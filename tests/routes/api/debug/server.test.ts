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

const urlFor = (session?: string) =>
	new URL(`http://localhost/api/debug${session === undefined ? '' : `?session=${session}`}`);
const getJson = (sessionId: string, session?: string) =>
	(GET({ locals: { sessionId }, url: urlFor(session) } as never) as Response).json();
const runLoad = (sessionId: string, session?: string) =>
	load({ locals: { sessionId }, url: urlFor(session) } as never) as {
		events: unknown[];
		sessionId: string;
	};

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
		expect(body.sessionId).toBe(SID); // resolved id echoed back so the client can keep scope
	});

	it('isolates one session’s log from another’s', async () => {
		logEvent(SID, move);
		expect((await getJson(OTHER)).events).toEqual([]);
	});

	it('?session=<id> scopes to that session, not the cookie', async () => {
		logEvent(OTHER, move);
		logEvent(OTHER, round);
		const body = await getJson(SID, OTHER); // cookie is SID, but watch OTHER
		expect(body.sessionId).toBe(OTHER);
		expect(body.events).toHaveLength(2);
	});

	it('falls back to the cookie session when ?session is absent or blank', async () => {
		logEvent(SID, move);
		expect((await getJson(SID)).sessionId).toBe(SID);
		expect((await getJson(SID, '')).sessionId).toBe(SID); // blank ignored
		expect((await getJson(SID, '   ')).sessionId).toBe(SID); // whitespace ignored
		expect((await getJson(SID, '%20%20')).events).toHaveLength(1);
	});

	it('an unknown ?session yields an empty list, no crash', async () => {
		const body = await getJson(SID, 'never-seen');
		expect(body.sessionId).toBe('never-seen');
		expect(body.events).toEqual([]);
	});

	it('page load mirrors the API — same events and resolved session', () => {
		logEvent(SID, move);
		logEvent(SID, round);
		const result = runLoad(SID);
		expect(result.events).toHaveLength(2);
		expect(result.sessionId).toBe(SID);
	});

	it('page load honors ?session like the API', () => {
		logEvent(OTHER, move);
		const result = runLoad(SID, OTHER);
		expect(result.sessionId).toBe(OTHER);
		expect(result.events).toHaveLength(1);
	});
});
