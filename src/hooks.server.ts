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

// /debug and its poll READ the session to scope the log, but must never MINT one. Viewing a log is
// read-only: a second-screen viewer (laptop watching a phone) would otherwise be handed a brand-new
// empty session — a junk round that shows nothing. With no cookie they get an empty id (empty log);
// with a cookie, same-browser viewing still works; `?session=<id>` still scopes to any session.
export const READONLY_SESSION_PATHS = new Set(['/debug', '/api/debug']);

export const handle: Handle = async ({ event, resolve }) => {
	if (SESSIONLESS_PATHS.has(event.url.pathname)) return resolve(event);

	// `!sessionId` not `=== undefined`: an empty-string cookie is junk, regenerate it.
	let sessionId = event.cookies.get(COOKIE);
	if (!sessionId && !READONLY_SESSION_PATHS.has(event.url.pathname)) {
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
	// Empty string on a read-only path with no cookie: getEvents('') is just an empty log, and
	// resolveSessionId still lets ?session= override. Game paths always minted above, so they're set.
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
