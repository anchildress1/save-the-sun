import { json } from '@sveltejs/kit';
import { claimTtsSlot } from '$lib/server/voice/rateLimit';
import { composeLine, isLineDescriptor } from '$lib/server/voice/lines';
import { synthesize } from '$lib/server/voice/tts';
import type { RequestHandler } from './$types';

const badLine = () => json({ error: 'Unknown voice line.' }, { status: 400 });

// Voices one server-owned line as base64 PCM the browser's speaker plays directly. The browser
// sends a descriptor (the "line ID"), never free text: the server composes the exact words from
// the allow-list, so this route can't be turned into a free arbitrary-text TTS endpoint once the
// Live token path is gone.
export const POST: RequestHandler = async ({ request, locals }) => {
	const verdict = claimTtsSlot(locals.sessionId);
	if (!verdict.ok) {
		return json(
			{ error: 'Too many voice requests. Try again shortly.' },
			{ status: 429, headers: { 'retry-after': String(verdict.retryAfterSeconds) } }
		);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return badLine();
	}

	if (!isLineDescriptor(body)) return badLine();

	const line = composeLine(body);
	// A well-shaped descriptor whose values don't compose to an allow-listed line is refused, not
	// synthesized — the gate is the line, not the request shape.
	if (line === null) return badLine();

	const result = await synthesize(line);
	if (!result.ok) return json({ error: 'Voice is unavailable.' }, { status: 503 });

	return json({ audio: result.audio });
};
