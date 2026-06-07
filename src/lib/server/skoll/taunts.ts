// Sköll's voice (S6) — turn taunts and cast lines (ux-copy.md §2). Taunts rotate with no
// repeat within a round; cast lines are templated on the named rune. The escalation tier is P2
// (deferred) — these are the v1 idle/turn taunts only.

const TAUNTS = [
	'You circle. I close.',
	"So little dark, witch. Spend it asking. I'll spend it winning.",
	'Another question. I prefer answers.',
	'You spend a turn asking. I spend mine narrowing.',
	'The night is short. I waste none of it.',
	'Two of us hunt one rune. Only one of us is hungry.',
	'Ask. Cross your little runes off. Dawn comes regardless.',
	'Every sign you read, I read the shadow of.'
];

/** The taunt at a rotation index (wraps); pair with a per-round counter for no in-round repeat. */
export function tauntAt(index: number): string {
	return TAUNTS[index % TAUNTS.length];
}

/** His public cast line — the winning cast earns his one permitted exclamation (ux-copy.md §2). */
export function castLine(rune: string, won: boolean): string {
	return won ? `The hunt ends. ${rune}.` : `I name it. ${rune}.`;
}
