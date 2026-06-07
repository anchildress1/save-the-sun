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

	it('lays the 24 cards out in a 6-column grid (6×4)', async () => {
		const screen = render(RuneGrid, { boardSeed: 42, onSelectTarget: vi.fn() });
		const cards = [...screen.container.querySelectorAll<HTMLElement>('.rune-card')];
		expect(cards).toHaveLength(24);
		// Count columns by geometry, not by parsing gridTemplateColumns: getComputedStyle can
		// return the declared `minmax(0, 1fr)` (with internal spaces) when layout is unresolved,
		// which makes string-splitting flaky. Cards sharing the first row's top give the column
		// count — `repeat(6, …)` is always 6 tracks, so 24 cards resolve to 6×4.
		const firstRowTop = cards[0].offsetTop;
		const firstRow = cards.filter((card) => card.offsetTop === firstRowTop);
		expect(firstRow).toHaveLength(6);
	});

	it('renders the crossed visual state in place — dimmed card keeps its chalk X', async () => {
		const screen = render(RuneGrid, { boardSeed: 0, onSelectTarget: vi.fn() });
		const card = screen.container.querySelector('.rune-card[data-rune-id="1"]')!;
		await screen.getByRole('button', { name: /cross off sowilo/i }).click();
		expect(card.classList.contains('crossed')).toBe(true);
		expect(card.querySelectorAll('.strikeout line')).toHaveLength(2);
	});

	it('renders the armed visual state — only the chosen target wears the halo', async () => {
		const screen = render(RuneGrid, { boardSeed: 0, castMode: true, onSelectTarget: vi.fn() });
		// Armed: every card offers a select-target affordance instead of cross-off.
		const cards = screen.container.querySelectorAll('.rune-card');
		expect(cards).toHaveLength(24);
		await screen.getByRole('button', { name: /select sowilo as cast target/i }).click();
		const selected = screen.container.querySelectorAll('.rune-card.selected');
		expect(selected).toHaveLength(1);
		expect((selected[0] as HTMLElement).dataset.runeId).toBe('1');
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
