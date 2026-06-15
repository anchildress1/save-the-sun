// Push-to-talk transcription, server-side. A held recording (WAV PCM16 mono @ 16kHz) is sent to
// Gemini and turned into the player's Ask text — the only new server step the spoken path adds; the
// text then runs the exact same Ask pipeline as the typed box. The key stays here.

import { GoogleGenAI } from '@google/genai';
import { env } from '$env/dynamic/private';
import { STT_MODEL } from '$lib/voice/config';
import { maskApiKey } from '$lib/server/debug/log';

let client: GoogleGenAI | null = null;
function ai(apiKey: string): GoogleGenAI {
	// 3 backoff attempts (408/429/5xx) — a single blip shouldn't drop the player's spoken turn.
	client ??= new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 3 } } });
	return client;
}

// Verbatim only: the words become an Ask the engine interprets, so the model must not answer,
// rephrase, or editorialize — just return what was said (or nothing for silence).
const INSTRUCTION =
	'Transcribe the spoken question verbatim as plain text. Output only the words spoken — no ' +
	'quotes, no commentary, no answer. If there is no intelligible speech, output nothing.';

/**
 * Transcribe a base64 WAV utterance to text. Returns the trimmed transcript, or an empty string
 * when the key is missing or the call fails — the caller treats empty as "nothing was heard"
 * (the typed Ask path already handles an empty question), so a failure degrades, never throws.
 */
export async function transcribe(wavBase64: string): Promise<string> {
	if (!env.GEMINI_API_KEY) {
		console.error('[voice] GEMINI_API_KEY is not configured; cannot transcribe');
		return '';
	}
	try {
		const response = await ai(env.GEMINI_API_KEY).models.generateContent({
			model: STT_MODEL,
			contents: [
				{
					role: 'user',
					parts: [{ inlineData: { mimeType: 'audio/wav', data: wavBase64 } }, { text: INSTRUCTION }]
				}
			]
		});
		return (response.text ?? '').trim();
	} catch (err) {
		// Keep the stack but mask it — an SDK error can embed the request URL, and with it the key.
		const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
		console.error('[voice] transcription failed:', maskApiKey(detail));
		return '';
	}
}

/** Test isolation only — the client is module state shared across a test file. */
export function resetTranscribeClient(): void {
	client = null;
}
