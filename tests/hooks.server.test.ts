import { beforeEach, describe, it, expect, vi } from 'vitest';

// Pin dev:false so the cookie is set with secure:true — the production posture we want to
// assert (secure: !dev). Also keeps the dev-only "created" debug log out of the test output.
vi.mock('$app/environment', () => ({ dev: false }));

import { handle } from '../src/hooks.server';

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

	it('does not create sessions for cacheable pwa assets', async () => {
		const { event, set, locals } = fakeEvent(undefined, '/icon-512.png');
		const res = await handle({ event, resolve } as never);
		expect(await res.text()).toBe('ok');
		expect(locals.sessionId).toBeUndefined();
		expect(set).not.toHaveBeenCalled();
		expect(resolve).toHaveBeenCalledOnce();
	});
});
