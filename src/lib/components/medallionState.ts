// Pure medallion state -> presentation mappings, kept framework-free so the completeness
// of every state is unit-testable outside the Svelte component (the runeVisuals.ts pattern).

import type { VoiceState } from '$lib/voice/voiceSession';
import type { RuneName } from './runeVisuals';

/** Display union: every session voice state plus Sköll's playback, driven by the S13 director. */
export type MedallionState = VoiceState | 'skoll-speaking';

// Canonical copy: docs/ux-copy.md §6 (eclipse medallion). State first, then what a tap does.
// Readonly via `as const` (compile-time): TS-guarded code can't fork them from the canon.
export const MEDALLION_LABEL = {
	asleep: 'The voice sleeps. Wake the Oracle.',
	// Eclipsed is sealed (S4): no action tail — a tap does nothing, and the label must not promise one.
	eclipsed: 'The voice is sealed. The rite continues by hand.',
	waking: 'The Oracle stirs. Silence the voice.',
	listening: 'The Oracle listens. Silence the voice.',
	hearing: 'The Oracle hears you. Silence the voice.',
	thinking: 'The Oracle considers. Silence the voice.',
	speaking: 'The Oracle speaks. Silence the voice.',
	'skoll-speaking': 'Sköll speaks. Silence the voice.'
} as const satisfies Record<MedallionState, string>;

// Polite live-region lines for the transitions a player must never miss: mic privacy and who
// holds the fire. null = stay quiet (hearing/thinking are still "listening" to a listener,
// and announcing every utterance would drown the screen reader in chatter).
export const MEDALLION_ANNOUNCEMENT = {
	asleep: 'The voice sleeps.',
	eclipsed: 'The voice is sealed.',
	waking: 'The Oracle stirs.',
	listening: 'The Oracle listens.',
	hearing: null,
	thinking: null,
	speaking: 'The Oracle speaks.',
	'skoll-speaking': 'Sköll speaks.'
} as const satisfies Record<MedallionState, string | null>;

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

/** Glow level for a state; hearing maps mic flare with the asset's own volume formula.
 * Looping states (listening/speaking/sköll) ping-pong the strip in CSS — their value here
 * is the frozen level reduced motion falls back to. */
export function spriteLevel(state: MedallionState, flare = 0): number {
	switch (state) {
		case 'asleep':
		case 'eclipsed':
			return 0;
		case 'waking':
			return 2;
		case 'hearing':
			return Math.min(
				SPRITE_PEAK_LEVEL,
				Math.floor(Math.min(1, Math.max(0, flare)) * SPRITE_LEVELS)
			);
		case 'thinking':
		case 'listening':
			return 4;
		case 'speaking':
		case 'skoll-speaking':
			return SPRITE_PEAK_LEVEL;
	}
}

// Mic RMS at which the corona reads fully flared; conversational speech peaks well below 1.0 raw.
const FLARE_FULL_RMS = 0.3;

/** Corona flare level (0..1) from a raw mic RMS amplitude. Garbage in (NaN/negative) reads as
 * silence and over-scale readings clamp to full — CSS never sees an out-of-range value. */
export function flareLevel(amplitude: number): number {
	if (Number.isNaN(amplitude) || amplitude <= 0) return 0;
	return Math.min(1, amplitude / FLARE_FULL_RMS);
}
