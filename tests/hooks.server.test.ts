import { describe, it, expect, vi } from 'vitest';
import { handle } from '../src/hooks.server';

function fakeEvent(existing?: string) {
	const store = new Map<string, string>();
	if (existing !== undefined) store.set('sts_session', existing);
	const set = vi.fn((name: string, value: string) => store.set(name, value));
	const locals: { sessionId?: string } = {};
	return {
		event: {
			cookies: { get: (name: string) => store.get(name), set },
			locals
		},
		set,
		locals
	};
}

const resolve = vi.fn(async () => new Response('ok'));

describe('session hook', () => {
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
			expect.objectContaining({ path: '/', httpOnly: true, sameSite: 'lax' })
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
});
