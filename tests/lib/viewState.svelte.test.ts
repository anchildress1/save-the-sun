// Browser-project test (the `.svelte.` suffix routes it to the jsdom/Playwright project) because
// the module touches `localStorage`, which the node project does not provide.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readViewState, writeViewState } from '$lib/viewState';

const KEY = 'save-the-sun:view';
const ROUND = 'round-abc';

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
	localStorage.clear();
});

describe('viewState — round-trip', () => {
	it('reads back exactly what was written for the same round', () => {
		writeViewState(ROUND, {
			crossings: [3, 7, 11],
			answer: 'No. Sól is not reaching for fire.'
		});
		expect(readViewState(ROUND)).toEqual({
			crossings: [3, 7, 11],
			answer: 'No. Sól is not reaching for fire.'
		});
	});

	it('stamps the round id into the single record so a new round overwrites it', () => {
		writeViewState(ROUND, { crossings: [1], answer: 'a' });
		writeViewState('round-xyz', { crossings: [2], answer: 'b' });
		// One key, last write wins — the prior round's data is gone, not accumulated.
		expect(readViewState(ROUND)).toBeNull();
		expect(readViewState('round-xyz')).toEqual({
			crossings: [2],
			answer: 'b'
		});
	});
});

describe('viewState — round scoping', () => {
	it('returns null when the stored record belongs to a different round', () => {
		writeViewState(ROUND, { crossings: [5], answer: 'stale' });
		// A fresh secret means a different token — the stale view must not resume onto it.
		expect(readViewState('a-different-round')).toBeNull();
	});

	it('returns null and writes nothing when the round id is empty', () => {
		writeViewState('', { crossings: [1], answer: 'x' });
		expect(localStorage.getItem(KEY)).toBeNull();
		expect(readViewState('')).toBeNull();
	});

	it('returns null when there is no record at all', () => {
		expect(readViewState(ROUND)).toBeNull();
	});
});

describe('viewState — malformed records', () => {
	it.each([
		{ label: 'not JSON', raw: 'not-json{' },
		{
			label: 'crossings not an array',
			raw: JSON.stringify({ roundId: ROUND, crossings: 5, answer: 'a' })
		},
		{
			label: 'a non-number crossing',
			raw: JSON.stringify({ roundId: ROUND, crossings: ['x'], answer: 'a' })
		},
		{
			label: 'answer not a string',
			raw: JSON.stringify({ roundId: ROUND, crossings: [], answer: 7 })
		},
		{
			label: 'roundId missing',
			raw: JSON.stringify({ crossings: [], answer: 'a' })
		},
		{ label: 'a bare null', raw: 'null' }
	])('returns null for $label rather than throwing', ({ raw }) => {
		localStorage.setItem(KEY, raw);
		expect(readViewState(ROUND)).toBeNull();
	});
});

describe('viewState — storage failure degrades, never throws', () => {
	it('returns null when reading throws (private mode)', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new DOMException('denied');
		});
		expect(() => readViewState(ROUND)).not.toThrow();
		expect(readViewState(ROUND)).toBeNull();
	});

	it('swallows a write that throws (private mode)', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('quota');
		});
		expect(() => writeViewState(ROUND, { crossings: [1], answer: 'a' })).not.toThrow();
	});
});
