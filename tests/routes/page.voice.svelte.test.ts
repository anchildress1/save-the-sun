import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Page from '$routes/+page.svelte';
import type { GameState } from '$lib/server/engine/actions';
import { HUMAN_TURN, SKOLL_TURN, HUMAN_WON, ASK_ANSWER, props } from '../helpers/gameFixtures';

// Push-to-talk + delivery, mocked at the module boundary: these tests assert the page wires the
// recorder, the transcribe route, and the delivery seam — not that a real mic or AudioContext opens.

const deliveryMock = vi.hoisted(() => {
	const listeners = new Set<(event: unknown) => void>();
	return {
		listeners,
		enableDelivery: vi.fn(),
		disableDelivery: vi.fn(),
		stopDelivery: vi.fn(),
		deliver: vi.fn<(descriptor: { kind: string }) => Promise<void>>(async () => {}),
		whenDrained: vi.fn(async () => {}),
		subscribeDelivery(listener: (event: unknown) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		emit(event: unknown) {
			for (const listener of listeners) listener(event);
		}
	};
});
vi.mock('$lib/voice/delivery', () => deliveryMock);

const recorderMock = vi.hoisted(() => ({
	startRecording: vi.fn(async () => ({ ok: true }) as { ok: boolean; reason?: string }),
	stopRecording: vi.fn(async () => ({ wavBase64: 'WAV' }) as { wavBase64: string } | null),
	releaseRecorder: vi.fn(),
	recorderSealed: vi.fn<() => string | null>(() => null),
	closeRecorder: vi.fn()
}));
vi.mock('$lib/voice/recorder', () => recorderMock);

type DeliveryEvent = { type: 'speaking'; voice: 'oracle' | 'skoll' } | { type: 'idle' };
const emitDelivery = (event: DeliveryEvent) => deliveryMock.emit(event);

const pageProps = props(HUMAN_TURN);

// Default fetch: transcribe returns a question, an Ask answers, everything else is empty.
function mockFetch(transcript = 'is it a fire rune') {
	vi.mocked(fetch).mockImplementation(async (input, init) => {
		const url = String(input);
		if (url === '/api/voice/transcribe') return new Response(JSON.stringify({ text: transcript }));
		if (url === '/api/action') {
			const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
			if (body.type === 'Advance') {
				return new Response(JSON.stringify({ type: 'Advance', state: HUMAN_TURN }));
			}
			return new Response(
				JSON.stringify({
					type: 'Ask',
					oracle: {
						ok: true,
						query: { axis: 'element', value: 'Fire' },
						answer: ASK_ANSWER,
						affirmative: false,
						turnConsumed: true
					},
					skollVsYou: { reaction: 'Pass' },
					state: HUMAN_TURN
				})
			);
		}
		return new Response('{}');
	});
}

const medallion = (screen: ReturnType<typeof render>) => screen.getByTestId('eclipse-medallion');
const press = (screen: ReturnType<typeof render>) =>
	medallion(screen)
		.element()
		.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
const release = (screen: ReturnType<typeof render>) =>
	medallion(screen)
		.element()
		.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
// Page-wide push-to-talk is the backtick (`) — Space is reserved for activating the focused control.
const holdPtt = () =>
	window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backquote', bubbles: true }));
const releasePtt = () =>
	window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Backquote', bubbles: true }));

// The browser context runs reducedMotion:'reduce' (vite.config.ts), so by default audio is muted
// (PRD R9). The auto-prime-on-first-gesture path is a non-reduced-motion behavior, so the tests that
// exercise it stub matchMedia to report motion allowed. RuneGrid reads the same query for its GSAP
// entrance; flipping it just lets that animation run (cleared via clearProps), which these tests
// don't assert on.
const allowMotion = () =>
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false
	}));

const actionBodies = () =>
	vi
		.mocked(fetch)
		.mock.calls.filter(([url]) => String(url) === '/api/action')
		.map(([, init]) => JSON.parse(String((init as RequestInit)?.body ?? '{}')));

beforeEach(() => {
	vi.resetAllMocks();
	deliveryMock.listeners.clear();
	recorderMock.startRecording.mockResolvedValue({ ok: true });
	recorderMock.stopRecording.mockResolvedValue({ wavBase64: 'WAV' });
	recorderMock.recorderSealed.mockReturnValue(null);
	sessionStorage.clear();
	localStorage.setItem('save-the-sun:onboarded', '1');
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response('{}'))
	);
	mockFetch();
});

afterEach(() => {
	vi.unstubAllGlobals();
	localStorage.clear();
});

