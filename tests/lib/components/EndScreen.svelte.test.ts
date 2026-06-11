import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi } from 'vitest';
import EndScreen from '$lib/components/EndScreen.svelte';

// S9 — the closing rite (ux-copy.md §4). Victory and defeat each stage their exact in-world lines and
// a single replay CTA; the overlay is a focus-trapping aria-modal dialog over the resolved board.

describe('EndScreen — victory sequence', () => {
	const renderWin = (over: { onReplay?: () => void } = {}) =>
		render(EndScreen, { outcome: 'win', onReplay: vi.fn(), ...over });

	it('voices the three victory lines in order, ending on Sól’s blessing', async () => {
		const screen = renderWin();
		await expect.element(screen.getByText('The rune is true.')).toBeInTheDocument();
		await expect.element(screen.getByText('Sól crests the rim of the world.')).toBeInTheDocument();
		await expect
			.element(
				screen.getByText(
					'The offering is made. The longest day breaks — and the light is yours to keep.'
				)
			)
			.toBeInTheDocument();
		// DOM order is the rite's order — the blessing lands last.
		const lines = Array.from(
			screen.container.querySelectorAll('.line') as NodeListOf<HTMLElement>
		).map((n) => n.textContent?.trim());
		expect(lines).toEqual([
			'The rune is true.',
			'Sól crests the rim of the world.',
			'The offering is made. The longest day breaks — and the light is yours to keep.'
		]);
	});

	it('offers the victory CTA with its exact in-world label — and only it', async () => {
		const screen = renderWin();
		await expect
			.element(screen.getByRole('button', { name: 'Begin another night' }))
			.toBeInTheDocument();
		// The single closing action — no "Leave the fire." escape hatch.
		expect(screen.container.querySelectorAll('.actions button')).toHaveLength(1);
		expect(screen.container.textContent).not.toContain('Leave the fire.');
	});

	it('fires onReplay from the CTA', async () => {
		const onReplay = vi.fn();
		const screen = renderWin({ onReplay });
		await screen.getByRole('button', { name: 'Begin another night' }).click();
		expect(onReplay).toHaveBeenCalledOnce();
	});

	it('uses the dawn splash and tags the outcome', async () => {
		const screen = renderWin();
		const root = screen.getByTestId('end-screen').element();
		expect(root.getAttribute('data-outcome')).toBe('win');
		const img = root.querySelector('img.splash') as HTMLImageElement;
		// Decorative art — named only by the lines, never by the image.
		expect(img.getAttribute('alt')).toBe('');
		expect(img.getAttribute('aria-hidden')).toBe('true');
		expect(img.getAttribute('src')).toMatch(/dawn-splash/);
	});
});

describe('EndScreen — defeat sequence', () => {
	const renderLose = (over: { onReplay?: () => void } = {}) =>
		render(EndScreen, { outcome: 'lose', onReplay: vi.fn(), ...over });

	it('tolls the defeat in a lead line and its quieter consequence — no victory verse', async () => {
		const screen = renderLose();
		const root = screen.getByTestId('end-screen').element();
		expect(root.querySelector('.lead')?.textContent?.trim()).toBe('Sköll takes the sun.');
		expect(root.querySelector('.coda')?.textContent?.trim()).toBe(
			'The longest day never breaks. The year falls to dark.'
		);
		// The full canonical sentence is preserved across the two lines, in order.
		expect(root.querySelector('.verse')).toBeNull();
		expect(screen.container.querySelectorAll('.line')).toHaveLength(2);
	});

	it('offers the defeat CTAs — "Stand against him again" replaces the victory replay', async () => {
		const onReplay = vi.fn();
		const screen = renderLose({ onReplay });
		// Defeat replay is its own line; the victory one must not appear.
		expect(screen.container.querySelector('[data-testid="end-replay"]')?.textContent?.trim()).toBe(
			'Stand against him again'
		);
		expect(screen.container.textContent).not.toContain('Begin another night');
		await screen.getByRole('button', { name: 'Stand against him again' }).click();
		expect(onReplay).toHaveBeenCalledOnce();
	});

	it('uses the defeat splash and tags the outcome', async () => {
		const screen = renderLose();
		const root = screen.getByTestId('end-screen').element();
		expect(root.getAttribute('data-outcome')).toBe('lose');
		const img = root.querySelector('img.splash') as HTMLImageElement;
		expect(img.getAttribute('src')).toMatch(/defeat-splash/);
	});

	it('darkens the defeat rite surface so the modal reads intentionally over the dark splash', () => {
		const screen = renderLose();
		const rite = screen.container.querySelector('.rite') as HTMLElement;
		expect(getComputedStyle(rite).backgroundImage).toContain('rgba(6, 9, 18, 0.78)');
	});
});

describe('EndScreen — accessibility & voice', () => {
	it('is an aria-modal dialog named by its lead line — the heaviest beat', async () => {
		const screen = render(EndScreen, { outcome: 'win', onReplay: vi.fn() });
		const dialog = screen.getByRole('dialog').element();
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		const labelledby = dialog.getAttribute('aria-labelledby');
		const labelEl = dialog.querySelector(`#${labelledby}`);
		expect(labelEl?.textContent?.trim()).toBe('The rune is true.');
	});

	it('opens focus on the replay CTA', async () => {
		render(EndScreen, { outcome: 'win', onReplay: vi.fn() });
		await expect.poll(() => document.activeElement?.getAttribute('data-testid')).toBe('end-replay');
	});

	it('traps Tab on the lone CTA — focus never leaves the dialog', async () => {
		const screen = render(EndScreen, { outcome: 'lose', onReplay: vi.fn() });
		await expect.poll(() => document.activeElement?.getAttribute('data-testid')).toBe('end-replay');
		const replay = screen.getByTestId('end-replay').element() as HTMLElement;
		// With a single focusable, both Tab and Shift+Tab keep focus on it (first === last).
		replay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
		await expect.poll(() => document.activeElement?.getAttribute('data-testid')).toBe('end-replay');
		replay.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
		);
		await expect.poll(() => document.activeElement?.getAttribute('data-testid')).toBe('end-replay');
	});

	it('carries no arcade tone or exclamation at the heaviest beat', async () => {
		const win = render(EndScreen, { outcome: 'win', onReplay: vi.fn() });
		const lose = render(EndScreen, { outcome: 'lose', onReplay: vi.fn() });
		for (const screen of [win, lose]) {
			const text = screen.container.textContent ?? '';
			expect(text).not.toMatch(/play again/i);
			expect(text).not.toMatch(/game over/i);
			expect(text).not.toContain('!');
		}
	});
});
