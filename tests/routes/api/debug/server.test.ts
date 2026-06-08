import { describe, it, expect, beforeEach, vi } from 'vitest';

// debugLevel reads $env/dynamic/private + $app/environment; mock both to drive the level.
const mock = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: mock.env }));
vi.mock('$app/environment', () => ({ dev: true }));

import { GET } from '$routes/api/debug/+server';
import { load } from '$routes/debug/+page.server';
import { logEvent, resetLog } from '$lib/server/debug/log';

const SID = 'debug-route';
const safe = { channel: 'turn', level: 'info', message: 'safe move' } as const;
const secret = { channel: 'session', level: 'info', sensitive: true, message: 'secret' } as const;

const getJson = (sessionId: string) => (GET({ locals: { sessionId } } as never) as Response).json();
const runLoad = (sessionId: string) =>
	load({ locals: { sessionId } } as never) as { level: string; events: unknown[] };

describe('GET /api/debug + /debug load', () => {
	beforeEach(() => {
		resetLog(SID);
		mock.env.DEBUG_LOG = 'verbose';
	});

	it('verbose returns the level and every event, sensitive included', async () => {
		logEvent(SID, safe);
		logEvent(SID, secret);
		const body = await getJson(SID);
		expect(body.level).toBe('verbose');
		expect(body.events).toHaveLength(2);
	});

	it('demo strips sensitive events (no secret on the wire)', async () => {
		mock.env.DEBUG_LOG = 'demo';
		logEvent(SID, safe);
		logEvent(SID, secret);
		const body = await getJson(SID);
		expect(body.level).toBe('demo');
		expect(body.events).toHaveLength(1);
		expect(body.events[0]).toMatchObject({ message: 'safe move' });
	});

	it('off returns nothing', async () => {
		mock.env.DEBUG_LOG = 'off';
		logEvent(SID, safe);
		const body = await getJson(SID);
		expect(body).toEqual({ level: 'off', events: [] });
	});

	it('isolates one session’s log from another’s', async () => {
		logEvent(SID, safe);
		expect((await getJson('debug-other')).events).toEqual([]);
	});

	it('page load mirrors the API — same level and filtered events', () => {
		mock.env.DEBUG_LOG = 'demo';
		logEvent(SID, safe);
		logEvent(SID, secret);
		const data = runLoad(SID);
		expect(data.level).toBe('demo');
		expect(data.events).toHaveLength(1);
	});
});
