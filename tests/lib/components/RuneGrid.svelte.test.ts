import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi } from 'vitest';
import RuneGrid from '$lib/components/RuneGrid.svelte';

function cardIds(container: HTMLElement): number[] {
	return [...container.querySelectorAll<HTMLElement>('.rune-card[data-rune-id]')].map((el) =>
		Number(el.dataset.runeId)
	);
}

describe('RuneGrid', () => {
	it('renders all 24 runes shuffled — every rune present, not the sorted order', async () => {
		const sorted = Array.from({ length: 24 }, (_, i) => i + 1);
		const screen = render(RuneGrid, { boardSeed: 42, onSelectTarget: vi.fn() });
		const ids = cardIds(screen.container);
		expect(ids).toHaveLength(24);
		expect([...ids].sort((a, b) => a - b)).toEqual(sorted);
		// Anti-pattern board: the on-screen order must not be the sorted data order.
		expect(ids).not.toEqual(sorted);
	});

	it('keeps the same order for the same seed across renders', async () => {
		const a = cardIds(render(RuneGrid, { boardSeed: 7, onSelectTarget: vi.fn() }).container);
		const b = cardIds(render(RuneGrid, { boardSeed: 7, onSelectTarget: vi.fn() }).container);
		expect(a).toEqual(b);
	});

	it('does not reshuffle when a card is crossed off (order depends only on the seed)', async () => {
		const screen = render(RuneGrid, { boardSeed: 7, onSelectTarget: vi.fn() });
		const before = cardIds(screen.container);
		await screen.getByRole('button', { name: /cross off sowilo/i }).click();
		expect(cardIds(screen.container)).toEqual(before);
	});

	it('crosses a card off and restores it on repeat clicks', async () => {
		const screen = render(RuneGrid, { boardSeed: 0, onSelectTarget: vi.fn() });
		const first = screen.container.querySelector('.rune-card[data-rune-id="1"]')!;
		expect(first.classList.contains('crossed')).toBe(false);
		await screen.getByRole('button', { name: /cross off sowilo/i }).click();
		expect(first.classList.contains('crossed')).toBe(true);
		await screen.getByRole('button', { name: /restore sowilo/i }).click();
		expect(first.classList.contains('crossed')).toBe(false);
	});

	it('routes a tap to onSelectTarget in cast mode without crossing off', async () => {
		const onSelectTarget = vi.fn();
		const screen = render(RuneGrid, { boardSeed: 0, castMode: true, onSelectTarget });
		const first = screen.container.querySelector('.rune-card[data-rune-id="1"]')!;
		await screen.getByRole('button', { name: /select sowilo as cast target/i }).click();
		expect(onSelectTarget).toHaveBeenCalledWith(1);
		expect(first.classList.contains('crossed')).toBe(false);
		// Only the tapped target highlights — the board is otherwise unchanged.
		expect(first.classList.contains('selected')).toBe(true);
		const second = screen.container.querySelector('.rune-card[data-rune-id="2"]')!;
		expect(second.classList.contains('selected')).toBe(false);
	});
});
