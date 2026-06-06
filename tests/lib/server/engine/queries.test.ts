import { describe, it, expect } from 'vitest';
import { runes } from '$lib/board';
import {
	parseQuery,
	resolveQuery,
	queryKey,
	type PowerOp,
	type Query
} from '$lib/server/engine/queries';

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
});

describe('queryKey — collides iff the same thing is asked', () => {
	it('is stable per query and distinguishes axis + value', () => {
		expect(queryKey({ axis: 'element', value: 'Fire' })).toBe('element:Fire');
		expect(queryKey({ axis: 'power', op: 'lt', value: 3 })).toBe('power:lt:3');
		expect(queryKey({ axis: 'rune', value: 'Sowilo' })).toBe('rune:Sowilo');
	});

	it('separates a power exact from a power range on the same number', () => {
		const a: Query = { axis: 'power', op: 'eq', value: 3 };
		const b: Query = { axis: 'power', op: 'lt', value: 3 };
		expect(queryKey(a)).not.toBe(queryKey(b));
	});
});
