import { describe, it, expect, beforeEach } from 'vitest';

import { GET } from '$routes/api/debug/+server';
import { load } from '$routes/debug/+page.server';
import { logEvent, resetLog } from '$lib/server/debug/log';

const SID = 'debug-route';
const OTHER = 'debug-other';
const move = {
	owner: 'Engine',
	kind: 'deterministic',
	part: 'Ask',
	level: 'info',
	message: 'safe move'
} as const;
const round = {
	owner: 'Engine',
	kind: 'deterministic',
	part: 'Round',
	level: 'info',
	message: 'New round — secret is Sowilo'
} as const;

const getJson = (sessionId: string) => (GET({ locals: { sessionId } } as never) as Response).json();
const runLoad = (sessionId: string) =>
	load({ locals: { sessionId } } as never) as { events: unknown[]; sessionId: string };

describe('GET /api/debug + /debug load', () => {
	beforeEach(() => {
		resetLog(SID);
		resetLog(OTHER);
	});

	it('returns every event — the round secret included, no exposure gate', async () => {
		logEvent(SID, move);
		logEvent(SID, round);
		const body = await getJson(SID);
		expect(body.events).toHaveLength(2);
		expect(body.events[1]).toMatchObject({ message: 'New round — secret is Sowilo' });
		expect(body.sessionId).toBe(SID); // cookie id echoed back so the client can show it
	});

	it('isolates one session’s log from another’s', async () => {
		logEvent(SID, move);
		expect((await getJson(OTHER)).events).toEqual([]);
	});

	it('an empty cookie id yields an empty list, no crash', async () => {
		const body = await getJson('');
		expect(body.sessionId).toBe('');
		expect(body.events).toEqual([]);
	});

	it('page load mirrors the API — same events and session', () => {
		logEvent(SID, move);
		logEvent(SID, round);
		const result = runLoad(SID);
		expect(result.events).toHaveLength(2);
		expect(result.sessionId).toBe(SID);
	});
});
