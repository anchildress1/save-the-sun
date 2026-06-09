import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi } from 'vitest';
import Onboarding from '$lib/components/Onboarding.svelte';

describe('Onboarding — title screen + first-run tour (S7)', () => {
	it('opens on the title screen with both CTAs', async () => {
		const screen = render(Onboarding, { onDone: vi.fn() });
		await expect.element(screen.getByRole('heading', { name: 'Save the Sun' })).toBeInTheDocument();
		await expect
			.element(screen.getByText('A race to beat Sköll and save the light.'))
			.toBeInTheDocument();
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

	it('walks the five concepts in order through the tour', async () => {
		const screen = render(Onboarding, { onDone: vi.fn() });
		await screen.getByRole('button', { name: 'How the rite works' }).click();

		await expect.element(screen.getByTestId('step-count')).toHaveTextContent('1 / 5');
		await expect.element(screen.getByTestId('step-body')).toHaveTextContent('one offering to Sól');

		await screen.getByRole('button', { name: 'Next' }).click();
		await expect.element(screen.getByTestId('step-count')).toHaveTextContent('2 / 5');
		await expect
			.element(screen.getByTestId('step-body'))
			.toHaveTextContent('Ask the Oracle yes/no questions');

		await screen.getByRole('button', { name: 'Next' }).click();
		await expect.element(screen.getByTestId('step-count')).toHaveTextContent('3 / 5');
		await expect
			.element(screen.getByTestId('step-body'))
			.toHaveTextContent('Cross off what each answer rules out');

		await screen.getByRole('button', { name: 'Next' }).click();
		await expect.element(screen.getByTestId('step-count')).toHaveTextContent('4 / 5');
		await expect.element(screen.getByTestId('step-body')).toHaveTextContent('cast a rune');

		await screen.getByRole('button', { name: 'Next' }).click();
		await expect.element(screen.getByTestId('step-count')).toHaveTextContent('5 / 5');
		await expect
			.element(screen.getByTestId('step-body'))
			.toHaveTextContent('Scry to overhear her reply, or Hex to silence her');
	});

	it('finishes the tour with "Take up the runes."', async () => {
		const onDone = vi.fn();
		const screen = render(Onboarding, { onDone });
		await screen.getByRole('button', { name: 'How the rite works' }).click();
		for (let i = 0; i < 4; i++) await screen.getByRole('button', { name: 'Next' }).click();
		await screen.getByRole('button', { name: 'Take up the runes.' }).click();
		expect(onDone).toHaveBeenCalledOnce();
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
