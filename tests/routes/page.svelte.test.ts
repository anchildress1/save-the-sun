import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';
import Page from '$routes/+page.svelte';

// Full page props (data normally comes from +page.server.ts). A fixed seed keeps the
// board order deterministic across these behavioural tests.
const pageProps = { data: { boardSeed: 0 }, params: {}, form: null };

afterEach(() => {
	vi.unstubAllGlobals();
});

function stubFetch(impl: (input: string) => Promise<Response>) {
	const spy = vi.fn(impl);
	vi.stubGlobal('fetch', spy);
	return spy;
}

const respond = (body: object) => stubFetch(async () => new Response(JSON.stringify(body)));

// Every action response carries the post-shim turn snapshot. Default: the human is back on
// the clock with the round still live (the v1 pre-Sköll shim hands play straight back).
const HUMAN_TURN = { activePlayer: 'Human', status: 'active', winner: null };
const SKOLL_TURN = { activePlayer: 'Sköll', status: 'active', winner: null };
const HUMAN_WON = { activePlayer: 'Human', status: 'won', winner: 'Human' };

const askResult = (oracle: object, state: object = HUMAN_TURN) =>
	respond({ type: 'Ask', oracle, state });
const castResult = (cast: object, state: object = HUMAN_TURN) =>
	respond({ type: 'Cast', cast, state });

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

	it('shows only the voiced answer for a resolved Ask (no echo for your own Ask)', async () => {
		const spy = askResult({
			ok: true,
			echo: 'You ask after the fire-runes.',
			answer: 'No. Sól is not reaching for a fire rune.',
			affirmative: false,
			turnConsumed: true
		});
		const screen = render(Page, pageProps);
		await screen.getByLabelText(/ask the oracle/i).fill('Is it a fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('No. Sól is not reaching for a fire rune.');
		expect(screen.container.querySelector('[data-testid="interpretation"]')).toBeNull();
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

	it('tells the player to hold when the engine has handed the turn to Sköll', async () => {
		askResult({ ok: false, reason: 'engine', engineReason: 'not-your-turn', turnConsumed: false });
		const screen = render(Page, pageProps);
		await screen.getByLabelText(/ask the oracle/i).fill('Is it light?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('The wolf is moving. Hold.');
	});

	it('shows the Oracle-silent line on a non-turn engine rejection', async () => {
		askResult({ ok: false, reason: 'engine', engineReason: 'round-over', turnConsumed: false });
		const screen = render(Page, pageProps);
		await screen.getByLabelText(/ask the oracle/i).fill('Is it light?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The Oracle falls silent');
	});

	it('shows a rite-falters line when a cast is rejected by the engine', async () => {
		castResult({ ok: false, reason: 'not-your-turn', turnConsumed: false });
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Cast the rune' }).click();
		await screen.getByRole('button', { name: /select sowilo as cast target/i }).click();
		await screen.getByRole('button', { name: 'Name it' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The rite falters');
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
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The Oracle falls silent');
	});

	it('shows an in-world error when a Cast dispatch fails', async () => {
		stubFetch(async () => new Response('nope', { status: 500 }));
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Cast the rune' }).click();
		await screen.getByRole('button', { name: /select sowilo as cast target/i }).click();
		await screen.getByRole('button', { name: 'Name it' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The rite falters');
	});

	it('begins another night — resets the panel and pulls a fresh board', async () => {
		const spy = stubFetch(async (url) => {
			if (url.includes('/api/new-game')) return new Response(JSON.stringify({ boardSeed: 99 }));
			return new Response(
				JSON.stringify({
					type: 'Ask',
					oracle: {
						ok: true,
						answer: 'No. Sól is not reaching for a fire rune.',
						turnConsumed: true
					},
					state: HUMAN_TURN
				})
			);
		});
		const screen = render(Page, pageProps);

		// Dirty the panel so the reset is observable.
		await screen.getByLabelText(/ask the oracle/i).fill('Is it a fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('No. Sól is not reaching');

		await screen.getByRole('button', { name: 'Begin another night' }).click();
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('Twenty-four runes stand. None ruled out. Ask the Oracle.');
		expect(spy).toHaveBeenCalledWith('/api/new-game', expect.objectContaining({ method: 'POST' }));
	});

	it('shows an in-world error when starting a new game fails', async () => {
		stubFetch(async () => new Response('nope', { status: 500 }));
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Begin another night' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The Oracle falls silent');
	});

	it('treats a 200 with no board seed as a failure, not a silent no-op', async () => {
		stubFetch(async () => new Response(JSON.stringify({})));
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Begin another night' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The Oracle falls silent');
	});

	it('opens on the human turn — "Your move." and controls live', async () => {
		const screen = render(Page, pageProps);
		await expect.element(screen.getByTestId('turn-pill')).toHaveTextContent('Your move.');
		await expect.element(screen.getByRole('button', { name: 'Ask the Oracle' })).toBeEnabled();
		await expect.element(screen.getByRole('button', { name: 'Cast the rune' })).toBeEnabled();
	});

	it('hands the turn to Sköll — pill flips and Ask + Cast disable', async () => {
		askResult(
			{ ok: true, answer: 'No. Sól is not reaching for a fire rune.', turnConsumed: true },
			SKOLL_TURN
		);
		const screen = render(Page, pageProps);
		await screen.getByLabelText(/ask the oracle/i).fill('Is it a fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect.element(screen.getByTestId('turn-pill')).toHaveTextContent('Sköll moves.');
		await expect.element(screen.getByRole('button', { name: 'Ask the Oracle' })).toBeDisabled();
		await expect.element(screen.getByRole('button', { name: 'Cast the rune' })).toBeDisabled();
	});

	it('keeps cross-off live during Sköll’s turn — the reading is always yours', async () => {
		askResult(
			{ ok: true, answer: 'No. Sól is not reaching for a fire rune.', turnConsumed: true },
			SKOLL_TURN
		);
		const screen = render(Page, pageProps);
		await screen.getByLabelText(/ask the oracle/i).fill('Is it a fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect.element(screen.getByRole('button', { name: 'Cast the rune' })).toBeDisabled();
		// Cross-off is a private aid — never turn-gated. Sowilo's card stays interactive and
		// crosses off even while it is the wolf's move.
		const sowilo = screen.getByRole('button', { name: /cross off sowilo/i });
		await sowilo.click();
		await expect
			.element(screen.getByRole('button', { name: /restore sowilo/i }))
			.toBeInTheDocument();
	});

	it('resolves the round on a correct cast — Ask + Cast lock until a new night', async () => {
		castResult({ ok: true, won: true, rune: { name: 'Sowilo' }, turnConsumed: true }, HUMAN_WON);
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Cast the rune' }).click();
		await screen.getByRole('button', { name: /select sowilo as cast target/i }).click();
		await screen.getByRole('button', { name: 'Name it' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The rune is true.');
		// The pill stops reading as a turn and becomes the resolved-round indicator.
		await expect.element(screen.getByTestId('turn-pill')).toHaveTextContent('The rune is true.');
		// Round is resolved: no further asking or casting until "Begin another night".
		await expect.element(screen.getByRole('button', { name: 'Ask the Oracle' })).toBeDisabled();
		await expect.element(screen.getByRole('button', { name: 'Cast the rune' })).toBeDisabled();
		// Replay stays the live next step.
		await expect.element(screen.getByRole('button', { name: 'Begin another night' })).toBeEnabled();
	});
});
