import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '$routes/api/debug/+server';
import { load } from '$routes/debug/+page.server';
import { record, resetLog } from '$lib/server/debug/log';

const SID = 'debug-route';
const entry = {
	actor: 'Sköll',
	action: 'Cast',
	truth: 'wrong',
	inference: 'a hunch',
	source: 'floor'
} as const;

const getJson = (sessionId: string) => (GET({ locals: { sessionId } } as never) as Response).json();
const runLoad = (sessionId: string) =>
	load({ locals: { sessionId } } as never) as { entries: unknown[] };

describe('GET /api/debug + /debug load', () => {
	beforeEach(() => resetLog(SID));

	it('returns the session’s log entries', async () => {
		record(SID, entry);
		expect(await getJson(SID)).toEqual({ entries: [{ seq: 1, ...entry }] });
	});

	it('returns an empty log before any move', async () => {
		expect(await getJson(SID)).toEqual({ entries: [] });
	});

	it('isolates one session’s log from another’s', async () => {
		record(SID, entry);
		expect((await getJson('debug-other')).entries).toEqual([]);
	});

	it('page load hands the same entries to the view', () => {
		record(SID, entry);
		expect(runLoad(SID).entries).toEqual([{ seq: 1, ...entry }]);
	});
});
