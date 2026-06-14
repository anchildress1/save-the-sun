import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { claimTtsSlot } from '$lib/server/voice/rateLimit';
import { composeLine, isLineDescriptor, voiceForLine, synthPrompt } from '$lib/server/voice/lines';
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

	const line = composeLine(body);
	// A well-shaped descriptor whose values don't compose to an allow-listed line is refused, not
	// synthesized — the gate is the line, not the request shape. Validated BEFORE any quota spend so a
	// flood of malformed/unknown payloads can't exhaust the synth budget.
	if (line === null) return badLine();
	// The descriptor's kind picks the voice (Sköll's lines in his voice, the Oracle's in hers) and the
	// synthesis prompt (Sköll's line wrapped in his director's-notes growl; the Oracle's spoken bare).
	const voice = voiceForLine(body);
	const prompt = synthPrompt(body, line);

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
	// best-effort (the panel already carries the text) past this point.
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			for await (const chunk of synthesizeStream(prompt, voice)) {
				controller.enqueue(encoder.encode(chunk + '\n'));
			}
			controller.close();
		}
	});

	return new Response(stream, {
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' }
	});
};
