import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { buildLimiterKey, claimTtsSlot } from '$lib/server/voice/rateLimit';
import {
	composeLine,
	isLineDescriptor,
	voiceForLine,
	synthPrompt,
	type LineDescriptor
} from '$lib/server/voice/lines';
import { getVoiceLine } from '$lib/server/engine/session';
import { synthesizeStream, isCached } from '$lib/server/voice/tts';
import { SKOLL_VOICE, type VoiceId } from '$lib/voice/config';
import { logEvent } from '$lib/server/debug/log';
import type { RequestHandler } from './$types';

const badLine = () => json({ error: 'Unknown voice line.' }, { status: 400 });

// Tee a voice outcome to /debug — the TTS path was otherwise silent there, so a non-speaking Oracle
// (refused line, denied slot, dead synth) left no trace to follow.
function logVoice(
	sessionId: string,
	level: 'info' | 'warn',
	message: string,
	voice?: VoiceId
): void {
	logEvent(sessionId, {
		owner: voice === SKOLL_VOICE ? 'Sköll' : 'Oracle',
		kind: 'llm',
		part: 'Voice',
		level,
		message: `TTS — ${message}`
	});
}

// planSynth only ever denies with 429 (limiter) or 503 (no key) — those are the two reasons.
function denialReason(status: number): string {
	return status === 429 ? 'rate-limited' : 'unavailable (no key)';
}

// The resolved words for a descriptor. `cacheable` is false only for authored lines (unique per call,
// so they can never replay); `fallbackPrompt` is their deterministic counterpart, voiced if the
// authored synth is blocked or makes no audio.
interface Resolved {
	voice: VoiceId;
	prompt: string;
	cacheable: boolean;
	fallbackPrompt: string | null;
}

interface Plan {
	voice: VoiceId;
	synthText: string;
	synthMayCache: boolean;
	fallbackPrompt: string | null;
}

// Resolve a descriptor to its words + voice — by id from the session store for an authored line, or
// recomposed from the allow-list otherwise. null when it maps to no allow-listed line (refuse before
// any quota spend). The client never supplies the words: this is what keeps the route from becoming a
// free arbitrary-text TTS endpoint.
function resolveLine(body: LineDescriptor, sessionId: string): Resolved | null {
	if (body.kind === 'authored') {
		const stored = getVoiceLine(sessionId, body.id);
		if (stored === null) return null;
		return {
			voice: stored.voice,
			prompt: synthPrompt(stored.voice, stored.text),
			cacheable: false,
			fallbackPrompt: synthPrompt(stored.voice, stored.fallback)
		};
	}
	const line = composeLine(body);
	if (line === null) return null;
	const voice = voiceForLine(body);
	return { voice, prompt: synthPrompt(voice, line), cacheable: true, fallbackPrompt: null };
}

// A cached cacheable line replays free (no key, no slot). Otherwise gate a fresh synth on the key +
// limiter. An authored line never replays from its own unique prompt (cacheable=false skips the cache),
// so it always faces the gate; on a block, a cached deterministic counterpart replays before going silent.
function planSynth(resolved: Resolved, sessionId: string, limitKey: string): Plan | Response {
	const { voice, prompt, cacheable, fallbackPrompt } = resolved;
	const plan = (synthText: string, synthMayCache: boolean): Plan => ({
		voice,
		synthText,
		synthMayCache,
		fallbackPrompt
	});
	if (cacheable && isCached(prompt, voice)) return plan(prompt, true);

	const fallbackReplay =
		fallbackPrompt !== null && isCached(fallbackPrompt, voice) ? fallbackPrompt : null;
	if (!env.GEMINI_API_KEY) {
		return fallbackReplay
			? plan(fallbackReplay, true)
			: json({ error: 'Voice is unavailable.' }, { status: 503 });
	}
	const verdict = claimTtsSlot(limitKey);
	if (verdict.ok) return plan(prompt, cacheable);
	return fallbackReplay
		? plan(fallbackReplay, true)
		: json(
				{ error: 'Too many voice requests. Try again shortly.' },
				{ status: 429, headers: { 'retry-after': String(verdict.retryAfterSeconds) } }
			);
}

// Stream the planned line as NDJSON base64 PCM chunks the browser plays as they arrive. A synth that
// makes no audio (a mid-stream 429, key gone) falls back to the cacheable counterpart unless that's
// already what we're voicing. The pump is guarded so a torn stream / client disconnect closes
// deliberately instead of escaping as an unhandled rejection — audio is best-effort past the panel text.
function streamLine(
	{ voice, synthText, synthMayCache, fallbackPrompt }: Plan,
	sessionId: string
): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const pump = async (text: string, mayCache: boolean): Promise<boolean> => {
				let voiced = false;
				for await (const chunk of synthesizeStream(text, voice, mayCache, sessionId)) {
					controller.enqueue(encoder.encode(chunk + '\n'));
					voiced = true;
				}
				return voiced;
			};
			try {
				let voiced = await pump(synthText, synthMayCache);
				// Only replay an ALREADY-cached fallback — a fresh synth here would be a second uncapped
				// Gemini call past the one slot this request claimed. Uncached, stay silent (the panel
				// carries the line); the deterministic line gets cached via normal voicing elsewhere.
				if (
					!voiced &&
					fallbackPrompt &&
					synthText !== fallbackPrompt &&
					isCached(fallbackPrompt, voice)
				) {
					voiced = await pump(fallbackPrompt, true);
					logVoice(
						sessionId,
						voiced ? 'info' : 'warn',
						voiced ? 'voiced the cached fallback' : 'no audio — silent',
						voice
					);
				} else {
					logVoice(
						sessionId,
						voiced ? 'info' : 'warn',
						voiced ? 'voiced' : 'synth produced no audio — silent',
						voice
					);
				}
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
}

// Voices one server-owned line as a stream of base64 PCM chunks the browser's speaker plays as they
// arrive — so the Oracle starts speaking at the first chunk, not after the whole clip. The browser
// sends a descriptor (the "line ID"), never free text.
export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return badLine();
	}
	if (!isLineDescriptor(body)) return badLine();

	const sessionId = locals.sessionId;
	const resolved = resolveLine(body, sessionId);
	if (resolved === null) {
		logVoice(sessionId, 'warn', `refused an unknown or evicted line (kind: ${body.kind})`);
		return badLine();
	}

	const limitKey = buildLimiterKey(
		typeof getClientAddress === 'function' ? getClientAddress() : undefined,
		sessionId
	);

	const plan = planSynth(resolved, sessionId, limitKey);
	if (plan instanceof Response) {
		logVoice(sessionId, 'warn', `not voiced (${denialReason(plan.status)})`, resolved.voice);
		return plan;
	}
	return streamLine(plan, sessionId);
};
