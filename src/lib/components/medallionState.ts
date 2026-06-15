// Pure medallion state -> presentation mappings, kept framework-free so the completeness
// of every state is unit-testable outside the Svelte component (the runeVisuals.ts pattern).
//
// The medallion is the push-to-talk control: hold it (or hold Space) to record an Ask, release to
// send. Its states cover the hold-to-record lifecycle plus who is being voiced on delivery.

import type { RuneName } from './runeVisuals';

/** Push-to-talk display states: idle (ready), recording (holding), thinking (transcribe + Ask),
 *  the two delivered voices, and denied (mic sealed shut for the session). */
export type MedallionState =
	| 'idle'
	| 'recording'
	| 'thinking'
	| 'speaking'
	| 'skoll-speaking'
	| 'denied';

// Canonical copy: docs/ux-copy.md §6 (eclipse medallion). The label carries the state plus the
// hold-to-record affordance. Readonly via `as const` so TS-guarded code can't fork the canon.
export const MEDALLION_LABEL = {
	idle: 'Hold to speak to the Oracle.',
	recording: 'Listening — release to ask.',
	thinking: 'The Oracle considers your words.',
	speaking: 'The Oracle speaks.',
	'skoll-speaking': 'Sköll speaks.',
	// Sealed: a denied or absent mic. No hold affordance — the rite goes on by hand.
	denied: 'The voice is sealed. The rite continues by hand.'
} as const satisfies Record<MedallionState, string>;

// Polite live-region lines for each transition — the indicator is small and changes are infrequent.
export const MEDALLION_ANNOUNCEMENT = {
	idle: 'Ready to hear you.',
	recording: 'Listening.',
	thinking: 'The Oracle considers.',
	speaking: 'The Oracle speaks.',
	'skoll-speaking': 'Sköll speaks.',
	denied: 'The voice is sealed.'
} as const satisfies Record<MedallionState, string>;

// Rim glyphs (decorative, reused card assets per R6). Ansuz leads — the rune of the spoken word.
export const RING_RUNES: readonly RuneName[] = [
	'Ansuz',
	'Sowilo',
	'Raido',
	'Tiwaz',
	'Dagaz',
	'Algiz',
	'Kenaz',
	'Jera'
];

// Volume-level strip (assets-webp/ui/voice-medallion-levels.webp): 12 frames of 128px laid out
// horizontally, glow intensity 0 (rest) → 11 (peak), per the asset's authoring manifest.
export const SPRITE_LEVELS = 12;
const SPRITE_PEAK_LEVEL = SPRITE_LEVELS - 1;

/** Glow level for a state. Looping states (recording/speaking/sköll) ping-pong the strip in CSS —
 * their value here is the frozen level reduced motion falls back to. */
export function spriteLevel(state: MedallionState): number {
	switch (state) {
		case 'denied':
			return 0;
		case 'idle':
		case 'thinking':
			return 4;
		case 'recording':
		case 'speaking':
		case 'skoll-speaking':
			return SPRITE_PEAK_LEVEL;
	}
}
