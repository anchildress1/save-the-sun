// Pure trait -> visual mappings for the rune cards. Kept framework-free so the
// completeness of every axis is unit-testable outside the Svelte component.
import stoneCardBackground from '$lib/assets/card/stone.png';
import chalkCrossAsset from '$lib/assets/marks/chalk-cross.png';
import blackColorIcon from '$lib/assets/colors/black.png';
import blueColorIcon from '$lib/assets/colors/blue.png';
import goldColorIcon from '$lib/assets/colors/gold.png';
import greenColorIcon from '$lib/assets/colors/green.png';
import purpleColorIcon from '$lib/assets/colors/purple.png';
import redColorIcon from '$lib/assets/colors/red.png';
import airElementIcon from '$lib/assets/elements/air.png';
import earthElementIcon from '$lib/assets/elements/earth.png';
import fireElementIcon from '$lib/assets/elements/fire.png';
import spiritElementIcon from '$lib/assets/elements/spirit.png';
import sunElementIcon from '$lib/assets/elements/sun.png';
import waterElementIcon from '$lib/assets/elements/water.png';
import darkFillIcon from '$lib/assets/fills/dark.png';
import lightFillIcon from '$lib/assets/fills/light.png';
import algizSymbol from '$lib/assets/runes/algiz.png';
import ansuzSymbol from '$lib/assets/runes/ansuz.png';
import berkanaSymbol from '$lib/assets/runes/berkana.png';
import dagazSymbol from '$lib/assets/runes/dagaz.png';
import ehwazSymbol from '$lib/assets/runes/ehwaz.png';
import eihwazSymbol from '$lib/assets/runes/eihwaz.png';
import fehuSymbol from '$lib/assets/runes/fehu.png';
import geboSymbol from '$lib/assets/runes/gebo.png';
import hagalazSymbol from '$lib/assets/runes/hagalaz.png';
import ingwazSymbol from '$lib/assets/runes/ingwaz.png';
import isaSymbol from '$lib/assets/runes/isa.png';
import jeraSymbol from '$lib/assets/runes/jera.png';
import kenazSymbol from '$lib/assets/runes/kenaz.png';
import laguzSymbol from '$lib/assets/runes/laguz.png';
import mannazSymbol from '$lib/assets/runes/mannaz.png';
import naudizSymbol from '$lib/assets/runes/naudiz.png';
import othalaSymbol from '$lib/assets/runes/othala.png';
import perthroSymbol from '$lib/assets/runes/perthro.png';
import raidoSymbol from '$lib/assets/runes/raido.png';
import sowiloSymbol from '$lib/assets/runes/sowilo.png';
import thurisazSymbol from '$lib/assets/runes/thurisaz.png';
import tiwazSymbol from '$lib/assets/runes/tiwaz.png';
import uruzSymbol from '$lib/assets/runes/uruz.png';
import wunjoSymbol from '$lib/assets/runes/wunjo.png';

export type RuneColor = 'Blue' | 'Red' | 'Green' | 'Purple' | 'Gold' | 'Black';
export type RuneElement = 'Sun' | 'Fire' | 'Air' | 'Water' | 'Earth' | 'Spirit';
export type RuneFill = 'Light' | 'Dark';
export type RuneName =
	| 'Algiz'
	| 'Ansuz'
	| 'Berkana'
	| 'Dagaz'
	| 'Ehwaz'
	| 'Eihwaz'
	| 'Fehu'
	| 'Gebo'
	| 'Hagalaz'
	| 'Ingwaz'
	| 'Isa'
	| 'Jera'
	| 'Kenaz'
	| 'Laguz'
	| 'Mannaz'
	| 'Naudiz'
	| 'Othala'
	| 'Perthro'
	| 'Raido'
	| 'Sowilo'
	| 'Thurisaz'
	| 'Tiwaz'
	| 'Uruz'
	| 'Wunjo';

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

export const RUNE_SYMBOL_ASSET: Record<RuneName, string> = {
	Algiz: algizSymbol,
	Ansuz: ansuzSymbol,
	Berkana: berkanaSymbol,
	Dagaz: dagazSymbol,
	Ehwaz: ehwazSymbol,
	Eihwaz: eihwazSymbol,
	Fehu: fehuSymbol,
	Gebo: geboSymbol,
	Hagalaz: hagalazSymbol,
	Ingwaz: ingwazSymbol,
	Isa: isaSymbol,
	Jera: jeraSymbol,
	Kenaz: kenazSymbol,
	Laguz: laguzSymbol,
	Mannaz: mannazSymbol,
	Naudiz: naudizSymbol,
	Othala: othalaSymbol,
	Perthro: perthroSymbol,
	Raido: raidoSymbol,
	Sowilo: sowiloSymbol,
	Thurisaz: thurisazSymbol,
	Tiwaz: tiwazSymbol,
	Uruz: uruzSymbol,
	Wunjo: wunjoSymbol
};

export const COLOR_ICON_ASSET: Record<RuneColor, string> = {
	Black: blackColorIcon,
	Blue: blueColorIcon,
	Gold: goldColorIcon,
	Green: greenColorIcon,
	Purple: purpleColorIcon,
	Red: redColorIcon
};

export const ELEMENT_ICON_ASSET: Record<RuneElement, string> = {
	Air: airElementIcon,
	Earth: earthElementIcon,
	Fire: fireElementIcon,
	Spirit: spiritElementIcon,
	Sun: sunElementIcon,
	Water: waterElementIcon
};

export const FILL_ICON_ASSET: Record<RuneFill, string> = {
	Dark: darkFillIcon,
	Light: lightFillIcon
};

export const CARD_BACKGROUND_ASSET = stoneCardBackground;
export const CHALK_CROSS_ASSET = chalkCrossAsset;

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

/** Symbol asset URL for a rune name. Throws on an unmapped value rather than silently defaulting. */
export function runeSymbolAsset(name: string): string {
	const symbol = RUNE_SYMBOL_ASSET[name as RuneName];
	if (!symbol) throw new Error(`Unmapped rune symbol: ${name}`);
	return symbol;
}

/** Color icon asset URL for a rune color. Throws on an unmapped value rather than silently defaulting. */
export function colorIconAsset(color: string): string {
	const icon = COLOR_ICON_ASSET[color as RuneColor];
	if (!icon) throw new Error(`Unmapped color icon: ${color}`);
	return icon;
}

/** Element icon asset URL for a rune element. Throws on an unmapped value rather than silently defaulting. */
export function elementIconAsset(element: string): string {
	const icon = ELEMENT_ICON_ASSET[element as RuneElement];
	if (!icon) throw new Error(`Unmapped element icon: ${element}`);
	return icon;
}

/** Fill icon asset URL for a rune fill. Throws on an unmapped value rather than silently defaulting. */
export function fillIconAsset(fill: string): string {
	const icon = FILL_ICON_ASSET[fill as RuneFill];
	if (!icon) throw new Error(`Unmapped fill icon: ${fill}`);
	return icon;
}
