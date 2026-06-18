import { describe, it, expect } from 'vitest';
import {
	MEDALLION_ANNOUNCEMENT,
	MEDALLION_LABEL,
	RING_RUNES,
	SPRITE_LEVELS,
	spriteLevel,
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
