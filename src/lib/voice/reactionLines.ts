// The reaction-resolution lines (ux-copy.md §3), shared so the panel text and the voiced line come
// from one source — the page renders them, the server TTS allow-list (`lines.ts`) composes the same
// words. Spoken in the Oracle's voice (they land in her panel). The two scry lines lead/trail a
// dynamic answer the server appends; these are the fixed framing only.

export const REACTION_LINES = {
	'human-scry': 'You lean into the dark; his answer is yours.',
	'human-hex': "You close the Oracle's lips; his turn dies with the question.",
	'human-pass': 'You stay your hand; Sköll gets his answer.',
	'skoll-hex': 'Sköll silences the Oracle; your question dies.',
	'skoll-scry': 'Sköll listened at the threshold — the answer is his too.'
} as const;

export type ReactionLineId = keyof typeof REACTION_LINES;

/** Whether the line carries a dynamic answer alongside its framing (so it needs a query to compose). */
export function carriesAnswer(id: ReactionLineId): boolean {
	return id === 'human-scry' || id === 'skoll-scry';
}
