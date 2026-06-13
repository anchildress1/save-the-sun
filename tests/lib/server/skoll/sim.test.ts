import { describe, it, expect, beforeAll } from 'vitest';
import { playFloorGame, simulateFloor, type SimMetrics } from '$lib/server/skoll/sim';
import { GameEngine, selectSecret } from '$lib/server/engine/engine';
import { freshSkollState, takeSkollTurn } from '$lib/server/skoll/skoll';

const FLOOR_ONLY = () => Promise.reject(new Error('test: floor-only'));

describe('playFloorGame', () => {
	it('drives a single seed to a correct cast', async () => {
		const result = await playFloorGame(1);
		expect(result.won).toBe(true);
		expect(result.turns).toBeGreaterThan(0);
		expect(result.secret).toBeTruthy();
	});

	it('is reproducible: same seed → same result', async () => {
		expect(await playFloorGame(42)).toEqual(await playFloorGame(42));
	});

	it('throws on an illegal Cast (engine rejects) — a harness invariant breach, not silent', async () => {
		// Pre-collapse the state to a lone candidate so the very first floor move is a Cast, then point
		// it at a round-over engine that rejects the cast — the sim must throw, not loop or record junk.
		const won = new GameEngine(7);
		const cast = won.cast('Human', selectSecret(7).name);
		expect(cast.ok && cast.won).toBe(true);
		const collapsed = freshSkollState(7);
		// One rune-true fact leaves exactly one live candidate, so chooseFloorMove casts immediately.
		collapsed.facts.push({ query: { axis: 'rune', value: 'Sowilo' }, answer: true });
		await expect(playFloorGame(7, won, collapsed)).rejects.toThrow(/harness: illegal cast/);
	});
});

describe('wrong-cast memory (production parity)', () => {
	// The live bug: a missed floor cast was logged but never recorded, so the next floor turn could
	// re-pick the SAME dead rune (Codex: seed 53 burned seven wrong casts). takeSkollTurn now rules a
	// missed rune out, so a wrong cast can never recur — drive the real path and assert no repeats.
	it('never re-casts a rune it already missed (seed 53 regression)', async () => {
		const engine = new GameEngine(53);
		const state = freshSkollState(53);
		const casts: string[] = [];
		const origErr = console.error;
		const origWarn = console.warn;
		console.error = () => {};
		console.warn = () => {};
		try {
			for (let i = 0; i < 60; i++) {
				if (engine.activePlayer === 'Human') engine.passTurn();
				const out = await takeSkollTurn(engine, state, FLOOR_ONLY, state.rng);
				if (out.kind === 'cast') {
					casts.push(out.runeName);
					if (out.result.ok && out.result.won) break;
				} else {
					// Resolve the parked Ask as a Pass so the fact lands and play continues.
					const { resolveSkollAsk } = await import('$lib/server/skoll/skoll');
					resolveSkollAsk(engine, state, { ok: true, choice: 'Pass' });
				}
			}
		} finally {
			console.error = origErr;
			console.warn = origWarn;
		}
		expect(engine.status).toBe('won');
		expect(casts.at(-1)).toBe(selectSecret(53).name);
		// No rune appears twice — the missed cast was remembered, never repeated.
		expect(new Set(casts).size).toBe(casts.length);
	});
});

describe('simulateFloor — pacing target', () => {
	// The deliverable: Sköll's OWN wins average 7.5–9 turns so a competent human can beat him. The
	// floor is the seeded, network-free proxy for that pacing (Gemini can't run in CI). The sim runs
	// the SAME orchestration as the app (freshSkollState + takeSkollTurn), so the measured mean (~8.4)
	// is the real opponent's, not a sim invention. Run in beforeAll, not at suite-definition time, so
	// the 1000-game sweep is skipped when these tests are.
	let metrics: SimMetrics;
	beforeAll(async () => {
		metrics = await simulateFloor(1000);
	});

	it('wins every game in self-play (the secret always survives its own answers)', () => {
		expect(metrics.winRate).toBe(1);
	});

	it("[S] keeps Sköll's mean win in the 7.5–9-turn window", () => {
		expect(metrics.meanTurns).toBeGreaterThanOrEqual(7.5);
		expect(metrics.meanTurns).toBeLessThanOrEqual(9);
	});

	it('produces a real spread of game lengths, not one fixed pace', () => {
		expect(metrics.minTurns).toBeLessThan(metrics.medianTurns);
		expect(metrics.maxTurns).toBeGreaterThan(metrics.medianTurns);
		expect(metrics.distribution.length).toBeGreaterThan(5);
	});
});
