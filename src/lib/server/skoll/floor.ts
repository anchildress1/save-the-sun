// Deterministic floor — Sköll's fallback move, fired ONLY when Gemini errors, times out, or emits an
// illegal/malformed call. Never a quality filter on a legal move.
//
// Weighted-random, NOT argmax — and weighted toward the persona, not the optimizer. Sköll plays as a
// twelve-year-old on hunches: he reaches for narrow, specific questions (a color he likes, a rune he'd
// bet on) far more than the clean 50/50 cutoff a solver would open on. Every legal splitting question
// keeps a real, non-zero chance, so he stays unpredictable — never a puzzle, an opponent. This hunch
// bias is also the pacing lever: it stretches his self-play wins into the 7.5–9-turn window measured by
// scripts/skoll-sim.mjs, slow enough that a competent human can beat him. He reasons from earned facts
// only, never the secret.

import { runes, type Rune } from '$lib/board';
import { resolveQuery, type PowerOp, type Query } from '$lib/server/engine/queries';

/** One truthful answer Sköll has earned — his own resolved Ask, or anything he Scried. */
export interface EarnedFact {
	query: Query;
	answer: boolean;
}

export type FloorMove = { kind: 'ask'; query: Query } | { kind: 'cast'; runeName: string };

const POWERS = [1, 2, 3, 4, 5, 6];
const POWER_OPS: PowerOp[] = ['eq', 'lt', 'lte', 'gt', 'gte'];

// Every well-formed query over the trait space, computed once. The all-yes / all-no ones
// (e.g. `power ≤ 6`) are pruned per live-set at selection time, so over-generating here is fine.
const ALL_QUERIES: Query[] = buildAllQueries();

function buildAllQueries(): Query[] {
	const elements = [...new Set(runes.map((r) => r.element))];
	const colors = [...new Set(runes.map((r) => r.color))];
	const qs: Query[] = [
		...elements.map((value): Query => ({ axis: 'element', value })),
		...colors.map((value): Query => ({ axis: 'color', value })),
		{ axis: 'fill', value: 'Light' },
		{ axis: 'fill', value: 'Dark' },
		...runes.map((r): Query => ({ axis: 'rune', value: r.name }))
	];
	for (const op of POWER_OPS) for (const value of POWERS) qs.push({ axis: 'power', op, value });
	return qs;
}

/** Canonical key for dedup and already-asked exclusion — order-independent across axes. */
function queryKey(q: Query): string {
	return q.axis === 'power' ? `power:${q.op}:${q.value}` : `${q.axis}:${q.value}`;
}

/** Runes still consistent with every earned fact — the live candidate set. */
export function liveCandidates(facts: EarnedFact[]): Rune[] {
	return runes.filter((r) => facts.every((f) => resolveQuery(r, f.query) === f.answer));
}

/**
 * Split quality of a query over the live set: `1 / (1 + |yes − n/2|)`, peaking at an even
 * 50/50 split. Returns null for a non-splitting query (all-yes or all-no) — it carries no
 * information, so it is excluded from selection entirely.
 */
export function splitScore(query: Query, live: Rune[]): number | null {
	const yes = live.filter((r) => resolveQuery(r, query)).length;
	if (yes === 0 || yes === live.length) return null;
	return 1 / (1 + Math.abs(yes - live.length / 2));
}

// How sharply the floor favors a hunch over a clean split. The selection weight is
// `minorityCount^(-HUNCH_BIAS)`, so a narrow question (small minority side, like "is it Sowilo?")
// outweighs the perfect 50/50 cutoff — the opposite of an optimizer. Tuned against the self-play
// sweep so wins average inside [7.5, 9] turns; lower it toward 0 to play sharper (fewer turns),
// raise it to play more scattered (more turns). 0.6 centers the sweep near 8.3.
const HUNCH_BIAS = 0.6;

/**
 * Persona weight of a splitting query over the live set: how hunch-like it is. The smaller side of
 * the split (the specific guess) is favored, so Sköll reaches for narrow questions over the cleanest
 * cutoff. Returns null for a non-splitting query (all-yes or all-no) — no information, excluded.
 */
export function hunchWeight(query: Query, live: Rune[]): number | null {
	const yes = live.filter((r) => resolveQuery(r, query)).length;
	if (yes === 0 || yes === live.length) return null;
	const minority = Math.min(yes, live.length - yes);
	return minority ** -HUNCH_BIAS;
}

/** Weighted-random pick over scored queries — heaviest weight most likely, never certain. */
function weightedSample(scored: { query: Query; score: number }[], rng: () => number): Query {
	const total = scored.reduce((sum, s) => sum + s.score, 0);
	let r = rng() * total;
	let last = scored[0].query; // scored is non-empty (caller casts when there's nothing to sample)
	for (const s of scored) {
		r -= s.score;
		if (r < 0) return s.query;
		last = s.query;
	}
	return last; // floating-point slack: rng() can land at the very top of the range — fall to the last
}

/**
 * Choose Sköll's fallback move from earned facts alone.
 * @param facts Sköll's truthful answers so far (his Asks + anything Scried)
 * @param asked queries already asked this round — excluded as non-splitting redundancy
 * @param rng seeded PRNG; same stream + same state → same move (reproducible for the demo)
 */
export function chooseFloorMove(facts: EarnedFact[], asked: Query[], rng: () => number): FloorMove {
	const live = liveCandidates(facts);
	// Down to one or two runes he can't tell apart → name one (persona: cast on a hunch at the end,
	// not a careful elimination of the last pair). Picking randomly among the two — not always the
	// first — means a wrong cast is a real outcome, the slack that lands wins in the 7.5–9 window.
	// Zero live is unreachable from truthful play (the real secret always survives its own answers);
	// guarded so the floor can never crash mid-demo.
	if (live.length <= 2) {
		const pick = live[Math.floor(rng() * live.length)] ?? runes[0];
		return { kind: 'cast', runeName: pick.name };
	}

	const askedKeys = new Set(asked.map(queryKey));
	const scored = ALL_QUERIES.filter((q) => !askedKeys.has(queryKey(q)))
		.map((query) => ({ query, score: hunchWeight(query, live) }))
		.filter((s): s is { query: Query; score: number } => s.score !== null);

	// No splitter remains → name the best candidate left (first in fixed board order).
	if (scored.length === 0) return { kind: 'cast', runeName: live[0].name };

	return { kind: 'ask', query: weightedSample(scored, rng) };
}
