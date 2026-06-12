import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Page from '$routes/+page.svelte';
import type { GameState } from '$lib/server/engine/actions';
import type { VoiceEvent } from '$lib/voice/voiceSession';

// S3: the page owns the voiceSession subscription and drives the medallion from its events.
// The session module is mocked at the boundary so these tests emit the S2 contract directly —
// no mic, token, or socket involved.

const voiceMock = vi.hoisted(() => {
	const listeners = new Set<(event: unknown) => void>();
	return {
		listeners,
		state: 'asleep',
		notice: null as string | null,
		wake: vi.fn(async () => {}),
		sleep: vi.fn(),
		setToolExecutor: vi.fn(),
		direct: vi.fn(),
		emit(event: unknown) {
			for (const listener of listeners) listener(event);
		}
	};
});

vi.mock('$lib/voice/voiceSession', () => ({
	voiceSession: {
		wake: voiceMock.wake,
		sleep: voiceMock.sleep,
		setToolExecutor: voiceMock.setToolExecutor,
		direct: voiceMock.direct,
		get state() {
			return voiceMock.state;
		},
		get notice() {
			return voiceMock.notice;
		},
		subscribe(listener: (event: unknown) => void) {
			voiceMock.listeners.add(listener);
			return () => voiceMock.listeners.delete(listener);
		}
	}
}));

const emit = (event: VoiceEvent) => voiceMock.emit(event);

const HUMAN_TURN: GameState = { activePlayer: 'Human', status: 'active', winner: null, turns: 0 };
const RITE_MOVING = 'The rite is moving. Hold.';
const pageProps = {
	data: { boardSeed: 0, roundId: 'test-round', state: HUMAN_TURN, pendingReaction: null },
	params: {},
	form: null
};

beforeEach(() => {
	// Reset here, not in afterEach: the previous test's component cleanup calls sleep() on
	// unmount, and that teardown ordering must never leak into this test's call counts. Reset
	// (not clear) so a per-test wake implementation can't outlive its test either.
	vi.resetAllMocks();
	voiceMock.listeners.clear();
	voiceMock.state = 'asleep';
	voiceMock.notice = null;
	localStorage.setItem('save-the-sun:onboarded', '1');
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response('{}'))
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	localStorage.clear();
});

