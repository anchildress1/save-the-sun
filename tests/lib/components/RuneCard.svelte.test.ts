import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi } from 'vitest';
import RuneCard from '$lib/components/RuneCard.svelte';
import type { Rune } from '$lib/board';

// id 6 / power 4 so the badge and power numerals never collide in text queries.
const uruz: Rune = {
	id: 6,
	name: 'Uruz',
	glyph: 'ᚢ',
	meaning: 'aurochs, strength',
	element: 'Fire',
	power: 4,
	fill: 'Light',
	color: 'Silver'
};

// A Dark rune to assert the solid-pip semantics.
const perthro: Rune = {
	id: 13,
	name: 'Perthro',
	glyph: 'ᛈ',
	meaning: 'dice-cup, fate',
	element: 'Spirit',
	power: 1,
	fill: 'Dark',
	color: 'Gold'
};

describe('RuneCard', () => {
	it('renders glyph, name, element, and color as visible text', async () => {
		const screen = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		await expect.element(screen.getByText('ᚢ')).toBeInTheDocument();
		await expect.element(screen.getByText('Uruz')).toBeInTheDocument();
		await expect.element(screen.getByText('Fire')).toBeInTheDocument();
		await expect.element(screen.getByText('Silver')).toBeInTheDocument();
	});

	it('shows neither the power numeral nor the rune id as visible text', async () => {
		// id 6 / power 4 — counting the pips and the accessible name carry power; the
		// id is internal. Neither number appears on the card face.
		const screen = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		expect(screen.container.textContent).not.toMatch(/[46]/);
	});

	it('never shows light/dark as a visible word (locked decision)', async () => {
		const light = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		expect(light.container.textContent).not.toMatch(/\b(light|dark)\b/i);
		const dark = render(RuneCard, { rune: perthro, onAction: vi.fn() });
		expect(dark.container.textContent).not.toMatch(/\b(light|dark)\b/i);
	});

	it('speaks power + light/dark together in the accessible name ("{n} {light|dark} power")', async () => {
		const light = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		await expect
			.element(light.getByRole('button', { name: /cross off uruz, 4 light power/i }))
			.toBeInTheDocument();

		const dark = render(RuneCard, { rune: perthro, onAction: vi.fn() });
		await expect
			.element(dark.getByRole('button', { name: /cross off perthro, 1 dark power/i }))
			.toBeInTheDocument();
	});

	it('encodes fill on the pips — light pips plain, dark pips marked; count = power', async () => {
		const light = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		expect(light.container.querySelectorAll('.pip')).toHaveLength(4);
		expect(light.container.querySelectorAll('.pip.dark')).toHaveLength(0);

		const dark = render(RuneCard, { rune: perthro, onAction: vi.fn() });
		expect(dark.container.querySelectorAll('.pip')).toHaveLength(1);
		expect(dark.container.querySelectorAll('.pip.dark')).toHaveLength(1);
	});

	it('fires onAction with the rune id on click', async () => {
		const onAction = vi.fn();
		const screen = render(RuneCard, { rune: uruz, onAction });
		await screen.getByRole('button', { name: /cross off uruz/i }).click();
		expect(onAction).toHaveBeenCalledWith(6);
	});

	it('shows a restore label and strike marks when crossed', async () => {
		const screen = render(RuneCard, { rune: uruz, crossed: true, onAction: vi.fn() });
		await expect.element(screen.getByRole('button', { name: /restore uruz/i })).toBeInTheDocument();
		expect(screen.container.querySelectorAll('.strike')).toHaveLength(2);
	});

	it('exposes a cast-target label when armed', async () => {
		const screen = render(RuneCard, { rune: uruz, armed: true, onAction: vi.fn() });
		await expect
			.element(screen.getByRole('button', { name: /select uruz as cast target/i }))
			.toBeInTheDocument();
	});
});
