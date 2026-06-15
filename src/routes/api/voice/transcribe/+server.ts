import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { claimTranscribeSlot } from '$lib/server/voice/rateLimit';
import { transcribe } from '$lib/server/voice/transcribe';
import { logEvent } from '$lib/server/debug/log';
import type { RequestHandler } from './$types';

// A held push-to-talk utterance is a base64 WAV; cap it so a malformed/huge payload can't be sent
// to Gemini. ~5MB base64 ≈ 3.6MB audio ≈ well over a minute at 16kHz mono — plenty for one Ask.
const MAX_WAV_BASE64 = 5_000_000;

// Turns a recorded utterance into the player's Ask text. The browser sends only audio; the engine
// still interprets the resulting text through the same Ask path the typed box uses, so this route
// adds transcription and nothing else.
export const POST: RequestHandler = async ({ request, locals }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Bad request.' }, { status: 400 });
	}

	const wavBase64 = (body as { wavBase64?: unknown }).wavBase64;
	if (
		typeof wavBase64 !== 'string' ||
		wavBase64.length === 0 ||
		wavBase64.length > MAX_WAV_BASE64
	) {
		return json({ error: 'Bad audio.' }, { status: 400 });
	}

	// Fail loudly (503) when voice is unconfigured so a deploy/config gap is visible, and gate the
	// Gemini call behind the per-session/global limiter (a denial spends nothing).
	if (!env.GEMINI_API_KEY) return json({ error: 'Voice is unavailable.' }, { status: 503 });
	const verdict = claimTranscribeSlot(locals.sessionId);
	if (!verdict.ok) {
		return json(
			{ error: 'Too many voice requests. Try again shortly.' },
			{ status: 429, headers: { 'retry-after': String(verdict.retryAfterSeconds) } }
		);
	}

	const text = await transcribe(wavBase64);
	// Tee what was heard to /debug so a mishear is diagnosable — it never fills the player's
	// typing box, but the spoken words are visible in the stream that follows the rite's truth.
	logEvent(locals.sessionId, {
		owner: 'Human',
		kind: 'input',
		part: 'Voice',
		level: 'info',
		message: `heard: ${text || '(nothing)'}`
	});
	return json({ text });
};