describe('Save the Sun page — eclipse medallion wiring (S3)', () => {
	it('opens with the medallion asleep at the top of the Oracle panel', async () => {
		const screen = render(Page, pageProps);
		const medallion = screen.getByTestId('eclipse-medallion');
		await expect.element(medallion).toBeInTheDocument();
		expect(medallion.element().getAttribute('aria-label')).toBe(
			'The voice sleeps. Wake the Oracle.'
		);
		// First interactive element of the panel: the medallion sits above the turn pill.
		const panel = screen.container.querySelector('.oracle-panel')!;
		const order = [...panel.querySelectorAll('[data-testid]')].map((el) =>
			el.getAttribute('data-testid')
		);
		expect(order.indexOf('eclipse-medallion')).toBeLessThan(order.indexOf('turn-pill'));
	});

	it('stacks the medallion above the panel dimming veil', async () => {
		// The page lifts panel children over the ::before overlay; the voice stack (the
		// medallion's page-scoped parent) must be among them or the art renders dimmed.
		const screen = render(Page, pageProps);
		const stack = screen.container.querySelector('.voice-stack')!;
		expect(getComputedStyle(stack).position).toBe('relative');
		expect(Number(getComputedStyle(stack).zIndex)).toBeGreaterThanOrEqual(2);
	});

	it('wakes the session on a tap while asleep', async () => {
		const screen = render(Page, pageProps);
		await screen.getByTestId('eclipse-medallion').click();
		expect(voiceMock.wake).toHaveBeenCalledOnce();
		expect(voiceMock.sleep).not.toHaveBeenCalled();
	});

	// Every awake state promises "Silence the voice" (MEDALLION_LABEL) — the tap must honor it
	// from all of them, not just listening. A hot mic that ignores the tap is a privacy failure.
	it.each([
		{ state: 'waking' },
		{ state: 'listening' },
		{ state: 'hearing' },
		{ state: 'thinking' },
		{ state: 'speaking' }
	])('sleeps the session on a tap while $state', async ({ state }) => {
		voiceMock.state = state;
		const screen = render(Page, pageProps);
		await screen.getByTestId('eclipse-medallion').click();
		expect(voiceMock.sleep).toHaveBeenCalledOnce();
		expect(voiceMock.wake).not.toHaveBeenCalled();
	});

	it('cancels an in-flight wake on a second tap — never silently drops it', async () => {
		// The session reports 'waking' for the whole permission+token+connect stretch; a player
		// who taps again to back out must reach sleep() (which aborts the pending wake), not a
		// wake() re-entry no-op while the mic is about to go live.
		voiceMock.wake.mockImplementation(() => {
			voiceMock.state = 'waking';
			emit({ type: 'waking' });
			return new Promise(() => {}); // a wake that never settles
		});
		const screen = render(Page, pageProps);
		await screen.getByTestId('eclipse-medallion').click();
		expect(voiceMock.wake).toHaveBeenCalledOnce();
		await expect
			.element(screen.getByTestId('eclipse-medallion'))
			.toHaveAttribute('data-voice-state', 'waking');
		await screen.getByTestId('eclipse-medallion').click();
		expect(voiceMock.sleep).toHaveBeenCalledOnce();
		expect(voiceMock.wake).toHaveBeenCalledOnce(); // the second tap must not re-enter wake
	});

	it('allows a fresh wake after a failed one — a failure must not jam the toggle', async () => {
		voiceMock.wake.mockImplementation(async () => {
			emit({
				type: 'error',
				reason: 'token',
				notice: 'The fire does not carry your voice tonight. The rite continues by hand.'
			});
			emit({ type: 'asleep' });
		});
		const screen = render(Page, pageProps);
		await screen.getByTestId('eclipse-medallion').click();
		// The notice must survive the session's trailing asleep event — a "reset everything on
		// asleep" refactor would blank every failure microseconds after it lands.
		await expect
			.element(screen.getByTestId('voice-notice'))
			.toHaveTextContent('The fire does not carry your voice tonight. The rite continues by hand.');
		await screen.getByTestId('eclipse-medallion').click();
		expect(voiceMock.wake).toHaveBeenCalledTimes(2);
		expect(voiceMock.sleep).not.toHaveBeenCalled();
	});

	it.each([
		{ event: { type: 'waking' } as VoiceEvent, state: 'waking' },
		{ event: { type: 'listening' } as VoiceEvent, state: 'listening' },
		{ event: { type: 'thinking' } as VoiceEvent, state: 'thinking' },
		{ event: { type: 'speaking' } as VoiceEvent, state: 'speaking' },
		{ event: { type: 'asleep' } as VoiceEvent, state: 'asleep' },
		{ event: { type: 'eclipsed' } as VoiceEvent, state: 'eclipsed' }
	])('mirrors the $state event onto the medallion', async ({ event, state }) => {
		const screen = render(Page, pageProps);
		emit(event);
		await expect
			.element(screen.getByTestId('eclipse-medallion'))
			.toHaveAttribute('data-voice-state', state);
	});

	it('flares the medallion with the hearing amplitude', async () => {
		const screen = render(Page, pageProps);
		emit({ type: 'hearing', amplitude: 0.15 });
		const medallion = screen.getByTestId('eclipse-medallion');
		await expect.element(medallion).toHaveAttribute('data-voice-state', 'hearing');
		expect((medallion.element() as HTMLElement).style.getPropertyValue('--flare')).toBe('0.5');
	});

	it('resets the flare when the session settles back to asleep', async () => {
		const screen = render(Page, pageProps);
		emit({ type: 'hearing', amplitude: 0.3 });
		const medallion = screen.getByTestId('eclipse-medallion');
		await expect.element(medallion).toHaveAttribute('data-voice-state', 'hearing');
		emit({ type: 'asleep' });
		await expect.element(medallion).toHaveAttribute('data-voice-state', 'asleep');
		expect((medallion.element() as HTMLElement).style.getPropertyValue('--flare')).toBe('0');
	});

	it('mounts the notice region empty from first paint — a region born with content is never narrated', async () => {
		const screen = render(Page, pageProps);
		const notice = screen.getByTestId('voice-notice').element();
		expect(notice.getAttribute('role')).toBe('status');
		expect(notice.textContent).toBe('');
	});

	it('shows the failure notice by the medallion — never in the Oracle answer frame', async () => {
		const screen = render(Page, pageProps);
		emit({
			type: 'error',
			reason: 'socket',
			notice: "The Oracle's voice falters. The rite continues by hand."
		});
		await expect
			.element(screen.getByTestId('voice-notice'))
			.toHaveTextContent("The Oracle's voice falters. The rite continues by hand.");
		// The answer frame is her voiced surface (and persists across reloads) — it must stay clean.
		expect(screen.getByTestId('answer').element().textContent?.trim()).toBe('');
		// The error alone settles the medallion — it must never strand in waking promising
		// a silence-tap it can't honor, even if the session's asleep event were lost.
		await expect
			.element(screen.getByTestId('eclipse-medallion'))
			.toHaveAttribute('data-voice-state', 'asleep');
	});

	it('clears the failure notice the moment a retry starts waking — a re-failure re-announces', async () => {
		const screen = render(Page, pageProps);
		const notice = 'The fire does not carry your voice tonight. The rite continues by hand.';
		emit({ type: 'error', reason: 'token', notice });
		await expect.element(screen.getByTestId('voice-notice')).toHaveTextContent(notice);
		// Retry starts: the stale line must not sit under a stirring medallion...
		emit({ type: 'waking' });
		await expect.poll(() => screen.getByTestId('voice-notice').element().textContent).toBe('');
		// ...and the identical failure landing again is a real content change — narrated.
		emit({ type: 'error', reason: 'token', notice });
		await expect.element(screen.getByTestId('voice-notice')).toHaveTextContent(notice);
	});

	// S4: mic permission denied / no device. The session seals itself; the page must show the
	// one quiet notice, render the medallion inert, and leave the button game untouched.
	it('seals the medallion after a mic failure — one notice, no second prompt, ever', async () => {
		voiceMock.wake.mockImplementation(async () => {
			voiceMock.state = 'eclipsed';
			emit({
				type: 'error',
				reason: 'mic-permission',
				notice: 'The fire cannot hear you. The rite continues by hand.'
			});
			emit({ type: 'eclipsed' });
		});
		const screen = render(Page, pageProps);
		const medallion = screen.getByTestId('eclipse-medallion');
		await medallion.click();
		expect(voiceMock.wake).toHaveBeenCalledOnce();
		await expect.element(medallion).toHaveAttribute('data-voice-state', 'eclipsed');
		await expect.element(medallion).toHaveAttribute('aria-disabled', 'true');
		await expect
			.element(screen.getByTestId('voice-notice'))
			.toHaveTextContent('The fire cannot hear you. The rite continues by hand.');
		// A second tap dies in the medallion: no re-prompt (wake) and no false sleep.
		// force: aria-disabled makes Playwright refuse the click; a real pointer still lands.
		await medallion.click({ force: true });
		expect(voiceMock.wake).toHaveBeenCalledOnce();
		expect(voiceMock.sleep).not.toHaveBeenCalled();
		// The notice is permanent for the session — nothing clears it once sealed.
		await expect
			.element(screen.getByTestId('voice-notice'))
			.toHaveTextContent('The fire cannot hear you. The rite continues by hand.');
	});

	it('adopts the live session state at mount — a remount after the seal must not promise a wake', async () => {
		// The session is a module singleton: the eclipse survives unmount (sleep() cannot clear
		// it), so a fresh mount that defaulted to asleep would render a wake button the session
		// silently refuses.
		voiceMock.state = 'eclipsed';
		voiceMock.notice = 'The fire cannot hear you. The rite continues by hand.';
		const screen = render(Page, pageProps);
		await expect
			.element(screen.getByTestId('eclipse-medallion'))
			.toHaveAttribute('data-voice-state', 'eclipsed');
		await expect
			.element(screen.getByTestId('voice-notice'))
			.toHaveTextContent('The fire cannot hear you. The rite continues by hand.');
	});

	it('leaves the button game untouched by the seal — Ask still dispatches (S4)', async () => {
		const fetchMock = vi.mocked(fetch);
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					type: 'Ask',
					oracle: {
						ok: true,
						answer: 'No. Sól is not reaching for a fire rune.',
						turnConsumed: true
					},
					state: HUMAN_TURN
				})
			)
		);
		const screen = render(Page, pageProps);
		emit({
			type: 'error',
			reason: 'mic-missing',
			notice: 'No voice reaches the fire. The rite continues by hand.'
		});
		emit({ type: 'eclipsed' });
		const input = screen.container.querySelector<HTMLInputElement>('#oracle-ask')!;
		expect(input.disabled).toBe(false);
		await screen.getByLabelText('Ask the Oracle').fill('is it a fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await vi.waitFor(() => {
			const actionCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/action');
			expect(actionCalls).toHaveLength(1);
		});
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('No. Sól is not reaching for a fire rune.');
		expect(consoleError).not.toHaveBeenCalled();
	});

	it('ignores an event type it does not know — a newer session must not crash an older page', async () => {
		const screen = render(Page, pageProps);
		voiceMock.emit({ type: 'directors-cut' });
		await expect
			.element(screen.getByTestId('eclipse-medallion'))
			.toHaveAttribute('data-voice-state', 'asleep');
		expect(screen.getByTestId('voice-notice').element().textContent).toBe('');
	});

	it('ignores transcript fragments — they belong to S10, and must not disturb the panel', async () => {
		const screen = render(Page, pageProps);
		emit({ type: 'transcript', direction: 'out', text: 'The fire holds your answer.' });
		await expect
			.element(screen.getByTestId('eclipse-medallion'))
			.toHaveAttribute('data-voice-state', 'asleep');
		expect(screen.getByTestId('answer').element().textContent?.trim()).toBe('');
		expect(screen.getByTestId('voice-notice').element().textContent).toBe('');
	});

	it('unsubscribes and sleeps the session when the page unmounts — the mic never outlives the UI', async () => {
		const screen = render(Page, pageProps);
		await expect.element(screen.getByTestId('eclipse-medallion')).toBeInTheDocument();
		expect(voiceMock.listeners.size).toBe(1);
		screen.unmount();
		expect(voiceMock.listeners.size).toBe(0);
		expect(voiceMock.sleep).toHaveBeenCalled();
	});
});

