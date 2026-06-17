import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Page from '$routes/+page.svelte';
import { VIEW_STATE_KEY } from '$lib/viewState';
import type { GameState } from '$lib/server/engine/actions';

// These tests are about the board, the Ask flow, and the end-screen — not voice. Mock the audio
// layer so it stays inert: no real AudioContext, no TTS fetch, drains instantly (the voice surface
// has its own suite in page.voice.svelte.test.ts).
vi.mock('$lib/voice/delivery', () => ({
	enableDelivery: vi.fn(),
	disableDelivery: vi.fn(),
	stopDelivery: vi.fn(),
	deliver: vi.fn(async () => {}),
	whenDrained: vi.fn(async () => {}),
	deliveryReady: vi.fn(() => false),
	currentLevel: vi.fn(() => 0),
	subscribeDelivery: () => () => {}
}));
vi.mock('$lib/voice/recorder', () => ({
	startRecording: vi.fn(async () => ({ ok: true })),
	stopRecording: vi.fn(async () => null),
	releaseRecorder: vi.fn(),
	recorderSealed: vi.fn(() => null),
	closeRecorder: vi.fn()
}));

const ONBOARDED_KEY = 'save-the-sun:onboarded';

// Full page props (data normally comes from +page.server.ts). A fixed seed keeps the
// board order deterministic across these behavioral tests; the hydrated state opens the
// page human-first on a live round.
const HUMAN_TURN: GameState = { activePlayer: 'Human', status: 'active', winner: null, turns: 0 };
const SKOLL_TURN: GameState = { activePlayer: 'Sköll', status: 'active', winner: null, turns: 1 };
const HUMAN_WON: GameState = { activePlayer: 'Human', status: 'won', winner: 'Human', turns: 1 };
const SKOLL_WON: GameState = { activePlayer: 'Sköll', status: 'won', winner: 'Sköll', turns: 5 };

type PendingReaction = { echo: string; held: { Scry: boolean; Hex: boolean } } | null;
const props = (
	state: GameState,
	pendingReaction: PendingReaction = null,
	roundId = 'test-round'
) => ({
	data: { boardSeed: 0, roundId, state, pendingReaction },
	params: {},
	form: null
});
const pageProps = props(HUMAN_TURN);
const propsWith = (state: GameState) => props(state);

