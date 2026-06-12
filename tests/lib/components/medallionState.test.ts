import { describe, it, expect } from 'vitest';
import {
	MEDALLION_ANNOUNCEMENT,
	MEDALLION_LABEL,
	RING_RUNES,
	SPRITE_COLS,
	SPRITE_ROWS,
	flareLevel,
	spriteFrame,
	type MedallionState
} from '$lib/components/medallionState';
import { RUNE_SYMBOL_ASSET } from '$lib/components/runeVisuals';

const ALL_STATES: MedallionState[] = [
	'asleep',
	'waking',
	'listening',
	'hearing',
	'thinking',
	'speaking',
	'skoll-speaking'
];

describe('MEDALLION_LABEL', () => {
	it('carries a non-empty label for every medallion state', () => {
		expect(Object.keys(MEDALLION_LABEL).sort()).toEqual([...ALL_STATES].sort());
		for (const state of ALL_STATES) {
			expect(MEDALLION_LABEL[state].length).toBeGreaterThan(0);
		}
	});

	it('invites the wake action only while asleep — every awake state offers silence', () => {
		expect(MEDALLION_LABEL.asleep).toContain('Wake');
		for (const state of ALL_STATES.filter((s) => s !== 'asleep')) {
			expect(MEDALLION_LABEL[state]).toContain('Silence the voice');
		}
	});

	it('names the speaker unambiguously when someone holds the fire', () => {
		expect(MEDALLION_LABEL.speaking).toContain('Oracle');
		expect(MEDALLION_LABEL['skoll-speaking']).toContain('Sköll');
	});
});

describe('MEDALLION_ANNOUNCEMENT', () => {
	it('announces the privacy-critical states and stays quiet inside a live exchange', () => {
		expect(Object.keys(MEDALLION_ANNOUNCEMENT).sort()).toEqual([...ALL_STATES].sort());
		// Mic on/off and who speaks must announce; hearing/thinking are still "listening".
		expect(MEDALLION_ANNOUNCEMENT.asleep).toBeTruthy();
		expect(MEDALLION_ANNOUNCEMENT.waking).toBeTruthy(); // the mic is being opened — never silent
		expect(MEDALLION_ANNOUNCEMENT.listening).toBeTruthy();
		expect(MEDALLION_ANNOUNCEMENT.speaking).toBeTruthy();
		expect(MEDALLION_ANNOUNCEMENT['skoll-speaking']).toBeTruthy();
		expect(MEDALLION_ANNOUNCEMENT.hearing).toBeNull();
		expect(MEDALLION_ANNOUNCEMENT.thinking).toBeNull();
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

describe('spriteFrame', () => {
	it('keeps every state inside the sheet', () => {
		const frames = SPRITE_COLS * SPRITE_ROWS;
		for (const state of ALL_STATES) {
			for (const flare of [0, 0.5, 1]) {
				const frame = spriteFrame(state, flare);
				expect(Number.isInteger(frame)).toBe(true);
				expect(frame).toBeGreaterThanOrEqual(0);
				expect(frame).toBeLessThan(frames);
			}
		}
	});

	it.each([
		{ state: 'asleep' as const, frame: 0 },
		{ state: 'waking' as const, frame: 8 },
		{ state: 'listening' as const, frame: 12 },
		{ state: 'thinking' as const, frame: 12 },
		{ state: 'speaking' as const, frame: 31 },
		{ state: 'skoll-speaking' as const, frame: 31 }
	])('rests $state on frame $frame', ({ state, frame }) => {
		expect(spriteFrame(state)).toBe(frame);
	});

	it.each([
		{ label: 'silence', flare: 0, frame: 0 },
		{ label: 'half flare', flare: 0.5, frame: 16 },
		{ label: 'full flare', flare: 1, frame: 31 },
		{ label: 'a negative flare clamped to the dim end', flare: -1, frame: 0 },
		{ label: 'an over-range flare clamped to the peak', flare: 2, frame: 31 }
	])('climbs the hearing ramp with $label', ({ flare, frame }) => {
		expect(spriteFrame('hearing', flare)).toBe(frame);
	});
});

describe('flareLevel', () => {
	it.each([
		{ label: 'silence', amplitude: 0, expected: 0 },
		{ label: 'half-scale speech', amplitude: 0.15, expected: 0.5 },
		{ label: 'full-scale speech', amplitude: 0.3, expected: 1 },
		{ label: 'louder than full scale', amplitude: 0.6, expected: 1 },
		{ label: 'raw RMS ceiling', amplitude: 1, expected: 1 },
		{ label: 'a negative amplitude', amplitude: -0.4, expected: 0 },
		{ label: 'NaN from a broken feed', amplitude: Number.NaN, expected: 0 },
		{ label: 'Infinity from a broken feed', amplitude: Number.POSITIVE_INFINITY, expected: 1 }
	])('maps $label to a flare of $expected', ({ amplitude, expected }) => {
		expect(flareLevel(amplitude)).toBeCloseTo(expected, 10);
	});

	it('never escapes the 0..1 range CSS expects', () => {
		for (const amplitude of [-1e9, -0.0001, 0.0001, 0.299, 0.301, 1e9]) {
			const flare = flareLevel(amplitude);
			expect(flare).toBeGreaterThanOrEqual(0);
			expect(flare).toBeLessThanOrEqual(1);
		}
	});
});