describe('Save the Sun page — wake invitation (S6)', () => {
	const VIEW_KEY = 'save-the-sun:view';

	function wakeSucceeds() {
		voiceMock.wake.mockImplementation(async () => {
			voiceMock.state = 'thinking';
			emit({ type: 'thinking' });
		});
	}

	it('first tap carries the invitation; the next wake resumes silent', async () => {
		wakeSucceeds();
		const screen = render(Page, pageProps);
		const medallion = screen.getByTestId('eclipse-medallion');
		await medallion.click();
		expect(voiceMock.wake).toHaveBeenCalledExactlyOnceWith({ invitation: true });
		// Delivery persists with the round's view, so a reload also resumes silent.
		await vi.waitFor(() => {
			expect(JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}').voiceInvited).toBe(true);
		});
		await medallion.click(); // sleeps
		voiceMock.state = 'asleep';
		emit({ type: 'asleep' });
		await medallion.click();
		expect(voiceMock.wake).toHaveBeenLastCalledWith({ invitation: false });
	});

	it('a reload mid-round resumes silent — the invitation rides the saved view', async () => {
		localStorage.setItem(
			VIEW_KEY,
			JSON.stringify({ roundId: 'test-round', crossings: [], answer: '', voiceInvited: true })
		);
		wakeSucceeds();
		const screen = render(Page, pageProps);
		await screen.getByTestId('eclipse-medallion').click();
		expect(voiceMock.wake).toHaveBeenCalledExactlyOnceWith({ invitation: false });
	});

	it('a failed first wake re-invites on the retry', async () => {
		voiceMock.wake.mockImplementation(async () => {
			emit({
				type: 'error',
				reason: 'token',
				notice: 'The fire does not carry your voice tonight. The rite continues by hand.'
			});
			emit({ type: 'asleep' });
		});
		const screen = render(Page, pageProps);
		await screen.getByTestId('eclipse-medallion').click();
		await screen.getByTestId('eclipse-medallion').click();
		expect(voiceMock.wake).toHaveBeenCalledTimes(2);
		expect(voiceMock.wake).toHaveBeenLastCalledWith({ invitation: true });
	});

	it('an eclipsed first wake never marks the invitation delivered', async () => {
		voiceMock.wake.mockImplementation(async () => {
			voiceMock.state = 'eclipsed';
			emit({
				type: 'error',
				reason: 'mic-permission',
				notice: 'The fire cannot hear you. The rite continues by hand.'
			});
			emit({ type: 'eclipsed' });
		});
		const screen = render(Page, pageProps);
		await screen.getByTestId('eclipse-medallion').click();
		expect(voiceMock.wake).toHaveBeenCalledExactlyOnceWith({ invitation: true });
		await vi.waitFor(() => {
			expect(JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}').voiceInvited).toBe(false);
		});
	});

	it('a new game during an in-flight wake cancels it and never marks the fresh round invited', async () => {
		let settleWake!: () => void;
		voiceMock.wake.mockImplementation(() => {
			voiceMock.state = 'waking';
			emit({ type: 'waking' });
			return new Promise<void>((resolve) => {
				settleWake = resolve;
			});
		});
		voiceMock.sleep.mockImplementation(() => {
			voiceMock.state = 'asleep';
			emit({ type: 'asleep' });
		});
		vi.mocked(fetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url.includes('/api/new-game'))
				return new Response(
					JSON.stringify({ boardSeed: 99, roundId: 'next-round', state: HUMAN_TURN })
				);
			return new Response('{}');
		});
		const screen = render(Page, pageProps);
		const medallion = screen.getByTestId('eclipse-medallion');
		await medallion.click(); // wake hangs in the permission+token+connect stretch
		await screen.getByRole('button', { name: 'Begin another night' }).click();
		expect(voiceMock.sleep).toHaveBeenCalled(); // the old round's session never crosses over
		settleWake(); // the canceled wake settles asleep — delivery must not be marked
		await medallion.click();
		expect(voiceMock.wake).toHaveBeenLastCalledWith({ invitation: true });
		await vi.waitFor(() => {
			const saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}');
			expect(saved.roundId).toBe('next-round');
			expect(saved.voiceInvited).toBe(false);
		});
	});

	it('a new game re-arms the invitation', async () => {
		wakeSucceeds();
		vi.mocked(fetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url.includes('/api/new-game'))
				return new Response(
					JSON.stringify({ boardSeed: 99, roundId: 'next-round', state: HUMAN_TURN })
				);
			return new Response('{}');
		});
		const screen = render(Page, pageProps);
		const medallion = screen.getByTestId('eclipse-medallion');
		await medallion.click();
		expect(voiceMock.wake).toHaveBeenLastCalledWith({ invitation: true });
		await medallion.click(); // sleeps
		voiceMock.state = 'asleep';
		emit({ type: 'asleep' });
		await screen.getByRole('button', { name: 'Begin another night' }).click();
		await medallion.click();
		expect(voiceMock.wake).toHaveBeenLastCalledWith({ invitation: true });
	});
});

