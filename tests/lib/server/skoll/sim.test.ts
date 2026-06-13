import { describe, it, expect, beforeAll } from 'vitest';
import { playFloorGame, simulateFloor, type SimMetrics } from '$lib/server/skoll/sim';
import { GameEngine, selectSecret } from '$lib/server/engine/engine';

describe('playFloorGame', () => {
	it('drives a single seed to a correct cast', () => {
		const result = playFloorGame(1);
		expect(result.won).toBe(true);
		expect(result.turns).toBeGreaterThan(0);
		expect(result.secret).toBeTruthy();
	});

	it('is reproducible: same seed → same result', () => {
		expect(playFloorGame(42)).toEqual(playFloorGame(42));
	});

	it('throws on an illegal Ask (engine rejects) — a harness invariant breach, not silent', () => {
		// A round already won rejects every move with round-over; the opening move is an Ask, so the
		// Ask guard fires. Proves the harness fails loud rather than recording a bad fact.
		const won = new GameEngine(1);
		const cast = won.cast('Human', selectSecret(1).name);
		expect(cast.ok && cast.won).toBe(true);
		expect(() => playFloorGame(1, won)).toThrow(/illegal ask/);
	});

	it('throws on an illegal Cast (engine rejects) — a harness invariant breach, not silent', () => {
		// A stub engine that stays Sköll's turn and answers every Ask "no" so the floor narrows the live
		// set down to a Cast — which the stub rejects, firing the Cast guard regardless of seed.
		const stub = {
			get activePlayer() {
				return 'Sköll' as const;
			},
			passTurn() {},
			ask() {
				return { ok: true, answer: false, turnConsumed: true } as const;
			},
			cast() {
				return { ok: false, reason: 'round-over', turnConsumed: false } as const;
			}
		};
		expect(() => playFloorGame(1, stub as unknown as GameEngine)).toThrow(/illegal cast/);
	});
});

describe('simulateFloor — pacing target', () => {
	// The deliverable: Sköll's OWN wins average 7.5–9 turns so a competent human can beat him. The
	// floor is the seeded, network-free proxy for that pacing (Gemini can't run in CI). A wide sweep
	// keeps the mean stable; the live-key numbers live in docs/skoll-metrics-corpus.md. Run in
	// beforeAll, not at suite-definition time, so the 1000-game sweep is skipped when these tests are.
	let metrics: SimMetrics;
	beforeAll(() => {
		metrics = simulateFloor(1000);
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
