import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi } from 'vitest';
import RuneCard from './RuneCard.svelte';
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

describe('RuneCard', () => {
	it('renders glyph, name, and every trait as visible text (no color alone)', async () => {
		const screen = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		await expect.element(screen.getByText('ᚢ')).toBeInTheDocument();
		await expect.element(screen.getByText('Uruz')).toBeInTheDocument();
		await expect.element(screen.getByText('Fire')).toBeInTheDocument();
		await expect.element(screen.getByText('Light')).toBeInTheDocument();
		await expect.element(screen.getByText('Silver')).toBeInTheDocument();
		await expect.element(screen.getByText('4', { exact: true })).toBeInTheDocument();
		await expect.element(screen.getByText('6', { exact: true })).toBeInTheDocument();
	});

	it('renders one pip per power point', async () => {
		const screen = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		expect(screen.container.querySelectorAll('.pip')).toHaveLength(4);
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
