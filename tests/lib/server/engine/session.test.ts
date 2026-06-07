import { describe, it, expect } from 'vitest';
import { GameEngine, selectSecret } from '$lib/server/engine/engine';
import { getEngine, resetEngine } from '$lib/server/engine/session';

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
});
