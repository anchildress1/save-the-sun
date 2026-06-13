import { describe, it, expect, beforeEach, vi } from 'vitest';

// The key mask reads $env/dynamic/private; mock it to control GEMINI_API_KEY.
const mock = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: mock.env }));

import {
	logEvent,
	getEvents,
	resetLog,
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

	it('masks the Gemini API key at this sink too — message and data alike', () => {
		mock.env.GEMINI_API_KEY = 'AIzaSecretKey123';
		logEvent(
			SID,
			ev({ message: 'failed: ?key=AIzaSecretKey123', data: { e: 'AIzaSecretKey123' } })
		);
		const [event] = getEvents(SID);
		expect(JSON.stringify(event)).not.toContain('AIzaSecretKey123');
		expect(event.message).toBe('failed: ?key=[gemini-api-key]');
		expect(event.data).toEqual({ e: '[gemini-api-key]' });
		delete mock.env.GEMINI_API_KEY;
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

	it('masks the Gemini API key in every logged string — error and response alike', () => {
		mock.env.GEMINI_API_KEY = 'AIzaSecretKey123';
		runWithSession(SID, () => {
			captureGemini({
				label: 'move',
				request: {},
				error: 'fetch failed: https://example.com/v1?key=AIzaSecretKey123'
			});
			captureGemini({
				label: 'reaction',
				request: { url: 'call with AIzaSecretKey123 embedded' },
				response: { note: 'echoes AIzaSecretKey123 twice: AIzaSecretKey123' }
			});
		});
		const drained = drainGemini(SID);
		expect(JSON.stringify(drained)).not.toContain('AIzaSecretKey123');
		expect(drained[0].error).toBe('fetch failed: https://example.com/v1?key=[gemini-api-key]');
		expect(drained[1].response).toEqual({
			note: 'echoes [gemini-api-key] twice: [gemini-api-key]'
		});
		delete mock.env.GEMINI_API_KEY;
	});
});

// The log is anchored on globalThis so a dev HMR re-eval doesn't wipe it out from under the live
// engine (session.ts persists the engine the same way) — otherwise /debug would name a secret the
// engine no longer holds. Last in the file: it resets the module registry.
describe('debug log survives module re-evaluation (dev HMR)', () => {
	it('keeps a session log across a module reload', async () => {
		logEvent('hmr-log', ev({ message: 'before reload' }));
		vi.resetModules();
		const reimported = await import('$lib/server/debug/log');
		expect(reimported.getEvents('hmr-log').map((e) => e.message)).toContain('before reload');
	});
});
