import { describe, it, expect, beforeEach, vi } from 'vitest';

// debugLevel reads $env/dynamic/private + $app/environment; mock both to control the level.
const mock = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: mock.env }));
vi.mock('$app/environment', () => ({ dev: true }));

import {
	logEvent,
	getEvents,
	resetLog,
	debugLevel,
	filterForLevel,
	captureGemini,
	drainGemini,
	type DebugEvent
} from '$lib/server/debug/log';

const SID = 'log-session';
const ev = (over: Partial<DebugEvent> = {}): Omit<DebugEvent, 'seq'> => ({
	channel: 'turn',
	level: 'info',
	message: 'm',
	...over
});

beforeEach(() => {
	resetLog(SID);
	mock.env.DEBUG_LOG = undefined;
	drainGemini();
});

describe('debug event log', () => {
	it('is empty before any event', () => {
		expect(getEvents(SID)).toEqual([]);
	});

	it('appends with a monotonic seq', () => {
		logEvent(SID, ev());
		logEvent(SID, ev({ channel: 'skoll' }));
		expect(getEvents(SID).map((e) => e.seq)).toEqual([1, 2]);
	});

	it('trims the oldest past the cap while seq keeps climbing', () => {
		for (let i = 0; i < 205; i++) logEvent(SID, ev({ message: `m${i}` }));
		const log = getEvents(SID);
		expect(log).toHaveLength(200); // MAX_EVENTS
		expect(log[0].message).toBe('m5'); // first five trimmed
		expect(log.at(-1)?.seq).toBe(205); // seq survives trimming
	});

	it('isolates sessions', () => {
		logEvent(SID, ev());
		logEvent('other', ev());
		expect(getEvents(SID)).toHaveLength(1);
		resetLog('other');
	});

	it('resetLog drops the round’s record', () => {
		logEvent(SID, ev());
		resetLog(SID);
		expect(getEvents(SID)).toEqual([]);
	});
});

describe('debugLevel', () => {
	it.each(['verbose', 'demo', 'off'] as const)('reads %s from DEBUG_LOG', (v) => {
		mock.env.DEBUG_LOG = v;
		expect(debugLevel()).toBe(v);
	});

	it('defaults to verbose in dev when unset or invalid', () => {
		mock.env.DEBUG_LOG = undefined;
		expect(debugLevel()).toBe('verbose');
		mock.env.DEBUG_LOG = 'loud';
		expect(debugLevel()).toBe('verbose');
	});
});

describe('filterForLevel', () => {
	const events: DebugEvent[] = [
		{ seq: 1, channel: 'turn', level: 'info', message: 'safe' },
		{ seq: 2, channel: 'session', level: 'info', sensitive: true, message: 'the secret' }
	];

	it('off hides everything', () => {
		expect(filterForLevel(events, 'off')).toEqual([]);
	});

	it('demo strips sensitive events', () => {
		expect(filterForLevel(events, 'demo')).toEqual([events[0]]);
	});

	it('verbose keeps everything', () => {
		expect(filterForLevel(events, 'verbose')).toEqual(events);
	});
});

describe('raw Gemini sink', () => {
	it('captures calls and drains them once, clearing each time', () => {
		captureGemini({ label: 'move', request: { a: 1 }, response: { b: 2 } });
		captureGemini({ label: 'reaction', request: {}, error: 'boom' });
		const drained = drainGemini();
		expect(drained).toHaveLength(2);
		expect(drained[1]).toMatchObject({ label: 'reaction', error: 'boom' });
		expect(drainGemini()).toEqual([]); // drained = cleared
	});
});

describe('debugLevel in prod', () => {
	it('defaults to off when DEBUG_LOG is unset', async () => {
		vi.resetModules();
		vi.doMock('$app/environment', () => ({ dev: false }));
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		const mod = await import('$lib/server/debug/log');
		expect(mod.debugLevel()).toBe('off');
	});
});
