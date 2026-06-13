// Self-play harness for Sköll's deterministic floor — the measurable proxy for his pacing.
//
// Gemini is the live brain, but it needs a real key and a network, so it can't be measured in CI.
// The floor is the seeded fallback and the only part we can drive reproducibly, so the pacing target
// ("Sköll's own wins land in 7.5–9 turns") is asserted against it. Each run drives a REAL GameEngine
// move by move: the human seat just passes, Sköll plays his floor, the engine resolves every Ask and
// Cast truthfully and reports the win. Turns-to-win counts Sköll's own moves (his Asks plus the
// winning Cast) — not the engine's alternation flips.

import { runes } from '$lib/board';
import { mulberry32 } from '$lib/prng';
import { GameEngine, selectSecret } from '$lib/server/engine/engine';
import type { Query } from '$lib/server/engine/queries';
import { chooseFloorMove, type EarnedFact } from './floor';

export interface SimResult {
	seed: number;
	secret: string;
	turns: number;
	won: boolean;
}

export interface SimMetrics {
	games: number;
	wins: number;
	winRate: number;
	meanTurns: number;
	medianTurns: number;
	minTurns: number;
	maxTurns: number;
	distribution: { turns: number; count: number }[];
}

// A wrong cast can never recur from truthful play once recorded as a ruled-out fact, so the loop is
// bounded by the trait space; this cap only guards against a logic regression turning into a hang.
const MAX_MOVES = 100;

/**
 * Drive Sköll's floor through a real engine for one seed until he casts the secret.
 * @param seed PRNG seed — fixes the secret and the floor's move stream (reproducible).
 * @param engine engine override, for tests that need to force the harness-invariant guards; defaults
 *   to a fresh engine on the same seed.
 */
export function playFloorGame(seed: number, engine: GameEngine = new GameEngine(seed)): SimResult {
	const secret = selectSecret(seed);
	const rng = mulberry32(seed);
	const facts: EarnedFact[] = [];
	const asked: Query[] = [];
	let turns = 0;

	for (let move = 0; move < MAX_MOVES; move++) {
		// The human seat takes no action in self-play — hand the turn straight to Sköll.
		if (engine.activePlayer === 'Human') engine.passTurn();

		const decision = chooseFloorMove(facts, asked, rng);
		turns += 1;

		if (decision.kind === 'cast') {
			const result = engine.cast('Sköll', decision.runeName);
			// An illegal cast (unknown rune, out of turn, round over) is a harness regression, not play —
			// fail loud rather than fold it into the wrong-cast slack and hide the bug.
			if (!result.ok) throw new Error(`harness: illegal cast (${result.reason}) on seed ${seed}`);
			if (result.won) return { seed, secret: secret.name, turns, won: true };
			// Legal but wrong cast: record it as a ruled-out fact so the floor never names it again. This
			// is real self-play slack (a wrong guess on the final pair), not a failure.
			const ruledOut: Query = { axis: 'rune', value: decision.runeName };
			facts.push({ query: ruledOut, answer: false });
			asked.push(ruledOut);
			continue;
		}

		// Sköll is always the active player on a live round here and the floor only emits well-formed
		// queries, so a floor Ask is always legal. A not-ok result is therefore a harness invariant
		// breach (engine/floor regression) — throw rather than assert the type and record a bad fact.
		const result = engine.ask('Sköll', decision.query);
		if (!result.ok) throw new Error(`harness: illegal ask (${result.reason}) on seed ${seed}`);
		facts.push({ query: decision.query, answer: result.answer });
		asked.push(decision.query);
	}

	// Unreachable from truthful play (a wrong cast can't recur, so the trait space bounds the loop);
	// the cap only guards against a logic regression turning into a hang.
	return { seed, secret: secret.name, turns, won: false };
}

/** Aggregate self-play metrics across a contiguous seed sweep `[startSeed, startSeed + games)`. */
export function simulateFloor(games: number, startSeed = 1): SimMetrics {
	const results: SimResult[] = [];
	for (let i = 0; i < games; i++) results.push(playFloorGame(startSeed + i));

	const winning = results.filter((r) => r.won);
	const turns = winning.map((r) => r.turns).sort((a, b) => a - b);
	const sum = turns.reduce((acc, t) => acc + t, 0);
	const counts = new Map<number, number>();
	for (const t of turns) counts.set(t, (counts.get(t) ?? 0) + 1);

	return {
		games,
		wins: winning.length,
		winRate: winning.length / games,
		meanTurns: turns.length ? sum / turns.length : 0,
		medianTurns: turns.length ? turns[Math.floor(turns.length / 2)] : 0,
		minTurns: turns.length ? turns[0] : 0,
		maxTurns: turns.length ? turns[turns.length - 1] : 0,
		distribution: [...counts.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([t, count]) => ({ turns: t, count }))
	};
}

/** Total rune count — surfaced so the corpus header can note the board size without re-importing. */
export const BOARD_SIZE = runes.length;
