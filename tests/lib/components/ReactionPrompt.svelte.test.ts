import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi } from 'vitest';
import ReactionPrompt from '$lib/components/ReactionPrompt.svelte';

const bothHeld = { Scry: true, Hex: true };

describe('ReactionPrompt — the human-side interrupt on Sköll’s Ask (S5)', () => {
	it('offers Scry, Hex, and Pass under an accessible group label', async () => {
		const screen = render(ReactionPrompt, { held: bothHeld, onReact: vi.fn() });
		// The prompt heading copy is not displayed (v2 redesign); the group keeps its SR label.
		expect(screen.getByTestId('reaction-prompt').element().getAttribute('aria-label')).toBe(
			'Sköll asks. Answer it?'
		);
		await expect.element(screen.getByRole('button', { name: 'Scry' })).toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: 'Hex' })).toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: 'Pass' })).toBeInTheDocument();
	});

	it('reports the chosen reaction', async () => {
		const onReact = vi.fn();
		const screen = render(ReactionPrompt, { held: bothHeld, onReact });
		await screen.getByRole('button', { name: 'Hex' }).click();
		expect(onReact).toHaveBeenCalledWith('Hex');
	});

	it('lets the player pass', async () => {
		const onReact = vi.fn();
		const screen = render(ReactionPrompt, { held: bothHeld, onReact });
		await screen.getByRole('button', { name: 'Pass' }).click();
		expect(onReact).toHaveBeenCalledWith('Pass');
	});

	it('keeps a spent reaction visible, disabled, and marked spent', async () => {
		const screen = render(ReactionPrompt, { held: { Scry: false, Hex: true }, onReact: vi.fn() });
		const labels = [...screen.container.querySelectorAll('button')].map((b) =>
			b.textContent?.trim()
		);
		expect(labels).toEqual(['Scry', 'Hex', 'Pass']);
		const scry = screen.getByRole('button', { name: 'Scry' }).element() as HTMLButtonElement;
		const hex = screen.getByRole('button', { name: 'Hex' }).element() as HTMLButtonElement;
		const pass = screen.getByRole('button', { name: 'Pass' }).element() as HTMLButtonElement;
		expect(scry.disabled).toBe(true);
		expect(scry.classList).toContain('reaction-choice--spent');
		expect(Number(getComputedStyle(scry).opacity)).toBeLessThan(0.7);
		expect(hex.disabled).toBe(false);
		expect(pass.disabled).toBe(false);
	});

	it('seals every choice while busy — a clicked reaction never races an in-flight move', async () => {
		const onReact = vi.fn();
		const screen = render(ReactionPrompt, { held: bothHeld, onReact, busy: true });
		const scry = screen.getByRole('button', { name: 'Scry' }).element() as HTMLButtonElement;
		const hex = screen.getByRole('button', { name: 'Hex' }).element() as HTMLButtonElement;
		const pass = screen.getByRole('button', { name: 'Pass' }).element() as HTMLButtonElement;
		expect(scry.disabled).toBe(true);
		expect(hex.disabled).toBe(true);
		expect(pass.disabled).toBe(true);
	});

	it('keeps Pass available when both Scry and Hex are spent', async () => {
		const onReact = vi.fn();
		const screen = render(ReactionPrompt, {
			held: { Scry: false, Hex: false },
			onReact
		});
		const scry = screen.getByRole('button', { name: 'Scry' }).element() as HTMLButtonElement;
		const hex = screen.getByRole('button', { name: 'Hex' }).element() as HTMLButtonElement;
		const pass = screen.getByRole('button', { name: 'Pass' }).element() as HTMLButtonElement;

		expect(scry.disabled).toBe(true);
		expect(hex.disabled).toBe(true);
		expect(pass.disabled).toBe(false);
		await pass.click();
		expect(onReact).toHaveBeenCalledWith('Pass');
	});
});