describe('Save the Sun page — push-to-talk medallion', () => {
	it('opens with the medallion idle at the top of the Oracle panel', async () => {
		const screen = render(Page, pageProps);
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'idle');
		const panel = screen.container.querySelector('.oracle-panel')!;
		const order = [...panel.querySelectorAll('[data-testid]')].map(
			(el) => (el as HTMLElement).dataset.testid
		);
		expect(order.indexOf('eclipse-medallion')).toBeLessThan(order.indexOf('turn-pill'));
	});

	it('holds to record and shows recording, then transcribes and asks on release', async () => {
		const screen = render(Page, pageProps);
		press(screen);
		expect(recorderMock.startRecording).toHaveBeenCalledOnce();
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'recording');

		release(screen);
		await vi.waitFor(() =>
			expect(fetch).toHaveBeenCalledWith(
				'/api/voice/transcribe',
				expect.objectContaining({ method: 'POST' })
			)
		);
		await vi.waitFor(() =>
			expect(actionBodies()).toContainEqual(
				expect.objectContaining({ type: 'Ask', question: 'is it a fire rune' })
			)
		);
		await expect.element(screen.getByTestId('answer')).toHaveTextContent(ASK_ANSWER);
		// The spoken words go to the engine, never into the typing box.
		expect(screen.container.querySelector<HTMLInputElement>('#oracle-ask')!.value).toBe('');
	});

	it('honors a release that happens before mic setup finishes', async () => {
		let finishSetup: (value: { ok: true }) => void = () => {};
		recorderMock.startRecording.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishSetup = resolve;
				})
		);
		const screen = render(Page, pageProps);

		press(screen);
		release(screen);
		expect(recorderMock.stopRecording).not.toHaveBeenCalled();

		finishSetup({ ok: true });
		await vi.waitFor(() => expect(recorderMock.stopRecording).toHaveBeenCalledOnce());
		await vi.waitFor(() =>
			expect(actionBodies()).toContainEqual(
				expect.objectContaining({ type: 'Ask', question: 'is it a fire rune' })
			)
		);
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'idle');
	});

	it('hold the backtick anywhere records; release asks — the same path as a tap', async () => {
		const screen = render(Page, pageProps);
		holdPtt();
		expect(recorderMock.startRecording).toHaveBeenCalledOnce();
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'recording');
		releasePtt();
		await vi.waitFor(() => expect(actionBodies()).toHaveLength(1));
	});

	it('ignores the backtick while the onboarding modal is open', async () => {
		localStorage.removeItem('save-the-sun:onboarded'); // first run → the title/tour modal shows
		const screen = render(Page, pageProps);
		await expect.element(screen.getByTestId('onboarding')).toBeInTheDocument();
		holdPtt();
		expect(recorderMock.startRecording).not.toHaveBeenCalled();
	});

	it('backtick records even from inside the Ask field — push-to-talk works while typing', async () => {
		const screen = render(Page, pageProps);
		screen.container.querySelector<HTMLInputElement>('#oracle-ask')!.focus();
		holdPtt();
		expect(recorderMock.startRecording).toHaveBeenCalledOnce();
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'recording');
		releasePtt();
	});

	it('the backtick records even when a button has focus — Space could not (it activates the button)', async () => {
		mockFetch(''); // empty transcript keeps this about the key, not a dispatched Ask
		const screen = render(Page, pageProps);
		// A focused control would swallow Space; the page-wide backtick must still start a hold.
		screen.getByRole('button', { name: 'Cast the rune' }).element().focus();
		holdPtt();
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'recording');
		releasePtt();
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'idle');
		expect(recorderMock.startRecording).toHaveBeenCalled();
	});

	it('an empty transcript spends no turn and settles back to idle', async () => {
		mockFetch(''); // nothing intelligible
		const screen = render(Page, pageProps);
		press(screen);
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'recording');
		release(screen);
		await vi.waitFor(() =>
			expect(fetch).toHaveBeenCalledWith('/api/voice/transcribe', expect.anything())
		);
		expect(actionBodies()).toHaveLength(0); // no Ask dispatched
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'idle');
	});

	it('treats a failed transcribe (non-ok) as nothing heard — no Ask, settles idle', async () => {
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input) === '/api/voice/transcribe') return new Response('boom', { status: 500 });
			return new Response('{}');
		});
		const screen = render(Page, pageProps);
		press(screen);
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'recording');
		release(screen);
		await vi.waitFor(() =>
			expect(fetch).toHaveBeenCalledWith('/api/voice/transcribe', expect.anything())
		);
		expect(actionBodies()).toHaveLength(0);
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'idle');
	});

	it('treats an unparseable transcribe body as nothing heard', async () => {
		vi.mocked(fetch).mockImplementation(async (input) => {
			// 200 OK, but the body throws on .json() — the read must degrade, not surface garbage.
			if (String(input) === '/api/voice/transcribe') return new Response('<<not json>>');
			return new Response('{}');
		});
		const screen = render(Page, pageProps);
		press(screen);
		release(screen);
		await vi.waitFor(() =>
			expect(fetch).toHaveBeenCalledWith('/api/voice/transcribe', expect.anything())
		);
		expect(actionBodies()).toHaveLength(0);
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'idle');
	});

	it('treats a transcribe response with neither text nor rune as an empty ask', async () => {
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input) === '/api/voice/transcribe') return new Response('{}'); // ok JSON, no fields
			return new Response('{}');
		});
		const screen = render(Page, pageProps);
		press(screen);
		release(screen);
		await vi.waitFor(() =>
			expect(fetch).toHaveBeenCalledWith('/api/voice/transcribe', expect.anything())
		);
		expect(actionBodies()).toHaveLength(0);
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'idle');
	});

	it('seals the medallion when the mic is denied — one notice, button game untouched', async () => {
		recorderMock.startRecording.mockResolvedValueOnce({ ok: false, reason: 'denied' });
		const screen = render(Page, pageProps);
		press(screen);
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'denied');
		await expect
			.element(screen.getByTestId('voice-notice'))
			.toHaveTextContent('The fire cannot hear you. The rite continues by hand.');
		const input = screen.container.querySelector<HTMLInputElement>('#oracle-ask')!;
		expect(input.disabled).toBe(false);
	});

	it('a transient mic failure returns to idle with a retry notice — not sealed', async () => {
		recorderMock.startRecording.mockResolvedValueOnce({ ok: false, reason: 'audio' });
		const screen = render(Page, pageProps);
		press(screen);
		// 'audio' is retryable: the medallion stays usable rather than dropping to the inert 'denied'.
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'idle');
		await expect
			.element(screen.getByTestId('voice-notice'))
			.toHaveTextContent('The fire flickered. Hold again to speak.');
	});

	it('ends a page-level backtick hold on keyup even after focus moves to a control', async () => {
		const screen = render(Page, pageProps);
		(document.activeElement as HTMLElement | null)?.blur();
		holdPtt(); // started from page chrome
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'recording');
		// Focus moves into the Ask field mid-hold; the release must still end the recording.
		screen.container.querySelector<HTMLInputElement>('#oracle-ask')!.focus();
		releasePtt();
		await vi.waitFor(() => expect(recorderMock.stopRecording).toHaveBeenCalled());
	});

	it('drops a stale clip when an intervening action moved the turn', async () => {
		// Hold the transcription open so an intervening typed Ask can land (and advance the turn) first.
		let finishTranscribe: (text: string) => void = () => {};
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			const url = String(input);
			if (url === '/api/voice/transcribe') {
				return new Promise<Response>((resolve) => {
					finishTranscribe = (text) => resolve(new Response(JSON.stringify({ text })));
				});
			}
			if (url === '/api/action') {
				const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
				if (body.type === 'Advance') {
					return new Response(JSON.stringify({ type: 'Advance', state: HUMAN_TURN }));
				}
				// A typed Ask consumes the turn — turns advances, making the in-flight spoken clip stale.
				return new Response(
					JSON.stringify({
						type: 'Ask',
						oracle: {
							ok: true,
							query: { axis: 'element', value: 'Fire' },
							answer: ASK_ANSWER,
							affirmative: false,
							turnConsumed: true
						},
						skollVsYou: { reaction: 'Pass' },
						state: { ...HUMAN_TURN, turns: 5 }
					})
				);
			}
			return new Response('{}');
		});
		const screen = render(Page, pageProps);
		press(screen);
		release(screen);
		await vi.waitFor(() => expect(recorderMock.stopRecording).toHaveBeenCalled());
		// A typed Ask lands first and advances the turn.
		await screen.getByLabelText('Ask the Oracle').fill('typed question?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		// Wait for the typed answer to render — proof its state (turns advanced) has been applied.
		await expect.element(screen.getByTestId('answer')).toHaveTextContent(ASK_ANSWER);
		// The spoken transcript returns stale — it must NOT be dispatched into the moved turn.
		finishTranscribe('stale spoken clip');
		await vi.waitFor(() => expect(medallion(screen)).toHaveAttribute('data-voice-state', 'idle'));
		expect(actionBodies().some((b) => b.type === 'Ask' && b.question === 'stale spoken clip')).toBe(
			false
		);
	});

	it('adopts an already-sealed mic at mount — a remount must not promise a hold', async () => {
		recorderMock.recorderSealed.mockReturnValue('denied');
		const screen = render(Page, pageProps);
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'denied');
		expect(recorderMock.startRecording).not.toHaveBeenCalled();
	});

	it('releases the recorder and delivery speaker on unmount', async () => {
		const screen = render(Page, pageProps);
		await expect.element(medallion(screen)).toBeInTheDocument();
		expect(deliveryMock.listeners.size).toBe(1);
		screen.unmount();
		expect(deliveryMock.listeners.size).toBe(0);
		expect(deliveryMock.disableDelivery).toHaveBeenCalled();
		expect(recorderMock.closeRecorder).toHaveBeenCalled();
	});
});

