import { describe, it, expect } from 'vitest';
import { GameEngine, selectSecret } from '$lib/server/engine/engine';
import {
	getEngine,
	getSkoll,
	resetEngine,
	sessionCount,
	MAX_SESSIONS
} from '$lib/server/engine/session';
import { getEvents, logEvent } from '$lib/server/debug/log';

const SEED = 1;
const A = 'session-a';
const B = 'session-b';

describe('session engine registry', () => {
	it('lazily creates one engine per session and memoizes it', () => {
		const first = getEngine('lazy-session');
		expect(first).toBeInstanceOf(GameEngine);
		expect(getEngine('lazy-session')).toBe(first);
	});

	it('hands different sessions different engine instances', () => {
		expect(getEngine(A)).not.toBe(getEngine(B));
	});

	it('keeps parallel sessions isolated — one round never moves the other', () => {
		const a = resetEngine(A, SEED);
		const b = resetEngine(B, SEED);

		// A plays a turn; B must be untouched (still human-first, fresh).
		a.ask('Human', { axis: 'fill', value: 'Light' });
		expect(a.activePlayer).toBe('Sköll');
		expect(b.activePlayer).toBe('Human');

		// A wins its round; B's round stays active and independently winnable.
		expect(a.cast('Sköll', selectSecret(SEED).name)).toMatchObject({ won: true });
		expect(a.status).toBe('won');
		expect(b.status).toBe('active');
		expect(b.cast('Human', selectSecret(SEED).name)).toMatchObject({ won: true });
	});

	it('resetEngine(seed) makes the secret deterministic for that session', () => {
		resetEngine(A, SEED);
		expect(getEngine(A).cast('Human', selectSecret(SEED).name)).toMatchObject({ won: true });
	});

	it('resetEngine() starts a fresh active round and replaces the prior engine', () => {
		const before = getEngine(A);
		const after = resetEngine(A);
		expect(after).not.toBe(before);
		expect(after.status).toBe('active');
		expect(after.activePlayer).toBe('Human');
	});

	it('throws if called without a sessionId', () => {
		expect(() => getEngine('')).toThrow(/sessionId/);
		expect(() => resetEngine('')).toThrow(/sessionId/);
		expect(() => getSkoll('')).toThrow(/sessionId/);
	});

	it('lazily creates one Sköll memory per session and memoizes it', () => {
		const skoll = getSkoll('wolf-session');
		expect(skoll.facts).toEqual([]);
		expect(getSkoll('wolf-session')).toBe(skoll);
	});

	it('wipes the wolf memory on a new round, but resumes it on a refresh', () => {
		const skoll = getSkoll('wolf-reset');
		skoll.facts.push({ query: { axis: 'fill', value: 'Light' }, answer: true });
		// A bare getEngine (refresh) keeps his accumulated facts...
		getEngine('wolf-reset');
		expect(getSkoll('wolf-reset').facts).toHaveLength(1);
		// ...but a new round clears them.
		resetEngine('wolf-reset', SEED);
		expect(getSkoll('wolf-reset').facts).toEqual([]);
	});

	it('evicts the wolf memory with its engine', () => {
		const skoll = getSkoll('wolf-victim');
		skoll.facts.push({ query: { axis: 'fill', value: 'Light' }, answer: true });
		getEngine('wolf-victim');
		for (let i = 0; i <= MAX_SESSIONS; i++) getEngine(`wolf-flood-${i}`);
		// Evicted alongside the engine → a fresh, empty memory on next access.
		expect(getSkoll('wolf-victim').facts).toEqual([]);
	});

	// The debug log is lifecycle-linked to the round through this registry — the wiring, not just
	// resetLog in isolation.
	it('wipes the debug log on a new round, reseeded with the new secret', () => {
		getEngine('log-reset'); // create → logs the round's secret event
		logEvent('log-reset', {
			owner: 'Human',
			kind: 'input',
			part: 'Ask',
			level: 'info',
			message: 'mid-round'
		});
		expect(getEvents('log-reset').length).toBeGreaterThan(1);
		resetEngine('log-reset', SEED); // resetLog clears, then create reseeds the secret
		const events = getEvents('log-reset');
		expect(events).toHaveLength(1); // only the new round's secret event remains
		expect(events[0]).toMatchObject({ owner: 'Engine', part: 'Round', sensitive: true });
	});

	it('evicts the debug log with its engine', () => {
		getEngine('log-victim'); // log holds the secret event
		expect(getEvents('log-victim').length).toBeGreaterThan(0);
		for (let i = 0; i <= MAX_SESSIONS; i++) getEngine(`log-flood-${i}`);
		expect(getEvents('log-victim')).toEqual([]); // evicted → log gone, not re-created
	});

	it('never grows past the session cap', () => {
		for (let i = 0; i <= MAX_SESSIONS + 10; i++) getEngine(`cap-${i}`);
		expect(sessionCount()).toBe(MAX_SESSIONS);
	});

	it('evicts an idle session once the cap is exceeded', () => {
		// Park a known terminal round, then never touch it again.
		resetEngine('idle-victim', SEED);
		getEngine('idle-victim').cast('Human', selectSecret(SEED).name);
		expect(getEngine('idle-victim').status).toBe('won');

		// Flood the cap with fresh sessions — the idle one is older than all of them.
		for (let i = 0; i <= MAX_SESSIONS; i++) getEngine(`flood-${i}`);

		// Evicted → the next access is a brand-new active round, not the won one.
		expect(getEngine('idle-victim').status).toBe('active');
	});

	it('never evicts a session that is still being used', () => {
		resetEngine('active-keep', SEED);
		getEngine('active-keep').cast('Human', selectSecret(SEED).name); // terminal: won

		// Overflow the cap, but touch the kept session every step so it stays most-recent.
		for (let i = 0; i <= MAX_SESSIONS; i++) {
			getEngine(`churn-${i}`);
			getEngine('active-keep');
		}

		// Survived: still the same won round, never reset.
		expect(getEngine('active-keep').status).toBe('won');
	});
});
