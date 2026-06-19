// The Oracle's voice, server-side. Streams a composed line as base64 PCM16 @ 24kHz chunks the
// browser's speaker plays as they arrive (same format Live emitted) — so she starts speaking at
// the first chunk (~1s) instead of waiting for the whole clip (~2.5s). The key stays here. Lines
// are finite and templated, so a per-text cache means most turns replay without a Gemini call.

import { GoogleGenAI, Modality } from '@google/genai';
import { env } from '$env/dynamic/private';
import { TTS_MODEL } from '$lib/voice/config';
import { maskApiKey } from '$lib/server/debug/log';

// Keyed by voice + text: the Oracle and Sköll speak different lines, but a shared line in two voices
// must cache as two clips, not collide.
const cache = new Map<string, string[]>();
const cacheKey = (voice: string, text: string) => `${voice}\n${text}`;

// The deterministic line space is finite, but a hard cap keeps the cache provably bounded regardless —
// PCM clips are large, and nothing else evicts them for the life of the process.
const MAX_CLIPS = 128;

// Store a finished clip; an uncacheable (authored, unique) or empty one is dropped. Insertion-ordered,
// so once over the cap the oldest falls off the front.
function remember(key: string, chunks: string[], cacheable: boolean): void {
	if (!cacheable || chunks.length === 0) return;
	cache.set(key, chunks);
	if (cache.size > MAX_CLIPS) cache.delete(cache.keys().next().value as string);
}

/** Whether this exact line+voice is already synthesized — a cached replay costs no Gemini call, so the
 *  route can serve it without spending a synth-rate-limit slot. */
export function isCached(text: string, voice: string): boolean {
	return cache.has(cacheKey(voice, text));
}

let client: GoogleGenAI | null = null;
function ai(apiKey: string): GoogleGenAI {
	// 3 backoff attempts (408/429/5xx) — the TTS preview model 500s occasionally, and one blip
	// shouldn't drop a line to text-only.
	client ??= new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 3 } } });
	return client;
}

/**
 * Stream one allow-listed line as base64 PCM chunks. Replays a cached clip's chunks when one
 * exists; otherwise streams from Gemini, accumulating the chunks to cache only on a clean finish.
 * Yields nothing (silent) when the key is missing or synthesis fails — the panel still has the line.
 */
export async function* synthesizeStream(
	text: string,
	voice: string,
	cacheable = true
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

	const chunks: string[] = [];
	try {
		const stream = await ai(env.GEMINI_API_KEY).models.generateContentStream({
			model: TTS_MODEL,
			contents: [{ role: 'user', parts: [{ text }] }],
			config: {
				responseModalities: [Modality.AUDIO],
				speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
			}
		});
		for await (const part of stream) {
			const data = part.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
			if (data) {
				if (cacheable) chunks.push(data);
				yield data;
			}
		}
		// Cache only a complete clip — a stream that errored mid-flight must not replay truncated.
		// Authored lines (Gemini-written, unique every call) are never cacheable: a unique key can't
		// replay, so caching only grows memory unbounded for the life of the process.
		remember(key, chunks, cacheable);
	} catch (err) {
		// Keep the stack but mask it — an SDK error can embed the request URL, and with it the key.
		const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
		console.error('[voice] TTS synth failed:', maskApiKey(detail));
	}
}

/** Test isolation only — the cache is module state shared across a test file. */
export function resetTtsCache(): void {
	cache.clear();
	client = null;
}
