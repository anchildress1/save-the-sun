import { getEvents } from '$lib/server/debug/log';
import { resolveSessionId } from '$lib/server/debug/scope';
import type { PageServerLoad } from './$types';

// First paint of the demo log; the page then polls /api/debug to stay live while screen-shared.
// ?session=<id> scopes the view to any session so a second screen can follow a phone demo.
export const load: PageServerLoad = ({ locals, url }) => {
	const sessionId = resolveSessionId(url, locals.sessionId);
	return { sessionId, events: getEvents(sessionId) };
};
