import { json } from '@sveltejs/kit';
import { claimTtsSlot } from '$lib/server/voice/rateLimit';
import { composeLine, isLineDescriptor } from '$lib/server/voice/lines';
import { synthesizeStream } from '$lib/server/voice/tts';
import type { RequestHandler } from './$types';

const badLine = () => json({ error: 'Unknown voice line.' }, { status: 400 });

// Voices one server-owned line as a stream of base64 PCM chunks the browser's speaker plays as they
// arrive — so the Oracle starts speaking at the first chunk, not after the whole clip. The browser
// sends a descriptor (the "line ID"), never free text: the server composes the exact words from the
// allow-list, so this route can't be turned into a free arbitrary-text TTS endpoint.
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

	// NDJSON: one base64 PCM chunk per line. A synth failure ends the stream early — the audio is
	// best-effort (the panel already carries the text), so there is no mid-stream error status.
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			for await (const chunk of synthesizeStream(line)) {
				controller.enqueue(encoder.encode(chunk + '\n'));
			}
			controller.close();
		}
	});

	return new Response(stream, {
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' }
	});
};
