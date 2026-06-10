// Pure trait -> visual mappings for the rune cards. Kept framework-free so the
// completeness of every axis is unit-testable outside the Svelte component.
import stoneCardBackground from '$lib/assets-webp/card/stone.webp?url&no-inline';
import chalkCrossAsset from '$lib/assets-webp/marks/chalk-cross.webp?url&no-inline';
import blackColorIcon from '$lib/assets-webp/colors/black.webp?url&no-inline';
import blueColorIcon from '$lib/assets-webp/colors/blue.webp?url&no-inline';
import goldColorIcon from '$lib/assets-webp/colors/gold.webp?url&no-inline';
import greenColorIcon from '$lib/assets-webp/colors/green.webp?url&no-inline';
import purpleColorIcon from '$lib/assets-webp/colors/purple.webp?url&no-inline';
import redColorIcon from '$lib/assets-webp/colors/red.webp?url&no-inline';
import airElementIcon from '$lib/assets-webp/elements/air.webp?url&no-inline';
import earthElementIcon from '$lib/assets-webp/elements/earth.webp?url&no-inline';
import fireElementIcon from '$lib/assets-webp/elements/fire.webp?url&no-inline';
import spiritElementIcon from '$lib/assets-webp/elements/spirit.webp?url&no-inline';
import sunElementIcon from '$lib/assets-webp/elements/sun.webp?url&no-inline';
import waterElementIcon from '$lib/assets-webp/elements/water.webp?url&no-inline';
import darkFillIcon from '$lib/assets-webp/fills/dark.webp?url&no-inline';
import lightFillIcon from '$lib/assets-webp/fills/light.webp?url&no-inline';
import algizSymbol from '$lib/assets-webp/runes/algiz.webp?url&no-inline';
import ansuzSymbol from '$lib/assets-webp/runes/ansuz.webp?url&no-inline';
import berkanaSymbol from '$lib/assets-webp/runes/berkana.webp?url&no-inline';
import dagazSymbol from '$lib/assets-webp/runes/dagaz.webp?url&no-inline';
import ehwazSymbol from '$lib/assets-webp/runes/ehwaz.webp?url&no-inline';
import eihwazSymbol from '$lib/assets-webp/runes/eihwaz.webp?url&no-inline';
import fehuSymbol from '$lib/assets-webp/runes/fehu.webp?url&no-inline';
import geboSymbol from '$lib/assets-webp/runes/gebo.webp?url&no-inline';
import hagalazSymbol from '$lib/assets-webp/runes/hagalaz.webp?url&no-inline';
import ingwazSymbol from '$lib/assets-webp/runes/ingwaz.webp?url&no-inline';
import isaSymbol from '$lib/assets-webp/runes/isa.webp?url&no-inline';
import jeraSymbol from '$lib/assets-webp/runes/jera.webp?url&no-inline';
import kenazSymbol from '$lib/assets-webp/runes/kenaz.webp?url&no-inline';
import laguzSymbol from '$lib/assets-webp/runes/laguz.webp?url&no-inline';
import mannazSymbol from '$lib/assets-webp/runes/mannaz.webp?url&no-inline';
import naudizSymbol from '$lib/assets-webp/runes/naudiz.webp?url&no-inline';
import othalaSymbol from '$lib/assets-webp/runes/othala.webp?url&no-inline';
import perthroSymbol from '$lib/assets-webp/runes/perthro.webp?url&no-inline';
import raidoSymbol from '$lib/assets-webp/runes/raido.webp?url&no-inline';
import sowiloSymbol from '$lib/assets-webp/runes/sowilo.webp?url&no-inline';
import thurisazSymbol from '$lib/assets-webp/runes/thurisaz.webp?url&no-inline';
import tiwazSymbol from '$lib/assets-webp/runes/tiwaz.webp?url&no-inline';
import uruzSymbol from '$lib/assets-webp/runes/uruz.webp?url&no-inline';
import wunjoSymbol from '$lib/assets-webp/runes/wunjo.webp?url&no-inline';

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
