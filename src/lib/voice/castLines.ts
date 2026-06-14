// The cast-resolution lines (ux-copy.md §4), shared so the panel text and the voiced line come from
// one source — the page renders them, the server TTS allow-list (`lines.ts`) composes the same words.
// Spoken in the Oracle's voice. The wrong-cast line names the rune (a real board rune, validated
// server-side), so the route still voices only a server-owned line.

export const CAST_TRUE = 'The rune is true.';
export const CAST_FALTERS = 'The rite falters. The rune slips away.';

/** "{Rune} is not the one. The night holds." — the rune is repeated, no generic fallback (ux-copy §4). */
export function wrongCastLine(rune: string): string {
	return `${rune} is not the one. The night holds.`;
}
