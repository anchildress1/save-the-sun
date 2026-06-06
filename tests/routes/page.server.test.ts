import { describe, it, expect } from 'vitest';
import { load } from '$routes/+page.server';

// load is synchronous and returns { boardSeed }; the PageServerLoad signature widens the
// return to MaybePromise<…>, so narrow it for the assertions.
const runLoad = () => load({} as never) as { boardSeed: number };

describe('+page.server load — board seed', () => {
	it('returns a uint32 integer seed', () => {
		const { boardSeed } = runLoad();
		expect(Number.isInteger(boardSeed)).toBe(true);
		expect(boardSeed).toBeGreaterThanOrEqual(0);
		expect(boardSeed).toBeLessThan(2 ** 32);
	});

	it('reseeds per load so the layout varies', () => {
		const seeds = new Set(Array.from({ length: 20 }, () => runLoad().boardSeed));
		expect(seeds.size).toBeGreaterThan(1);
	});
});
