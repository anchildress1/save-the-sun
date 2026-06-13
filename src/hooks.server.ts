import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';

// One sessionId per browser so the page load and /api/action resolve the same engine.
const COOKIE = 'sts_session';
export const SESSIONLESS_PATHS = new Set([
	'/apple-touch-icon.png',
	'/favicon.ico',
	'/favicon-16x16.png',
	'/favicon-32x32.png',
	'/icon-192.png',
	'/icon-512.png',
	'/site.webmanifest'
]);

// /debug reads the session cookie to scope its log but must never mint one — viewing the log must
// not spawn a junk game session. No cookie → empty id, and getEvents('') is just an empty log.
export const READONLY_SESSION_PATHS = new Set(['/debug', '/api/debug']);

export const handle: Handle = async ({ event, resolve }) => {
	// Trim a trailing slash so /debug/ can't slip past the read-only check and mint a junk session.
	const pathname = event.url.pathname.replace(/(.)\/$/, '$1');
	if (SESSIONLESS_PATHS.has(pathname)) return resolve(event);

	// `!sessionId` not `=== undefined`: an empty-string cookie counts as absent. Minted below, but
	// only off the read-only paths — /debug never mints.
	let sessionId = event.cookies.get(COOKIE);
	if (!sessionId && !READONLY_SESSION_PATHS.has(pathname)) {
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
	// '' on an un-minted read-only path; getEvents('') is an empty log. Game paths always minted above.
	event.locals.sessionId = sessionId ?? '';
	const response = await resolve(event);

	// Every deploy replaces the Cloud Run image, deleting the previous build's hashed
	// /_app/immutable assets. A cached HTML document outlives the assets it references,
	// so the page must always revalidate — otherwise stale HTML 404s on its own CSS/JS.
	if (response.headers.get('content-type')?.includes('text/html')) {
		response.headers.set('cache-control', 'no-cache');
	}
	return response;
};
