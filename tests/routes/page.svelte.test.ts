import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';
import Page from '$routes/+page.svelte';
import type { GameState } from '$lib/server/engine/actions';

// Full page props (data normally comes from +page.server.ts). A fixed seed keeps the
// board order deterministic across these behavioural tests; the hydrated state opens the
// page human-first on a live round.
const HUMAN_TURN: GameState = { activePlayer: 'Human', status: 'active', winner: null, turns: 0 };
const SKOLL_TURN: GameState = { activePlayer: 'Sköll', status: 'active', winner: null, turns: 1 };
const HUMAN_WON: GameState = { activePlayer: 'Human', status: 'won', winner: 'Human', turns: 1 };
const SKOLL_WON: GameState = { activePlayer: 'Sköll', status: 'won', winner: 'Sköll', turns: 5 };

const pageProps = { data: { boardSeed: 0, state: HUMAN_TURN }, params: {}, form: null };
const propsWith = (state: GameState) => ({ data: { boardSeed: 0, state }, params: {}, form: null });

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
const askResult = (oracle: object, state: GameState = HUMAN_TURN) =>
	respond({ type: 'Ask', oracle, state });
const castResult = (cast: object, state: GameState = HUMAN_TURN) =>
	respond({ type: 'Cast', cast, state });

// --- S6: Sköll's surfaced turn + the human's reactions ---

// A fetch stub that answers an Ask with a Sköll turn, then resolves the human's React.
function skollFlow(skoll: object, askState: GameState, reaction: object, reactState: GameState) {
	return stubFetch(async (_url: string, init?: { body?: string }) => {
		const body = init?.body ? JSON.parse(init.body) : {};
		if (body.type === 'React')
			return new Response(
				JSON.stringify({
					type: 'React',
					outcome: { ok: true },
					skollReaction: reaction,
					state: reactState
				})
			);
		return new Response(
			JSON.stringify({
				type: 'Ask',
				oracle: {
					ok: true,
					answer: 'No. Sól is not reaching for a fire rune.',
					turnConsumed: true
				},
				skoll,
				state: askState
			})
		);
	});
}

const askThenSkollAsks = (echo = 'Sköll asks after a gold rune.') =>
	skollFlow(
		{ taunt: 'You circle. I close.', asks: { echo } },
		SKOLL_TURN,
		{ hexed: false },
		HUMAN_TURN
	);

