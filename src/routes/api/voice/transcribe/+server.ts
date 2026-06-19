import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { claimTranscribeSlot } from '$lib/server/voice/rateLimit';
import {
	transcribe,
	classifyReaction,
	classifyCast,
	interpretAsk
} from '$lib/server/voice/transcribe';
import { logEvent } from '$lib/server/debug/log';
import { runes as boardRunes } from '$lib/board';
import type { RequestHandler } from './$types';

// A held push-to-talk utterance is a base64 WAV; cap it so a malformed/huge payload can't be sent
// to Gemini. ~5MB base64 ≈ 3.6MB audio ≈ well over a minute at 16kHz mono — plenty for one Ask.
const MAX_WAV_BASE64 = 5_000_000;
// Cap the request body before it's buffered for parse — the base64 cap above only fires after the
// whole payload is already in memory. Margin covers the JSON keys and the optional rune list.
const MAX_REQUEST_BYTES = MAX_WAV_BASE64 + 16_384;

// Cast matching uses the SERVER's canonical rune names, never the client's list — the board always
// holds these 24, so a malformed client can't pad the Gemini prompt with junk labels under our key.
const RUNE_NAMES = boardRunes.map((rune) => rune.name);

// Read the body as text, capped at maxBytes — enforced WHILE streaming, so a chunked request or one
// with a missing/garbled Content-Length can't slip an oversized payload past a header check. null once
// the cap is exceeded (the read is aborted without buffering the rest).
async function readCappedBody(request: Request, maxBytes: number): Promise<string | null> {
	const reader = request.body?.getReader();
	if (!reader) return '';
	const decoder = new TextDecoder();
	let text = '';
	let bytes = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return text + decoder.decode();
		bytes += value.byteLength;
		if (bytes > maxBytes) {
			await reader.cancel().catch(() => {}); // a cancel that rejects must still yield a clean 413
			return null;
		}
		text += decoder.decode(value, { stream: true });
	}
}

type Mode = 'ask' | 'reaction' | 'cast';
interface ParsedRequest {
	wavBase64: string;
	mode: Mode | undefined;
	runes: unknown;
}

// Parse and validate the request envelope — JSON shape plus the audio/mode/cast fields. Returns a
// ready-to-send 4xx Response on any violation, or the validated fields.
async function parseRequest(request: Request): Promise<Response | ParsedRequest> {
	const raw = await readCappedBody(request, MAX_REQUEST_BYTES);
	if (raw === null) return json({ error: 'Payload too large.' }, { status: 413 });
	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		return json({ error: 'Bad request.' }, { status: 400 });
	}
	// A bare JSON `null` / non-object parses fine but would throw on destructure — treat it as a 400.
	if (typeof body !== 'object' || body === null) {
		return json({ error: 'Bad request.' }, { status: 400 });
	}
	const { wavBase64, mode, runes } = body as {
		wavBase64?: unknown;
		mode?: unknown;
		runes?: unknown;
	};
	if (
		typeof wavBase64 !== 'string' ||
		wavBase64.length === 0 ||
		wavBase64.length > MAX_WAV_BASE64
	) {
		return json({ error: 'Bad audio.' }, { status: 400 });
	}
	if (mode !== undefined && mode !== 'ask' && mode !== 'reaction' && mode !== 'cast') {
		return json({ error: 'Bad mode.' }, { status: 400 });
	}
	if (mode === 'cast' && !Array.isArray(runes)) {
		return json({ error: 'Bad cast targets.' }, { status: 400 });
	}
	return { wavBase64, mode, runes };
}

// Tee what was heard to /debug so a mishear is diagnosable — it never fills the player's typing box,
// but the spoken intent is visible in the stream that follows the rite's truth.
function teeHeard(sessionId: string, message: string): void {
	logEvent(sessionId, { owner: 'Human', kind: 'input', part: 'Voice', level: 'info', message });
}

// Reads a recorded utterance: `ask` (default) transcribes it verbatim into the player's question;
// `reaction` classifies a reply to Sköll's hanging question into scry/hex/pass (or unclear); `cast`
// matches a spoken rune name (against the server's canonical board names) to commit an armed cast.
// The browser sends only audio — the engine still runs the same Ask/React/Cast paths the buttons use.
export const POST: RequestHandler = async ({ request, locals }) => {
	const parsed = await parseRequest(request);
	if (parsed instanceof Response) return parsed;
	const { wavBase64, mode, runes } = parsed;

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

	if (mode === 'reaction') {
		const choice = await classifyReaction(wavBase64);
		teeHeard(locals.sessionId, `heard reaction: ${choice}`);
		return json({ choice });
	}

	if (mode === 'cast') {
		const rune = await classifyCast(wavBase64, RUNE_NAMES);
		teeHeard(locals.sessionId, `heard cast: ${rune || '(unclear)'}`);
		return json({ rune });
	}

	// Default (ask): a question, or a hands-free cast when the player names a board rune. The client
	// sends `runes` only as the signal that it wants cast detection; the match runs against the
	// server's canonical names. Without the signal it's a plain transcribe.
	if (Array.isArray(runes)) {
		const result = await interpretAsk(wavBase64, RUNE_NAMES);
		if ('cast' in result) {
			teeHeard(locals.sessionId, `heard cast: ${result.cast || '(unclear)'}`);
			return json({ rune: result.cast });
		}
		teeHeard(locals.sessionId, `heard: ${result.text || '(nothing)'}`);
		return json({ text: result.text });
	}

	const text = await transcribe(wavBase64);
	teeHeard(locals.sessionId, `heard: ${text || '(nothing)'}`);
	return json({ text });
};
