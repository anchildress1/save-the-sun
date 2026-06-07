import { describe, it, expect } from 'vitest';
import { load } from '$routes/+page.server';
import { getEngine, resetEngine } from '$lib/server/engine/session';
import { selectSecret } from '$lib/server/engine/engine';
import type { GameState } from '$lib/server/engine/actions';

// load is synchronous and returns { boardSeed, state }; the PageServerLoad signature widens
// the return to MaybePromise<…>, so narrow it for the assertions.
const runLoad = (sessionId: string) =>
	load({ locals: { sessionId } } as never) as { boardSeed: number; state: GameState };

const SEED = 1;

describe('+page.server load — board seed', () => {
	it('returns a uint32 integer seed', () => {
		const { boardSeed } = runLoad('seed-session');
		expect(Number.isInteger(boardSeed)).toBe(true);
		expect(boardSeed).toBeGreaterThanOrEqual(0);
		expect(boardSeed).toBeLessThan(2 ** 32);
	});

	it('reseeds the board ORDER per load so the layout varies', () => {
		const seeds = new Set(Array.from({ length: 20 }, () => runLoad('order-session').boardSeed));
		expect(seeds.size).toBeGreaterThan(1);
	});
});

describe('+page.server load — engine lifetime', () => {
	it('lazily creates an active engine on first load of a fresh session', () => {
		runLoad('fresh-session');
		const engine = getEngine('fresh-session');
		expect(engine.status).toBe('active');
		expect(engine.activePlayer).toBe('Human');
	});

	it('hydrates the live turn state — fresh round is human-first and active', () => {
		const { state } = runLoad('hydrate-fresh');
		expect(state).toEqual({ activePlayer: 'Human', status: 'active', winner: null });
	});

	it('reports a resumed won round so the UI does not open on a phantom turn', () => {
		resetEngine('hydrate-won', SEED);
		getEngine('hydrate-won').cast('Human', selectSecret(SEED).name);
		// The reload after a win must surface 'won', not guess 'active'.
		expect(runLoad('hydrate-won').state).toEqual({
			activePlayer: 'Human',
			status: 'won',
			winner: 'Human'
		});
	});

	it('a refresh resumes the same round — the secret does NOT change', () => {
		resetEngine('refresh-session', SEED);
		const before = getEngine('refresh-session');

		runLoad('refresh-session'); // the reload

		const after = getEngine('refresh-session');
		expect(after).toBe(before); // same engine instance, not reseeded
		// The original secret still wins, proving the round survived the reload.
		expect(after.cast('Human', selectSecret(SEED).name)).toMatchObject({ won: true });
	});

	it('keeps refresh isolated per session — one reload never reseeds another', () => {
		resetEngine('keep-a', SEED);
		const a = getEngine('keep-a');
		runLoad('keep-b'); // reloading B must not touch A
		expect(getEngine('keep-a')).toBe(a);
		expect(getEngine('keep-a').cast('Human', selectSecret(SEED).name)).toMatchObject({
			won: true
		});
	});
});
