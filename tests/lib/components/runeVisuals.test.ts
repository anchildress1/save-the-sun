import { describe, it, expect } from 'vitest';
import { runes } from '$lib/board';
import {
	gemColor,
	elementIcon,
	runeSymbolAsset,
	colorIconAsset,
	GEM_COLOR,
	ELEMENT_ICON,
	RUNE_SYMBOL_ASSET,
	COLOR_ICON_ASSET,
	CARD_BACKGROUND_ASSET
} from '$lib/components/runeVisuals';

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

	it('maps every rune name to a bundled symbol asset', () => {
		for (const rune of runes) {
			expect(() => runeSymbolAsset(rune.name)).not.toThrow();
			expect(runeSymbolAsset(rune.name)).toMatch(/\.png$/);
		}
	});

	it('maps every rune color to a bundled icon asset', () => {
		for (const rune of runes) {
			expect(() => colorIconAsset(rune.color)).not.toThrow();
			expect(colorIconAsset(rune.color)).toMatch(/\.png$/);
		}
	});

	it('exposes a bundled stone card background asset', () => {
		expect(CARD_BACKGROUND_ASSET).toMatch(/\.png$/);
	});

	it('covers all six colors and six elements with no extras', () => {
		expect(Object.keys(GEM_COLOR).sort()).toEqual(
			['Black', 'Blue', 'Gold', 'Green', 'Purple', 'Red'].sort()
		);
		expect(Object.keys(COLOR_ICON_ASSET).sort()).toEqual(
			['Black', 'Blue', 'Gold', 'Green', 'Purple', 'Red'].sort()
		);
		expect(Object.keys(ELEMENT_ICON).sort()).toEqual(
			['Air', 'Earth', 'Fire', 'Spirit', 'Sun', 'Water'].sort()
		);
		expect(Object.keys(RUNE_SYMBOL_ASSET).sort()).toEqual(runes.map((rune) => rune.name).sort());
	});

	it('throws loudly on an unmapped value rather than defaulting silently', () => {
		expect(() => gemColor('Chartreuse')).toThrow(/Unmapped rune color/);
		expect(() => elementIcon('Aether')).toThrow(/Unmapped rune element/);
		expect(() => runeSymbolAsset('Glorp')).toThrow(/Unmapped rune symbol/);
		expect(() => colorIconAsset('Chartreuse')).toThrow(/Unmapped color icon/);
	});
});
