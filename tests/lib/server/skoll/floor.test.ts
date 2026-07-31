import { describe, it, expect } from 'vitest';
import {
	chooseFloorMove,
	hunchWeight,
	liveCandidates,
	splitScore,
	type EarnedFact
} from '$lib/server/skoll/floor';
import { mulberry32 } from '$lib/prng';
import { runes } from '$lib/board';
import type { Query } from '$lib/server/engine/queries';

const lightFact = (answer: boolean): EarnedFact => ({
	query: { axis: 'fill', value: 'Light' },
	answer
});

describe('liveCandidates', () => {
	it('starts with the whole board when nothing is known', () => {
		expect(liveCandidates([])).toHaveLength(24);
	});

	it('keeps only runes consistent with every earned fact', () => {
		const live = liveCandidates([{ query: { axis: 'element', value: 'Sun' }, answer: true }]);
		expect(live.every((r) => r.element === 'Sun')).toBe(true);
		expect(live).toHaveLength(4);
	});

	it('intersects multiple facts', () => {
		const live = liveCandidates([
			{ query: { axis: 'element', value: 'Sun' }, answer: true },
			lightFact(true)
		]);
		expect(live.every((r) => r.element === 'Sun' && r.fill === 'Light')).toBe(true);
	});
});

describe('splitScore', () => {
	it('peaks at 1 for an even split', () => {
		// 12 Light / 12 Dark across the 24-rune board — a perfect 50/50.
		expect(splitScore({ axis: 'fill', value: 'Light' }, runes)).toBe(1);
	});

	it('is null for a non-splitting query (all-yes or all-no)', () => {
		const sun = runes.filter((r) => r.element === 'Sun');
		expect(splitScore({ axis: 'element', value: 'Sun' }, sun)).toBeNull(); // all yes
		expect(splitScore({ axis: 'element', value: 'Fire' }, sun)).toBeNull(); // all no
	});

	it('falls off as the split skews', () => {
		// 4 of 24 → |4 − 12| = 8 → 1/9.
		expect(splitScore({ axis: 'element', value: 'Sun' }, runes)).toBeCloseTo(1 / 9, 10);
	});
});

describe('hunchWeight', () => {
	it('favors the narrow question over the clean 50/50 split', () => {
		// fill:Light is the perfect splitter (12/12); element:Sun is the hunch (4/24). The persona
		// reaches for the hunch, so its weight must outrank the optimizer's even split.
		const split = hunchWeight({ axis: 'fill', value: 'Light' }, runes);
		const hunch = hunchWeight({ axis: 'element', value: 'Sun' }, runes);
		expect(split).not.toBeNull();
		expect(hunch).not.toBeNull();
		expect(hunch!).toBeGreaterThan(split!);
	});

	it('is null for a non-splitting query (all-yes or all-no)', () => {
		const sun = runes.filter((r) => r.element === 'Sun');
		expect(hunchWeight({ axis: 'element', value: 'Sun' }, sun)).toBeNull();
		expect(hunchWeight({ axis: 'element', value: 'Fire' }, sun)).toBeNull();
	});
});

