// Sköll's voice (S6) — turn taunts and cast lines (ux-copy.md §2). Taunts rotate with no
// repeat within a round; cast lines are templated on the named rune. The escalation tier is P2
// (deferred) — these are the v1 idle/turn taunts only.

const TAUNTS = [
	'I have chased the sun across every sky there is. It tires. I do not.',
	'The sun already knows my teeth. You are only late to the news.',
	'Spend the night talking. I will spend it swallowing the dawn.',
	'Cross them off, one by one. I will cross off the morning in a single bite.',
	'You count runes, witch. I count the breaths left in the night.',
	'Every sign you read, I have already devoured its shadow.',
	'Two of us hunt one rune. Only one of us has tasted a star.',
	'Run for the dawn. I am the night that runs faster.'
];

/** The taunt at a rotation index (wraps); pair with a per-round counter for no in-round repeat. */
export function tauntAt(index: number): string {
	return TAUNTS[index % TAUNTS.length];
}

/** His public cast line — the winning cast earns his one permitted exclamation (ux-copy.md §2). */
export function castLine(rune: string, won: boolean): string {
	return won ? `The hunt ends. ${rune}.` : `I name it. ${rune}.`;
}
