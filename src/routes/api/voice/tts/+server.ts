import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { claimTtsSlot } from '$lib/server/voice/rateLimit';
import { composeLine, isLineDescriptor, voiceForLine, synthPrompt } from '$lib/server/voice/lines';
import { getVoiceLine } from '$lib/server/engine/session';
import { synthesizeStream, isCached } from '$lib/server/voice/tts';
import type { RequestHandler } from './$types';

const badLine = () => json({ error: 'Unknown voice line.' }, { status: 400 });

// Voices one server-owned line as a stream of base64 PCM chunks the browser's speaker plays as they
// arrive — so the Oracle starts speaking at the first chunk, not after the whole clip. The browser
// sends a descriptor (the "line ID"), never free text: the server composes the exact words from the
// allow-list, so this route can't be turned into a free arbitrary-text TTS endpoint.
export const POST: RequestHandler = async ({ request, locals }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return badLine();
	}

	if (!isLineDescriptor(body)) return badLine();

	// Two resolution paths, ONE invariant — the client never supplies the words. An `authored` line
	// (Gemini-written, dynamic) is looked up by id from this session's store; everything else recomposes
	// from the descriptor. A well-shaped descriptor that resolves to nothing (unknown id, or values that
	// don't compose to an allow-listed line) is refused BEFORE any quota spend.
	let line: string | null;
	let voice: string;
	// Set only for an authored line: its deterministic counterpart, voiced if the authored synth 429s.
	let fallbackPrompt: string | null = null;
	if (body.kind === 'authored') {
		const stored = getVoiceLine(locals.sessionId, body.id);
		if (stored === null) return badLine();
		line = stored.text;
		voice = stored.voice;
		fallbackPrompt = synthPrompt(voice, stored.fallback);
	} else {
		line = composeLine(body);
		if (line === null) return badLine();
		voice = voiceForLine(body);
	}
	// Authored lines are unique per call, so they're never cacheable — a unique key can't replay, and
	// caching it would only grow memory for the life of the process.
	const cacheable = body.kind !== 'authored';
	// The synthesis prompt wraps the line in its speaker's director's-notes (both voices, never bare).
	const prompt = synthPrompt(voice, line);

	// A cached line replays from memory — no Gemini call — so it skips both the synth budget and the
	// key requirement. Only an uncached line costs a synth: gate it, and fail loudly (503, not a silent
	// empty 200) when voice is unconfigured so a deploy/config failure is visible.
	if (!isCached(prompt, voice)) {
		if (!env.GEMINI_API_KEY) return json({ error: 'Voice is unavailable.' }, { status: 503 });
		const verdict = claimTtsSlot(locals.sessionId);
		if (!verdict.ok) {
			return json(
				{ error: 'Too many voice requests. Try again shortly.' },
				{ status: 429, headers: { 'retry-after': String(verdict.retryAfterSeconds) } }
			);
		}
	}

	// NDJSON: one base64 PCM chunk per line. A synth failure mid-stream ends it early — the audio is
	// best-effort (the panel already carries the text) past this point. The pump is guarded so a client
	// disconnect (enqueue on a torn stream) closes deliberately instead of escaping as an unhandled
	// rejection — matching every other voice path, which degrades on purpose, not by accident.
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const pump = async (text: string, mayCache: boolean): Promise<boolean> => {
				let voiced = false;
				for await (const chunk of synthesizeStream(text, voice, mayCache)) {
					controller.enqueue(encoder.encode(chunk + '\n'));
					voiced = true;
				}
				return voiced;
			};
			try {
				// An authored line is unique and never cached, so it dies first under quota. When its synth
				// makes no audio, voice the deterministic counterpart instead — it's cacheable, so once
				// synthesized it replays free even while quota stays exhausted.
				const voiced = await pump(prompt, cacheable);
				if (!voiced && fallbackPrompt) await pump(fallbackPrompt, true);
			} catch {
				/* torn stream / client gone — audio is best-effort past here */
			} finally {
				try {
					controller.close();
				} catch {
					/* already errored or closed */
				}
			}
		}
	});

	return new Response(stream, {
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' }
	});
};