// These tests drive the in-game board, so mark the player onboarded before each render to clear the
// first-run title screen. The onboarding flow itself is covered below.
beforeEach(() => {
	localStorage.setItem(ONBOARDED_KEY, '1');
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	localStorage.clear();
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
const expectConsole = (method: 'error' | 'warn') =>
	vi.spyOn(console, method).mockImplementation(() => {});

// --- Sköll's surfaced turn + the human's reactions ---

// Sköll's move arrives on a SEPARATE Advance request now, so the stub routes by action type:
// the Ask returns the human's answer (turn handed to Sköll), Advance returns the wolf's move, and
// React resolves his parked Ask. Unset branches fall back to a turn-handed-back no-op.
function gameStub(opts: { ask?: object; advance?: object; react?: object }) {
	return stubFetch(async (_url: string, init?: { body?: string }) => {
		const body = init?.body ? JSON.parse(init.body) : {};
		const pick =
			body.type === 'Advance'
				? (opts.advance ?? { type: 'Advance', state: HUMAN_TURN })
				: body.type === 'React'
					? (opts.react ?? { type: 'React', outcome: { ok: true }, state: HUMAN_TURN })
					: (opts.ask ?? defaultAsk());
		return new Response(JSON.stringify(pick));
	});
}

const defaultAsk = (skollVsYou: object = { reaction: 'Pass' }) => ({
	type: 'Ask',
	oracle: { ok: true, answer: 'No. Sól is not reaching for a fire rune.', turnConsumed: true },
	skollVsYou,
	state: SKOLL_TURN
});
// A Cast carries no flavor line — his box stays blank; the outcome rides the turn state.
const advanceCast = (state: GameState = HUMAN_TURN) => ({ type: 'Advance', skoll: {}, state });
const advanceAsk = (echo = 'A gold rune. Mine.') => ({
	type: 'Advance',
	skoll: { asks: { echo } },
	state: SKOLL_TURN
});
const reactResult = (skollReaction: object) => ({
	type: 'React',
	outcome: { ok: true },
	skollReaction,
	state: HUMAN_TURN
});

async function humanAsks(screen: ReturnType<typeof render>) {
	await screen.getByLabelText(/ask the oracle/i).fill('Is it a fire rune?');
	await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
}

describe('Save the Sun page', () => {
	it('opens with a blank Oracle panel — the Oracle speaks only when it has a response', async () => {
		const screen = render(Page, pageProps);
		expect(screen.getByTestId('answer').element().textContent?.trim()).toBe('');
	});

	it('narrates the rite — turn pill, Oracle frame, and Sköll frame are polite status regions', async () => {
		const screen = render(Page, pageProps);
		const regions = screen.getByRole('status').elements();
		const ids = regions.map((el) => (el as HTMLElement).dataset.testid);
		expect(ids).toContain('turn-pill');
		expect(ids).toContain('skoll-frame');
		// The Oracle frame carries no testid of its own; the voiced answer lives inside it.
		expect(regions.some((el) => el.querySelector('[data-testid="answer"]') !== null)).toBe(true);
	});

	it('reopens the title splash from the header wordmark, without resetting the round', async () => {
		const spy = stubFetch(async () => new Response('{}'));
		const screen = render(Page, pageProps);
		// Onboarded player opens on the board, no overlay.
		expect(screen.container.querySelector('[data-testid="onboarding"]')).toBeNull();
		await screen.getByRole('button', { name: /save the sun — return to the title/i }).click();
		// The title splash is back; "Light the fire." drops them into the same round (no new-game call).
		await expect.element(screen.getByTestId('onboarding')).toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: 'Light the fire.' }))
			.toBeInTheDocument();
		expect(spy).not.toHaveBeenCalledWith('/api/new-game', expect.anything());
	});

	it('carries a meta Gemini-AI note, keyboard-reachable and crediting Gemini', async () => {
		const { container } = render(Page, pageProps);
		const btn = container.querySelector('button.ai-note-btn')!;
		expect(btn.getAttribute('aria-describedby')).toBe('ai-note');
		const note = container.querySelector('#ai-note')!;
		expect(note.getAttribute('role')).toBe('tooltip');
		expect(note.textContent).toMatch(/Oracle and Sköll/);
		expect(note.textContent).toMatch(/Gemini AI/);
	});

	it('reveals the note on focus and keeps it hidden at rest — not click-gated', async () => {
		const screen = render(Page, pageProps);
		const note = screen.container.querySelector('#ai-note') as HTMLElement;
		expect(note.matches(':popover-open')).toBe(false);
		screen
			.getByRole('button', { name: /about the gemini ai/i })
			.element()
			.focus();
		await vi.waitFor(() => expect(note.matches(':popover-open')).toBe(true));
	});

	it('dismisses the AI note on Escape and holds it open for any other key', async () => {
		const screen = render(Page, pageProps);
		const note = screen.container.querySelector('#ai-note') as HTMLElement;
		const btn = screen.getByRole('button', { name: /about the gemini ai/i }).element();
		btn.focus();
		await vi.waitFor(() => expect(note.matches(':popover-open')).toBe(true));
		btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
		expect(note.matches(':popover-open')).toBe(true);
		btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await vi.waitFor(() => expect(note.matches(':popover-open')).toBe(false));
	});

	it('turns off browser autofill on the question field so it keeps the dark panel background', async () => {
		const screen = render(Page, pageProps);
		const input = screen.getByLabelText(/ask the oracle/i).element();
		expect(input.getAttribute('autocomplete')).toBe('off');
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
			line: 'I read one sign at a time, not two.',
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
		const warn = expectConsole('warn');
		castResult({ ok: false, reason: 'not-your-turn', turnConsumed: false });
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Cast the rune' }).click();
		await screen.getByRole('button', { name: /select sowilo as cast target/i }).click();
		await screen.getByRole('button', { name: 'Name it' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The rite falters');
		expect(warn).toHaveBeenCalledWith('[ui] Cast rejected by engine:', 'not-your-turn');
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
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('Sowilo is not the one. The night holds.');
	});

	it('cancels a cast with no turn spent', async () => {
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Cast the rune' }).click();
		await screen.getByRole('button', { name: 'Not yet' }).click();
		await expect.element(screen.getByRole('button', { name: 'Cast the rune' })).toBeInTheDocument();
	});

	it('shows an in-world error when an Ask dispatch fails', async () => {
		const error = expectConsole('error');
		stubFetch(async () => new Response('nope', { status: 500 }));
		const screen = render(Page, pageProps);
		await screen.getByLabelText(/ask the oracle/i).fill('Is it gold?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The Oracle falls silent');
		expect(error).toHaveBeenCalledWith('[ui] Ask dispatch failed:', expect.any(Error));
	});

	// S11: the error path swaps only the voiced line — a failed dispatch must never cost
	// the player their board state. Crossings and the turn survive the Oracle falling silent.
	it('preserves crossings and turn state when the Ask dispatch fails', async () => {
		const error = expectConsole('error');
		stubFetch(async () => new Response('nope', { status: 500 }));
		const screen = render(Page, pageProps);

		await screen.getByRole('button', { name: /cross off sowilo/i }).click();
		await expect
			.element(screen.getByRole('button', { name: /restore sowilo/i }))
			.toBeInTheDocument();

		await screen.getByLabelText(/ask the oracle/i).fill('Is it gold?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The Oracle falls silent');

		await expect
			.element(screen.getByRole('button', { name: /restore sowilo/i }))
			.toBeInTheDocument();
		await expect.element(screen.getByTestId('turn-pill')).toHaveTextContent('Your move.');
		expect(error).toHaveBeenCalledWith('[ui] Ask dispatch failed:', expect.any(Error));
	});

	it('shows an in-world error when a Cast dispatch fails', async () => {
		const error = expectConsole('error');
		stubFetch(async () => new Response('nope', { status: 500 }));
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Cast the rune' }).click();
		await screen.getByRole('button', { name: /select sowilo as cast target/i }).click();
		await screen.getByRole('button', { name: 'Name it' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The rite falters');
		expect(error).toHaveBeenCalledWith('[ui] Cast dispatch failed:', expect.any(Error));
	});

	it('begins another night — resets the panel and pulls a fresh board', async () => {
		const spy = stubFetch(async (url) => {
			if (url.includes('/api/new-game'))
				return new Response(
					JSON.stringify({ boardSeed: 99, roundId: 'next-round', state: HUMAN_TURN })
				);
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
		await expect.poll(() => screen.getByTestId('answer').element().textContent?.trim()).toBe('');
		expect(spy).toHaveBeenCalledWith('/api/new-game', expect.objectContaining({ method: 'POST' }));
	});

	it('shows an in-world error when starting a new game fails', async () => {
		const error = expectConsole('error');
		stubFetch(async () => new Response('nope', { status: 500 }));
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Begin another night' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The Oracle falls silent');
		expect(error).toHaveBeenCalledWith('[ui] New game failed (status 500):', expect.any(Error));
	});

	it('treats a 200 with no board seed as a failure, not a silent no-op', async () => {
		const error = expectConsole('error');
		stubFetch(async () => new Response(JSON.stringify({})));
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Begin another night' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The Oracle falls silent');
		expect(error).toHaveBeenCalledWith('[ui] New game failed (status 200):', expect.any(Error));
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

	it('hydrates the page dawn gradient from the loaded turn count', () => {
		const screen = render(Page, propsWith({ ...HUMAN_TURN, turns: 6 }));
		const pageShell = screen.container.querySelector('main') as HTMLElement;
		const header = screen.container.querySelector('.rite-header') as HTMLElement;
		expect(pageShell.style.getPropertyValue('--night-t')).toMatch(/^0\.\d{3}$/);
		expect(getComputedStyle(pageShell, '::before').backgroundImage).toContain('rgba(220, 171, 73');
		expect(Number(getComputedStyle(pageShell, '::before').opacity)).toBeGreaterThan(0);
		expect(getComputedStyle(header, '::after').backgroundImage).toContain('rgba(220, 171, 73');
		expect(Number(getComputedStyle(header, '::after').opacity)).toBeGreaterThan(0);
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

	it('the live Ask field carries no hover hint', async () => {
		const screen = render(Page, pageProps);
		const input = screen.getByLabelText(/ask the oracle/i);
		await expect.element(input).toBeEnabled();
		expect(input.element().getAttribute('title')).toBe('');
	});

	it("a shut Ask field during Sköll's hanging question explains itself — disabled with a react-first hint", async () => {
		const screen = render(
			Page,
			props(
				{ activePlayer: 'Sköll', status: 'active', winner: null, turns: 1 },
				{
					echo: 'I scent a fire rune on her.',
					held: { Scry: true, Hex: true }
				}
			)
		);
		const input = screen.getByLabelText(/ask the oracle/i);
		await expect.element(input).toBeDisabled();
		expect(input.element().getAttribute('title')).toBe(
			'Answer Sköll first — Scry, Hex, or Pass — then ask.'
		);
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
		expect(screen.container.querySelector('.header-background-image')).not.toBeNull();
		expect(screen.container.querySelector('.sun-risen')).not.toBeNull();
		await expect
			.element(screen.getByTestId('outcome-line'))
			.toHaveTextContent('Sól crests the rim of the world.');
	});

	it('keeps the moon banner on a Sköll win — short tag in the header, no defeat copy in the panel', async () => {
		const screen = render(Page, propsWith(SKOLL_WON));
		// No sunrise for a loss — the moonlit background holds. The header carries only the short tag;
		// the defeat sentence belongs to the end screen alone, never doubled into the Oracle panel.
		expect(screen.container.querySelector('.header-background-image')).not.toBeNull();
		expect(screen.container.querySelector('.sun-risen')).toBeNull();
		// The loss freezes the night mid-sink — nightT snaps to 1 only when the dawn is won.
		expect(
			screen.container
				.querySelector<HTMLElement>('.rite-header')
				?.style.getPropertyValue('--night-t')
		).toMatch(/^0\.\d+$/);
		await expect
			.element(screen.getByTestId('outcome-line'))
			.toHaveTextContent('Sköll takes the sun.');
		await expect.element(screen.getByTestId('turn-pill')).toHaveTextContent('Sköll takes the sun.');
		// The panel holds whatever the Oracle last voiced (restored from the saved view) — here, nothing.
		expect(screen.getByTestId('answer').element().textContent?.trim()).toBe('');
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

	it('leaves the pill in gold on the human’s turn — no opponent tint', async () => {
		const screen = render(Page, pageProps);
		expect(screen.getByTestId('turn-pill').element().classList.contains('opponent')).toBe(false);
	});

	it('paints the pill in Sköll’s steel on his live turn — opponent on, terminal classes off', async () => {
		askResult(
			{ ok: true, answer: 'No. Sól is not reaching for a fire rune.', turnConsumed: true },
			SKOLL_TURN
		);
		const screen = render(Page, pageProps);
		await screen.getByLabelText(/ask the oracle/i).fill('Is it a fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect.element(screen.getByTestId('turn-pill')).toHaveTextContent('Sköll moves.');
		const pill = screen.getByTestId('turn-pill').element();
		expect(pill.classList.contains('opponent')).toBe(true);
		expect(pill.classList.contains('won')).toBe(false);
		expect(pill.classList.contains('lost')).toBe(false);
	});

	it('never tints a finished round — opponent stays off on a loss (Sköll still active on the won state)', async () => {
		const screen = render(Page, propsWith(SKOLL_WON));
		expect(screen.getByTestId('turn-pill').element().classList.contains('opponent')).toBe(false);
	});

	it('never tints a finished round — opponent stays off on a win', async () => {
		const screen = render(Page, propsWith(HUMAN_WON));
		expect(screen.getByTestId('turn-pill').element().classList.contains('opponent')).toBe(false);
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

	it('drives Sköll on load when the round resumes on his turn — never opens stuck', async () => {
		gameStub({ advance: advanceCast() });
		// One engine per session: a refresh can land on his turn. The page must advance him, not
		// open frozen on "Sköll moves." His cast leaves no flavor line — play just returns to her.
		const screen = render(Page, propsWith(SKOLL_TURN));
		await expect.element(screen.getByTestId('turn-pill')).toHaveTextContent('Your move.');
	});

	it('rehydrates the reaction prompt when a round resumes on Sköll’s parked Ask', async () => {
		// The window lives server-side; the load carries it so a refresh mid-interrupt isn't stuck.
		const spy = gameStub({ react: reactResult({ hexed: true }) });
		const screen = render(
			Page,
			props(SKOLL_TURN, { echo: 'A gold rune. Mine.', held: { Scry: true, Hex: true } })
		);
		await expect.element(screen.getByTestId('reaction-prompt')).toBeInTheDocument();
		await expect.element(screen.getByTestId('skoll-echo')).toHaveTextContent('A gold rune. Mine.');
		// A parked Ask must NOT fire an Advance on mount — the human owes a reaction first.
		expect(spy).not.toHaveBeenCalled();
		// And reacting still resolves it.
		await screen.getByRole('button', { name: 'Hex' }).click();
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('his turn dies with the question');
	});

	it('leaves his box blank on a Cast — no flavor line, just the engine outcome', async () => {
		gameStub({ advance: advanceCast() });
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		// Your answer landed from the Ask; his cast adds NO Sköll line.
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('No. Sól is not reaching');
		// His title persists, but his framed box carries no question and no taunt/cast text.
		await expect.element(screen.getByTestId('skoll-title')).toHaveTextContent('Sköll');
		expect(screen.getByTestId('skoll-frame').element().textContent?.trim()).toBe('');
		expect(screen.container.querySelector('[data-testid="skoll-echo"]')).toBeNull();
		expect(screen.container.querySelector('.skoll-banner')).not.toBeNull();
		expect(screen.container.querySelector('[data-testid="skoll-voice"]')).toBeNull();
	});

	it('prompts the human to react when Sköll Asks (on Advance)', async () => {
		gameStub({ advance: advanceAsk() });
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		await expect.element(screen.getByTestId('skoll-echo')).toHaveTextContent('A gold rune. Mine.');
		await expect.element(screen.getByTestId('reaction-prompt')).toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: 'Pass' })).toBeInTheDocument();
	});

	it('lets the human let Sköll Ask pass', async () => {
		gameStub({ advance: advanceAsk(), react: reactResult({ hexed: false }) });
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		await screen.getByRole('button', { name: 'Pass' }).click();
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('You stay your hand; Sköll gets his answer.');
		// Prompt gone, the static reactions row is back.
		expect(screen.container.querySelector('[data-testid="reaction-prompt"]')).toBeNull();
	});

	// Regression: the static reactions row dropped Pass entirely, so the button vanished from the DOM
	// on every window close while Scry/Hex stayed (their disabled placeholders held). It read as
	// "Pass disappears at random." Pass must hold a disabled slot whenever the window is closed.
	it('keeps a disabled Pass in the static row when no reaction window is open', async () => {
		const screen = render(Page, pageProps);
		const reactions = screen.container.querySelector('.reactions');
		expect(reactions).not.toBeNull();
		const labels = [...reactions!.querySelectorAll('.reaction-btn')].map((b) =>
			b.textContent?.trim()
		);
		expect(labels).toEqual(['Scry', 'Hex', 'Pass']);
		const pass = [...reactions!.querySelectorAll<HTMLButtonElement>('.reaction-btn')].find(
			(b) => b.textContent?.trim() === 'Pass'
		);
		expect(pass?.disabled).toBe(true);
	});

	it('never removes Pass from the DOM across the open→close reaction transition', async () => {
		gameStub({ advance: advanceAsk(), react: reactResult({ hexed: false }) });
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		// Window open: the live prompt carries an enabled Pass.
		await expect.element(screen.getByTestId('reaction-prompt')).toBeInTheDocument();
		const promptPass = screen
			.getByTestId('reaction-prompt')
			.element()
			.querySelector<HTMLButtonElement>('button.btn--secondary');
		expect(promptPass?.textContent?.trim()).toBe('Pass');
		expect(promptPass?.disabled).toBe(false);
		await screen.getByRole('button', { name: 'Pass' }).click();
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('You stay your hand; Sköll gets his answer.');
		// Window closed: the prompt is gone, but a Pass button still exists (the disabled placeholder).
		expect(screen.container.querySelector('[data-testid="reaction-prompt"]')).toBeNull();
		const stillThere = [
			...screen.container.querySelectorAll<HTMLButtonElement>('.reaction-btn')
		].find((b) => b.textContent?.trim() === 'Pass');
		expect(stillThere, 'Pass must not vanish when the window closes').toBeTruthy();
		expect(stillThere?.disabled).toBe(true);
	});

	it('shares the answer when the human Scries Sköll Ask', async () => {
		gameStub({
			advance: advanceAsk(),
			react: reactResult({
				hexed: false,
				scried: { answer: 'Yes. Sól is reaching for a gold rune.' }
			})
		});
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		await screen.getByRole('button', { name: 'Scry' }).click();
		// §3: the Scry framing line leads, then the overheard answer he was owed.
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent(
				'You lean into the dark; his answer is yours. Yes. Sól is reaching for a gold rune.'
			);
	});

	it('shows spent Scry disabled on the next Sköll Ask instead of hiding it', async () => {
		gameStub({
			advance: advanceAsk(),
			react: reactResult({
				hexed: false,
				scried: { answer: 'Yes. Sól is reaching for a gold rune.' }
			})
		});
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		await screen.getByRole('button', { name: 'Scry' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('his answer is yours.');

		await humanAsks(screen);
		await expect.element(screen.getByTestId('reaction-prompt')).toBeInTheDocument();
		const scry = screen.getByRole('button', { name: 'Scry' }).element() as HTMLButtonElement;
		const hex = screen.getByRole('button', { name: 'Hex' }).element() as HTMLButtonElement;
		const pass = screen.getByRole('button', { name: 'Pass' }).element() as HTMLButtonElement;

		expect(scry.disabled).toBe(true);
		expect(scry.classList).toContain('reaction-choice--spent');
		expect(hex.disabled).toBe(false);
		expect(pass.disabled).toBe(false);
	});

	it('kills the question when the human Hexes Sköll Ask', async () => {
		gameStub({ advance: advanceAsk(), react: reactResult({ hexed: true }) });
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		await screen.getByRole('button', { name: 'Hex' }).click();
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('his turn dies with the question');
		// No stale second line stacked beneath — the outcome is the single panel line.
		expect(screen.container.querySelector('[data-testid="skoll-voice"]')).toBeNull();
	});

	it('shows the pass outcome when a Hex did not land (server resolved it as a pass)', async () => {
		// The server can reject a reaction (e.g. no charge) and resolve it as a Pass. The UI must key
		// on what actually landed, not the requested choice — so a "Hex" that didn't fire reads as a pass.
		gameStub({ advance: advanceAsk(), react: reactResult({ hexed: false }) });
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		await screen.getByRole('button', { name: 'Hex' }).click();
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('You stay your hand; Sköll gets his answer.');
	});

	it('voices the Hex in the Oracle text when Sköll silences the human Ask', async () => {
		gameStub({
			// No oracle line — the question was silenced before any answer; then his own Advance move.
			ask: { type: 'Ask', skollVsYou: { reaction: 'Hex' }, state: SKOLL_TURN },
			advance: advanceCast()
		});
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		// The Oracle text names Sköll in the rite's voice — NOT his first-person gloat.
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('Sköll silences the Oracle; your question dies.');
		expect(screen.getByTestId('answer').element().textContent).not.toContain('My doing');
	});

	it('voices the Scry after the answer in the Oracle text when Sköll overhears', async () => {
		gameStub({
			ask: defaultAsk({ reaction: 'Scry' }),
			advance: advanceCast()
		});
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		// The answer he overheard, then the Scry noted in the same Oracle text.
		const text = () => screen.getByTestId('answer').element().textContent ?? '';
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('Sköll listened');
		expect(text()).toContain('No. Sól is not reaching for a fire rune.');
	});

	it('keeps the Scry note in the panel when his very next cast wins — the WHY of the loss survives', async () => {
		// The scried-name kill: he overhears her answer, then casts it on his Advance and takes the
		// round. The panel must hold the answer + his Scry, not the end screen's defeat copy.
		gameStub({
			ask: defaultAsk({ reaction: 'Scry' }),
			advance: advanceCast(SKOLL_WON)
		});
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		const text = () => screen.getByTestId('answer').element().textContent ?? '';
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('Sköll listened');
		expect(text()).toContain('No. Sól is not reaching for a fire rune.');
		expect(text()).not.toContain('takes the sun');
		await expect.element(screen.getByTestId('end-screen')).toBeInTheDocument();
	});

	it('falls to defeat when Sköll casts true on his Advance turn', async () => {
		gameStub({ advance: advanceCast(SKOLL_WON) });
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		// The Oracle panel keeps her last answer — the WHY of the loss — while the pill flips and the
		// end screen alone carries the defeat text. Nothing is doubled into the panel.
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('No. Sól is not reaching for a fire rune.');
		expect(screen.getByTestId('answer').element().textContent).not.toContain('takes the sun');
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

describe('Save the Sun page — first-run onboarding (S7)', () => {
	beforeEach(() => {
		localStorage.clear();
		respond({}); // onMount fires advanceSkoll; keep it a harmless no-op
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		localStorage.clear();
	});

	it('shows the title screen on a first run, over the live board behind it', async () => {
		const screen = render(Page, pageProps);
		await expect.element(screen.getByTestId('onboarding')).toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: 'Light the fire.' }))
			.toBeInTheDocument();
		// The board is rendered behind the dimmed overlay, not replaced by it.
		expect(screen.container.querySelector('main')).not.toBeNull();
	});

	it('dismisses on "Light the fire." and remembers it for the next load', async () => {
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Light the fire.' }).click();
		expect(screen.container.querySelector('[data-testid="onboarding"]')).toBeNull();
		expect(localStorage.getItem(ONBOARDED_KEY)).toBe('1');
	});

	it('does not show the title screen for a returning player', async () => {
		localStorage.setItem(ONBOARDED_KEY, '1');
		const screen = render(Page, pageProps);
		await expect.element(screen.getByTestId('turn-pill')).toBeInTheDocument();
		expect(screen.container.querySelector('[data-testid="onboarding"]')).toBeNull();
	});

	it('reopens the tour from the persistent "How the rite works" button — skipping the title', async () => {
		localStorage.setItem(ONBOARDED_KEY, '1');
		const screen = render(Page, pageProps);
		await screen.getByTestId('show-instructions').click();
		// Straight into the tour (no title screen) on the first concept.
		await expect.element(screen.getByTestId('step-count')).toHaveTextContent('1 / 5');
		expect(screen.container.querySelector('[data-testid="onboarding"]')).not.toBeNull();
	});
});

// S8.5: a refresh resumes the round server-side, but the client's view (crossings + the voiced
// Oracle line) is otherwise thrown away. These prove it is restored from storage, scoped to the
// round, and degrades safely when storage is unavailable.
describe('Save the Sun page — view resume on reload (S8.5)', () => {
	const VIEW_KEY = VIEW_STATE_KEY;

	beforeEach(() => {
		localStorage.setItem(ONBOARDED_KEY, '1'); // past the title; resume is the subject here
		respond({}); // onMount fires advanceSkoll — keep it a harmless no-op
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		localStorage.clear();
	});

	it('restores the crossings onto the board for the resumed round', async () => {
		// Sowilo is rune id 1 — seed it crossed under the round the load will report.
		localStorage.setItem(
			VIEW_KEY,
			JSON.stringify({ roundId: 'test-round', crossings: [1], answer: '' })
		);
		const screen = render(Page, pageProps);
		await expect
			.element(screen.getByRole('button', { name: /restore sowilo/i }))
			.toBeInTheDocument();
	});

	it('restores the voiced Oracle line for the resumed round', async () => {
		localStorage.setItem(
			VIEW_KEY,
			JSON.stringify({
				roundId: 'test-round',
				crossings: [],
				answer: 'No. Sól is not reaching for a fire rune.'
			})
		);
		const screen = render(Page, pageProps);
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('No. Sól is not reaching for a fire rune.');
	});

	it('never lets a blank stored line overwrite a server-derived one — a resumed won round keeps its victory line', async () => {
		// A won round hydrates its victory line from engine truth; a record with a blank answer (e.g. the
		// win was never voiced client-side before the reload) must not blank it back out.
		localStorage.setItem(
			VIEW_KEY,
			JSON.stringify({ roundId: 'test-round', crossings: [], answer: '' })
		);
		const screen = render(Page, propsWith(HUMAN_WON));
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The rune is true.');
	});

	it('ignores a persisted view from a different round — never restores onto a fresh secret', async () => {
		// Stored under another round's token: the resumed round must open clean, not wear stale marks.
		localStorage.setItem(
			VIEW_KEY,
			JSON.stringify({
				roundId: 'a-stale-round',
				crossings: [1],
				answer: 'stale line'
			})
		);
		const screen = render(Page, pageProps);
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('');
		expect(
			screen.container.querySelector('[data-rune-id="1"]')?.classList.contains('crossed')
		).toBe(false);
	});

	it('persists a cross-off so it would survive a reload', async () => {
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: /cross off sowilo/i }).click();
		await expect
			.element(screen.getByRole('button', { name: /restore sowilo/i }))
			.toBeInTheDocument();
		await vi.waitFor(() => {
			const saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}');
			expect(saved).toMatchObject({ roundId: 'test-round', crossings: [1] });
		});
	});

	it('re-keys the persisted view to the new round and drops the old crossings on a new game', async () => {
		// A stale record from the prior round, plus a new-game response that mints a new token.
		localStorage.setItem(
			VIEW_KEY,
			JSON.stringify({ roundId: 'test-round', crossings: [1], answer: 'old' })
		);
		stubFetch(async (url) => {
			if (url.includes('/api/new-game'))
				return new Response(
					JSON.stringify({ boardSeed: 99, roundId: 'next-round', state: HUMAN_TURN })
				);
			return new Response('{}');
		});
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Begin another night' }).click();

		await vi.waitFor(() => {
			const saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}');
			// The single record now belongs to the new round, with no crossings carried over.
			expect(saved.roundId).toBe('next-round');
			expect(saved.crossings).toEqual([]);
		});
		// And the board itself shows no surviving crossing.
		expect(
			screen.container.querySelector('[data-rune-id="1"]')?.classList.contains('crossed')
		).toBe(false);
	});

	it('keeps the last good line in storage when Sköll stalls — never persists the dead-end error', async () => {
		const error = expectConsole('error');
		// The Ask hands the turn to Sköll; his Advance then fails, stalling him.
		stubFetch(async (_url: string, init?: { body?: string }) => {
			const body = init?.body ? JSON.parse(init.body) : {};
			if (body.type === 'Advance') return new Response('nope', { status: 500 });
			return new Response(
				JSON.stringify({
					type: 'Ask',
					oracle: {
						ok: true,
						answer: 'No. Sól is not reaching for a fire rune.',
						turnConsumed: true
					},
					state: SKOLL_TURN
				})
			);
		});
		const screen = render(Page, pageProps);
		await screen.getByLabelText(/ask the oracle/i).fill('Is it a fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		// The stall line shows live, with its retry affordance...
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The wolf stalls');
		await expect.element(screen.getByTestId('rouse-wolf')).toBeInTheDocument();
		// ...but storage holds the last good line, not the transient error — a reload (which re-drives
		// his move) resumes a coherent view instead of a dead end with no rouse button.
		await vi.waitFor(() => {
			const saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}');
			expect(saved.answer).toBe('No. Sól is not reaching for a fire rune.');
		});
		expect(error).toHaveBeenCalled();
	});

	it('treats a new-game response with no round token as a failure, not a silent mis-key', async () => {
		const error = expectConsole('error');
		stubFetch(async () => new Response(JSON.stringify({ boardSeed: 99, state: HUMAN_TURN })));
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Begin another night' }).click();
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('The Oracle falls silent');
		expect(error).toHaveBeenCalledWith('[ui] New game failed (status 200):', expect.any(Error));
	});

	it('degrades to no restore when reading storage throws (private mode) — never breaks play', async () => {
		// Throw only for the view key; the onboarded read still resolves so the title stays down.
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
			if (key === VIEW_KEY) throw new DOMException('denied');
			return key === ONBOARDED_KEY ? '1' : null;
		});
		const screen = render(Page, pageProps);
		// The board still renders and play is live — the failed restore is silent, not fatal.
		await expect.element(screen.getByTestId('turn-pill')).toHaveTextContent('Your move.');
		await expect.element(screen.getByTestId('answer')).toHaveTextContent('');
		expect(screen.container.querySelectorAll('.rune-card')).toHaveLength(24);
	});
});

// A reload mid-rite interrupts Sköll's turn: the in-flight Advance response is lost, so his move
// presentation can never arrive that way. The engine resumes server-side, so the load is the only
// honest source of his last move on resume. These prove a reload landing on his turn reconciles to
// engine truth — interrupt restored, cast outcome reflected, turn handed back — never opens stuck.
describe('Save the Sun page — Sköll turn reload reconcile', () => {
	beforeEach(() => {
		localStorage.setItem(ONBOARDED_KEY, '1'); // past the title; the resume is the subject here
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		localStorage.clear();
	});

	it('restores the interrupt when a reload lands on Sköll’s parked Ask — no Advance fired', async () => {
		// The load carries the parked Ask (the server-side reaction window); the page must show the
		// prompt straight from it and NOT re-drive Advance (the human owes a reaction first).
		const spy = respond({});
		const screen = render(
			Page,
			props(SKOLL_TURN, { echo: 'A gold rune. Mine.', held: { Scry: true, Hex: true } })
		);
		await expect.element(screen.getByTestId('reaction-prompt')).toBeInTheDocument();
		await expect.element(screen.getByTestId('skoll-echo')).toHaveTextContent('A gold rune. Mine.');
		await expect.element(screen.getByTestId('turn-pill')).toHaveTextContent('Sköll moves.');
		expect(spy).not.toHaveBeenCalled();
	});

	it('reflects a Sköll win when a reload lands after his cast took the round — end screen, not stuck', async () => {
		// His winning cast resolved server-side; the lost Advance response never mattered. The load
		// reports the won round, so the resume opens on defeat — never frozen on "Sköll moves."
		const spy = respond({});
		const screen = render(Page, propsWith(SKOLL_WON));
		await expect.element(screen.getByTestId('end-screen')).toBeInTheDocument();
		await expect.element(screen.getByTestId('turn-pill')).toHaveTextContent('Sköll takes the sun.');
		await expect
			.element(screen.getByTestId('outcome-line'))
			.toHaveTextContent('Sköll takes the sun.');
		// Round resolved server-side: no phantom Advance to re-drive his already-spent turn.
		expect(spy).not.toHaveBeenCalled();
	});

	it('renders the human turn when a reload lands after Sköll’s wrong cast handed play back', async () => {
		// His wrong cast resolved server-side and returned the turn; the load reports the human active.
		// Advance no-ops (not his turn), so the page opens live on her move — the saved line holds.
		localStorage.setItem(
			VIEW_STATE_KEY,
			JSON.stringify({
				roundId: 'test-round',
				crossings: [],
				answer: 'No. Sól is not reaching for a fire rune.'
			})
		);
		const spy = respond({});
		const screen = render(Page, pageProps); // HUMAN_TURN: play handed back
		await expect.element(screen.getByTestId('turn-pill')).toHaveTextContent('Your move.');
		await expect.element(screen.getByRole('button', { name: 'Ask the Oracle' })).toBeEnabled();
		await expect.element(screen.getByRole('button', { name: 'Cast the rune' })).toBeEnabled();
		// The last good line survives the reload; his wrong cast carries no panel line by design.
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('No. Sól is not reaching for a fire rune.');
		expect(screen.container.querySelector('[data-testid="skoll-echo"]')).toBeNull();
		// His turn is over — the page must not re-drive a stale Advance against the human's clock.
		expect(spy).not.toHaveBeenCalled();
	});

	it('drives Sköll and surfaces his Ask when a reload lands on his unplayed turn', async () => {
		// The harder case: the human's Ask landed server-side (turn → Sköll) but the reload beat the
		// Advance. The engine never ran his move, so the load reports his turn with nothing parked —
		// the page MUST re-drive Advance and surface whatever he does (here, an Ask → the interrupt).
		const spy = gameStub({ advance: advanceAsk() });
		const screen = render(Page, propsWith(SKOLL_TURN));
		await expect.element(screen.getByTestId('skoll-echo')).toHaveTextContent('A gold rune. Mine.');
		await expect.element(screen.getByTestId('reaction-prompt')).toBeInTheDocument();
		// Exactly one request — the Advance re-drive (gameStub returns advanceAsk only for Advance;
		// the rendered interrupt proves it was that branch, not a stray player action).
		expect(spy).toHaveBeenCalledTimes(1);
	});
});

// A dropped action RESPONSE (the 30s abort trips, or the network drops) differs from a reload: the
// server completed the move under withSessionLock, so the engine moved on while the browser gave up.
// The catch must resync to /api/state or the UI strands on a stale turn/board. These prove it does.
describe('Save the Sun page — dropped action response reconcile', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		localStorage.clear();
	});

	it('surfaces Sköll’s parked Ask when his Advance response drops mid-flight', async () => {
		const error = expectConsole('error');
		// The Ask hands the turn to Sköll; his Advance then drops — but the server DID park his Ask, so
		// /api/state carries the interrupt. The catch must show the reaction prompt, not a rouse retry.
		stubFetch(async (url: string, init?: { body?: string }) => {
			if (url.includes('/api/state'))
				return new Response(
					JSON.stringify({
						boardSeed: 0,
						roundId: 'test-round',
						state: SKOLL_TURN,
						pendingReaction: { echo: 'A gold rune. Mine.', held: { Scry: true, Hex: true } }
					})
				);
			const body = init?.body ? JSON.parse(init.body) : {};
			if (body.type === 'Advance') return new Response('nope', { status: 500 });
			return new Response(
				JSON.stringify({
					type: 'Ask',
					oracle: {
						ok: true,
						answer: 'No. Sól is not reaching for a fire rune.',
						turnConsumed: true
					},
					state: SKOLL_TURN
				})
			);
		});
		const screen = render(Page, pageProps);
		await humanAsks(screen);
		// Resynced to the parked Ask — the interrupt is up, and the dead-end rouse retry is NOT.
		await expect.element(screen.getByTestId('reaction-prompt')).toBeInTheDocument();
		await expect.element(screen.getByTestId('skoll-echo')).toHaveTextContent('A gold rune. Mine.');
		expect(screen.container.querySelector('[data-testid="rouse-wolf"]')).toBeNull();
		expect(error).toHaveBeenCalled();
	});

	it('re-keys the board to the new round when a new-game response drops but the server reset', async () => {
		const error = expectConsole('error');
		localStorage.setItem(
			VIEW_STATE_KEY,
			JSON.stringify({ roundId: 'test-round', crossings: [1], answer: 'old' })
		);
		// The POST drops (500), but resetEngine already minted 'next-round' — /api/state proves it, so
		// the catch resyncs the board to the new secret instead of stranding on the old one.
		stubFetch(async (url: string) => {
			if (url.includes('/api/state'))
				return new Response(
					JSON.stringify({
						boardSeed: 99,
						roundId: 'next-round',
						state: HUMAN_TURN,
						pendingReaction: null
					})
				);
			if (url.includes('/api/new-game')) return new Response('nope', { status: 500 });
			return new Response('{}');
		});
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Begin another night' }).click();
		await vi.waitFor(() => {
			const saved = JSON.parse(localStorage.getItem(VIEW_STATE_KEY) ?? '{}');
			expect(saved.roundId).toBe('next-round');
			expect(saved.crossings).toEqual([]);
		});
		expect(error).toHaveBeenCalled();
	});
});

// S9: the end-screen rite takes over when the round resolves — the victory/defeat sequence and the
// replay/leave CTAs. These prove it shows on the right outcome, owns the single replay surface, and
// drives newGame / back-to-title.
describe('Save the Sun page — end screen + replay (S9)', () => {
	beforeEach(() => {
		localStorage.setItem(ONBOARDED_KEY, '1'); // past the title; the end screen is the subject here
		respond({}); // onMount fires advanceSkoll on active-round renders — keep it a harmless no-op
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		localStorage.clear();
	});

	it('shows no end screen while the round is still live', async () => {
		const screen = render(Page, pageProps);
		await expect.element(screen.getByTestId('turn-pill')).toHaveTextContent('Your move.');
		expect(screen.container.querySelector('[data-testid="end-screen"]')).toBeNull();
	});

	it('opens the victory rite on a resumed human win — Sól speaks, and it owns the only replay', async () => {
		const screen = render(Page, propsWith(HUMAN_WON));
		const end = screen.getByTestId('end-screen').element();
		expect((end as HTMLElement).dataset.outcome).toBe('win');
		await expect
			.element(
				screen.getByText(
					'The offering is made. The longest day breaks — and the light is yours to keep.'
				)
			)
			.toBeInTheDocument();
		// The header's own "Begin another night" folds away — the end screen is the single replay surface,
		// so the name resolves to exactly one button.
		expect(screen.container.querySelector('[data-testid="show-instructions"]')).toBeNull();
		await expect
			.element(screen.getByRole('button', { name: 'Begin another night' }))
			.toBeInTheDocument();
		expect(screen.getByTestId('end-replay').element().textContent?.trim()).toBe(
			'Begin another night'
		);
	});

	it('opens the defeat rite on a Sköll win — "Stand against him again"', async () => {
		const screen = render(Page, propsWith(SKOLL_WON));
		const end = screen.getByTestId('end-screen').element();
		expect((end as HTMLElement).dataset.outcome).toBe('lose');
		// Scope to the end screen's own lead + coda — the panel behind holds its own last line.
		expect(end.querySelector('.lead')?.textContent?.trim()).toBe('Sköll takes the sun.');
		expect(end.querySelector('.coda')?.textContent?.trim()).toBe(
			'Sól waits in the dark — only the true rune can win her back.'
		);
		expect(screen.getByTestId('end-replay').element().textContent?.trim()).toBe(
			'Stand against him again'
		);
	});

	it('raises the end screen the moment a winning cast lands', async () => {
		castResult({ ok: true, won: true, rune: { name: 'Sowilo' }, turnConsumed: true }, HUMAN_WON);
		const screen = render(Page, pageProps);
		expect(screen.container.querySelector('[data-testid="end-screen"]')).toBeNull();
		await screen.getByRole('button', { name: 'Cast the rune' }).click();
		await screen.getByRole('button', { name: /select sowilo as cast target/i }).click();
		await screen.getByRole('button', { name: 'Name it' }).click();
		await expect.element(screen.getByTestId('end-screen')).toBeInTheDocument();
		await expect
			.element(screen.getByTestId('end-screen').element())
			.toHaveAttribute('data-outcome', 'win');
	});

	it('replays a fresh round from the end screen — calls new-game and dismisses the rite', async () => {
		const spy = stubFetch(async (url) => {
			if (url.includes('/api/new-game'))
				return new Response(
					JSON.stringify({ boardSeed: 99, roundId: 'next-round', state: HUMAN_TURN })
				);
			return new Response('{}');
		});
		const screen = render(Page, propsWith(HUMAN_WON));
		await screen.getByTestId('end-replay').click();
		await expect
			.poll(() => screen.container.querySelector('[data-testid="end-screen"]'))
			.toBeNull();
		await expect.element(screen.getByTestId('turn-pill')).toHaveTextContent('Your move.');
		expect(spy).toHaveBeenCalledWith('/api/new-game', expect.objectContaining({ method: 'POST' }));
	});

	it('offers only the replay CTA on the end screen — no "Leave the fire." escape hatch', async () => {
		stubFetch(async () => new Response('{}'));
		const screen = render(Page, propsWith(HUMAN_WON));
		await expect.element(screen.getByTestId('end-screen')).toBeInTheDocument();
		expect(screen.container.querySelector('[data-testid="end-leave"]')).toBeNull();
		expect(screen.container.textContent).not.toContain('Leave the fire.');
	});
});
