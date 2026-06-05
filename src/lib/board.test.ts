import { describe, it, expect } from 'vitest';
import { runes } from './board';

describe('Rune Board Data Source', () => {
	it('loads exactly 24 runes from runes.json', () => {
		expect(runes).toHaveLength(24);
	});

	it('parses the first rune correctly', () => {
		const sowilo = runes.find((r) => r.name === 'Sowilo');
		expect(sowilo).toBeDefined();
		expect(sowilo?.id).toBe(1);
		expect(sowilo?.glyph).toBe('ᛋ');
		expect(sowilo?.element).toBe('Sun');
		expect(sowilo?.power).toBe(1);
		expect(sowilo?.fill).toBe('Light');
		expect(sowilo?.color).toBe('Blue');
	});

	it('maintains the fixed on-screen order (id 1 to 24)', () => {
		expect(runes[0].id).toBe(1);
		expect(runes[23].id).toBe(24);
	});
});
