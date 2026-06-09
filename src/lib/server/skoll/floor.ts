// Deterministic floor — Sköll's fallback move, fired ONLY when Gemini errors, times out, or emits an
// illegal/malformed call. Never a quality filter on a legal move.
//
// Weighted-random, NOT argmax: the best-splitting question is the most likely, but every legal
// splitting question keeps a real, non-zero chance. Taking the max would make Sköll inferable — a
// puzzle, not an opponent. The floor reasons from earned facts only, never the secret.

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

/** Weighted-random pick over scored queries — best splitter most likely, never certain. */
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
	// One candidate left → name it. Zero is unreachable from truthful play (the real secret
	// always survives its own answers); guard it so the floor can never crash mid-demo.
	if (live.length <= 1) return { kind: 'cast', runeName: (live[0] ?? runes[0]).name };

	const askedKeys = new Set(asked.map(queryKey));
	const scored = ALL_QUERIES.filter((q) => !askedKeys.has(queryKey(q)))
		.map((query) => ({ query, score: splitScore(query, live) }))
		.filter((s): s is { query: Query; score: number } => s.score !== null);

	// No splitter remains → name the best candidate left (first in fixed board order).
	if (scored.length === 0) return { kind: 'cast', runeName: live[0].name };

	return { kind: 'ask', query: weightedSample(scored, rng) };
}
