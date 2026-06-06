import { describe, it, expect } from 'vitest';
import { runes } from '$lib/board';
import { shuffledBoard } from '$lib/boardOrder';

const ID_ORDER = Array.from({ length: 24 }, (_, i) => i + 1);
const ids = (rs: { id: number }[]) => rs.map((r) => r.id);

describe('shuffledBoard', () => {
	it('returns a full permutation of all 24 runes', () => {
		for (let seed = 0; seed < 50; seed++) {
			const order = shuffledBoard(seed);
			expect(order).toHaveLength(24);
			expect([...ids(order)].sort((a, b) => a - b)).toEqual(ID_ORDER);
		}
	});

	it('is deterministic — same seed yields the same order', () => {
		expect(ids(shuffledBoard(42))).toEqual(ids(shuffledBoard(42)));
		expect(ids(shuffledBoard(123456))).toEqual(ids(shuffledBoard(123456)));
	});

	it('does not return the sorted data order (patterns must not jump out)', () => {
		// At least one seed shuffles away from id order; a sorted board would fail this.
		const shuffledSomewhere = Array.from({ length: 50 }, (_, s) => s).some(
			(s) => !arraysEqual(ids(shuffledBoard(s)), ID_ORDER)
		);
		expect(shuffledSomewhere).toBe(true);
	});

	it('produces different orders for different seeds', () => {
		const distinct = new Set(Array.from({ length: 50 }, (_, s) => ids(shuffledBoard(s)).join(',')));
		expect(distinct.size).toBeGreaterThan(1);
	});

	it('does not mutate the source board', () => {
		shuffledBoard(7);
		expect(ids(runes)).toEqual(ID_ORDER);
	});
});

function arraysEqual(a: number[], b: number[]): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i]);
}
