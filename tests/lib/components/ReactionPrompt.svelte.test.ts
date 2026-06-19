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

	it('keeps a spent reaction announced (aria-disabled, not removed) and inert', async () => {
		const onReact = vi.fn();
		const screen = render(ReactionPrompt, { held: { Scry: false, Hex: true }, onReact });
		const labels = [...screen.container.querySelectorAll('button')].map((b) =>
			b.textContent?.trim()
		);
		expect(labels).toEqual(['Scry', 'Hex', 'Pass']);
		const scry = screen.getByRole('button', { name: 'Scry' }).element() as HTMLButtonElement;
		const hex = screen.getByRole('button', { name: 'Hex' }).element() as HTMLButtonElement;
		const pass = screen.getByRole('button', { name: 'Pass' }).element() as HTMLButtonElement;
		// Spent stays focusable and in the a11y tree (aria-disabled, not hard-disabled), so a screen
		// reader still announces the option existed — but the click is inert.
		expect(scry.disabled).toBe(false);
		expect(scry.getAttribute('aria-disabled')).toBe('true');
		expect(scry.classList).toContain('reaction-choice--spent');
		expect(Number(getComputedStyle(scry).opacity)).toBeLessThan(0.7);
		await scry.click();
		expect(onReact).not.toHaveBeenCalled();
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

	it('describes each live choice for keyboard and screen-reader users, not only on hover', async () => {
		const screen = render(ReactionPrompt, { held: bothHeld, onReact: vi.fn() });
		const cases = [
			['Scry', 'reaction-hint-scry', 'When your rival asks, hear the answer too.'],
			[
				'Hex',
				'reaction-hint-hex',
				"When your rival asks, seal the Oracle's lips — no answer comes, and his turn is wasted."
			],
			['Pass', 'reaction-hint-pass', 'When your rival asks, let the question stand.']
		] as const;
		for (const [name, id, hint] of cases) {
			// The accessible name stays the bare label (getByRole resolves it) — described-by augments it.
			const btn = screen.getByRole('button', { name }).element() as HTMLButtonElement;
			expect(btn.getAttribute('aria-describedby')).toBe(id);
			expect(screen.container.querySelector(`#${id}`)?.textContent).toBe(hint);
		}
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

		expect(scry.getAttribute('aria-disabled')).toBe('true');
		expect(hex.getAttribute('aria-disabled')).toBe('true');
		expect(pass.disabled).toBe(false);
		await pass.click();
		expect(onReact).toHaveBeenCalledWith('Pass');
	});
});
