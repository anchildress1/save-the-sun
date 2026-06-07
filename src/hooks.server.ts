import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';

// One sessionId per browser so the page load and /api/action resolve the same engine.
const COOKIE = 'sts_session';

export const handle: Handle = async ({ event, resolve }) => {
	// `!sessionId` not `=== undefined`: an empty-string cookie is junk, regenerate it.
	let sessionId = event.cookies.get(COOKIE);
	if (!sessionId) {
		sessionId = crypto.randomUUID();
		// httpOnly: server bookkeeping, no client code reads it. secure outside dev so the
		// session id never rides plain HTTP (dev runs on http://localhost).
		event.cookies.set(COOKIE, sessionId, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: !dev
		});
		if (dev) console.debug(`[session] created ${sessionId}`);
	}
	event.locals.sessionId = sessionId;
	return resolve(event);
};
