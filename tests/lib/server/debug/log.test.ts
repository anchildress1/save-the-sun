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
	runWithSession,
	type DebugEvent
} from '$lib/server/debug/log';

const SID = 'log-session';
const ev = (over: Partial<DebugEvent> = {}): Omit<DebugEvent, 'seq'> => ({
	owner: 'Engine',
	kind: 'deterministic',
	part: 'Round',
	level: 'info',
	message: 'm',
	...over
});

beforeEach(() => {
	resetLog(SID);
	mock.env.DEBUG_LOG = undefined;
	drainGemini(SID);
});

describe('debug event log', () => {
	it('is empty before any event', () => {
		expect(getEvents(SID)).toEqual([]);
	});

	it('appends with a monotonic seq', () => {
		logEvent(SID, ev());
		logEvent(SID, ev({ owner: 'Sköll', kind: 'llm', part: 'React' }));
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
		{ seq: 1, owner: 'Human', kind: 'input', part: 'Ask', level: 'info', message: 'safe' },
		{
			seq: 2,
			owner: 'Engine',
			kind: 'deterministic',
			part: 'Round',
			level: 'info',
			sensitive: true,
			message: 'the secret'
		}
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

describe('raw Gemini sink (per session)', () => {
	it('captures and drains per session, clearing each time', () => {
		runWithSession(SID, () => {
			captureGemini({ label: 'move', request: { a: 1 }, response: { b: 2 } });
			captureGemini({ label: 'reaction', request: {}, error: 'boom' });
		});
		const drained = drainGemini(SID);
		expect(drained).toHaveLength(2);
		expect(drained[1]).toMatchObject({ label: 'reaction', error: 'boom' });
		expect(drainGemini(SID)).toEqual([]); // drained = cleared
	});

	it('isolates one session’s captures from another’s', () => {
		runWithSession('sink-a', () =>
			captureGemini({ label: 'move', request: {}, response: { a: 1 } })
		);
		runWithSession('sink-b', () =>
			captureGemini({ label: 'move', request: {}, response: { b: 2 } })
		);
		expect(drainGemini('sink-a')).toHaveLength(1);
		expect(drainGemini('sink-b')).toHaveLength(1);
	});

	it('ignores a capture outside any session context', () => {
		captureGemini({ label: 'move', request: {}, response: { x: 1 } }); // no runWithSession
		expect(drainGemini('no-context')).toEqual([]);
	});

	it('snapshots a non-POJO response so the /debug load can serialize it', () => {
		// Mirror the SDK's class instance: data on own fields, conveniences on getters.
		class FakeResponse {
			candidates = [{ content: { parts: [{ text: '{}' }] } }];
			get text() {
				return '{}';
			}
		}
		runWithSession(SID, () =>
			captureGemini({ label: 'move', request: {}, response: new FakeResponse() })
		);
		const [call] = drainGemini(SID);
		// Plain object: the getter is dropped, the data kept — and it round-trips without throwing.
		expect(call.response).toEqual({ candidates: [{ content: { parts: [{ text: '{}' }] } }] });
		expect(() => JSON.stringify(call)).not.toThrow();
	});

	it('strips functions and breaks cycles so json()/devalue never crash', () => {
		const cyclic: Record<string, unknown> = { a: 1, fn: () => 'x' };
		cyclic.self = cyclic;
		runWithSession(SID, () => captureGemini({ label: 'move', request: {}, response: cyclic }));
		const [call] = drainGemini(SID);
		expect(call.response).toEqual({ a: 1, self: '[Circular]' }); // fn dropped, cycle broken
		expect(() => JSON.stringify(call)).not.toThrow();
	});

	it('coerces every JSON-hostile shape: bigint→string, Date→ISO, null kept, fn/symbol dropped', () => {
		const response = {
			big: 10n,
			when: new Date('2020-01-01T00:00:00.000Z'),
			nada: null,
			n: 5,
			s: 'ok',
			sym: Symbol('x'),
			fn: () => 'y',
			nested: [1n, null]
		};
		runWithSession(SID, () => captureGemini({ label: 'move', request: {}, response }));
		expect(drainGemini(SID)[0].response).toEqual({
			big: '10',
			when: '2020-01-01T00:00:00.000Z',
			nada: null,
			n: 5,
			s: 'ok',
			nested: ['1', null] // sym + fn dropped
		});
	});

	it('degrades to a marker when sanitizing throws (a throwing getter)', () => {
		const bad = {
			get boom() {
				throw new Error('nope');
			}
		};
		runWithSession(SID, () => captureGemini({ label: 'move', request: {}, response: bad }));
		expect(drainGemini(SID)[0].response).toEqual({ note: 'value omitted — not serializable' });
	});
});

describe('debugLevel in prod', () => {
	it('defaults to off when DEBUG_LOG is unset — the unauthenticated view stays dark unless opted in', async () => {
		vi.resetModules();
		vi.doMock('$app/environment', () => ({ dev: false }));
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		const mod = await import('$lib/server/debug/log');
		expect(mod.debugLevel()).toBe('off');
	});
});
