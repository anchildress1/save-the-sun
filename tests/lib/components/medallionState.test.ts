import { describe, it, expect } from 'vitest';
import {
	MEDALLION_ANNOUNCEMENT,
	MEDALLION_LABEL,
	RING_RUNES,
	SPRITE_LEVELS,
	SPEAK_FLOOR,
	VOICE_GAIN,
	spriteLevel,
	voiceEnvelope,
	type MedallionState
} from '$lib/components/medallionState';
import { RUNE_SYMBOL_ASSET } from '$lib/components/runeVisuals';

const ALL_STATES: MedallionState[] = [
	'idle',
	'recording',
	'thinking',
	'speaking',
	'skoll-speaking',
	'denied'
];

describe('MEDALLION_LABEL', () => {
	it('carries a non-empty label for every medallion state', () => {
		expect(Object.keys(MEDALLION_LABEL).sort()).toEqual([...ALL_STATES].sort());
		for (const state of ALL_STATES) {
			expect(MEDALLION_LABEL[state].length).toBeGreaterThan(0);
		}
	});

	it('offers the hold-to-speak affordance while idle', () => {
		expect(MEDALLION_LABEL.idle).toContain('Hold');
	});

	it('promises no hold while denied — the seal is inert', () => {
		expect(MEDALLION_LABEL.denied).not.toContain('Hold');
	});

	it('names the speaker unambiguously when someone holds the fire', () => {
		expect(MEDALLION_LABEL.speaking).toContain('Oracle');
		expect(MEDALLION_LABEL['skoll-speaking']).toContain('Sköll');
	});
});

describe('MEDALLION_ANNOUNCEMENT', () => {
	it('announces every state transition with a non-empty line', () => {
		expect(Object.keys(MEDALLION_ANNOUNCEMENT).sort()).toEqual([...ALL_STATES].sort());
		for (const state of ALL_STATES) {
			expect(MEDALLION_ANNOUNCEMENT[state].length).toBeGreaterThan(0);
		}
		expect(MEDALLION_ANNOUNCEMENT.speaking).toContain('Oracle');
		expect(MEDALLION_ANNOUNCEMENT['skoll-speaking']).toContain('Sköll');
	});
});

describe('RING_RUNES', () => {
	it('lays eight distinct glyphs around the rim, each backed by a real card asset', () => {
		expect(RING_RUNES).toHaveLength(8);
		expect(new Set(RING_RUNES).size).toBe(8);
		for (const name of RING_RUNES) {
			expect(RUNE_SYMBOL_ASSET[name]).toBeTruthy();
		}
	});
});

describe('spriteLevel', () => {
	it('keeps every state inside the strip', () => {
		for (const state of ALL_STATES) {
			const level = spriteLevel(state);
			expect(Number.isInteger(level)).toBe(true);
			expect(level).toBeGreaterThanOrEqual(0);
			expect(level).toBeLessThan(SPRITE_LEVELS);
		}
	});

	it.each([
		{ state: 'denied' as const, level: 0 },
		{ state: 'idle' as const, level: 4 },
		{ state: 'thinking' as const, level: 4 },
		{ state: 'recording' as const, level: 11 },
		{ state: 'speaking' as const, level: 11 },
		{ state: 'skoll-speaking' as const, level: 11 }
	])('rests $state on level $level', ({ state, level }) => {
		expect(spriteLevel(state)).toBe(level);
	});
});

describe('voiceEnvelope', () => {
	it('floors silence at SPEAK_FLOOR so a quiet beat still reads as speaking, never below idle', () => {
		expect(voiceEnvelope(0)).toBe(SPEAK_FLOOR);
		// Idle rests at frame 4; the speaking floor must map at or above it, never dimmer than idle.
		expect(Math.round(voiceEnvelope(0) * (SPRITE_LEVELS - 1))).toBeGreaterThanOrEqual(
			spriteLevel('idle')
		);
	});

	it('clamps a loud beat to 1 — the strip never overshoots its peak', () => {
		expect(voiceEnvelope(0.5)).toBe(1);
		expect(voiceEnvelope(1)).toBe(1);
	});

	it('lifts a realistic speech RMS near peak — the regression that left the disc dead', () => {
		// Measured live: voiced TTS RMS peaks ~0.2–0.25. The raw value alone lit only frame ~2 (dimmer
		// than idle); gained, it must drive the disc near peak so the pulse is actually visible.
		expect(Math.round(voiceEnvelope(0.23) * (SPRITE_LEVELS - 1))).toBeGreaterThanOrEqual(9);
	});

	it('rises with the input between floor and clamp', () => {
		expect(voiceEnvelope(0.12)).toBeLessThan(voiceEnvelope(0.2));
		expect(voiceEnvelope(0.15)).toBeCloseTo(0.15 * VOICE_GAIN, 5);
	});

	it('stays within [SPEAK_FLOOR, 1] for any input, including out-of-range', () => {
		for (const rms of [-0.1, 0, 0.05, 0.3, 0.9, 2]) {
			const v = voiceEnvelope(rms);
			expect(v).toBeGreaterThanOrEqual(SPEAK_FLOOR);
			expect(v).toBeLessThanOrEqual(1);
		}
	});
});
