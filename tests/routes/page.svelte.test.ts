import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';
import Page from '$routes/+page.svelte';

afterEach(() => {
	vi.unstubAllGlobals();
});

function stubFetch(impl: () => Promise<Response>) {
	const spy = vi.fn(impl);
	vi.stubGlobal('fetch', spy);
	return spy;
}

const ok = (message: string) =>
	stubFetch(async () => new Response(JSON.stringify({ success: true, message })));

describe('Save the Sun page', () => {
	it('starts with a ready Rite state, not a blank panel', async () => {
		const screen = render(Page);
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('Twenty-four runes stand. None ruled out. Ask the Oracle.');
	});

	it('refuses an empty Ask without dispatching', async () => {
		const spy = stubFetch(async () => new Response('{}'));
		const screen = render(Page);
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('Speak your question, witch.');
		expect(spy).not.toHaveBeenCalled();
	});

	it('dispatches a non-empty Ask through the action interface and shows the result', async () => {
		const spy = ok('Action Ask received for Human.');
		const screen = render(Page);
		await screen.getByLabelText(/ask the oracle/i).fill('Is it a fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect.element(screen.getByTestId('interpretation')).toHaveTextContent('fire rune');
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('Action Ask received');
		expect(spy).toHaveBeenCalledOnce();
	});

	it('arms a cast, selects a target, and commits it', async () => {
		ok('Action Cast received for Human.');
		const screen = render(Page);
		await screen.getByRole('button', { name: 'Cast the rune' }).click();
		await screen.getByRole('button', { name: /select sowilo as cast target/i }).click();
		await expect.element(screen.getByTestId('cast-hint')).toHaveTextContent('Cast Sowilo?');
		await screen.getByRole('button', { name: 'Name it' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('Action Cast received');
	});

	it('cancels a cast with no turn spent', async () => {
		const screen = render(Page);
		await screen.getByRole('button', { name: 'Cast the rune' }).click();
		await screen.getByRole('button', { name: 'Not yet' }).click();
		await expect.element(screen.getByRole('button', { name: 'Cast the rune' })).toBeInTheDocument();
	});

	it('shows an in-world error when an Ask dispatch fails', async () => {
		stubFetch(async () => new Response('nope', { status: 500 }));
		const screen = render(Page);
		await screen.getByLabelText(/ask the oracle/i).fill('Is it gold?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The fire gutters');
	});

	it('shows an in-world error when a Cast dispatch fails', async () => {
		stubFetch(async () => new Response('nope', { status: 500 }));
		const screen = render(Page);
		await screen.getByRole('button', { name: 'Cast the rune' }).click();
		await screen.getByRole('button', { name: /select sowilo as cast target/i }).click();
		await screen.getByRole('button', { name: 'Name it' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The fire gutters');
	});
});
