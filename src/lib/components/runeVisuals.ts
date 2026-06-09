// Pure trait -> visual mappings for the rune cards. Kept framework-free so the
// completeness of every axis is unit-testable outside the Svelte component.

export type RuneColor = 'Blue' | 'Red' | 'Green' | 'Purple' | 'Gold' | 'Black';
export type RuneElement = 'Sun' | 'Fire' | 'Air' | 'Water' | 'Earth' | 'Spirit';

// Jewel tones tuned to read on the gray stone card (each orb also gets a dark rim
// in RuneCard). Black is a true dark obsidian, kept visible by the orb's highlight.
export const GEM_COLOR: Record<RuneColor, string> = {
	Blue: '#6ea0e0',
	Red: '#e06b63',
	Green: '#5cbf8a',
	Purple: '#8b5cf6',
	Gold: '#e6c068',
	Black: '#2e2c33'
};

export const ELEMENT_ICON: Record<RuneElement, string> = {
	Sun: '☼',
	Fire: '🜂',
	Air: '🜁',
	Water: '🜄',
	Earth: '🜃',
	Spirit: '✧'
};

/** Gem color for a rune color. Throws on an unmapped value rather than silently defaulting. */
export function gemColor(color: string): string {
	const hex = GEM_COLOR[color as RuneColor];
	if (!hex) throw new Error(`Unmapped rune color: ${color}`);
	return hex;
}

/** Element mark for a rune element. Throws on an unmapped value rather than silently defaulting. */
export function elementIcon(element: string): string {
	const icon = ELEMENT_ICON[element as RuneElement];
	if (!icon) throw new Error(`Unmapped rune element: ${element}`);
	return icon;
}
