// The Oracle's voice, server-side. Turns a composed line into base64 PCM16 @ 24kHz the browser's
// speaker plays as-is (same format Live emitted). The key stays here. Lines are finite and
// templated, so a per-text cache means most turns replay without a Gemini call.

import { GoogleGenAI, Modality } from '@google/genai';
import { env } from '$env/dynamic/private';
import { ORACLE_VOICE, TTS_MODEL } from '$lib/voice/config';
import { maskApiKey } from '$lib/server/debug/log';

const cache = new Map<string, string>();

let client: GoogleGenAI | null = null;
function ai(apiKey: string): GoogleGenAI {
	// 3 backoff attempts (408/429/5xx) — the TTS preview model 500s occasionally, and one blip
	// shouldn't drop a line to text-only.
	client ??= new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 3 } } });
	return client;
}

export type SynthResult = { ok: true; audio: string } | { ok: false };

/** Synthesize one allow-listed line to base64 PCM, replaying a cached clip when one exists. */
export async function synthesize(text: string): Promise<SynthResult> {
	const cached = cache.get(text);
	if (cached !== undefined) return { ok: true, audio: cached };

	if (!env.GEMINI_API_KEY) {
		console.error('[voice] GEMINI_API_KEY is not configured; cannot synthesize');
		return { ok: false };
	}

	try {
		const response = await ai(env.GEMINI_API_KEY).models.generateContent({
			model: TTS_MODEL,
			contents: [{ role: 'user', parts: [{ text }] }],
			config: {
				responseModalities: [Modality.AUDIO],
				speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: ORACLE_VOICE } } }
			}
		});
		const audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
		if (!audio) {
			console.error('[voice] TTS returned no audio data');
			return { ok: false };
		}
		cache.set(text, audio);
		return { ok: true, audio };
	} catch (err) {
		// Keep the stack but mask it — an SDK error can embed the request URL, and with it the key.
		const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
		console.error('[voice] TTS synth failed:', maskApiKey(detail));
		return { ok: false };
	}
}

/** Test isolation only — the cache is module state shared across a test file. */
export function resetTtsCache(): void {
	cache.clear();
	client = null;
}
