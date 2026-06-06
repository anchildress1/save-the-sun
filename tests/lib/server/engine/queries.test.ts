import { describe, it, expect } from 'vitest';
import { runes } from '$lib/board';
import { parseQuery, resolveQuery, type PowerOp } from '$lib/server/engine/queries';

const ELEMENTS = [...new Set(runes.map((r) => r.element))];
const COLORS = [...new Set(runes.map((r) => r.color))];
const POWERS = [1, 2, 3, 4, 5, 6];

describe('resolveQuery — truthful trait resolution (all 24 × all axes)', () => {
	for (const secret of runes) {
		describe(`secret = ${secret.name} (${secret.element}, ${secret.power}, ${secret.fill}, ${secret.color})`, () => {
			it('element resolves truthfully for every element value', () => {
				for (const value of ELEMENTS) {
					expect(resolveQuery(secret, { axis: 'element', value })).toBe(value === secret.element);
				}
			});

			it('fill resolves truthfully for light and dark', () => {
				expect(resolveQuery(secret, { axis: 'fill', value: 'Light' })).toBe(
					secret.fill === 'Light'
				);
				expect(resolveQuery(secret, { axis: 'fill', value: 'Dark' })).toBe(secret.fill === 'Dark');
			});

			it('hue resolves truthfully for every color value', () => {
				for (const value of COLORS) {
					expect(resolveQuery(secret, { axis: 'color', value })).toBe(value === secret.color);
				}
			});

			it('single-rune query is yes only for the secret', () => {
				for (const r of runes) {
					expect(resolveQuery(secret, { axis: 'rune', value: r.name })).toBe(
						r.name === secret.name
					);
				}
			});

			it('power exact resolves truthfully for 1..6', () => {
				for (const value of POWERS) {
					expect(resolveQuery(secret, { axis: 'power', op: 'eq', value })).toBe(
						secret.power === value
					);
				}
			});
		});
	}
});

describe('resolveQuery — power ranges correct at boundaries (1 and 6 inclusive)', () => {
	const compare: Record<PowerOp, (p: number, n: number) => boolean> = {
		eq: (p, n) => p === n,
		ne: (p, n) => p !== n,
		lt: (p, n) => p < n,
		lte: (p, n) => p <= n,
		gt: (p, n) => p > n,
		gte: (p, n) => p >= n
	};
	const ops = Object.keys(compare) as PowerOp[];

	for (const op of ops) {
		// 0 and 7 probe outside the legal power span so the boundaries 1 and 6 are inclusive.
		for (const value of [0, 1, 2, 5, 6, 7]) {
			it(`power ${op} ${value} matches the reference comparison for every secret`, () => {
				for (const secret of runes) {
					expect(resolveQuery(secret, { axis: 'power', op, value })).toBe(
						compare[op](secret.power, value)
					);
				}
			});
		}
	}

	it('"fewer than 1" excludes every rune; "at least 6" admits only power-6 runes', () => {
		expect(
			runes.filter((r) => resolveQuery(r, { axis: 'power', op: 'lt', value: 1 }))
		).toHaveLength(0);
		expect(
			runes.filter((r) => resolveQuery(r, { axis: 'power', op: 'gte', value: 6 }))
		).toHaveLength(4);
	});
});

