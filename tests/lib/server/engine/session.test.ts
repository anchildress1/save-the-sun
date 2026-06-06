import { describe, it, expect } from 'vitest';
import { GameEngine, selectSecret } from '$lib/server/engine/engine';
import { getEngine, resetEngine } from '$lib/server/engine/session';

const SEED = 1;

describe('session engine holder', () => {
	// Must run first: the module starts with no engine, so this hits the lazy
	// create branch before any resetEngine sets one.
	it('lazily creates one engine and memoizes it', () => {
		const first = getEngine();
		expect(first).toBeInstanceOf(GameEngine);
		expect(getEngine()).toBe(first);
	});

	it('resetEngine(seed) makes the secret deterministic', () => {
		resetEngine(SEED);
		expect(getEngine().cast('Human', selectSecret(SEED).name)).toMatchObject({ won: true });
	});

	it('resetEngine() starts a fresh active round', () => {
		const engine = resetEngine();
		expect(engine.status).toBe('active');
		expect(engine.activePlayer).toBe('Human');
	});
});
