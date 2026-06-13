import { describe, it, expect } from 'vitest';
import { playFloorGame, simulateFloor } from '$lib/server/skoll/sim';

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
});

describe('simulateFloor — pacing target', () => {
	// The deliverable: Sköll's OWN wins average 7.5–9 turns so a competent human can beat him. The
	// floor is the seeded, network-free proxy for that pacing (Gemini can't run in CI). A wide sweep
	// keeps the mean stable; the live-key numbers live in docs/skoll-metrics-corpus.md.
	const metrics = simulateFloor(1000);

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
