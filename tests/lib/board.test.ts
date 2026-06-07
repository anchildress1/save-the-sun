import { describe, it, expect } from 'vitest';
import { runes } from '$lib/board';

describe('Rune Board Data Source', () => {
	it('loads exactly 24 runes from runes.json', () => {
		expect(runes).toHaveLength(24);
	});

	it('parses the first rune correctly', () => {
		const sowilo = runes.find((r) => r.name === 'Sowilo');
		expect(sowilo).toBeDefined();
		expect(sowilo?.id).toBe(1);
		expect(sowilo?.glyph).toBe('ᛋ');
		expect(sowilo?.element).toBe('Sun');
		expect(sowilo?.power).toBe(1);
		expect(sowilo?.fill).toBe('Dark');
		expect(sowilo?.color).toBe('Red');
	});

	it('maintains the fixed on-screen order (id 1 to 24)', () => {
		expect(runes[0].id).toBe(1);
		expect(runes[23].id).toBe(24);
	});

	it('makes every rune a unique (element, power, color) combination', () => {
		const combos = runes.map((r) => `${r.element}:${r.power}:${r.color}`);
		expect(new Set(combos).size).toBe(runes.length);
	});

	it('makes every rune a unique (element, power, fill, color) combination', () => {
		const combos = runes.map((r) => `${r.element}:${r.power}:${r.fill}:${r.color}`);
		expect(new Set(combos).size).toBe(runes.length);
	});

	// The v7 invariant: fill is the only axis perfectly balanced *within* every other
	// trait value, so a light/dark answer never just echoes a trait already pinned. This
	// is what the doc claims and what v6 lacked — enforce it so a reshuffle can't lose it.
	it('balances fill 2/2 within every element, power, and color value', () => {
		for (const axis of ['element', 'power', 'color'] as const) {
			const split = new Map<string | number, { Light: number; Dark: number }>();
			for (const r of runes) {
				const g = split.get(r[axis]) ?? { Light: 0, Dark: 0 };
				g[r.fill]++;
				split.set(r[axis], g);
			}
			for (const g of split.values()) {
				expect(g.Light).toBe(2);
				expect(g.Dark).toBe(2);
			}
		}
	});

	it('enforces the trait counts from rune-board.md', () => {
		const tally = (key: (r: (typeof runes)[number]) => string | number) => {
			const counts = new Map<string | number, number>();
			for (const r of runes) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
			return counts;
		};

		for (const count of tally((r) => r.element).values()) expect(count).toBe(4);
		for (const count of tally((r) => r.power).values()) expect(count).toBe(4);
		for (const count of tally((r) => r.color).values()) expect(count).toBe(4);

		const fill = tally((r) => r.fill);
		expect(fill.get('Light')).toBe(12);
		expect(fill.get('Dark')).toBe(12);
	});
});
