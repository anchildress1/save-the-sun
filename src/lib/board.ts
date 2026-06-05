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
