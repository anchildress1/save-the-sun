import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi } from 'vitest';
import RuneGrid from '$lib/components/RuneGrid.svelte';

function cardIds(container: HTMLElement): number[] {
	return [...container.querySelectorAll('.rune-card[data-rune-id]')].map((el) =>
		Number(el.getAttribute('data-rune-id'))
	);
}

describe('RuneGrid', () => {
	it('renders all 24 runes in fixed on-screen order', async () => {
		const screen = render(RuneGrid, { onSelectTarget: vi.fn() });
		const ids = cardIds(screen.container);
		expect(ids).toHaveLength(24);
		expect(ids).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
	});

	it('crosses a card off and restores it on repeat clicks', async () => {
		const screen = render(RuneGrid, { onSelectTarget: vi.fn() });
		const first = screen.container.querySelector('.rune-card[data-rune-id="1"]')!;
		expect(first.classList.contains('crossed')).toBe(false);
		await screen.getByRole('button', { name: /cross off sowilo/i }).click();
		expect(first.classList.contains('crossed')).toBe(true);
		await screen.getByRole('button', { name: /restore sowilo/i }).click();
		expect(first.classList.contains('crossed')).toBe(false);
	});

	it('routes a tap to onSelectTarget in cast mode without crossing off', async () => {
		const onSelectTarget = vi.fn();
		const screen = render(RuneGrid, { castMode: true, onSelectTarget });
		const first = screen.container.querySelector('.rune-card[data-rune-id="1"]')!;
		await screen.getByRole('button', { name: /select sowilo as cast target/i }).click();
		expect(onSelectTarget).toHaveBeenCalledWith(1);
		expect(first.classList.contains('crossed')).toBe(false);
	});
});
