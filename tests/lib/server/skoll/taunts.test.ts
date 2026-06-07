import { describe, it, expect } from 'vitest';
import { castLine, tauntAt } from '$lib/server/skoll/taunts';

describe('tauntAt', () => {
	it('returns a line and wraps around the pool', () => {
		expect(tauntAt(0)).toBe('You circle. I close.');
		// Wrap: index 8 lands back on the first of the 8-line pool.
		expect(tauntAt(8)).toBe(tauntAt(0));
	});

	it('rotates without repeating across one pass of the pool', () => {
		const seen = new Set(Array.from({ length: 8 }, (_, i) => tauntAt(i)));
		expect(seen.size).toBe(8);
	});
});

describe('castLine', () => {
	it('voices a plain cast', () => {
		expect(castLine('Sowilo', false)).toBe('I name it. Sowilo.');
	});

	it('earns the one exclamation on a winning cast', () => {
		expect(castLine('Sowilo', true)).toBe('The hunt ends. Sowilo.');
	});
});