describe('chooseFloorMove', () => {
	it('casts the lone survivor when one candidate remains', () => {
		const facts: EarnedFact[] = [{ query: { axis: 'rune', value: 'Sowilo' }, answer: true }];
		const move = chooseFloorMove(facts, [], mulberry32(1));
		expect(move).toEqual({ kind: 'cast', runeName: 'Sowilo' });
	});

	it('casts once narrowed to two runes — names one of the surviving pair', () => {
		// Two Sun-Light runes survive; the floor casts at <=2 (persona: name one of the final pair),
		// picking from within that live set rather than asking the field down to one.
		const facts: EarnedFact[] = [
			{ query: { axis: 'element', value: 'Sun' }, answer: true },
			lightFact(true)
		];
		const live = liveCandidates(facts);
		expect(live).toHaveLength(2);
		const names = new Set(live.map((r) => r.name));
		for (let seed = 0; seed < 50; seed++) {
			const move = chooseFloorMove(facts, [], mulberry32(seed));
			expect(move.kind).toBe('cast');
			if (move.kind === 'cast') expect(names.has(move.runeName)).toBe(true);
		}
	});

	it('asks a splitting question while the field is open', () => {
		const move = chooseFloorMove([], [], mulberry32(1));
		expect(move.kind).toBe('ask');
		if (move.kind === 'ask') {
			// Whatever it picks must actually split the live set.
			expect(splitScore(move.query, runes)).not.toBeNull();
		}
	});

	it('never re-asks a question already asked', () => {
		const asked: Query[] = [
			{ axis: 'fill', value: 'Light' },
			{ axis: 'fill', value: 'Dark' }
		];
		// Run across many seeds — the excluded queries must never resurface.
		for (let seed = 0; seed < 200; seed++) {
			const move = chooseFloorMove([], asked, mulberry32(seed));
			if (move.kind === 'ask') {
				expect(move.query.axis).not.toBe('fill');
			}
		}
	});

	it('is reproducible: same seed + same state → same move', () => {
		const facts: EarnedFact[] = [lightFact(true)];
		const a = chooseFloorMove(facts, [], mulberry32(7));
		const b = chooseFloorMove(facts, [], mulberry32(7));
		expect(a).toEqual(b);
	});

	it('casts the first candidate when no splitter is left (3+ live, all asked)', () => {
		// Pin the live set to exactly three runes (above the cast-at-2 line) by ruling out the other 21,
		// then mark every query that could split them as already asked — no splitter remains, so the
		// floor must cast, not stall. Falls to the first survivor in fixed board order.
		const survivors = runes.slice(0, 3);
		const pinned: EarnedFact[] = runes
			.slice(3)
			.map((r) => ({ query: { axis: 'rune', value: r.name }, answer: false }));
		const live = liveCandidates(pinned);
		expect(live).toHaveLength(3);
		const asked = allSplittingQueries(live);
		const move = chooseFloorMove(pinned, asked, mulberry32(1));
		expect(move).toEqual({ kind: 'cast', runeName: survivors[0].name });
	});

	it('never crashes on contradictory facts (zero live) — casts a real rune', () => {
		const facts: EarnedFact[] = [
			{ query: { axis: 'element', value: 'Sun' }, answer: true },
			{ query: { axis: 'element', value: 'Fire' }, answer: true }
		];
		expect(liveCandidates(facts)).toHaveLength(0);
		const move = chooseFloorMove(facts, [], mulberry32(1));
		expect(move).toEqual({ kind: 'cast', runeName: runes[0].name });
	});

	// The non-negotiable gate (test-checklist high-risk): the floor must be weighted-random,
	// never argmax. The persona favors the HUNCH (a narrow, specific question) over the clean split,
	// so the hunch is picked more — but the clean splitter is never shut out, and the field shows real
	// variety. None of that holds for an argmax picker (which would lock onto one fixed question).
	it('[S] samples weighted-random toward hunches, NOT argmax', () => {
		const RUNS = 5000;
		const hunch = key({ axis: 'element', value: 'Sun' }); // narrow (4/24) — the favored hunch
		const split = key({ axis: 'fill', value: 'Light' }); // perfect 50/50 — the optimizer's pick
		const counts = new Map<string, number>();
		const distinct = new Set<string>();

		for (let seed = 0; seed < RUNS; seed++) {
			const move = chooseFloorMove([], [], mulberry32(seed));
			expect(move.kind).toBe('ask');
			if (move.kind === 'ask') {
				const k = key(move.query);
				counts.set(k, (counts.get(k) ?? 0) + 1);
				distinct.add(k);
			}
		}

		const hunchCount = counts.get(hunch) ?? 0;
		const splitCount = counts.get(split) ?? 0;
		// Persona weighting: a narrow hunch outweighs the perfect split...
		expect(hunchCount).toBeGreaterThan(splitCount);
		// ...but the clean splitter is NOT shut out — it still gets picked.
		expect(splitCount).toBeGreaterThan(0);
		// And the floor ranges across many questions, not one fixed pick.
		expect(distinct.size).toBeGreaterThan(10);
	});
});

function key(q: Query): string {
	return q.axis === 'power' ? `power:${q.op}:${q.value}` : `${q.axis}:${q.value}`;
}

// Brute-force every query the floor could enumerate that still splits a given live set —
// used to drive the no-splitter-left branch by pre-asking all of them.
function allSplittingQueries(live: typeof runes): Query[] {
	const out: Query[] = [];
	const push = (q: Query) => {
		if (splitScore(q, live) !== null) out.push(q);
	};
	for (const v of new Set(runes.map((r) => r.element))) push({ axis: 'element', value: v });
	for (const v of new Set(runes.map((r) => r.color))) push({ axis: 'color', value: v });
	push({ axis: 'fill', value: 'Light' });
	push({ axis: 'fill', value: 'Dark' });
	for (const r of runes) push({ axis: 'rune', value: r.name });
	for (const op of ['eq', 'lt', 'lte', 'gt', 'gte'] as const)
		for (let v = 1; v <= 6; v++) push({ axis: 'power', op, value: v });
	return out;
}