describe('Save the Sun page — engine tool calls (S7)', () => {
	// The page-registered executor, exactly as the session would invoke it.
	const executor = () =>
		voiceMock.setToolExecutor.mock.lastCall![0] as (call: {
			name: string;
			args: Record<string, unknown>;
		}) => Promise<string>;

	const actionBodies = () =>
		vi
			.mocked(fetch)
			.mock.calls.filter(([url]) => String(url) === '/api/action')
			.map(([, init]) => JSON.parse(String((init as RequestInit).body)));

	const askAnswer = 'Yes. Sól is reaching for a fire rune.';

	function mockAction(result: object) {
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input) === '/api/action') return new Response(JSON.stringify(result));
			return new Response('{}');
		});
	}

	it('registers the executor at mount and unregisters at unmount', async () => {
		const screen = render(Page, pageProps);
		expect(voiceMock.setToolExecutor).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
		screen.unmount();
		expect(voiceMock.setToolExecutor).toHaveBeenLastCalledWith(null);
	});

	it('a voiced ask dispatches the identical engine action as the typed Ask', async () => {
		mockAction({
			type: 'Ask',
			oracle: { ok: true, answer: askAnswer, turnConsumed: true },
			state: HUMAN_TURN
		});
		const screen = render(Page, pageProps);
		await screen.getByLabelText('Ask the Oracle').fill('is it a fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await vi.waitFor(() => expect(actionBodies()).toHaveLength(1));

		const outcome = await executor()({ name: 'ask', args: { question: 'is it a fire rune?' } });
		// The tool result is the same line the panel voices…
		expect(outcome).toBe(askAnswer);
		await expect.element(screen.getByTestId('answer')).toHaveTextContent(askAnswer);
		// …and the wire carried the same action both times: identical engine state by construction.
		const [typed, voiced] = actionBodies();
		expect(voiced).toEqual(typed);
		expect(voiced).toEqual({ type: 'Ask', player: 'Human', question: 'is it a fire rune?' });
	});

	it('a voiced cast dispatches the identical engine action as the board cast', async () => {
		mockAction({
			type: 'Cast',
			cast: { ok: true, won: false, turnConsumed: true },
			state: HUMAN_TURN
		});
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Cast the rune' }).click();
		await screen.getByRole('button', { name: /select sowilo as cast target/i }).click();
		await screen.getByRole('button', { name: 'Name it' }).click();
		await vi.waitFor(() => expect(actionBodies()).toHaveLength(1));

		// Spoken rune names arrive in whatever case the transcript carried. The cast is
		// destructive, so the voiced path runs through the S8 confirmation exchange first.
		const question = await executor()({ name: 'cast_rune', args: { rune: 'sowilo' } });
		expect(question).toBe(
			'Sowilo, staked on the longest day — a cast does not unwrite. Say it plain: shall I cast it?'
		);
		emit({ type: 'transcript', direction: 'in', text: 'cast it' });
		const outcome = await executor()({ name: 'cast_rune', args: { rune: 'sowilo' } });
		expect(outcome).toBe('Sowilo is not the one. The night holds.');
		const [board, voiced] = actionBodies();
		expect(voiced).toEqual(board);
		expect(voiced).toEqual({ type: 'Cast', player: 'Human', runeName: 'Sowilo' });
	});

	it('a voiced scry dispatches the identical engine action as the prompt button', async () => {
		const reactProps = {
			...pageProps,
			data: {
				...pageProps.data,
				pendingReaction: { echo: 'I scent a fire rune on her.', held: { Scry: true, Hex: true } }
			}
		};
		mockAction({
			type: 'React',
			outcome: { ok: true, choice: 'Scry', shareAnswer: true },
			skollReaction: { hexed: false, scried: { answer: askAnswer } },
			state: HUMAN_TURN
		});
		const screen = render(Page, reactProps);
		await screen.getByRole('button', { name: 'Scry' }).click();
		await vi.waitFor(() => expect(actionBodies()).toHaveLength(1));
		screen.unmount();

		// A fresh window for the voiced path — the first render's Scry already closed its own.
		render(Page, reactProps);
		const outcome = await executor()({ name: 'scry', args: {} });
		expect(outcome).toBe(
			`You lean into the dark and listen. His answer is yours too. ${askAnswer}`
		);
		const [button, voiced] = actionBodies();
		expect(voiced).toEqual(button);
		expect(voiced).toEqual({ type: 'React', player: 'Human', reaction: 'Scry' });
	});

	it('a voiced reaction with no hanging question dispatches nothing', async () => {
		render(Page, pageProps);
		const outcome = await executor()({ name: 'hex', args: {} });
		expect(outcome).toBe('Sköll asks nothing. There is no question to scry, hex, or pass.');
		expect(actionBodies()).toHaveLength(0);
	});

	it("a voiced ask during Sköll's move dispatches nothing", async () => {
		const skollTurn: GameState = {
			activePlayer: 'Sköll',
			status: 'active',
			winner: null,
			turns: 1
		};
		mockAction({ type: 'Advance', state: skollTurn });
		render(Page, { ...pageProps, data: { ...pageProps.data, state: skollTurn } });
		const outcome = await executor()({ name: 'ask', args: { question: 'is it gold?' } });
		expect(outcome).toBe('The wolf is moving. Hold.');
		// Only the mount-driven Advance reached the wire — never an Ask.
		expect(actionBodies().filter((body) => body.type === 'Ask')).toHaveLength(0);
	});

	it('a voiced move after the round resolves dispatches nothing', async () => {
		const won: GameState = { activePlayer: 'Human', status: 'won', winner: 'Human', turns: 6 };
		render(Page, { ...pageProps, data: { ...pageProps.data, state: won } });
		const outcome = await executor()({ name: 'cast_rune', args: { rune: 'Sowilo' } });
		expect(outcome).toBe('The longest day is decided. Begin another night to play again.');
		expect(actionBodies()).toHaveLength(0);
	});

	it('a voiced cast of a rune not on the board dispatches nothing', async () => {
		render(Page, pageProps);
		const outcome = await executor()({ name: 'cast_rune', args: { rune: 'Excalibur' } });
		expect(outcome).toBe('No rune named Excalibur lies on the board.');
		expect(actionBodies()).toHaveLength(0);
	});

	it('a voiced empty question dispatches nothing', async () => {
		render(Page, pageProps);
		const outcome = await executor()({ name: 'ask', args: {} });
		expect(outcome).toBe('Speak your question, witch.');
		expect(actionBodies()).toHaveLength(0);
	});

	it('an unknown tool rejects — the session answers the model with the error', async () => {
		render(Page, pageProps);
		await expect(executor()({ name: 'summon_wolf', args: {} })).rejects.toThrow(
			'unknown tool: summon_wolf'
		);
	});

	it('a typed answer is spoken at the fire — the session decides whether it can land', async () => {
		mockAction({
			type: 'Ask',
			oracle: { ok: true, answer: askAnswer, turnConsumed: true },
			state: HUMAN_TURN
		});
		voiceMock.state = 'listening';
		const screen = render(Page, pageProps);
		await screen.getByLabelText('Ask the Oracle').fill('is it a fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await vi.waitFor(() => expect(voiceMock.direct).toHaveBeenCalledOnce());
		const direction = String(voiceMock.direct.mock.calls[0][0]);
		expect(direction).toContain('Stage direction');
		expect(direction).toContain(askAnswer);
	});

	it('a voiced ask is never re-spoken — the tool result already carries the line', async () => {
		mockAction({
			type: 'Ask',
			oracle: { ok: true, answer: askAnswer, turnConsumed: true },
			state: HUMAN_TURN
		});
		voiceMock.state = 'listening';
		render(Page, pageProps);
		await executor()({ name: 'ask', args: { question: 'is it a fire rune?' } });
		expect(voiceMock.direct).not.toHaveBeenCalled();
	});

	it("a typed Ask that Sköll hexes is not spoken — his Hex closed the Oracle's lips", async () => {
		mockAction({ type: 'Ask', skollVsYou: { reaction: 'Hex' }, state: HUMAN_TURN });
		voiceMock.state = 'listening';
		const screen = render(Page, pageProps);
		await screen.getByLabelText('Ask the Oracle').fill('is it a fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent("Sköll closes the Oracle's lips. Your question dies in the dark.");
		expect(voiceMock.direct).not.toHaveBeenCalled();
	});
});

describe('Save the Sun page — voiced tool guards (S7 review fixes)', () => {
	const executor = () =>
		voiceMock.setToolExecutor.mock.lastCall![0] as (call: {
			name: string;
			args: Record<string, unknown>;
		}) => Promise<string>;

	const actionBodies = () =>
		vi
			.mocked(fetch)
			.mock.calls.filter(([url]) => String(url) === '/api/action')
			.map(([, init]) => JSON.parse(String((init as RequestInit).body)));

	it('an inherited object key is not a tool — model names only match own reactions', async () => {
		// With the window open, `in`-based matching would have routed toString into a React
		// dispatch carrying a function as the reaction.
		render(Page, {
			...pageProps,
			data: {
				...pageProps.data,
				pendingReaction: { echo: 'I scent a fire rune on her.', held: { Scry: true, Hex: true } }
			}
		});
		await expect(executor()({ name: 'toString', args: {} })).rejects.toThrow(
			'unknown tool: toString'
		);
		expect(actionBodies()).toHaveLength(0);
	});

	it('a voiced ask holds the board lock until the wolf settles', async () => {
		const skollTurn: GameState = {
			activePlayer: 'Sköll',
			status: 'active',
			winner: null,
			turns: 1
		};
		let settleAdvance!: (response: Response) => void;
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			if (String(input) !== '/api/action') return new Response('{}');
			const body = JSON.parse(String((init as RequestInit | undefined)?.body));
			if (body.type === 'Ask')
				return new Response(
					JSON.stringify({
						type: 'Ask',
						oracle: {
							ok: true,
							answer: 'Yes. Sól is reaching for a fire rune.',
							turnConsumed: true
						},
						state: skollTurn
					})
				);
			return new Promise<Response>((resolve) => {
				settleAdvance = resolve;
			});
		});
		const screen = render(Page, pageProps);
		const outcome = await executor()({ name: 'ask', args: { question: 'is it a fire rune?' } });
		// The tool result returned promptly, but his move is still in flight — the board stays
		// locked so a "Begin another night" can't interleave a reset under the Advance.
		expect(outcome).toBe('Yes. Sól is reaching for a fire rune.');
		const newNight = screen.getByRole('button', { name: 'Begin another night' });
		await expect.element(newNight).toBeDisabled();
		settleAdvance(new Response(JSON.stringify({ type: 'Advance', state: HUMAN_TURN })));
		await expect.element(newNight).toBeEnabled();
	});

	it('voice tools cannot dispatch while a typed Ask is pending', async () => {
		let settleAsk!: (response: Response) => void;
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input) !== '/api/action') return new Response('{}');
			return new Promise<Response>((resolve) => {
				settleAsk = resolve;
			});
		});
		const screen = render(Page, pageProps);
		const input = screen.getByLabelText('Ask the Oracle').element() as HTMLInputElement;
		input.value = 'is it a fire rune?';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		(screen.getByRole('button', { name: 'Ask the Oracle' }).element() as HTMLButtonElement).click();
		await vi.waitFor(() => expect(actionBodies()).toHaveLength(1));

		const outcome = await executor()({ name: 'cast_rune', args: { rune: 'Sowilo' } });
		expect(outcome).toBe(RITE_MOVING);
		expect(actionBodies()).toEqual([
			{ type: 'Ask', player: 'Human', question: 'is it a fire rune?' }
		]);

		settleAsk(
			new Response(
				JSON.stringify({
					type: 'Ask',
					oracle: {
						ok: true,
						answer: 'Yes. Sól is reaching for a fire rune.',
						turnConsumed: true
					},
					state: HUMAN_TURN
				})
			)
		);
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('Yes. Sól is reaching for a fire rune.');
	});

	it('a second model tool call in the same batch gets the pending guard, not a second action', async () => {
		let settleAsk!: (response: Response) => void;
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input) !== '/api/action') return new Response('{}');
			return new Promise<Response>((resolve) => {
				settleAsk = resolve;
			});
		});
		render(Page, pageProps);
		const first = executor()({ name: 'ask', args: { question: 'is it a fire rune?' } });
		await vi.waitFor(() => expect(actionBodies()).toHaveLength(1));

		const second = await executor()({ name: 'cast_rune', args: { rune: 'Sowilo' } });
		expect(second).toBe(RITE_MOVING);
		expect(actionBodies()).toEqual([
			{ type: 'Ask', player: 'Human', question: 'is it a fire rune?' }
		]);

		settleAsk(
			new Response(
				JSON.stringify({
					type: 'Ask',
					oracle: {
						ok: true,
						answer: 'Yes. Sól is reaching for a fire rune.',
						turnConsumed: true
					},
					state: HUMAN_TURN
				})
			)
		);
		await expect(first).resolves.toBe('Yes. Sól is reaching for a fire rune.');
	});
});

