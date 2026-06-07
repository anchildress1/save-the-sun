import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi } from 'vitest';
import ReactionPrompt from '$lib/components/ReactionPrompt.svelte';

const bothHeld = { Scry: true, Hex: true };

describe('ReactionPrompt — the human-side interrupt on Sköll’s Ask (S5)', () => {
	it('asks whether to answer and offers Scry, Hex, and Let it pass', async () => {
		const screen = render(ReactionPrompt, { held: bothHeld, onReact: vi.fn() });
		await expect
			.element(screen.getByTestId('reaction-prompt'))
			.toHaveTextContent('Sköll asks. Answer it?');
		await expect.element(screen.getByRole('button', { name: 'Scry' })).toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: 'Hex' })).toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: 'Let it pass' })).toBeInTheDocument();
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
		await screen.getByRole('button', { name: 'Let it pass' }).click();
		expect(onReact).toHaveBeenCalledWith('Pass');
	});

	it('hides a spent reaction — no "spent" copy, it simply vanishes', async () => {
		const screen = render(ReactionPrompt, { held: { Scry: false, Hex: true }, onReact: vi.fn() });
		// The held Scry is gone; only Hex and the pass remain — a spent reaction just disappears.
		const labels = [...screen.container.querySelectorAll('button')].map((b) =>
			b.textContent?.trim()
		);
		expect(labels).toEqual(['Hex', 'Let it pass']);
	});
});