describe('Save the Sun page — cast by voice', () => {
	// Cast must be armed first (the deliberate safety step), then the rune named aloud. The server
	// constrains the match to the board names the client sends, so only a real rune commits.
	function mockCastFetch(rune: string) {
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			const url = String(input);
			const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
			if (url === '/api/voice/transcribe') {
				return new Response(JSON.stringify(body.mode === 'cast' ? { rune } : { text: '' }));
			}
			if (url === '/api/action') {
				if (body.type === 'Advance')
					return new Response(JSON.stringify({ type: 'Advance', state: HUMAN_TURN }));
				if (body.type === 'Cast')
					return new Response(
						JSON.stringify({ type: 'Cast', cast: { ok: true, won: true }, state: HUMAN_WON })
					);
			}
			return new Response('{}');
		});
	}

	it('casts hands-free when the rune is named without arming', async () => {
		// A normal hold (no Cast button first): the server resolves an explicit spoken cast to a board
		// rune and the page commits it.
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			const url = String(input);
			const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
			if (url === '/api/voice/transcribe') {
				return new Response(
					JSON.stringify(body.runes && !body.mode ? { rune: 'Sowilo' } : { text: '' })
				);
			}
			if (url === '/api/action') {
				if (body.type === 'Advance')
					return new Response(JSON.stringify({ type: 'Advance', state: HUMAN_TURN }));
				if (body.type === 'Cast')
					return new Response(
						JSON.stringify({ type: 'Cast', cast: { ok: true, won: true }, state: HUMAN_WON })
					);
			}
			return new Response('{}');
		});
		const screen = render(Page, pageProps);

		press(screen); // no arming — just hold and name the rune
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'recording');
		release(screen);

		await vi.waitFor(() => {
			const casts = actionBodies().filter((b) => b.type === 'Cast');
			expect(casts).toHaveLength(1);
			expect(casts[0].runeName).toBe('Sowilo');
		});
	});

	it('casts the named rune when a cast is armed and the rune is spoken', async () => {
		mockCastFetch('Sowilo');
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Cast the rune' }).click(); // arm

		press(screen);
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'recording');
		release(screen);

		await vi.waitFor(() => {
			const casts = actionBodies().filter((b) => b.type === 'Cast');
			expect(casts).toHaveLength(1);
			expect(casts[0].runeName).toBe('Sowilo');
		});
		// The hold sent the board's rune names for the server to match against.
		const sentCast = vi
			.mocked(fetch)
			.mock.calls.some(
				([url, init]) =>
					String(url) === '/api/voice/transcribe' &&
					JSON.parse(String((init as RequestInit)?.body ?? '{}')).mode === 'cast'
			);
		expect(sentCast).toBe(true);
	});

	it('drops an armed spoken cast if the player cancels before it resolves', async () => {
		let resolveCast: (r: Response) => void = () => {};
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			const url = String(input);
			const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
			if (url === '/api/voice/transcribe' && body.mode === 'cast') {
				return new Promise<Response>((resolve) => {
					resolveCast = resolve;
				});
			}
			return new Response('{}');
		});
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Cast the rune' }).click(); // arm

		press(screen);
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'recording');
		release(screen); // transcribe now in flight

		// The player backs out before the transcription returns — the irreversible cast must not land.
		await screen.getByRole('button', { name: 'Not yet' }).click();
		resolveCast(new Response(JSON.stringify({ rune: 'Sowilo' })));

		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'idle');
		expect(actionBodies().some((b) => b.type === 'Cast')).toBe(false);
	});

	it('drops an armed spoken cast after a cancel-then-re-arm before it resolves', async () => {
		// The boolean castMode is true again after a re-arm — only the arm generation tells the stale
		// utterance apart, so it must not commit the cast the player abandoned.
		let resolveCast: (r: Response) => void = () => {};
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			const url = String(input);
			const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
			if (url === '/api/voice/transcribe' && body.mode === 'cast') {
				return new Promise<Response>((resolve) => {
					resolveCast = resolve;
				});
			}
			return new Response('{}');
		});
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Cast the rune' }).click(); // arm

		press(screen);
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'recording');
		release(screen); // transcribe in flight

		await screen.getByRole('button', { name: 'Not yet' }).click(); // cancel
		await screen.getByRole('button', { name: 'Cast the rune' }).click(); // re-arm: castMode true again
		resolveCast(new Response(JSON.stringify({ rune: 'Sowilo' })));

		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'idle');
		expect(actionBodies().some((b) => b.type === 'Cast')).toBe(false);
	});

	it('refuses a cast the model could not match — no Cast dispatched, a notice instead', async () => {
		mockCastFetch(''); // unclear: matched no board rune
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Cast the rune' }).click();

		press(screen);
		release(screen);

		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'idle');
		expect(actionBodies().some((b) => b.type === 'Cast')).toBe(false);
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('Name a rune on the board to cast it');
	});

	it('treats a spoken cast with no rune field as off-board — commits nothing', async () => {
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
			if (String(input) === '/api/voice/transcribe')
				return new Response(body.mode === 'cast' ? '{}' : JSON.stringify({ text: '' }));
			return new Response('{}');
		});
		const screen = render(Page, pageProps);
		await screen.getByRole('button', { name: 'Cast the rune' }).click(); // arm cast mode

		press(screen);
		release(screen);

		await vi.waitFor(() =>
			expect(fetch).toHaveBeenCalledWith('/api/voice/transcribe', expect.anything())
		);
		expect(actionBodies().some((b) => b.type === 'Cast')).toBe(false);
	});
});

