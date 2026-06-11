import { describe, it, expect, beforeEach } from 'vitest';

import { GET } from '$routes/api/debug/+server';
import { load } from '$routes/debug/+page.server';
import { logEvent, resetLog } from '$lib/server/debug/log';

const SID = 'debug-route';
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
	load({ locals: { sessionId } } as never) as { events: unknown[] };

describe('GET /api/debug + /debug load', () => {
	beforeEach(() => {
		resetLog(SID);
	});

	it('returns every event — the round secret included, no exposure gate', async () => {
		logEvent(SID, move);
		logEvent(SID, round);
		const body = await getJson(SID);
		expect(body.events).toHaveLength(2);
		expect(body.events[1]).toMatchObject({ message: 'New round — secret is Sowilo' });
	});

	it('isolates one session’s log from another’s', async () => {
		logEvent(SID, move);
		expect((await getJson('debug-other')).events).toEqual([]);
	});

	it('page load mirrors the API — same events', () => {
		logEvent(SID, move);
		logEvent(SID, round);
		expect(runLoad(SID).events).toHaveLength(2);
	});
});
