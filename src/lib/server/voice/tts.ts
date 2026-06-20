// The Oracle's voice, server-side. Streams a composed line as base64 PCM16 @ 24kHz chunks the
// browser's speaker plays as they arrive (same format Live emitted) — so she starts speaking at
// the first chunk (~1s) instead of waiting for the whole clip (~2.5s). The key stays here. Lines
// are finite and templated, so a per-text cache means most turns replay without a Gemini call.

import { GoogleGenAI, Modality } from '@google/genai';
import { env } from '$env/dynamic/private';
import { TTS_MODEL, TTS_FALLBACK_MODEL, SKOLL_VOICE, type VoiceId } from '$lib/voice/config';
import { maskApiKey, logEvent } from '$lib/server/debug/log';

// Keyed by voice + text: the Oracle and Sköll speak different lines, but a shared line in two voices
// must cache as two clips, not collide.
const cache = new Map<string, string[]>();
const cacheKey = (voice: string, text: string) => `${voice}\n${text}`;

// The deterministic line space is finite, but a hard cap keeps the cache provably bounded regardless —
// PCM clips are large, and nothing else evicts them for the life of the process.
const MAX_CLIPS = 128;

// Store a finished clip; an empty one is dropped — a synth that yielded nothing, or an uncacheable
// authored line whose chunks were never accumulated. Insertion-ordered, so once over the cap the
// oldest falls off the front.
function remember(key: string, chunks: string[]): void {
	if (chunks.length === 0) return;
	cache.set(key, chunks);
	if (cache.size > MAX_CLIPS) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
}

/** Whether this exact line+voice is already synthesized — a cached replay costs no Gemini call, so the
 *  route can serve it without spending a synth-rate-limit slot. */
export function isCached(text: string, voice: string): boolean {
	return cache.has(cacheKey(voice, text));
}

let client: GoogleGenAI | null = null;
function ai(apiKey: string): GoogleGenAI {
	// 2 attempts (1 retry): the TTS preview model 500s occasionally, so one retry saves a line from
	// dropping to text-only — without the amplification a higher count piles onto a throttled key.
	client ??= new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 2 } } });
	return client;
}

// 429 is the shared-quota throttle we fall back on. The no-retry SDK path throws an ApiError with
// `.status`, but our client sets retryOptions — so a retried 429 escapes pRetry as a plain
// Error('Retryable HTTP Error: Too Many Requests') with no status. Match both shapes.
const isRateLimited = (err: unknown): boolean => {
	const status = (err as { status?: number })?.status;
	const message = String((err as { message?: unknown })?.message ?? '');
	return status === 429 || /\b429\b|RESOURCE_EXHAUSTED|Too Many Requests/i.test(message);
};

// Tee the model swap to /debug so a quota fallback is visible, not a silent degrade to the older model.
function logFallback(sessionId: string | undefined, voice: VoiceId): void {
	if (!sessionId) return;
	logEvent(sessionId, {
		owner: voice === SKOLL_VOICE ? 'Sköll' : 'Oracle',
		kind: 'llm',
		part: 'Voice',
		level: 'warn',
		message: `TTS rate-limited on ${TTS_MODEL}; retrying on ${TTS_FALLBACK_MODEL}`
	});
}

// A synth failure is masked (an SDK error can embed the key) and teed to /debug — without this the
// Oracle's silence is invisible there while the panel still shows her text.
function logSynthFailure(sessionId: string | undefined, voice: VoiceId, err: unknown): void {
	const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
	const masked = maskApiKey(detail);
	console.error('[voice] TTS synth failed:', masked);
	if (sessionId)
		logEvent(sessionId, {
			owner: voice === SKOLL_VOICE ? 'Sköll' : 'Oracle',
			kind: 'llm',
			part: 'Voice',
			level: 'error',
			message: `TTS synth failed: ${masked.split('\n')[0]}`
		});
}

/**
 * Stream one allow-listed line as base64 PCM chunks. Replays a cached clip's chunks when one
 * exists; otherwise streams from Gemini, accumulating the chunks to cache only on a clean finish.
 * Yields nothing (silent) when the key is missing or synthesis fails — the panel still has the line.
 * @param cacheable false for an authored one-off line — skips both the cache replay and storage.
 */
export async function* synthesizeStream(
	text: string,
	voice: VoiceId,
	cacheable = true,
	sessionId?: string
): AsyncGenerator<string> {
	const key = cacheKey(voice, text);
	if (cacheable) {
		const cached = cache.get(key);
		if (cached !== undefined) {
			yield* cached;
			return;
		}
	}

	if (!env.GEMINI_API_KEY) {
		console.error('[voice] GEMINI_API_KEY is not configured; cannot synthesize');
		return;
	}

	// Primary then fallback: the older model is tried only when the primary 429s before a single chunk —
	// once audio is on the wire, switching models would re-speak the line in the other voice.
	const models = [TTS_MODEL, TTS_FALLBACK_MODEL];
	for (let i = 0; i < models.length; i++) {
		const chunks: string[] = [];
		let voiced = false;
		try {
			const stream = await ai(env.GEMINI_API_KEY).models.generateContentStream({
				model: models[i],
				contents: [{ role: 'user', parts: [{ text }] }],
				config: {
					responseModalities: [Modality.AUDIO],
					speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
				}
			});
			for await (const part of stream) {
				const data = part.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
				if (data) {
					voiced = true;
					if (cacheable) chunks.push(data);
					yield data;
				}
			}
			// Cache only a complete clip — a stream that errored mid-flight must not replay truncated.
			// Authored lines (Gemini-written, unique every call) are never cacheable: a unique key can't
			// replay, so caching only grows memory unbounded for the life of the process.
			remember(key, chunks);
			return;
		} catch (err) {
			// A pre-audio 429 with a model still to try drops to the fallback; anything else (or a tear
			// after audio already played) is the end — mask + tee, best-effort past here.
			if (!voiced && isRateLimited(err) && i < models.length - 1) {
				logFallback(sessionId, voice);
				continue;
			}
			logSynthFailure(sessionId, voice, err);
			return;
		}
	}
}

/** Test isolation only — the cache is module state shared across a test file. */
export function resetTtsCache(): void {
	cache.clear();
	client = null;
}
