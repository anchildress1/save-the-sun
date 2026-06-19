import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	claimMintSlot,
	resetMintWindows,
	SESSION_LIMIT,
	GLOBAL_LIMIT,
	claimTtsSlot,
	resetTtsWindows,
	TTS_SESSION_LIMIT,
	TTS_GLOBAL_LIMIT,
	resolveLimit
} from '$lib/server/voice/rateLimit';

const T0 = 1_000_000;
const WINDOW_MS = 60_000;

describe('resolveLimit', () => {
	it('takes a positive-integer env override', () => {
		expect(resolveLimit('25', 10)).toBe(25);
	});

	it('falls back when the value is missing, non-numeric, non-integer, or not positive', () => {
		expect(resolveLimit(undefined, 10)).toBe(10); // unset
		expect(resolveLimit('abc', 10)).toBe(10); // NaN
		expect(resolveLimit('3.5', 10)).toBe(10); // not an integer
		expect(resolveLimit('0', 10)).toBe(10); // not positive
		expect(resolveLimit('-4', 10)).toBe(10); // negative
	});
});

function drainSession(sessionId: string, now: number) {
	for (let i = 0; i < SESSION_LIMIT; i++) {
		expect(claimMintSlot(sessionId, now)).toEqual({ ok: true });
	}
}