async function humanAsks(screen: ReturnType<typeof render>) {
	await screen.getByLabelText(/ask the oracle/i).fill('Is it a fire rune?');
	await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
}

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
			if (url.includes('/api/new-game'))
				return new Response(JSON.stringify({ boardSeed: 99, state: HUMAN_TURN }));
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

	it('opens on the early-night progress line before any turn is spent', async () => {
		const screen = render(Page, pageProps);
		await expect
			.element(screen.getByTestId('night-progress'))
			.toHaveTextContent('The night lies deep and unbroken.');
	});

	it('hydrates the mid-night progress phase from the loaded turn count', async () => {
		const screen = render(Page, propsWith({ ...HUMAN_TURN, turns: 4 }));
		await expect
			.element(screen.getByTestId('night-progress'))
			.toHaveTextContent('Gray bleeds into the dark.');
	});

	it('hydrates the late-night progress phase from the loaded turn count', async () => {
		const screen = render(Page, propsWith({ ...HUMAN_TURN, turns: 6 }));
		await expect
			.element(screen.getByTestId('night-progress'))
			.toHaveTextContent('Dawn gathers at the edge of the world.');
	});

	it('advances the night-progress as turns are spent on an Ask', async () => {
		askResult(
			{ ok: true, answer: 'No. Sól is not reaching for a fire rune.', turnConsumed: true },
			{
				...HUMAN_TURN,
				turns: 6
			}
		);
		const screen = render(Page, pageProps);
		await expect
			.element(screen.getByTestId('night-progress'))
			.toHaveTextContent('The night lies deep and unbroken.');
		await screen.getByLabelText(/ask the oracle/i).fill('Is it a fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect
			.element(screen.getByTestId('night-progress'))
			.toHaveTextContent('Dawn gathers at the edge of the world.');
	});

	it('opens on the human turn — "Your move." and controls live', async () => {
		const screen = render(Page, pageProps);
		await expect.element(screen.getByTestId('turn-pill')).toHaveTextContent('Your move.');
		await expect.element(screen.getByRole('button', { name: 'Ask the Oracle' })).toBeEnabled();
		await expect.element(screen.getByRole('button', { name: 'Cast the rune' })).toBeEnabled();
	});

	it('opens a resumed won round on its win state — no phantom "Your move."', async () => {
		const screen = render(Page, propsWith(HUMAN_WON));
		// Hydrated from the load: the pill and panel agree, and play is locked until replay.
		await expect.element(screen.getByTestId('turn-pill')).toHaveTextContent('The rune is true.');
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The rune is true.');
		await expect.element(screen.getByRole('button', { name: 'Ask the Oracle' })).toBeDisabled();
		await expect.element(screen.getByRole('button', { name: 'Cast the rune' })).toBeDisabled();
	});

	it('raises the sun and voices the victory line in the header on a human win', async () => {
		const screen = render(Page, propsWith(HUMAN_WON));
		// Moon gives way to the risen sun; the resolution line replaces the night-progress phase.
		expect(screen.container.querySelector('.sun-risen')).not.toBeNull();
		expect(screen.container.querySelector('.moon')).toBeNull();
		await expect
			.element(screen.getByTestId('outcome-line'))
			.toHaveTextContent('Sól crests the rim of the world.');
	});

	it('keeps the moon on a Sköll win — short tag in the header, full line in the Oracle panel', async () => {
		const screen = render(Page, propsWith(SKOLL_WON));
		// No sunrise for a loss — the moon holds. The header carries only the short tag; the full
		// resolution sentence lives in the Oracle panel, which wraps responsively on its own.
		expect(screen.container.querySelector('.moon')).not.toBeNull();
		expect(screen.container.querySelector('.sun-risen')).toBeNull();
		await expect
			.element(screen.getByTestId('outcome-line'))
			.toHaveTextContent('Sköll takes the sun.');
		await expect.element(screen.getByTestId('turn-pill')).toHaveTextContent('Sköll takes the sun.');
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent(
				'Sköll takes the sun. The longest day never breaks. The year falls to dark.'
			);
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

	it("voices Sköll's cast on his turn", async () => {
		respond({
			type: 'Ask',
			oracle: { ok: true, answer: 'No. Sól is not reaching for a fire rune.', turnConsumed: true },
			skoll: { taunt: 'You circle. I close.', cast: { line: 'I name it. Dagaz.', won: false } },
			state: HUMAN_TURN
		});
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		await expect.element(screen.getByTestId('skoll-voice')).toHaveTextContent('I name it. Dagaz.');
	});

	it('prompts the human to react when Sköll Asks', async () => {
		askThenSkollAsks();
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		await expect
			.element(screen.getByTestId('skoll-echo'))
			.toHaveTextContent('Sköll asks after a gold rune.');
		await expect
			.element(screen.getByTestId('reaction-prompt'))
			.toHaveTextContent('Sköll asks. Answer it?');
		await expect.element(screen.getByRole('button', { name: 'Let it pass' })).toBeInTheDocument();
	});

	it('lets the human let Sköll Ask pass', async () => {
		askThenSkollAsks();
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		await screen.getByRole('button', { name: 'Let it pass' }).click();
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('You hold your hand. Let him have his answer.');
		// Prompt gone, the static reactions row is back.
		expect(screen.container.querySelector('[data-testid="reaction-prompt"]')).toBeNull();
	});

	it('shares the answer when the human Scries Sköll Ask', async () => {
		skollFlow(
			{ taunt: 'You circle. I close.', asks: { echo: 'Sköll asks after a gold rune.' } },
			SKOLL_TURN,
			{ hexed: false, scried: { answer: 'Yes. Sól is reaching for a gold rune.' } },
			HUMAN_TURN
		);
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		await screen.getByRole('button', { name: 'Scry' }).click();
		// The scried answer is the payoff — it surfaces in the panel itself, no extra flavor line.
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('Yes. Sól is reaching for a gold rune.');
	});

	it('kills the question when the human Hexes Sköll Ask', async () => {
		skollFlow(
			{ taunt: 'You circle. I close.', asks: { echo: 'Sköll asks after a gold rune.' } },
			SKOLL_TURN,
			{ hexed: true },
			HUMAN_TURN
		);
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		await screen.getByRole('button', { name: 'Hex' }).click();
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('His question dies unanswered');
		// No stale second line stacked beneath — the outcome is the single panel line.
		expect(screen.container.querySelector('[data-testid="skoll-voice"]')).toBeNull();
	});

	it('shows the silenced line when Sköll Hexes the human Ask', async () => {
		respond({
			type: 'Ask',
			// No oracle line — the question was silenced before any answer.
			skollVsYou: { reaction: 'Hex' },
			skoll: { taunt: 'You circle. I close.', cast: { line: 'I name it. Dagaz.', won: false } },
			state: HUMAN_TURN
		});
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent("The Oracle's lips close.");
		// His own move still surfaces in his voice slot.
		await expect.element(screen.getByTestId('skoll-voice')).toHaveTextContent('I name it. Dagaz.');
	});

	it('shows the answer when Sköll Scries the human Ask (covert — no extra line)', async () => {
		respond({
			type: 'Ask',
			oracle: { ok: true, answer: 'No. Sól is not reaching for a fire rune.', turnConsumed: true },
			skollVsYou: { reaction: 'Scry' },
			skoll: { taunt: 'You circle. I close.', cast: { line: 'I name it. Dagaz.', won: false } },
			state: HUMAN_TURN
		});
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('No. Sól is not reaching for a fire rune.');
	});

	it('falls to defeat when Sköll casts true on his turn', async () => {
		respond({
			type: 'Ask',
			oracle: { ok: true, answer: 'No. Sól is not reaching for a fire rune.', turnConsumed: true },
			skoll: { taunt: 'You circle. I close.', cast: { line: 'The hunt ends. Dagaz.', won: true } },
			state: SKOLL_WON
		});
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		await expect
			.element(screen.getByTestId('skoll-voice'))
			.toHaveTextContent('The hunt ends. Dagaz.');
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('Sköll takes the sun. The longest day never breaks.');
		await expect.element(screen.getByTestId('turn-pill')).toHaveTextContent('Sköll takes the sun.');
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
