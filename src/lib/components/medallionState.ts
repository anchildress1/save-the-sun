// Pure medallion state -> presentation mappings, kept framework-free so the completeness
// of every state is unit-testable outside the Svelte component (the runeVisuals.ts pattern).

import type { VoiceState } from '$lib/voice/voiceSession';
import type { RuneName } from './runeVisuals';

/** Display union: S2's five voice states plus Sköll's playback, driven by the S13 director. */
export type MedallionState = VoiceState | 'skoll-speaking';

// Canonical copy: docs/ux-copy.md §6 (eclipse medallion). State first, then what a tap does.
export const MEDALLION_LABEL: Record<MedallionState, string> = {
	asleep: 'The voice sleeps. Wake the Oracle.',
	waking: 'The Oracle stirs. Silence the voice.',
	listening: 'The Oracle listens. Silence the voice.',
	hearing: 'The Oracle hears you. Silence the voice.',
	thinking: 'The Oracle considers. Silence the voice.',
	speaking: 'The Oracle speaks. Silence the voice.',
	'skoll-speaking': 'Sköll speaks. Silence the voice.'
};

// Polite live-region lines for the transitions a player must never miss: mic privacy and who
// holds the fire. null = stay quiet (hearing/thinking are still "listening" to a listener,
// and announcing every utterance would drown the screen reader in chatter).
export const MEDALLION_ANNOUNCEMENT: Record<MedallionState, string | null> = {
	asleep: 'The voice sleeps.',
	waking: 'The Oracle stirs.',
	listening: 'The Oracle listens.',
	hearing: null,
	thinking: null,
	speaking: 'The Oracle speaks.',
	'skoll-speaking': 'Sköll speaks.'
};

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

// Mic RMS at which the corona reads fully flared; conversational speech peaks well below 1.0 raw.
const FLARE_FULL_RMS = 0.3;

/** Corona flare level (0..1) from a raw mic RMS amplitude. Garbage in (NaN/negative) reads as
 * silence and over-scale readings clamp to full — CSS never sees an out-of-range value. */
export function flareLevel(amplitude: number): number {
	if (Number.isNaN(amplitude) || amplitude <= 0) return 0;
	return Math.min(1, amplitude / FLARE_FULL_RMS);
}