describe('parseQuery — validation (the referee leash)', () => {
	it('accepts a well-formed query for each axis', () => {
		expect(parseQuery({ axis: 'element', value: 'Fire' })).toEqual({
			axis: 'element',
			value: 'Fire'
		});
		expect(parseQuery({ axis: 'fill', value: 'Light' })).toEqual({ axis: 'fill', value: 'Light' });
		expect(parseQuery({ axis: 'fill', value: 'Dark' })).toEqual({ axis: 'fill', value: 'Dark' });
		expect(parseQuery({ axis: 'color', value: 'Gold' })).toEqual({ axis: 'color', value: 'Gold' });
		expect(parseQuery({ axis: 'rune', value: 'Sowilo' })).toEqual({
			axis: 'rune',
			value: 'Sowilo'
		});
		expect(parseQuery({ axis: 'power', op: 'lt', value: 3 })).toEqual({
			axis: 'power',
			op: 'lt',
			value: 3
		});
	});

	it('rejects non-object payloads', () => {
		expect(parseQuery(null)).toBeNull();
		expect(parseQuery(42)).toBeNull();
		expect(parseQuery('element')).toBeNull();
		expect(parseQuery(undefined)).toBeNull();
	});

	it('rejects an unknown axis', () => {
		expect(parseQuery({ axis: 'meaning', value: 'sun' })).toBeNull();
		expect(parseQuery({ value: 'Fire' })).toBeNull();
	});

	it('rejects a mixed-type trait bundle (no single axis)', () => {
		expect(parseQuery({ element: 'Fire', color: 'Red' })).toBeNull();
	});

	it('rejects a single-axis query carrying an extra trait key (mixed-type)', () => {
		// A query is one axis. A stray trait field makes it a mixed query — it must error,
		// not silently drop the extra and answer the element.
		expect(parseQuery({ axis: 'element', value: 'Fire', color: 'Red' })).toBeNull();
		expect(parseQuery({ axis: 'power', op: 'lt', value: 3, element: 'Fire' })).toBeNull();
		expect(parseQuery({ axis: 'fill', value: 'Light', power: 2 })).toBeNull();
	});

	it('rejects a query with the right key count but a wrong key name', () => {
		expect(parseQuery({ axis: 'element', hue: 'Fire' })).toBeNull();
	});

	it('rejects out-of-set values per axis', () => {
		expect(parseQuery({ axis: 'element', value: 'Shadow' })).toBeNull();
		expect(parseQuery({ axis: 'element', value: 7 })).toBeNull();
		expect(parseQuery({ axis: 'fill', value: 'Hollow' })).toBeNull();
		expect(parseQuery({ axis: 'color', value: 'Bronze' })).toBeNull();
		expect(parseQuery({ axis: 'color', value: 99 })).toBeNull();
		expect(parseQuery({ axis: 'rune', value: 'Nothere' })).toBeNull();
		expect(parseQuery({ axis: 'rune', value: 5 })).toBeNull();
	});

	it('rejects malformed power queries', () => {
		expect(parseQuery({ axis: 'power', op: 'between', value: 3 })).toBeNull();
		expect(parseQuery({ axis: 'power', op: 5, value: 3 })).toBeNull();
		expect(parseQuery({ axis: 'power', op: 'lt', value: 2.5 })).toBeNull();
		expect(parseQuery({ axis: 'power', op: 'lt', value: 'three' })).toBeNull();
	});

	it('accepts a not-equal op on a value axis', () => {
		expect(parseQuery({ axis: 'element', value: 'Fire', op: 'ne' })).toEqual({
			axis: 'element',
			value: 'Fire',
			op: 'ne'
		});
	});

	it('accepts ne as a power op', () => {
		expect(parseQuery({ axis: 'power', op: 'ne', value: 3 })).toEqual({
			axis: 'power',
			op: 'ne',
			value: 3
		});
	});

	it('normalizes an explicit op:eq to the bare value query', () => {
		expect(parseQuery({ axis: 'fill', value: 'Light', op: 'eq' })).toEqual({
			axis: 'fill',
			value: 'Light'
		});
	});

	it('rejects an unknown op on a value axis (no ordering to compare)', () => {
		expect(parseQuery({ axis: 'element', value: 'Fire', op: 'lt' })).toBeNull();
		expect(parseQuery({ axis: 'color', value: 'Gold', op: 'between' })).toBeNull();
	});
});

describe('resolveQuery — ne is the opposite of eq', () => {
	const secret = runes.find((r) => r.element === 'Fire')!;

	it('value-axis ne is the negation of equality', () => {
		for (const value of ELEMENTS) {
			const eq = resolveQuery(secret, { axis: 'element', value });
			expect(resolveQuery(secret, { axis: 'element', value, op: 'ne' })).toBe(!eq);
		}
	});

	it('power ne is the negation of power eq across 1..6', () => {
		for (const n of POWERS) {
			expect(resolveQuery(secret, { axis: 'power', op: 'ne', value: n })).toBe(secret.power !== n);
		}
	});
});