describe('claimMintSlot', () => {
	beforeEach(() => {
		resetMintWindows();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('allows exactly SESSION_LIMIT claims per session within one window', () => {
		drainSession('witch', T0);
		expect(claimMintSlot('witch', T0)).toEqual({ ok: false, retryAfterSeconds: 60 });
	});

	it('reports the remaining window time on a session denial', () => {
		drainSession('witch', T0);
		expect(claimMintSlot('witch', T0 + 30_000)).toEqual({ ok: false, retryAfterSeconds: 30 });
	});

	it('rounds a sub-second remainder up to one second, never zero', () => {
		drainSession('witch', T0);
		expect(claimMintSlot('witch', T0 + 59_900)).toEqual({ ok: false, retryAfterSeconds: 1 });
	});

	it('limits sessions independently — one drained session does not starve another', () => {
		drainSession('witch', T0);
		expect(claimMintSlot('bystander', T0)).toEqual({ ok: true });
	});

	it('grants a fresh session allowance once its window expires', () => {
		drainSession('witch', T0);
		expect(claimMintSlot('witch', T0 + WINDOW_MS)).toEqual({ ok: true });
	});

	it('denials consume nothing — the fresh window still grants the full allowance', () => {
		drainSession('witch', T0);
		expect(claimMintSlot('witch', T0).ok).toBe(false);
		expect(claimMintSlot('witch', T0).ok).toBe(false);
		drainSession('witch', T0 + WINDOW_MS);
	});

	it('denies any session once the global window is exhausted', () => {
		const sessionsNeeded = GLOBAL_LIMIT / SESSION_LIMIT;
		for (let s = 0; s < sessionsNeeded; s++) drainSession(`session-${s}`, T0);
		expect(claimMintSlot('fresh-session', T0 + 15_000)).toEqual({
			ok: false,
			retryAfterSeconds: 45
		});
	});

	it('grants claims again once the global window expires', () => {
		const sessionsNeeded = GLOBAL_LIMIT / SESSION_LIMIT;
		for (let s = 0; s < sessionsNeeded; s++) drainSession(`session-${s}`, T0);
		expect(claimMintSlot('fresh-session', T0 + WINDOW_MS)).toEqual({ ok: true });
	});

	it('warns the operator once per window when the global ceiling trips, then again next window', () => {
		const exhaust = (at: number) => {
			for (let s = 0; s < GLOBAL_LIMIT / SESSION_LIMIT; s++) drainSession(`flood-${at}-${s}`, at);
			expect(claimMintSlot('victim', at).ok).toBe(false);
			expect(claimMintSlot('victim', at).ok).toBe(false);
		};

		exhaust(T0);
		// Two denials, one warning — denial volume must not become log volume.
		expect(console.warn).toHaveBeenCalledTimes(1);
		expect(vi.mocked(console.warn).mock.calls[0].join(' ')).toContain('global token-mint');

		// A fresh window re-arms the warning so a sustained flood stays visible.
		exhaust(T0 + WINDOW_MS);
		expect(console.warn).toHaveBeenCalledTimes(2);
	});

	it('stays silent on per-session denials — player noise is not an operator signal', () => {
		drainSession('witch', T0);
		expect(claimMintSlot('witch', T0).ok).toBe(false);
		expect(console.warn).not.toHaveBeenCalled();
	});

	it('session denials never burn global capacity', () => {
		drainSession('witch', T0);
		for (let i = 0; i < 50; i++) {
			expect(claimMintSlot('witch', T0).ok).toBe(false);
		}

		// The hammering left the rest of the global budget fully intact...
		for (let s = 0; s < GLOBAL_LIMIT / SESSION_LIMIT - 1; s++) drainSession(`other-${s}`, T0);
		// ...and exactly intact: the next claim is the first to hit the global ceiling.
		expect(claimMintSlot('one-more', T0).ok).toBe(false);
	});

	it('lazily resets a swept-survivor session whose window expires mid-global-window', () => {
		expect(claimMintSlot('witch', T0)).toEqual({ ok: true });
		drainSession('late-witch', T0 + 59_000);
		// Rolls the global window; the sweep keeps late-witch (2s old) and drops witch.
		expect(claimMintSlot('roller', T0 + 61_000)).toEqual({ ok: true });

		// T0+120s: no sweep is due (global window is 59s old) but late-witch's own window
		// has expired — the lazy reset must grant a full fresh allowance, not the drained count.
		drainSession('late-witch', T0 + 120_000);
	});

	it('keeps a still-live session window across a global rollover and sweeps dead ones', () => {
		// witch's window starts at T0 and is stale by the rollover; late-witch's window starts
		// at T0+59s and must survive the sweep with its count intact.
		drainSession('witch', T0);
		expect(claimMintSlot('late-witch', T0 + 59_000)).toEqual({ ok: true });

		// T0+61s: the global window rolls over. witch was swept → full fresh allowance.
		drainSession('witch', T0 + 61_000);
		// late-witch was kept → only SESSION_LIMIT - 1 claims remain in its live window.
		for (let i = 0; i < SESSION_LIMIT - 1; i++) {
			expect(claimMintSlot('late-witch', T0 + 61_000)).toEqual({ ok: true });
		}
		expect(claimMintSlot('late-witch', T0 + 61_000).ok).toBe(false);
	});
});

describe('claimTtsSlot', () => {
	beforeEach(() => {
		resetTtsWindows();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => vi.restoreAllMocks());

	it('allows exactly TTS_SESSION_LIMIT claims per session within one window', () => {
		for (let i = 0; i < TTS_SESSION_LIMIT; i++) {
			expect(claimTtsSlot('witch', T0)).toEqual({ ok: true });
		}
		expect(claimTtsSlot('witch', T0)).toEqual({ ok: false, retryAfterSeconds: 60 });
	});

	it('runs an independent window from the mint limiter', () => {
		// Draining minting leaves TTS untouched — separate limiters, separate ceilings.
		for (let i = 0; i < SESSION_LIMIT; i++) claimMintSlot('witch', T0);
		expect(claimMintSlot('witch', T0).ok).toBe(false);
		expect(claimTtsSlot('witch', T0)).toEqual({ ok: true });
	});

	it('denies any session once the global TTS window is exhausted, warning once', () => {
		const sessionsNeeded = TTS_GLOBAL_LIMIT / TTS_SESSION_LIMIT;
		for (let s = 0; s < sessionsNeeded; s++) {
			for (let i = 0; i < TTS_SESSION_LIMIT; i++) claimTtsSlot(`flood-${s}`, T0);
		}
		expect(claimTtsSlot('fresh', T0).ok).toBe(false);
		expect(vi.mocked(console.warn).mock.calls[0].join(' ')).toContain('global TTS');
	});
});
