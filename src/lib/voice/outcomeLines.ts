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

// The beats each outcome voices, in order — the full closing rite, not a single beat. The win skips
// its lead ("The rune is true.") because the winning cast already voiced that exact line a beat earlier;
// re-voicing it would double. The loss voices all three: his cast names the rune ("I name it. {Rune}."),
// a different line from the loss lead. Win in the Oracle's voice, loss in Sköll's (Sól rides the Oracle).
export const VOICED_SEQUENCE = {
	win: ['verse', 'coda'],
	lose: ['lead', 'verse', 'coda']
} as const satisfies Record<Outcome, readonly OutcomeBeat[]>;
