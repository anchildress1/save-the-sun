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
		wake: vi.fn(async () => {}),
		sleep: vi.fn(),
		emit(event: unknown) {
			for (const listener of listeners) listener(event);
		}
	};
});

vi.mock('$lib/voice/voiceSession', () => ({
	voiceSession: {
		wake: voiceMock.wake,
		sleep: voiceMock.sleep,
		get state() {
			return voiceMock.state;
		},
		subscribe(listener: (event: unknown) => void) {
			voiceMock.listeners.add(listener);
			return () => voiceMock.listeners.delete(listener);
		}
	}
}));

const emit = (event: VoiceEvent) => voiceMock.emit(event);

const HUMAN_TURN: GameState = { activePlayer: 'Human', status: 'active', winner: null, turns: 0 };
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
		{ event: { type: 'asleep' } as VoiceEvent, state: 'asleep' }
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
