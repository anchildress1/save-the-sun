import { json } from '@sveltejs/kit';
import { logEvent } from '$lib/server/debug/log';
import { claimVoiceDebugSlot } from '$lib/server/voice/rateLimit';
import type { RequestHandler } from './$types';

// Tee for the browser-side voice session into the /debug stream. Bounded by the message cap here,
// the rate limiter, and the log's own 200-event trim.
const LEVELS = new Set(['info', 'error']);
const MAX_MESSAGE_CHARS = 300;
const MAX_DATA_CHARS = 1_000;

function boundData(raw: Record<string, unknown>): Record<string, unknown> {
	try {
		return JSON.stringify(raw).length <= MAX_DATA_CHARS ? raw : { _truncated: true };
	} catch {
		return { _truncated: true };
	}
}

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

	// Unauthenticated and client-controlled — cap it so a client can't flood the public /debug stream.
	const verdict = claimVoiceDebugSlot(locals.sessionId);
	if (!verdict.ok) {
		return json(
			{ error: 'Too many voice debug events.' },
			{ status: 429, headers: { 'retry-after': String(verdict.retryAfterSeconds) } }
		);
	}

	// Owner/kind/part fixed server-side so a client can't forge Engine verdicts into the stream.
	logEvent(locals.sessionId, {
		owner: 'Oracle',
		kind: 'llm',
		part: 'Voice',
		level: level as 'info' | 'error',
		message: message.slice(0, MAX_MESSAGE_CHARS),
		...(data !== null && typeof data === 'object' && !Array.isArray(data)
			? { data: boundData(data as Record<string, unknown>) }
			: {})
	});
	return new Response(null, { status: 204 });
};
