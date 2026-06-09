import { describe, it, expect } from 'vitest';
import { runes } from '$lib/board';
import {
	gemColor,
	elementIcon,
	runeSymbolAsset,
	colorIconAsset,
	elementIconAsset,
	fillIconAsset,
	GEM_COLOR,
	ELEMENT_ICON,
	RUNE_SYMBOL_ASSET,
	COLOR_ICON_ASSET,
	ELEMENT_ICON_ASSET,
	FILL_ICON_ASSET,
	CARD_BACKGROUND_ASSET,
	CHALK_CROSS_ASSET
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

	it('maps every rune element to a bundled icon asset', () => {
		for (const rune of runes) {
			expect(() => elementIconAsset(rune.element)).not.toThrow();
			expect(elementIconAsset(rune.element)).toMatch(/\.png$/);
		}
	});

	it('maps every rune fill to a bundled icon asset', () => {
		for (const rune of runes) {
			expect(() => fillIconAsset(rune.fill)).not.toThrow();
			expect(fillIconAsset(rune.fill)).toMatch(/\.png$/);
		}
	});

	it('exposes a bundled stone card background asset', () => {
		expect(CARD_BACKGROUND_ASSET).toMatch(/\.png$/);
	});

	it('exposes a bundled chalk cross asset', () => {
		expect(CHALK_CROSS_ASSET).toMatch(/\.png$/);
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
		expect(Object.keys(ELEMENT_ICON_ASSET).sort()).toEqual(
			['Air', 'Earth', 'Fire', 'Spirit', 'Sun', 'Water'].sort()
		);
		expect(Object.keys(FILL_ICON_ASSET).sort()).toEqual(['Dark', 'Light']);
		expect(Object.keys(RUNE_SYMBOL_ASSET).sort()).toEqual(runes.map((rune) => rune.name).sort());
	});

	it('throws loudly on an unmapped value rather than defaulting silently', () => {
		expect(() => gemColor('Chartreuse')).toThrow(/Unmapped rune color/);
		expect(() => elementIcon('Aether')).toThrow(/Unmapped rune element/);
		expect(() => runeSymbolAsset('Glorp')).toThrow(/Unmapped rune symbol/);
		expect(() => colorIconAsset('Chartreuse')).toThrow(/Unmapped color icon/);
		expect(() => elementIconAsset('Aether')).toThrow(/Unmapped element icon/);
		expect(() => fillIconAsset('Shadow')).toThrow(/Unmapped fill icon/);
	});
});
