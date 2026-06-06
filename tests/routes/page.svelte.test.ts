import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';
import Page from '$routes/+page.svelte';

// Full page props (data normally comes from +page.server.ts). A fixed seed keeps the
// board order deterministic across these behavioural tests.
const pageProps = { data: { boardSeed: 0 }, params: {}, form: null };

afterEach(() => {
	vi.unstubAllGlobals();
});

function stubFetch(impl: () => Promise<Response>) {
	const spy = vi.fn(impl);
	vi.stubGlobal('fetch', spy);
	return spy;
}

const respond = (body: object) => stubFetch(async () => new Response(JSON.stringify(body)));

const askResult = (oracle: object) => respond({ type: 'Ask', oracle });
const castResult = (cast: object) => respond({ type: 'Cast', cast });

describe('Save the Sun page', () => {
	it('starts with a ready Rite state, not a blank panel', async () => {
		const screen = render(Page, pageProps);
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('Twenty-four runes stand. None ruled out. Ask the Oracle.');
	});

	it('refuses an empty Ask without dispatching', async () => {
		const spy = stubFetch(async () => new Response('{}'));
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('Speak your question, witch.');
		expect(spy).not.toHaveBeenCalled();
	});

	it('shows the Oracle echo and voiced answer for a resolved Ask', async () => {
		const spy = askResult({
			ok: true,
			echo: 'You ask after the fire-runes.',
			answer: 'No.',
			affirmative: false,
			turnConsumed: true
		});
		const screen = render(Page, pageProps);
		await screen.getByLabelText(/ask the oracle/i).fill('Is it a fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect
			.element(screen.getByTestId('interpretation'))
			.toHaveTextContent('You ask after the fire-runes.');
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('No.');
		expect(spy).toHaveBeenCalledOnce();
	});

	it('shows the refusal line when the Oracle turns an Ask away', async () => {
		askResult({
			ok: false,
			reason: 'refusal',
			refusal: 'mixed-type',
			line: 'I read one sign at a time. Ask of fire, or power, or light, or hue — not two at once.',
			turnConsumed: false
		});
		const screen = render(Page, pageProps);
		await screen.getByLabelText(/ask the oracle/i).fill('Is it a red fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('I read one sign at a time');
	});

	it('arms a cast, selects a target, and resolves a correct cast', async () => {
		castResult({ ok: true, won: true, rune: { name: 'Sowilo' }, turnConsumed: true });
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Cast the rune' }).click();
		await screen.getByRole('button', { name: /select sowilo as cast target/i }).click();
		await expect.element(screen.getByTestId('cast-hint')).toHaveTextContent('Cast Sowilo?');
		await screen.getByRole('button', { name: 'Name it' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The rune is true.');
	});

	it('resolves a wrong cast without ending the round', async () => {
		castResult({ ok: true, won: false, turnConsumed: true });
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Cast the rune' }).click();
		await screen.getByRole('button', { name: /select sowilo as cast target/i }).click();
		await screen.getByRole('button', { name: 'Name it' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The rune is not the one');
	});

	it('cancels a cast with no turn spent', async () => {
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Cast the rune' }).click();
		await screen.getByRole('button', { name: 'Not yet' }).click();
		await expect.element(screen.getByRole('button', { name: 'Cast the rune' })).toBeInTheDocument();
	});

	it('shows an in-world error when an Ask dispatch fails', async () => {
		stubFetch(async () => new Response('nope', { status: 500 }));
		const screen = render(Page, pageProps);
		await screen.getByLabelText(/ask the oracle/i).fill('Is it gold?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The fire gutters');
	});

	it('shows an in-world error when a Cast dispatch fails', async () => {
		stubFetch(async () => new Response('nope', { status: 500 }));
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Cast the rune' }).click();
		await screen.getByRole('button', { name: /select sowilo as cast target/i }).click();
		await screen.getByRole('button', { name: 'Name it' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The fire gutters');
	});
});
