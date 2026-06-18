// The end-screen resolution copy (ux-copy.md §4), shared so the splash text and the voiced line are
// one source — EndScreen renders the lead/verse/coda, the TTS allow-list (`lines.ts`) voices one beat
// of it. A win is voiced by the Oracle, a loss by Sköll, so the player hears who took the day.

export const OUTCOME_LINES = {
	win: {
		lead: 'The rune is true.',
		verse: 'Sól crests the rim of the world.',
		coda: 'The offering is made. The longest day breaks — and the light is yours to keep.'
	},
	lose: {
		lead: 'Sköll takes the sun.',
		verse: 'The longest day never breaks. The night is everlasting.',
		coda: 'Sól waits in the dark — only the true rune can win her back.'
	}
} as const;

export type Outcome = keyof typeof OUTCOME_LINES;
export type OutcomeBeat = keyof (typeof OUTCOME_LINES)['win']; // 'lead' | 'verse' | 'coda'

// The beat each outcome voices — ONE, not the whole verse. The end-screen copy is fixed and already
// printed on the splash, so voicing all of it is just a long read of static text (~10s in his growl).
// Voice only the punch: the loss's lead ("Sköll takes the sun.") in Sköll's voice — the headline, not
// otherwise spoken; the win's coda in the Oracle's (its lead "The rune is true." is already voiced as
// the cast lands). The other beats stay on-screen text (still written, R10).
export const VOICED_SEQUENCE = {
	win: ['coda'],
	lose: ['lead']
} as const satisfies Record<Outcome, readonly OutcomeBeat[]>;
