import { describe, it, expect } from 'vitest';
import { runes } from '$lib/board';
import { gemColor, elementIcon, GEM_COLOR, ELEMENT_ICON } from '$lib/components/runeVisuals';

describe('rune visual maps', () => {
	it('maps every rune color to a defined gem color', () => {
		for (const rune of runes) {
			expect(() => gemColor(rune.color)).not.toThrow();
			expect(gemColor(rune.color)).toMatch(/^#[0-9a-f]{6}$/i);
		}
	});

	it('maps every rune element to a defined icon', () => {
		for (const rune of runes) {
			expect(() => elementIcon(rune.element)).not.toThrow();
			expect(elementIcon(rune.element).length).toBeGreaterThan(0);
		}
	});

	it('covers all six colors and six elements with no extras', () => {
		expect(Object.keys(GEM_COLOR).sort()).toEqual(
			['Black', 'Blue', 'Gold', 'Green', 'Purple', 'Red'].sort()
		);
		expect(Object.keys(ELEMENT_ICON).sort()).toEqual(
			['Air', 'Earth', 'Fire', 'Spirit', 'Sun', 'Water'].sort()
		);
	});

	it('throws loudly on an unmapped value rather than defaulting silently', () => {
		expect(() => gemColor('Chartreuse')).toThrow(/Unmapped rune color/);
		expect(() => elementIcon('Aether')).toThrow(/Unmapped rune element/);
	});
});
