import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi } from 'vitest';
import EndScreen from '$lib/components/EndScreen.svelte';

// S9 — the closing rite (ux-copy.md §4). Victory and defeat each stage their exact in-world lines and
// the two CTAs; the overlay is a focus-trapping aria-modal dialog over the resolved board.

describe('EndScreen — victory sequence', () => {
	const renderWin = (over: { onReplay?: () => void; onLeave?: () => void } = {}) =>
		render(EndScreen, { outcome: 'win', onReplay: vi.fn(), onLeave: vi.fn(), ...over });

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

	it('offers the victory CTAs with their exact in-world labels', async () => {
		const screen = renderWin();
		await expect
			.element(screen.getByRole('button', { name: 'Begin another night' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: 'Leave the fire.' }))
			.toBeInTheDocument();
	});

	it('fires onReplay from the primary CTA and onLeave from the secondary', async () => {
		const onReplay = vi.fn();
		const onLeave = vi.fn();
		const screen = renderWin({ onReplay, onLeave });
		await screen.getByRole('button', { name: 'Begin another night' }).click();
		expect(onReplay).toHaveBeenCalledOnce();
		await screen.getByRole('button', { name: 'Leave the fire.' }).click();
		expect(onLeave).toHaveBeenCalledOnce();
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
	const renderLose = (over: { onReplay?: () => void; onLeave?: () => void } = {}) =>
		render(EndScreen, { outcome: 'lose', onReplay: vi.fn(), onLeave: vi.fn(), ...over });

	it('tolls the single defeat line', async () => {
		const screen = renderLose();
		await expect
			.element(
				screen.getByText(
					'Sköll takes the sun. The longest day never breaks. The year falls to dark.'
				)
			)
			.toBeInTheDocument();
		expect(screen.container.querySelectorAll('.line')).toHaveLength(1);
	});

	it('offers the defeat CTAs — "Stand against him again" replaces the victory replay', async () => {
		const onReplay = vi.fn();
		const screen = renderLose({ onReplay });
		// Defeat replay is its own line; the victory one must not appear.
		expect(screen.container.querySelector('[data-testid="end-replay"]')?.textContent?.trim()).toBe(
			'Stand against him again'
		);
		expect(screen.container.textContent).not.toContain('Begin another night');
		await expect
			.element(screen.getByRole('button', { name: 'Leave the fire.' }))
			.toBeInTheDocument();
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
});

describe('EndScreen — accessibility & voice', () => {
	it('is an aria-modal dialog named by its final, heaviest line', async () => {
		const screen = render(EndScreen, { outcome: 'win', onReplay: vi.fn(), onLeave: vi.fn() });
		const dialog = screen.getByRole('dialog').element();
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		const labelledby = dialog.getAttribute('aria-labelledby');
		const labelEl = dialog.querySelector(`#${labelledby}`);
		expect(labelEl?.textContent?.trim()).toBe(
			'The offering is made. The longest day breaks — and the light is yours to keep.'
		);
	});

	it('moves focus onto the primary CTA on open', async () => {
		render(EndScreen, { outcome: 'win', onReplay: vi.fn(), onLeave: vi.fn() });
		await expect
			.poll(() => document.activeElement?.textContent?.trim())
			.toBe('Begin another night');
	});

	it('traps Tab inside the dialog — wraps at both ends', async () => {
		render(EndScreen, { outcome: 'lose', onReplay: vi.fn(), onLeave: vi.fn() });
		await expect
			.poll(() => document.activeElement?.textContent?.trim())
			.toBe('Stand against him again');
		// Shift+Tab off the first focusable wraps to the last.
		document.activeElement?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
		);
		await expect.poll(() => document.activeElement?.textContent?.trim()).toBe('Leave the fire.');
		// Tab off the last wraps back to the first.
		document.activeElement?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
		);
		await expect
			.poll(() => document.activeElement?.textContent?.trim())
			.toBe('Stand against him again');
	});

	it('carries no arcade tone or exclamation at the heaviest beat', async () => {
		const win = render(EndScreen, { outcome: 'win', onReplay: vi.fn(), onLeave: vi.fn() });
		const lose = render(EndScreen, { outcome: 'lose', onReplay: vi.fn(), onLeave: vi.fn() });
		for (const screen of [win, lose]) {
			const text = screen.container.textContent ?? '';
			expect(text).not.toMatch(/play again/i);
			expect(text).not.toMatch(/game over/i);
			expect(text).not.toContain('!');
		}
	});
});
