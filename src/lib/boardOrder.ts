// Canonical on-screen board order. The 24 runes render SHUFFLED, not in the sorted
// data order, so element / light-dark groupings don't jump out — the board must read
// as something to reason over, not a pre-sorted table (prd.md R5: reason over the
// board, "not computation over a sorted set").
//
// Seeded + deterministic: the order is fixed for a given seed, so it is stable within
// a round, reproducible for the demo, and — once Sköll lands — the same order the
// engine hands him. He sees exactly what the human sees.

import { runes, type Rune } from './board';
import { mulberry32 } from './prng';

/** A seeded Fisher–Yates shuffle of the 24 runes — the on-screen order. Same seed → same order. */
export function shuffledBoard(seed: number): Rune[] {
	const rng = mulberry32(seed);
	const order = [...runes];
	for (let i = order.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}
	return order;
}