describe('Save the Sun page — delivery drives the medallion voice', () => {
	it('mirrors the speaking voice and settles to idle on drain', async () => {
		const screen = render(Page, pageProps);
		emitDelivery({ type: 'speaking', voice: 'oracle' });
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'speaking');
		emitDelivery({ type: 'speaking', voice: 'skoll' });
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'skoll-speaking');
		emitDelivery({ type: 'idle' });
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'idle');
	});
});

describe('Save the Sun page — audio output toggle', () => {
	it('is on by default; the speaker opens on the first gesture', async () => {
		allowMotion();
		const screen = render(Page, pageProps);
		await expect.element(screen.getByTestId('mute-toggle')).toHaveAttribute('aria-checked', 'true');
		// No gesture yet — the AudioContext is not opened until one arrives.
		expect(deliveryMock.enableDelivery).not.toHaveBeenCalled();
		window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
		await vi.waitFor(() => expect(deliveryMock.enableDelivery).toHaveBeenCalled());
	});

	it('defaults to muted under reduced motion — no auto-prime (PRD R9)', async () => {
		// The browser context is reducedMotion:'reduce', so this is the unstubbed default path.
		const screen = render(Page, pageProps);
		await expect
			.element(screen.getByTestId('mute-toggle'))
			.toHaveAttribute('aria-checked', 'false');
		window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
		// A reduced-motion session never auto-opens the speaker — audio stays muted until opted in.
		await expect
			.element(screen.getByTestId('mute-toggle'))
			.toHaveAttribute('aria-checked', 'false');
		expect(deliveryMock.enableDelivery).not.toHaveBeenCalled();
	});

	it('falls back to off when first-gesture speaker priming fails, then allows a toggle retry', async () => {
		allowMotion();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		deliveryMock.enableDelivery.mockImplementationOnce(() => {
			throw new Error('AudioContext blocked');
		});
		const screen = render(Page, pageProps);
		const toggle = screen.getByTestId('mute-toggle');

		try {
			window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
			await expect.element(toggle).toHaveAttribute('aria-checked', 'false');
			expect(errorSpy).toHaveBeenCalledWith(
				'[ui] could not open the delivery speaker:',
				expect.any(Error)
			);

			await toggle.click();
			expect(deliveryMock.enableDelivery).toHaveBeenCalledTimes(2);
			await expect.element(toggle).toHaveAttribute('aria-checked', 'true');
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('stays off when the session was muted, and the toggle mutes/unmutes', async () => {
		sessionStorage.setItem('save-the-sun:muted', 'true');
		const screen = render(Page, pageProps);
		const toggle = screen.getByTestId('mute-toggle');
		await expect.element(toggle).toHaveAttribute('aria-checked', 'false');

		await toggle.click(); // unmute → audio on
		expect(deliveryMock.enableDelivery).toHaveBeenCalled();
		await expect.element(toggle).toHaveAttribute('aria-checked', 'true');

		await toggle.click(); // mute → audio off
		expect(deliveryMock.disableDelivery).toHaveBeenCalled();
		await expect.element(toggle).toHaveAttribute('aria-checked', 'false');
	});
});

describe('Save the Sun page — game moves voiced via delivery', () => {
	it('waits for a real speaker before spending a resumed outcome voice', async () => {
		allowMotion();
		const screen = render(Page, {
			...pageProps,
			data: { ...pageProps.data, state: HUMAN_WON }
		});

		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-testid="end-screen"]')).not.toBeNull()
		);
		expect(deliveryMock.deliver).not.toHaveBeenCalled();

		window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
		// One punch beat — the win's triumphant coda (its lead is heard at the cast). The fixed verse
		// stays on-screen text, not a long read.
		await vi.waitFor(() =>
			expect(deliveryMock.deliver).toHaveBeenCalledWith({
				kind: 'outcome',
				result: 'win',
				beat: 'coda'
			})
		);
		// The verse is NOT voiced — it's already printed on the splash.
		expect(deliveryMock.deliver).not.toHaveBeenCalledWith({
			kind: 'outcome',
			result: 'win',
			beat: 'verse'
		});
	});

	it('queues a Sköll Ask resumed before the speaker opens, voicing it on the first gesture', async () => {
		allowMotion(); // audio defaults on
		const ASK_QUERY = { axis: 'element', value: 'Fire' };
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			if (String(input) !== '/api/action') return new Response('{}');
			const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
			if (body.type === 'Advance') {
				return new Response(
					JSON.stringify({
						type: 'Advance',
						skoll: { asks: { echo: 'I scent fire on her.', query: ASK_QUERY } },
						state: SKOLL_TURN
					})
				);
			}
			return new Response('{}');
		});
		// Resume on Sköll's turn: onMount re-drives his Advance before any gesture opens the speaker.
		const screen = render(Page, { ...pageProps, data: { ...pageProps.data, state: SKOLL_TURN } });
		await expect
			.element(screen.getByTestId('skoll-echo'))
			.toHaveTextContent('I scent fire on her.');
		// deliver() is a no-op until the speaker exists — the Ask is held, not spent.
		expect(deliveryMock.deliver).not.toHaveBeenCalled();

		window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
		await vi.waitFor(() =>
			expect(deliveryMock.deliver).toHaveBeenCalledWith({ kind: 'skoll-ask', query: ASK_QUERY })
		);
	});

	it('voices her answer through the delivery seam with her line descriptor', async () => {
		const screen = render(Page, pageProps);
		await screen.getByTestId('mute-toggle').click(); // audio on
		await screen.getByLabelText('Ask the Oracle').fill('is it a fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await vi.waitFor(() =>
			expect(deliveryMock.deliver).toHaveBeenCalledWith({
				kind: 'answer',
				query: { axis: 'element', value: 'Fire' },
				affirmative: false
			})
		);
	});

	it('voices her dramatized, store-backed line when the server authored one (ttd:17)', async () => {
		const FLAIR = 'Yes — the flame-sign burns; she reaches for fire.';
		const voiced = { kind: 'authored', id: 'vl-answer-1', voice: 'Gacrux', text: FLAIR };
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			if (String(input) !== '/api/action') return new Response('{}');
			const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
			if (body.type === 'Advance')
				return new Response(JSON.stringify({ type: 'Advance', state: HUMAN_TURN }));
			return new Response(
				JSON.stringify({
					type: 'Ask',
					oracle: {
						ok: true,
						query: { axis: 'element', value: 'Fire' },
						answer: ASK_ANSWER,
						affirmative: false,
						turnConsumed: true,
						voiced
					},
					skollVsYou: { reaction: 'Pass' },
					state: HUMAN_TURN
				})
			);
		});
		const screen = render(Page, pageProps);
		await screen.getByTestId('mute-toggle').click(); // audio on
		await screen.getByLabelText('Ask the Oracle').fill('is it a fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		// The panel shows exactly what she voices (R10) — the dramatized line, not the template.
		await expect.element(screen.getByTestId('answer')).toHaveTextContent(FLAIR);
		// And the authored descriptor (id-backed) is what rides the delivery seam to the TTS route.
		await vi.waitFor(() => expect(deliveryMock.deliver).toHaveBeenCalledWith(voiced));
	});

	it('voices the authored ending blessing on a win, not a fixed splash beat (ttd:22)', async () => {
		const ENDING = {
			kind: 'authored',
			id: 'vl-ending-1',
			voice: 'Gacrux',
			text: 'The dawn is kept; Sól climbs free.'
		};
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			if (String(input) !== '/api/action') return new Response('{}');
			const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
			if (body.type === 'Cast')
				return new Response(
					JSON.stringify({
						type: 'Cast',
						cast: { ok: true, won: true },
						state: HUMAN_WON,
						outcomeFlair: ENDING
					})
				);
			return new Response(JSON.stringify({ type: 'Advance', state: HUMAN_WON }));
		});
		const screen = render(Page, pageProps);
		await screen.getByTestId('mute-toggle').click(); // audio on + speaker open
		await screen.getByRole('button', { name: 'Cast the rune' }).click(); // arm
		await screen.getByRole('button', { name: /select sowilo as cast target/i }).click();
		await screen.getByRole('button', { name: 'Name it' }).click();
		// Her authored blessing voices on the end screen — the fixed `outcome` beat does not.
		await vi.waitFor(() => expect(deliveryMock.deliver).toHaveBeenCalledWith(ENDING));
		expect(deliveryMock.deliver).not.toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'outcome' })
		);
	});

	it("voices Sköll's Ask through the delivery seam when his Advance asks", async () => {
		const ASK_QUERY = { axis: 'element', value: 'Fire' };
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			if (String(input) !== '/api/action') return new Response('{}');
			const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
			if (body.type === 'Advance') {
				return new Response(
					JSON.stringify({
						type: 'Advance',
						skoll: { asks: { echo: 'I scent a fire rune on her.', query: ASK_QUERY } },
						state: SKOLL_TURN
					})
				);
			}
			return new Response(
				JSON.stringify({
					type: 'Ask',
					oracle: {
						ok: true,
						query: ASK_QUERY,
						answer: ASK_ANSWER,
						affirmative: false,
						turnConsumed: true
					},
					skollVsYou: { reaction: 'Pass' },
					state: SKOLL_TURN
				})
			);
		});
		const screen = render(Page, pageProps);
		await screen.getByTestId('mute-toggle').click(); // audio on
		await screen.getByLabelText('Ask the Oracle').fill('is it a fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await vi.waitFor(() =>
			expect(deliveryMock.deliver).toHaveBeenCalledWith({ kind: 'skoll-ask', query: ASK_QUERY })
		);
		await expect
			.element(screen.getByTestId('skoll-echo'))
			.toHaveTextContent('I scent a fire rune on her.');
	});

	it("voices Sköll's winning cast through the delivery seam when his Advance casts", async () => {
		const ASK_QUERY = { axis: 'element', value: 'Fire' };
		const ACTIVE_TURN: GameState = {
			activePlayer: 'Sköll',
			status: 'active',
			winner: null,
			turns: 1
		};
		const WON_TURN: GameState = { activePlayer: 'Sköll', status: 'won', winner: 'Sköll', turns: 2 };
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			if (String(input) !== '/api/action') return new Response('{}');
			const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
			if (body.type === 'Advance') {
				return new Response(
					JSON.stringify({
						type: 'Advance',
						skoll: { casts: { echo: 'I name it. Sowilo.', rune: 'Sowilo' } },
						state: WON_TURN
					})
				);
			}
			return new Response(
				JSON.stringify({
					type: 'Ask',
					oracle: {
						ok: true,
						query: ASK_QUERY,
						answer: ASK_ANSWER,
						affirmative: false,
						turnConsumed: true
					},
					skollVsYou: { reaction: 'Pass' },
					state: ACTIVE_TURN
				})
			);
		});
		const screen = render(Page, pageProps);
		await screen.getByTestId('mute-toggle').click(); // audio on
		await screen.getByLabelText('Ask the Oracle').fill('is it a fire rune?');
		await screen.getByRole('button', { name: 'Ask the Oracle' }).click();
		await vi.waitFor(() =>
			expect(deliveryMock.deliver).toHaveBeenCalledWith({ kind: 'skoll-cast', rune: 'Sowilo' })
		);
	});

	it('holds the end-screen for a winning cast resumed before the speaker, then plays it on first gesture', async () => {
		allowMotion(); // audio defaults on
		const WON_TURN: GameState = { activePlayer: 'Sköll', status: 'won', winner: 'Sköll', turns: 2 };
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			if (String(input) !== '/api/action') return new Response('{}');
			const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
			if (body.type === 'Advance') {
				return new Response(
					JSON.stringify({
						type: 'Advance',
						skoll: { casts: { echo: 'I name it. Sowilo.', rune: 'Sowilo' } },
						state: WON_TURN
					})
				);
			}
			return new Response('{}');
		});
		// Resume on Sköll's turn: onMount drives his Advance, which returns the winning cast, before any
		// gesture opens the speaker.
		const screen = render(Page, { ...pageProps, data: { ...pageProps.data, state: SKOLL_TURN } });
		await expect.element(screen.getByTestId('skoll-echo')).toHaveTextContent('I name it. Sowilo.');

		// The cast is held (deliver is a no-op without a speaker), and the splash is withheld too — the
		// queued line returns a real pending promise, so the end-screen hold can't fall through early.
		expect(deliveryMock.deliver).not.toHaveBeenCalled();
		expect(screen.container.querySelector('[data-testid="end-screen"]')).toBeNull();

		window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
		await vi.waitFor(() =>
			expect(deliveryMock.deliver).toHaveBeenCalledWith({ kind: 'skoll-cast', rune: 'Sowilo' })
		);
		// His line played and drained — the held splash is released.
		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-testid="end-screen"]')).not.toBeNull()
		);
	});
});

