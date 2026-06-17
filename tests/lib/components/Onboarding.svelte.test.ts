import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi } from 'vitest';
import Onboarding from '$lib/components/Onboarding.svelte';

describe('Onboarding — title screen + first-run tour (S7)', () => {
	it('opens on the title screen with both CTAs', async () => {
		const screen = render(Onboarding, { onDone: vi.fn() });
		await expect.element(screen.getByRole('heading', { name: 'Save the Sun' })).toBeInTheDocument();
		await expect.element(screen.getByText('A rite for the longest day.')).toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: 'Light the fire.' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: 'How the rite works' }))
			.toBeInTheDocument();
	});

	it('lights the fire — done straight from the title, no tour', async () => {
		const onDone = vi.fn();
		const screen = render(Onboarding, { onDone });
		await screen.getByRole('button', { name: 'Light the fire.' }).click();
		expect(onDone).toHaveBeenCalledOnce();
	});

	it('walks the six concepts in order through the tour — Cast last', async () => {
		const screen = render(Onboarding, { onDone: vi.fn() });
		await screen.getByRole('button', { name: 'How the rite works' }).click();

		await expect.element(screen.getByTestId('step-count')).toHaveTextContent('1 / 6');
		await expect.element(screen.getByTestId('step-body')).toHaveTextContent('before Sköll does');

		await screen.getByRole('button', { name: 'Next' }).click();
		await expect.element(screen.getByTestId('step-count')).toHaveTextContent('2 / 6');
		await expect
			.element(screen.getByTestId('step-body'))
			.toHaveTextContent('Ask the Oracle a yes/no question');

		// Voice input — the new push-to-talk step.
		await screen.getByRole('button', { name: 'Next' }).click();
		await expect.element(screen.getByTestId('step-count')).toHaveTextContent('3 / 6');
		await expect.element(screen.getByTestId('step-body')).toHaveTextContent('Hold the medallion');

		await screen.getByRole('button', { name: 'Next' }).click();
		await expect.element(screen.getByTestId('step-count')).toHaveTextContent('4 / 6');
		await expect
			.element(screen.getByTestId('step-body'))
			.toHaveTextContent('Each answer rules some runes out');

		await screen.getByRole('button', { name: 'Next' }).click();
		await expect.element(screen.getByTestId('step-count')).toHaveTextContent('5 / 6');
		await expect
			.element(screen.getByTestId('step-body'))
			.toHaveTextContent('Scry to hear her answer, or Hex to block his question');

		// Cast comes last now (ux-copy.md §5 order).
		await screen.getByRole('button', { name: 'Next' }).click();
		await expect.element(screen.getByTestId('step-count')).toHaveTextContent('6 / 6');
		await expect
			.element(screen.getByTestId('step-body'))
			.toHaveTextContent('Cast right and you win the day');
	});

	it('finishes the tour with "Take up the runes."', async () => {
		const onDone = vi.fn();
		const screen = render(Onboarding, { onDone });
		await screen.getByRole('button', { name: 'How the rite works' }).click();
		for (let i = 0; i < 5; i++) await screen.getByRole('button', { name: 'Next' }).click();
		await screen.getByRole('button', { name: 'Take up the runes.' }).click();
		expect(onDone).toHaveBeenCalledOnce();
	});

	it('drops Skip on the last step — only "Take up the runes."', async () => {
		const screen = render(Onboarding, { onDone: vi.fn() });
		await screen.getByRole('button', { name: 'How the rite works' }).click();
		for (let i = 0; i < 5; i++) await screen.getByRole('button', { name: 'Next' }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Take up the runes.' }))
			.toBeInTheDocument();
		expect(screen.container.querySelector('button')?.textContent).not.toContain('Skip');
		expect(
			[...screen.container.querySelectorAll('button')].map((b) => b.textContent?.trim())
		).not.toContain('Skip');
	});

	it('skips cleanly mid-tour', async () => {
		const onDone = vi.fn();
		const screen = render(Onboarding, { onDone });
		await screen.getByRole('button', { name: 'How the rite works' }).click();
		await screen.getByRole('button', { name: 'Next' }).click();
		await screen.getByRole('button', { name: 'Skip' }).click();
		expect(onDone).toHaveBeenCalledOnce();
	});

	// aria-modal focus management (PR #12 review): the dialog must own keyboard focus so Tab can't
	// reach the board or the header behind it.
	it('moves focus into the dialog on open', async () => {
		render(Onboarding, { onDone: vi.fn() });
		await expect.poll(() => document.activeElement?.textContent?.trim()).toBe('Light the fire.');
	});

	it('traps Tab inside the dialog — wraps at both ends', async () => {
		render(Onboarding, { onDone: vi.fn() });
		await expect.poll(() => document.activeElement?.textContent?.trim()).toBe('Light the fire.');
		// Shift+Tab off the first focusable wraps to the last.
		document.activeElement?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
		);
		await expect.poll(() => document.activeElement?.textContent?.trim()).toBe('How the rite works');
		// Tab off the last wraps back to the first.
		document.activeElement?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
		);
		await expect.poll(() => document.activeElement?.textContent?.trim()).toBe('Light the fire.');
	});

	it('exits on Escape', async () => {
		const onDone = vi.fn();
		render(Onboarding, { onDone });
		await expect.poll(() => document.activeElement?.textContent?.trim()).toBe('Light the fire.');
		document.activeElement?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
		);
		expect(onDone).toHaveBeenCalledOnce();
	});
});
