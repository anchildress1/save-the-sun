// Self-play harness for Sköll's deterministic floor — the measurable proxy for his pacing.
//
// Gemini is the live brain, but it needs a real key and a network, so it can't be measured in CI.
// The floor is the seeded fallback and the only part we can drive reproducibly, so the pacing target
// ("Sköll's own wins land in 7.5–9 turns") is asserted against it. Each run drives a REAL GameEngine
// move by move through the SAME production code path the app uses (freshSkollState + takeSkollTurn,
// with a decider that always fails so the floor fires): the human seat just passes, Sköll plays his
// floor, the engine resolves every Ask and Cast truthfully and reports the win. Turns-to-win counts
// Sköll's own moves (his Asks plus the winning Cast) — not the engine's alternation flips.
//
// Going through takeSkollTurn (not a private re-implementation) is what makes the corpus honest: the
// RNG stream (freshSkollState burns one draw on the opening hunch first) and the wrong-cast memory
// (a missed cast is ruled out so it can't recur) are exactly production's, never the sim's invention.

import { runes } from '$lib/board';
import { GameEngine, selectSecret } from '$lib/server/engine/engine';
import {
	freshSkollState,
	takeSkollTurn,
	resolveSkollAsk,
	type SkollDecide,
	type SkollState
} from './skoll';

export interface SimResult {
	seed: number;
	secret: string;
	turns: number;
	won: boolean;
	/** Moves that fell back to the floor because the decider FAILED (threw / illegal / malformed). The
	 *  floor-only sweep expects this to equal `turns`; a live run uses it to reject contaminated proof. */
	floorMoves: number;
	/** Moves where the ≤2 convergence guard forced the closing cast — Gemini's play cornered the
	 *  board, so this is real live play, not a failure. Counted apart from `floorMoves`. */
	guardMoves: number;
}

// A decider that always rejects, so planMove always drops to the deterministic floor. This is how the
// sim measures the floor through the real orchestration without a network or a key.
const FLOOR_ONLY: SkollDecide = () => Promise.reject(new Error('sim: floor-only'));

// Production seeds the engine and Sköll from two INDEPENDENT randomSeed() calls (create vs getSkoll),
// so Sköll's opening hunch — the one fact handed to Gemini — is uncorrelated with the secret. Reusing
// one seed for both would couple the hunch/move stream to selectSecret(seed) and measure a synthetic
// setup. Derive a decorrelated-but-deterministic Sköll seed (Knuth multiplicative hash) to mirror prod.
export function skollSeedFor(seed: number): number {
	return Math.imul(seed, 2654435761) >>> 0;
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
 * Drive Sköll's floor through a real engine for one seed until he casts the secret. Runs the same
 * orchestration as the app (freshSkollState + takeSkollTurn with a floor-only decider), so the RNG
 * stream and wrong-cast memory match production exactly.
 * @param seed PRNG seed — fixes the secret and the floor's move stream (reproducible).
 * @param engine engine override, for tests that need to force the harness-invariant guards; defaults
 *   to a fresh engine on the same seed.
 * @param state Sköll-state override, for tests that need to pre-collapse the live set; defaults to a
 *   fresh state on an independent (decorrelated) seed, mirroring production's separate randomSeed().
 * @param decide move decider; defaults to the floor-only rejector. The live runner passes the real
 *   `decideSkollMove` to play a live Gemini game through this exact loop.
 */
export async function playFloorGame(
	seed: number,
	engine: GameEngine = new GameEngine(seed),
	state: SkollState = freshSkollState(skollSeedFor(seed)),
	decide: SkollDecide = FLOOR_ONLY
): Promise<SimResult> {
	const secret = selectSecret(seed);
	let turns = 0;
	let floorMoves = 0;
	let guardMoves = 0;

	for (let move = 0; move < MAX_MOVES; move++) {
		// The human seat takes no action in self-play — hand the turn straight to Sköll.
		if (engine.activePlayer === 'Human') engine.passTurn();

		const out = await takeSkollTurn(engine, state, decide, state.rng);
		turns += 1;
		if (out.source === 'floor') floorMoves += 1;
		else if (out.source === 'guard') guardMoves += 1;

		if (out.kind === 'cast') {
			// An illegal cast (unknown rune, out of turn, round over) is a harness regression, not play.
			if (!out.result.ok)
				throw new Error(`harness: illegal cast (${out.result.reason}) on seed ${seed}`);
			if (out.result.won)
				return { seed, secret: secret.name, turns, won: true, floorMoves, guardMoves };
			// A legal-but-wrong cast is real self-play slack; takeSkollTurn already ruled the rune out.
			continue;
		}

		// Resolve his parked Ask as a Pass — the human reaction the app awaits — so the fact lands.
		resolveSkollAsk(engine, state, { ok: true, choice: 'Pass' });
	}

	// Unreachable from truthful play (a wrong cast can't recur, so the trait space bounds the loop);
	// the cap only guards against a logic regression turning into a hang.
	return { seed, secret: secret.name, turns, won: false, floorMoves, guardMoves };
}

/** Aggregate self-play metrics across a contiguous seed sweep `[startSeed, startSeed + games)`. */
export async function simulateFloor(games: number, startSeed = 1): Promise<SimMetrics> {
	// takeSkollTurn logs "Gemini decision failed, floor fires" on every floor move (correct in prod,
	// pure noise here). Silence the expected error/warn for the duration of the sweep only.
	const results = await withQuietConsole(async () => {
		const out: SimResult[] = [];
		for (let i = 0; i < games; i++) out.push(await playFloorGame(startSeed + i));
		return out;
	});

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
		medianTurns: median(turns),
		minTurns: turns.length ? turns[0] : 0,
		maxTurns: turns.at(-1) ?? 0,
		distribution: [...counts.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([t, count]) => ({ turns: t, count }))
	};
}

/** Run `fn` with console.error/warn silenced — the floor's expected "Gemini failed" / guard noise.
 *  Exported so the live runner can wrap each game and keep its per-seed result lines clean. */
export async function withQuietConsole<T>(fn: () => Promise<T>): Promise<T> {
	const { error, warn } = console;
	console.error = () => {};
	console.warn = () => {};
	try {
		return await fn();
	} finally {
		console.error = error;
		console.warn = warn;
	}
}

/** Median of an ascending-sorted list — averages the two middle values on an even count. */
export function median(sorted: number[]): number {
	if (!sorted.length) return 0;
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Total rune count — surfaced so the corpus header can note the board size without re-importing. */
export const BOARD_SIZE = runes.length;
