// Push-to-talk understanding, server-side. A held recording (WAV PCM16 mono @ 16kHz) is sent to
// Gemini — verbatim transcription for an Ask, or a one-word classification when the player is
// replying to Sköll's hanging question. The text/intent then drives the same engine paths the
// buttons use. The key stays here.

import { GoogleGenAI } from '@google/genai';
import { env } from '$env/dynamic/private';
import { STT_MODEL } from '$lib/voice/config';
import { maskApiKey } from '$lib/server/debug/log';

/** A spoken reply to Sköll's Ask, classified into a reaction — or `unclear` when it matches none. */
export type SpokenReaction = 'scry' | 'hex' | 'pass' | 'unclear';

// One name back: the player has armed a cast and is naming the rune to commit. Constrained to the
// board so a mishear can't conjure a rune that isn't there.
const CAST_INSTRUCTION =
	'The player is naming one rune to cast as their final answer. The runes on the board are: {NAMES}. ' +
	'Output exactly one name, copied verbatim from that list, matching the rune they said. If their ' +
	'words match none of the listed runes, or are unintelligible, output "unclear". Output only the ' +
	'single name.';

let client: GoogleGenAI | null = null;
function ai(apiKey: string): GoogleGenAI {
	// 3 backoff attempts (408/429/5xx) — a single blip shouldn't drop the player's spoken turn.
	client ??= new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 3 } } });
	return client;
}

// Run one audio prompt and return the model's trimmed text, or '' when the key is missing or the
// call fails — callers degrade on '' rather than throwing.
async function runAudioPrompt(wavBase64: string, instruction: string): Promise<string> {
	if (!env.GEMINI_API_KEY) {
		console.error('[voice] GEMINI_API_KEY is not configured; cannot read voice input');
		return '';
	}
	try {
		const response = await ai(env.GEMINI_API_KEY).models.generateContent({
			model: STT_MODEL,
			contents: [
				{
					role: 'user',
					parts: [{ inlineData: { mimeType: 'audio/wav', data: wavBase64 } }, { text: instruction }]
				}
			]
		});
		return (response.text ?? '').trim();
	} catch (err) {
		// Keep the stack but mask it — an SDK error can embed the request URL, and with it the key.
		const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
		console.error('[voice] voice-input read failed:', maskApiKey(detail));
		return '';
	}
}

// Verbatim only: the words become an Ask the engine interprets, so the model must not answer,
// rephrase, or editorialize — just return what was said (or nothing for silence).
const TRANSCRIBE_INSTRUCTION =
	'Transcribe the spoken question verbatim as plain text. Output only the words spoken — no ' +
	'quotes, no commentary, no answer. If there is no intelligible speech, output nothing.';

// One word back: the player is choosing a reaction to Sköll's challenge, not asking anything.
const REACTION_INSTRUCTION =
	'The player is replying to a yes/no challenge from Sköll the wolf. Classify their spoken reply ' +
	'into exactly one word: "scry" (overhear or steal the answer), "hex" (silence the Oracle and ' +
	'waste his turn), or "pass" (let his question stand, do nothing). If the reply is none of these ' +
	'or unintelligible, output "unclear". Output only the single word.';

/**
 * Transcribe a base64 WAV utterance to text. Returns the trimmed transcript, or an empty string
 * when the key is missing or the call fails — the caller treats empty as "nothing was heard".
 */
export async function transcribe(wavBase64: string): Promise<string> {
	return runAudioPrompt(wavBase64, TRANSCRIBE_INSTRUCTION);
}

/**
 * Classify a spoken reply to Sköll's hanging question into a reaction. Anything the model doesn't
 * map to scry/hex/pass — including a failed or keyless call — is `unclear`, so a mishear never
 * silently spends a one-use charge.
 */
export async function classifyReaction(wavBase64: string): Promise<SpokenReaction> {
	const word = (await runAudioPrompt(wavBase64, REACTION_INSTRUCTION)).toLowerCase();
	return word === 'scry' || word === 'hex' || word === 'pass' ? word : 'unclear';
}

/**
 * Match a spoken cast to one of the board's runes. Returns the verbatim board name, or '' when the
 * model's answer matches no listed rune (a mishear, "unclear", or a failed/keyless call) — so a
 * destructive, irreversible cast never fires on a guess.
 */
export async function classifyCast(wavBase64: string, runes: string[]): Promise<string> {
	const names = runes.filter((name) => typeof name === 'string' && name.trim() !== '');
	if (names.length === 0) return '';
	const said = (
		await runAudioPrompt(wavBase64, CAST_INSTRUCTION.replace('{NAMES}', names.join(', ')))
	).toLowerCase();
	return names.find((name) => name.toLowerCase() === said) ?? '';
}

/** Test isolation only — the client is module state shared across a test file. */
export function resetTranscribeClient(): void {
	client = null;
}
