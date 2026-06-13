import { beforeEach, describe, it, expect, vi } from 'vitest';

// Pin dev:false so the cookie is set with secure:true — the production posture we want to
// assert (secure: !dev). Also keeps the dev-only "created" debug log out of the test output.
vi.mock('$app/environment', () => ({ dev: false }));

import { handle, SESSIONLESS_PATHS, READONLY_SESSION_PATHS } from '../src/hooks.server';

function fakeEvent(existing?: string, pathname = '/') {
	const store = new Map<string, string>();
	if (existing !== undefined) store.set('sts_session', existing);
	const set = vi.fn((name: string, value: string) => store.set(name, value));
	const locals: { sessionId?: string } = {};
	const url = new URL(`https://save-the-sun.test${pathname}`);
	return {
		event: {
			url,
			request: new Request(url),
			cookies: { get: (name: string) => store.get(name), set },
			locals
		},
		set,
		locals
	};
}

const resolve = vi.fn(async () => new Response('ok'));

describe('session hook', () => {
	beforeEach(() => {
		resolve.mockClear();
	});

	it('reuses an existing session cookie without re-setting it', async () => {
		const { event, set, locals } = fakeEvent('known-session');
		await handle({ event, resolve } as never);
		expect(locals.sessionId).toBe('known-session');
		expect(set).not.toHaveBeenCalled();
	});

	it('generates and sets an httpOnly cookie when none is present', async () => {
		const { event, set, locals } = fakeEvent();
		await handle({ event, resolve } as never);
		expect(locals.sessionId).toEqual(expect.any(String));
		expect(locals.sessionId).not.toBe('');
		expect(set).toHaveBeenCalledWith(
			'sts_session',
			locals.sessionId,
			// secure: true here because the test env is not dev (secure: !dev).
			expect.objectContaining({ path: '/', httpOnly: true, sameSite: 'lax', secure: true })
		);
	});

	it('regenerates when the cookie is present but empty', async () => {
		const { event, set, locals } = fakeEvent('');
		await handle({ event, resolve } as never);
		expect(locals.sessionId).toEqual(expect.any(String));
		expect(locals.sessionId).not.toBe('');
		expect(set).toHaveBeenCalledOnce();
	});

	it('passes the request through to resolve', async () => {
		const { event } = fakeEvent('any');
		const res = await handle({ event, resolve } as never);
		expect(await res.text()).toBe('ok');
	});

	// Stale HTML outliving its hashed assets is the failure mode here: a deploy swaps the
	// Cloud Run image, the old /_app/immutable files vanish, and any cached document 404s
	// on its own CSS. no-cache forces revalidation so the page always matches its assets.
	it('marks HTML responses no-cache so stale documents never reference dead assets', async () => {
		const html = vi.fn(
			async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })
		);
		const { event } = fakeEvent('any');
		const res = await handle({ event, resolve: html } as never);
		expect(res.headers.get('cache-control')).toBe('no-cache');
	});

	it('leaves cache-control untouched on non-HTML responses', async () => {
		const json = vi.fn(
			async () => new Response('{}', { headers: { 'content-type': 'application/json' } })
		);
		const { event } = fakeEvent('any');
		const res = await handle({ event, resolve: json } as never);
		expect(res.headers.get('cache-control')).toBeNull();
	});

	// Every sessionless path, not just one — a typo in any entry would silently route that asset
	// through cookie creation, defeating its cacheability, with nothing to catch the omission.
	it.each([...SESSIONLESS_PATHS])('does not create a session for %s', async (pathname) => {
		const { event, set, locals } = fakeEvent(undefined, pathname);
		const res = await handle({ event, resolve } as never);
		expect(await res.text()).toBe('ok');
		expect(locals.sessionId).toBeUndefined();
		expect(set).not.toHaveBeenCalled();
		expect(resolve).toHaveBeenCalledOnce();
	});

	// Read-only paths (the debug view + its poll) must scope to a session without ever minting one —
	// a second-screen viewer should never spawn a junk game session just by opening the log.
	it.each([...READONLY_SESSION_PATHS])(
		'does not mint a session for %s (no cookie)',
		async (path) => {
			const { event, set, locals } = fakeEvent(undefined, path);
			await handle({ event, resolve } as never);
			expect(set).not.toHaveBeenCalled();
			expect(locals.sessionId).toBe(''); // empty id → empty log; ?session= still overrides downstream
		}
	);

	it.each([...READONLY_SESSION_PATHS])(
		'reads an existing cookie on %s without re-setting',
		async (path) => {
			const { event, set, locals } = fakeEvent('known-session', path);
			await handle({ event, resolve } as never);
			expect(locals.sessionId).toBe('known-session');
			expect(set).not.toHaveBeenCalled();
		}
	);
});
