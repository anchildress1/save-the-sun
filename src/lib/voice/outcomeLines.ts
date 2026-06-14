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

// The beat each outcome voices: the win's triumphant coda (the lead "The rune is true." is already
// voiced as the cast lands), the loss's verse — a pronouncement that growls without naming himself.
export const VOICED_BEAT = { win: 'coda', lose: 'verse' } as const;
