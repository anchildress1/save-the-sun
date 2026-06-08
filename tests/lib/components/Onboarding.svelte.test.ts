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

	it('walks the four concepts in order through the tour', async () => {
		const screen = render(Onboarding, { onDone: vi.fn() });
		await screen.getByRole('button', { name: 'How the rite works' }).click();

		await expect.element(screen.getByTestId('step-count')).toHaveTextContent('1 / 4');
		await expect.element(screen.getByTestId('step-body')).toHaveTextContent('one offering to Sól');

		await screen.getByRole('button', { name: 'Next' }).click();
		await expect.element(screen.getByTestId('step-count')).toHaveTextContent('2 / 4');
		await expect
			.element(screen.getByTestId('step-body'))
			.toHaveTextContent('Ask the Oracle yes/no questions');

		await screen.getByRole('button', { name: 'Next' }).click();
		await expect.element(screen.getByTestId('step-count')).toHaveTextContent('3 / 4');
		await expect
			.element(screen.getByTestId('step-body'))
			.toHaveTextContent('Cross off what each answer rules out');

		await screen.getByRole('button', { name: 'Next' }).click();
		await expect.element(screen.getByTestId('step-count')).toHaveTextContent('4 / 4');
		await expect.element(screen.getByTestId('step-body')).toHaveTextContent('cast a rune');
	});

	it('finishes the tour with "Take up the runes."', async () => {
		const onDone = vi.fn();
		const screen = render(Onboarding, { onDone });
		await screen.getByRole('button', { name: 'How the rite works' }).click();
		for (let i = 0; i < 3; i++) await screen.getByRole('button', { name: 'Next' }).click();
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
});
