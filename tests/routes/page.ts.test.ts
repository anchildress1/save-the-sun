import { describe, it, expect } from 'vitest';
import { load } from '$routes/+page';

// load is synchronous and returns { boardSeed }; the PageLoad signature widens the
// return to MaybePromise<…>, so narrow it for the assertions.
const runLoad = () => load({} as never) as { boardSeed: number };

describe('+page load — board seed', () => {
	it('returns an integer seed within the valid range', () => {
		const { boardSeed } = runLoad();
		expect(Number.isInteger(boardSeed)).toBe(true);
		expect(boardSeed).toBeGreaterThanOrEqual(0);
		expect(boardSeed).toBeLessThan(0x7fffffff);
	});

	it('reseeds per load so the layout varies', () => {
		const seeds = new Set(Array.from({ length: 20 }, () => runLoad().boardSeed));
		expect(seeds.size).toBeGreaterThan(1);
	});
});