describe('Save the Sun page — spoken reaction to Sköll', () => {
	const reactionProps = (held = { Scry: true, Hex: true }) => ({
		...pageProps,
		data: { ...pageProps.data, pendingReaction: { echo: 'I scent fire on her.', held } }
	});

	// In reaction mode the transcribe route returns a classified choice; /api/action runs a React.
	function mockReaction(choice: string, skollReaction: object = {}) {
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			const url = String(input);
			if (url === '/api/voice/transcribe') {
				const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
				return new Response(JSON.stringify(body.mode === 'reaction' ? { choice } : { text: '' }));
			}
			if (url === '/api/action') {
				return new Response(JSON.stringify({ type: 'React', state: HUMAN_TURN, skollReaction }));
			}
			return new Response('{}');
		});
	}

	async function holdRelease(screen: ReturnType<typeof render>) {
		press(screen);
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'recording');
		release(screen);
	}

	it('classifies a held reply as a reaction (not an Ask) and dispatches it', async () => {
		mockReaction('hex', { hexed: true });
		const screen = render(Page, reactionProps());
		await holdRelease(screen);

		await vi.waitFor(() =>
			expect(actionBodies()).toContainEqual({ type: 'React', player: 'Human', reaction: 'Hex' })
		);
		// No Ask was dispatched — the hanging question got a reaction, not the unparseable refusal.
		expect(actionBodies().some((b) => b.type === 'Ask')).toBe(false);
		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent("You close the Oracle's lips; his turn dies with the question.");
	});

	it('an unclear reply asks again and spends nothing', async () => {
		mockReaction('unclear');
		const screen = render(Page, reactionProps());
		await holdRelease(screen);

		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('Scry, hex, or pass — or let his question stand.');
		expect(actionBodies()).toHaveLength(0); // no React, no Ask
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'idle');
	});

	it('treats a reaction reply with no choice field as unclear — asks again, spends nothing', async () => {
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input) === '/api/voice/transcribe') return new Response('{}'); // reaction mode, no choice
			return new Response('{}');
		});
		const screen = render(Page, reactionProps());
		await holdRelease(screen);

		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('Scry, hex, or pass — or let his question stand.');
		expect(actionBodies()).toHaveLength(0);
	});

	it('refuses a spoken scry whose charge is spent — never silently passes', async () => {
		mockReaction('scry');
		const screen = render(Page, reactionProps({ Scry: false, Hex: true }));
		await holdRelease(screen);

		await expect
			.element(screen.getByTestId('answer'))
			.toHaveTextContent('Your scrying is spent for the night.');
		expect(actionBodies()).toHaveLength(0);
	});

	it('a hold begun during the question never becomes an Ask if a button closes the window mid-hold', async () => {
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			const url = String(input);
			if (url === '/api/voice/transcribe') {
				const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
				// Ask-mode would surface a question (the misclassification bug); reaction-mode a choice.
				return new Response(
					JSON.stringify(body.mode === 'reaction' ? { choice: 'scry' } : { text: 'is it fire' })
				);
			}
			if (url === '/api/action') {
				const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
				if (body.type === 'React') {
					return new Response(
						JSON.stringify({ type: 'React', state: { ...HUMAN_TURN, turns: 1 }, skollReaction: {} })
					);
				}
				return new Response(
					JSON.stringify({
						type: 'Ask',
						oracle: {
							ok: true,
							query: { axis: 'element', value: 'Fire' },
							answer: ASK_ANSWER,
							affirmative: false,
							turnConsumed: true
						},
						skollVsYou: { reaction: 'Pass' },
						state: HUMAN_TURN
					})
				);
			}
			return new Response('{}');
		});
		const screen = render(Page, reactionProps());
		press(screen); // reaction intent fixed at the press — Sköll is asking
		await expect.element(medallion(screen)).toHaveAttribute('data-voice-state', 'recording');
		// A button answers (and closes) the question before the hold is released.
		await screen.getByRole('button', { name: 'Hex' }).click();
		await vi.waitFor(() =>
			expect(actionBodies()).toContainEqual({ type: 'React', player: 'Human', reaction: 'Hex' })
		);
		release(screen);
		await vi.waitFor(() => expect(medallion(screen)).toHaveAttribute('data-voice-state', 'idle'));
		// The held clip stays a (now-stale) reaction — it never lands an Ask in the moved turn.
		expect(actionBodies().some((b) => b.type === 'Ask')).toBe(false);
	});
});
