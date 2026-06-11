import { describe, it, expect } from 'vitest';
import { load } from '$routes/+page.server';
import { getEngine, getSkoll, resetEngine } from '$lib/server/engine/session';
import { selectSecret } from '$lib/server/engine/engine';
import type { GameState } from '$lib/server/engine/actions';

type PendingReaction = { echo: string; held: { Scry: boolean; Hex: boolean } } | null;
// load is synchronous and returns { boardSeed, roundId, state, pendingReaction }; the
// PageServerLoad signature widens the return to MaybePromise<…>, so narrow it for the assertions.
const runLoad = (sessionId: string) =>
	load({ locals: { sessionId } } as never) as {
		boardSeed: number;
		roundId: string;
		state: GameState;
		pendingReaction: PendingReaction;
	};

const SEED = 1;

describe('+page.server load — board seed', () => {
	it('returns a uint32 integer seed', () => {
		const { boardSeed } = runLoad('seed-session');
		expect(Number.isInteger(boardSeed)).toBe(true);
		expect(boardSeed).toBeGreaterThanOrEqual(0);
		expect(boardSeed).toBeLessThan(2 ** 32);
	});

	it('holds the board order steady across reloads of the same round', () => {
		const seeds = new Set(Array.from({ length: 20 }, () => runLoad('order-session').boardSeed));
		expect(seeds.size).toBe(1);
	});

	it('reshuffles the board only when the round changes', () => {
		const before = runLoad('order-newround').boardSeed;
		resetEngine('order-newround', SEED);
		expect(runLoad('order-newround').boardSeed).not.toBe(before);
	});
});

describe('+page.server load — round token (view resume)', () => {
	it('surfaces a stable per-round token, held constant across a refresh', () => {
		const first = runLoad('token-load').roundId;
		expect(typeof first).toBe('string');
		expect(first.length).toBeGreaterThan(0);
		// A reload resumes the same round, so the token must not move (it keys the persisted view).
		expect(runLoad('token-load').roundId).toBe(first);
	});

	it('changes the token after a new round so a stale view never restores', () => {
		const before = runLoad('token-newround').roundId;
		resetEngine('token-newround', SEED);
		expect(runLoad('token-newround').roundId).not.toBe(before);
	});

	it('keeps the token and the board seed stable together across the same round', () => {
		const loads = Array.from({ length: 12 }, () => runLoad('token-vs-seed'));
		// Same round → one stable token AND one held layout across every reload.
		expect(new Set(loads.map((l) => l.roundId)).size).toBe(1);
		expect(new Set(loads.map((l) => l.boardSeed)).size).toBe(1);
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
		const result = runLoad('hydrate-fresh');
		expect(result.state).toEqual({
			activePlayer: 'Human',
			status: 'active',
			winner: null,
			turns: 0
		});
		// No interrupt pending on a fresh round.
		expect(result.pendingReaction).toBeNull();
	});

	it('rehydrates Sköll’s parked Ask so a refresh mid-interrupt is not stuck', () => {
		resetEngine('parked-session', SEED);
		const engine = getEngine('parked-session');
		const skoll = getSkoll('parked-session');
		// Mirror the live state: Sköll has declared an Ask and the window is open for the human.
		skoll.pendingAsk = { axis: 'color', value: 'Gold' };
		engine.openReactionWindow('Sköll');

		const { pendingReaction } = runLoad('parked-session');
		expect(pendingReaction).toEqual({
			echo: 'A gold rune. Mine.',
			held: { Scry: true, Hex: true }
		});
	});

	it('reports a resumed won round so the UI does not open on a phantom turn', () => {
		resetEngine('hydrate-won', SEED);
		getEngine('hydrate-won').cast('Human', selectSecret(SEED).name);
		// The reload after a win must surface 'won', not guess 'active'.
		expect(runLoad('hydrate-won').state).toEqual({
			activePlayer: 'Human',
			status: 'won',
			winner: 'Human',
			turns: 1
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
