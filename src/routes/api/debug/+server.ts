import { json } from '@sveltejs/kit';
import { getEvents } from '$lib/server/debug/log';
import { resolveSessionId } from '$lib/server/debug/scope';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals, url }) => {
	// ?session=<id> lets a second screen watch any session's log (phone demo, laptop view).
	const sessionId = resolveSessionId(url, locals.sessionId);
	return json({ sessionId, events: getEvents(sessionId) });
};