describe('Save the Sun page — destructive confirmation gate (S8)', () => {
	const executor = () =>
		voiceMock.setToolExecutor.mock.lastCall![0] as (call: {
			name: string;
			args: Record<string, unknown>;
		}) => Promise<string>;

	const actionBodies = () =>
		vi
			.mocked(fetch)
			.mock.calls.filter(([url]) => String(url) === '/api/action')
			.map(([, init]) => JSON.parse(String((init as RequestInit).body)));

	function mockAction(result: object) {
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input) === '/api/action') return new Response(JSON.stringify(result));
			return new Response('{}');
		});
	}

	const CONFIRM_HEX =
		'His question dies unanswered and the hex is spent. Say it plain: shall I hex him?';
	const confirmCast = (name: string) =>
		`${name}, staked on the longest day — a cast does not unwrite. Say it plain: shall I cast it?`;
	// The player's reply since arming — the only thing that opens the gate.
	const playerSpeaks = () => emit({ type: 'transcript', direction: 'in', text: 'yes, do it' });

	const reactProps = {
		...pageProps,
		data: {
			...pageProps.data,
			pendingReaction: { echo: 'I scent a fire rune on her.', held: { Scry: true, Hex: true } }
		}
	};

	it('a voiced hex arms the gate — the confirmation question returns and nothing dispatches', async () => {
		render(Page, reactProps);
		const outcome = await executor()({ name: 'hex', args: {} });
		expect(outcome).toBe(CONFIRM_HEX);
		expect(actionBodies()).toHaveLength(0);
	});

	it('a heard affirmation executes the armed hex — the identical engine action as the button', async () => {
		mockAction({
			type: 'React',
			outcome: { ok: true, choice: 'Hex' },
			skollReaction: { hexed: true },
			state: HUMAN_TURN
		});
		const screen = render(Page, reactProps);
		await screen.getByRole('button', { name: 'Hex' }).click();
		await vi.waitFor(() => expect(actionBodies()).toHaveLength(1));
		screen.unmount();

		// A fresh window for the voiced path — the button Hex already closed its own.
		render(Page, reactProps);
		await executor()({ name: 'hex', args: {} });
		playerSpeaks();
		const outcome = await executor()({ name: 'hex', args: {} });
		expect(outcome).toBe(
			"You close the Oracle's lips. His question dies unanswered — his turn with it."
		);
		const [button, voiced] = actionBodies();
		expect(voiced).toEqual(button);
		expect(voiced).toEqual({ type: 'React', player: 'Human', reaction: 'Hex' });
	});

	it('a repeated call with no player speech between re-asks — the model cannot confirm itself', async () => {
		render(Page, reactProps);
		await executor()({ name: 'hex', args: {} });
		const outcome = await executor()({ name: 'hex', args: {} });
		expect(outcome).toBe(CONFIRM_HEX);
		expect(actionBodies()).toHaveLength(0);
	});

	it("the Oracle's own voiced question never opens the gate — only the player's speech counts", async () => {
		// Drop the direction check and the model self-confirms through its own out-transcript:
		// call → her speech → call. That is the exact R4 bypass the gate exists to stop.
		render(Page, reactProps);
		await executor()({ name: 'hex', args: {} });
		emit({ type: 'transcript', direction: 'out', text: CONFIRM_HEX });
		const outcome = await executor()({ name: 'hex', args: {} });
		expect(outcome).toBe(CONFIRM_HEX);
		expect(actionBodies()).toHaveLength(0);
	});

	it('the real exchange — question voiced, player affirms, the call lands — executes', async () => {
		// The production sequence has exactly one Oracle turn between arming and confirming;
		// an off-by-one in the decline counter would re-ask forever and pass every other test.
		mockAction({
			type: 'React',
			outcome: { ok: true, choice: 'Hex' },
			skollReaction: { hexed: true },
			state: HUMAN_TURN
		});
		render(Page, reactProps);
		await executor()({ name: 'hex', args: {} });
		emit({ type: 'speaking' }); // she voices the confirmation question
		emit({ type: 'listening' });
		playerSpeaks();
		const outcome = await executor()({ name: 'hex', args: {} });
		expect(outcome).toBe(
			"You close the Oracle's lips. His question dies unanswered — his turn with it."
		);
		expect(actionBodies()).toEqual([{ type: 'React', player: 'Human', reaction: 'Hex' }]);
	});

	it('a session error clears the armed gate — no stale execution after a reconnect', async () => {
		render(Page, reactProps);
		await executor()({ name: 'hex', args: {} });
		playerSpeaks();
		emit({
			type: 'error',
			reason: 'socket',
			notice: "The Oracle's voice falters. The rite continues by hand."
		});
		const outcome = await executor()({ name: 'hex', args: {} });
		expect(outcome).toBe(CONFIRM_HEX);
		expect(actionBodies()).toHaveLength(0);
	});

	it('a guard line between arm and confirm kills the exchange — no stale affirmation', async () => {
		// Armed for Sowilo, affirmed, but the next call misnames the rune (guard, no gate
		// consult): the affirmation must die with it, or a later Sowilo call would execute
		// against a reply the player gave to a different question.
		render(Page, pageProps);
		await executor()({ name: 'cast_rune', args: { rune: 'Sowilo' } });
		playerSpeaks();
		expect(await executor()({ name: 'cast_rune', args: { rune: 'Excalibur' } })).toBe(
			'No rune named Excalibur lies on the board.'
		);
		const outcome = await executor()({ name: 'cast_rune', args: { rune: 'Sowilo' } });
		expect(outcome).toBe(confirmCast('Sowilo')); // re-asked from scratch
		expect(actionBodies()).toHaveLength(0);
	});

	it('a confirmed cast executes; the confirmation is per rune', async () => {
		mockAction({
			type: 'Cast',
			cast: { ok: true, won: false, turnConsumed: true },
			state: HUMAN_TURN
		});
		render(Page, pageProps);
		expect(await executor()({ name: 'cast_rune', args: { rune: 'Sowilo' } })).toBe(
			confirmCast('Sowilo')
		);
		playerSpeaks();
		// The affirmation names a DIFFERENT rune: never executes — re-arms for the new target.
		expect(await executor()({ name: 'cast_rune', args: { rune: 'Algiz' } })).toBe(
			confirmCast('Algiz')
		);
		expect(actionBodies()).toHaveLength(0);
		playerSpeaks();
		expect(await executor()({ name: 'cast_rune', args: { rune: 'Algiz' } })).toBe(
			'Algiz is not the one. The night holds.'
		);
		expect(actionBodies()).toEqual([{ type: 'Cast', player: 'Human', runeName: 'Algiz' }]);
	});

	it('a second Oracle turn without the call disarms — a decline never executes', async () => {
		render(Page, reactProps);
		await executor()({ name: 'hex', args: {} });
		playerSpeaks();
		// Her first turn since arming is the confirmation question itself…
		emit({ type: 'speaking' });
		emit({ type: 'listening' });
		// …her second means the player declined and she acknowledged: the exchange is over.
		emit({ type: 'speaking' });
		const outcome = await executor()({ name: 'hex', args: {} });
		expect(outcome).toBe(CONFIRM_HEX); // re-asked, not executed
		expect(actionBodies()).toHaveLength(0);
	});

	it('sleep clears the armed gate — silence through the timeout never executes', async () => {
		// The R7 silence timeout is a full sleep, so this is also the decline-by-silence path.
		render(Page, reactProps);
		await executor()({ name: 'hex', args: {} });
		playerSpeaks();
		emit({ type: 'asleep' });
		const outcome = await executor()({ name: 'hex', args: {} });
		expect(outcome).toBe(CONFIRM_HEX);
		expect(actionBodies()).toHaveLength(0);
	});

	it('a different tool call kills the exchange — the reply went elsewhere', async () => {
		render(Page, reactProps);
		await executor()({ name: 'hex', args: {} });
		playerSpeaks();
		// An ask during his hanging question only earns the guard line, yet it still proves the
		// player's reply was not the affirmation.
		await executor()({ name: 'ask', args: { question: 'is it gold?' } });
		const outcome = await executor()({ name: 'hex', args: {} });
		expect(outcome).toBe(CONFIRM_HEX);
		expect(actionBodies()).toHaveLength(0);
	});

	it('a board move kills the exchange — any engine action supersedes the pending confirmation', async () => {
		mockAction({
			type: 'Ask',
			oracle: { ok: true, answer: 'Yes. Sól is reaching for a fire rune.', turnConsumed: true },
			state: HUMAN_TURN
		});
		const screen = render(Page, pageProps);
		expect(await executor()({ name: 'cast_rune', args: { rune: 'Sowilo' } })).toBe(
			confirmCast('Sowilo')
		);
		playerSpeaks();
		await screen.getByLabelText('Ask the Oracle').fill('is it a fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await vi.waitFor(() =>
			expect(actionBodies().filter((body) => body.type === 'Ask')).toHaveLength(1)
		);
		const outcome = await executor()({ name: 'cast_rune', args: { rune: 'Sowilo' } });
		expect(outcome).toBe(confirmCast('Sowilo')); // re-asked from scratch
		expect(actionBodies().filter((body) => body.type === 'Cast')).toHaveLength(0);
	});

	it('arming the gate never blocks the other tools — a scry still executes in the same window', async () => {
		mockAction({
			type: 'React',
			outcome: { ok: true, choice: 'Scry', shareAnswer: true },
			skollReaction: { hexed: false, scried: { answer: 'Yes. Sól is reaching for a fire rune.' } },
			state: HUMAN_TURN
		});
		render(Page, reactProps);
		await executor()({ name: 'hex', args: {} });
		const outcome = await executor()({ name: 'scry', args: {} });
		expect(outcome).toBe(
			'You lean into the dark and listen. His answer is yours too. Yes. Sól is reaching for a fire rune.'
		);
		expect(actionBodies()).toEqual([{ type: 'React', player: 'Human', reaction: 'Scry' }]);
	});
});
