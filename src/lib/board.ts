import runesData from '../config/runes.json';

export interface Rune {
	id: number;
	name: string;
	glyph: string;
	meaning: string;
	element: string;
	power: number;
	fill: 'Light' | 'Dark';
	color: string;
}

export const runes: Rune[] = runesData as Rune[];

// Trait value-lists derived once from the board, so the Oracle/Sköll LLM schemas, the floor, and his
// hunch don't each re-run `[...new Set(runes.map(...))]`. One source — add a trait to the data and it
// shows up everywhere. (queries.ts keeps its own Sets for O(1) validation.)
export const ELEMENTS: string[] = [...new Set(runes.map((r) => r.element))];
export const COLORS: string[] = [...new Set(runes.map((r) => r.color))];
export const RUNE_NAMES: string[] = runes.map((r) => r.name);
