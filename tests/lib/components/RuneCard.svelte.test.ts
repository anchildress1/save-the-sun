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
	it('renders glyph, name, element, color, and power numeral as visible text', async () => {
		const screen = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		await expect.element(screen.getByText('ᚢ')).toBeInTheDocument();
		await expect.element(screen.getByText('Uruz')).toBeInTheDocument();
		await expect.element(screen.getByText('Fire')).toBeInTheDocument();
		await expect.element(screen.getByText('Silver')).toBeInTheDocument();
		await expect.element(screen.getByText('4', { exact: true })).toBeInTheDocument();
		await expect.element(screen.getByText('6', { exact: true })).toBeInTheDocument();
	});

	it('does not surface the light/dark axis on the card (queryable via the Oracle)', async () => {
		const screen = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		expect(screen.container.textContent).not.toMatch(/\b(light|dark)\b/i);
		// The power label carries no fill; pips are power count only.
		await expect.element(screen.getByLabelText('power 4')).toBeInTheDocument();
	});

	it('renders pips as filled power markers — count = power, no fill variance', async () => {
		const light = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		expect(light.container.querySelectorAll('.pip')).toHaveLength(4);
		expect(light.container.querySelectorAll('.pip.dark')).toHaveLength(0);

		// A Dark rune renders the same pip treatment — only the count differs.
		const dark = render(RuneCard, { rune: perthro, onAction: vi.fn() });
		expect(dark.container.querySelectorAll('.pip')).toHaveLength(1);
		expect(dark.container.querySelectorAll('.pip.dark')).toHaveLength(0);
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
