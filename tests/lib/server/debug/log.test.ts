import { describe, it, expect, beforeEach } from 'vitest';
import { record, getLog, resetLog, floorFired, type DebugEntry } from '$lib/server/debug/log';

const SID = 'log-session';
const base = { actor: 'Human', action: 'Ask', truth: 't', inference: 'i' } as const;

describe('debug log store', () => {
	beforeEach(() => resetLog(SID));

	it('is empty before any result', () => {
		expect(getLog(SID)).toEqual([]);
	});

	it('appends results in order, assigning a monotonic seq', () => {
		record(SID, base);
		record(SID, { ...base, actor: 'Sköll', action: 'Cast' });
		expect(getLog(SID).map((e) => e.seq)).toEqual([1, 2]);
		expect(getLog(SID)[1]).toMatchObject({ actor: 'Sköll', action: 'Cast' });
	});

	it('trims the oldest past the cap while keeping seq climbing', () => {
		for (let i = 0; i < 65; i++) record(SID, { ...base, truth: `t${i}` });
		const log = getLog(SID);
		expect(log).toHaveLength(60); // MAX_ENTRIES
		expect(log[0].truth).toBe('t5'); // first five trimmed
		expect(log.at(-1)?.seq).toBe(65); // seq survives trimming, never resets
	});

	it('isolates sessions', () => {
		record(SID, base);
		record('other', base);
		record('other', base);
		expect(getLog(SID)).toHaveLength(1);
		expect(getLog('other')).toHaveLength(2);
		resetLog('other');
	});

	it('resetLog drops the round’s record', () => {
		record(SID, base);
		resetLog(SID);
		expect(getLog(SID)).toEqual([]);
	});

	it('floorFired flags only floor-sourced entries', () => {
		const floor: DebugEntry = { seq: 1, ...base, actor: 'Sköll', source: 'floor' };
		const gemini: DebugEntry = { seq: 2, ...base, actor: 'Sköll', source: 'gemini' };
		const human: DebugEntry = { seq: 3, ...base };
		expect(floorFired(floor)).toBe(true);
		expect(floorFired(gemini)).toBe(false);
		expect(floorFired(human)).toBe(false);
	});
});
