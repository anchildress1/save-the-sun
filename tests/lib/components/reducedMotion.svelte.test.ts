import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi } from 'vitest';
import EndScreen from '$lib/components/EndScreen.svelte';
import RuneGrid from '$lib/components/RuneGrid.svelte';

// S10 — prefers-reduced-motion (test-plan.md §7). The client suite runs the browser context with
// `reducedMotion: 'reduce'` (vite.config.ts), so these render in exactly the reduced state: motion is
// cut to instant, yet the live state the motion decorated is still fully present and still mutable.

describe('reduced motion — the rite is present at once, never mid-animation', () => {
	it('shows every EndScreen line at full opacity immediately (no rise-in to wait on)', async () => {
		const screen = render(EndScreen, { outcome: 'win', onReplay: vi.fn(), onLeave: vi.fn() });
		const lines = [...screen.container.querySelectorAll<HTMLElement>('.line, .actions')];
		expect(lines.length).toBeGreaterThan(0);
		// The CSS staggers these in from opacity:0; under reduced motion the media query forces them to
		// opacity:1 with no animation, so the whole verse is legible the instant it mounts.
		for (const el of lines) {
			expect(getComputedStyle(el).opacity).toBe('1');
		}
	});

	it('renders the full board at rest under reduced motion — the entrance stagger is skipped', async () => {
		const screen = render(RuneGrid, { boardSeed: 42, onSelectTarget: vi.fn() });
		const wrappers = [...screen.container.querySelectorAll<HTMLElement>('.rune-card-wrapper')];
		expect(wrappers).toHaveLength(24);
		// GSAP's `from` would write opacity:0 and clear it over time; the reduced-motion guard returns
		// before it runs, so the cards never leave their resting (visible) state.
		for (const el of wrappers) {
			expect(getComputedStyle(el).opacity).toBe('1');
		}
	});

	it('still reflects live state changes — a cross lands instantly, not after a beat', async () => {
		const screen = render(RuneGrid, { boardSeed: 0, onSelectTarget: vi.fn() });
		const card = screen.container.querySelector('.rune-card[data-rune-id="1"]')!;
		expect(card.classList.contains('crossed')).toBe(false);
		await screen.getByRole('button', { name: /cross off sowilo/i }).click();
		// No motion to gate it: the crossed state is on the moment the action resolves.
		expect(card.classList.contains('crossed')).toBe(true);
	});
});
