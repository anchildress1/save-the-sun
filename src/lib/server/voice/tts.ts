// The Oracle's voice, server-side. Streams a composed line as base64 PCM16 @ 24kHz chunks the
// browser's speaker plays as they arrive (same format Live emitted) — so she starts speaking at
// the first chunk (~1s) instead of waiting for the whole clip (~2.5s). The key stays here. Lines
// are finite and templated, so a per-text cache means most turns replay without a Gemini call.

import { GoogleGenAI, Modality } from '@google/genai';
import { env } from '$env/dynamic/private';
import { ORACLE_VOICE, TTS_MODEL } from '$lib/voice/config';
import { maskApiKey } from '$lib/server/debug/log';

const cache = new Map<string, string[]>();

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
export async function* synthesizeStream(text: string): AsyncGenerator<string> {
	const cached = cache.get(text);
	if (cached !== undefined) {
		yield* cached;
		return;
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
				speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: ORACLE_VOICE } } }
			}
		});
		for await (const part of stream) {
			const data = part.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
			if (data) {
				chunks.push(data);
				yield data;
			}
		}
		// Cache only a complete clip — a stream that errored mid-flight must not replay truncated.
		if (chunks.length > 0) cache.set(text, chunks);
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
