import { json } from '@sveltejs/kit';
import { logEvent } from '$lib/server/debug/log';
import type { RequestHandler } from './$types';

// Tee for the browser-side voice session into the /debug stream. Bounded twice: the message cap
// here and the log's own 200-event trim.
const LEVELS = new Set(['info', 'error']);
const MAX_MESSAGE_CHARS = 300;

export const POST: RequestHandler = async ({ request, locals }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid voice debug event.' }, { status: 400 });
	}
	const { level, message, data } = (body ?? {}) as Record<string, unknown>;
	if (typeof message !== 'string' || message.length === 0 || !LEVELS.has(level as string)) {
		return json({ error: 'Invalid voice debug event.' }, { status: 400 });
	}

	// Owner/kind/part fixed server-side so a client can't forge Engine verdicts into the stream.
	logEvent(locals.sessionId, {
		owner: 'Oracle',
		kind: 'llm',
		part: 'Voice',
		level: level as 'info' | 'error',
		message: message.slice(0, MAX_MESSAGE_CHARS),
		...(data !== null && typeof data === 'object' && !Array.isArray(data)
			? { data: data as Record<string, unknown> }
			: {})
	});
	return new Response(null, { status: 204 });
};
