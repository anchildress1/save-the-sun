import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pin the env so the TTS/STT ceilings resolve to their defaults (4/10). The limits are computed at
// module load from $env/dynamic/private, so a developer's exported TTS_SESSION_LIMIT (etc.) would
// otherwise make this suite non-deterministic.
vi.mock('$env/dynamic/private', () => ({ env: {} }));

import {
	claimTtsSlot,
	resetTtsWindows,
	TTS_SESSION_LIMIT,
	TTS_GLOBAL_LIMIT,
	claimTranscribeSlot,
	resetTranscribeWindows,
	resolveLimit,
	resolveLimiterAddress,
	buildLimiterKey,
	resetLimiterKey
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

	it('warns on a defined-but-rejected override, but stays silent for an unset value', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(resolveLimit('1O', 10)).toBe(10); // typo (letter O) → a silent default would hide it
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain('1O');
		resolveLimit(undefined, 10); // unset is the normal case — no noise
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});
});

describe('resolveLimiterAddress', () => {
	it('uses getClientAddress when available and stable', () => {
		const request = new Request('http://localhost');
		expect(resolveLimiterAddress(request, () => '198.51.100.17')).toBe('198.51.100.17');
	});

	it('falls back to x-forwarded-for when getClientAddress throws', () => {
		const request = new Request('http://localhost', {
			headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }
		});
		expect(
			resolveLimiterAddress(request, () => {
				throw new Error('upstream proxy not configured');
			})
		).toBe('203.0.113.9');
	});

	it('falls back to cf-connecting-ip when getClientAddress returns undefined', () => {
		const request = new Request('http://localhost', {
			headers: { 'cf-connecting-ip': '198.18.0.22' }
		});
		expect(resolveLimiterAddress(request, () => undefined)).toBe('198.18.0.22');
	});

	it('returns unknown when no source can provide an address', () => {
		const request = new Request('http://localhost');
		expect(resolveLimiterAddress(request)).toBe('unknown');
	});

	it('parses the Forwarded header for= token, stripping IPv6 brackets', () => {
		const request = new Request('http://localhost', {
			headers: { forwarded: 'for=[2001:db8::1];proto=https' }
		});
		expect(resolveLimiterAddress(request)).toBe('2001:db8::1');
	});

	it('skips a Forwarded header that carries no for= token', () => {
		const request = new Request('http://localhost', {
			headers: { forwarded: 'proto=https;by=10.0.0.1' }
		});
		expect(resolveLimiterAddress(request)).toBe('unknown');
	});

	it('strips surrounding quotes and ignores a literal "unknown" address', () => {
		const quoted = new Request('http://localhost', {
			headers: { 'x-forwarded-for': '"203.0.113.5"' }
		});
		expect(resolveLimiterAddress(quoted)).toBe('203.0.113.5');
		// A header whose first hop is the literal token `unknown` is no address — fall through.
		const unknown = new Request('http://localhost', {
			headers: { 'x-forwarded-for': 'unknown', 'x-real-ip': '192.0.2.7' }
		});
		expect(resolveLimiterAddress(unknown)).toBe('192.0.2.7');
	});
});

describe('buildLimiterKey', () => {
	it('joins address and session, defaulting each empty part', () => {
		expect(buildLimiterKey('203.0.113.9', 'sess-1')).toBe('203.0.113.9:sess-1');
		expect(buildLimiterKey(undefined, 'sess-1')).toBe('unknown:sess-1');
		expect(buildLimiterKey('203.0.113.9', '')).toBe('203.0.113.9:nosession');
	});
});

function drainSession(sessionId: string, now: number) {
	for (let i = 0; i < TTS_SESSION_LIMIT; i++) {
		expect(claimTtsSlot(sessionId, now)).toEqual({ ok: true });
	}
}

// Drain exactly TTS_GLOBAL_LIMIT claims across as many sessions as the per-session cap requires,
// so the next claim is the first to hit the global ceiling — works for any session/global ratio.
function exhaustGlobal(at: number) {
	let claimed = 0;
	for (let s = 0; claimed < TTS_GLOBAL_LIMIT; s++) {
		for (let i = 0; i < TTS_SESSION_LIMIT && claimed < TTS_GLOBAL_LIMIT; i++) {
			expect(claimTtsSlot(`flood-${at}-${s}`, at)).toEqual({ ok: true });
			claimed++;
		}
	}
}

describe('claimTtsSlot', () => {
	beforeEach(() => {
		resetTtsWindows();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('allows exactly TTS_SESSION_LIMIT claims per session within one window', () => {
		drainSession('witch', T0);
		expect(claimTtsSlot('witch', T0)).toEqual({ ok: false, retryAfterSeconds: 60 });
	});

	it('resetLimiterKey gives one session a fresh window (newGame is a clean slate)', () => {
		drainSession('witch', T0);
		expect(claimTtsSlot('witch', T0).ok).toBe(false); // spent
		resetLimiterKey('witch');
		expect(claimTtsSlot('witch', T0).ok).toBe(true); // cleared → fresh allowance
	});

	it('resetLimiterKey leaves the global ceiling intact — newGame cannot bypass it', () => {
		exhaustGlobal(T0); // global window full across many sessions
		resetLimiterKey('late-comer'); // clearing a key's session window...
		expect(claimTtsSlot('late-comer', T0).ok).toBe(false); // ...does NOT reopen the global
	});

	it('reports the remaining window time on a session denial', () => {
		drainSession('witch', T0);
		expect(claimTtsSlot('witch', T0 + 30_000)).toEqual({ ok: false, retryAfterSeconds: 30 });
	});

	it('rounds a sub-second remainder up to one second, never zero', () => {
		drainSession('witch', T0);
		expect(claimTtsSlot('witch', T0 + 59_900)).toEqual({ ok: false, retryAfterSeconds: 1 });
	});

	it('limits sessions independently — one drained session does not starve another', () => {
		drainSession('witch', T0);
		expect(claimTtsSlot('bystander', T0)).toEqual({ ok: true });
	});

	it('grants a fresh session allowance once its window expires', () => {
		drainSession('witch', T0);
		expect(claimTtsSlot('witch', T0 + WINDOW_MS)).toEqual({ ok: true });
	});

	it('denials consume nothing — the fresh window still grants the full allowance', () => {
		drainSession('witch', T0);
		expect(claimTtsSlot('witch', T0).ok).toBe(false);
		expect(claimTtsSlot('witch', T0).ok).toBe(false);
		drainSession('witch', T0 + WINDOW_MS);
	});

	it('denies any session once the global window is exhausted', () => {
		exhaustGlobal(T0);
		expect(claimTtsSlot('fresh-session', T0 + 15_000)).toEqual({
			ok: false,
			retryAfterSeconds: 45
		});
	});

	it('grants claims again once the global window expires', () => {
		exhaustGlobal(T0);
		expect(claimTtsSlot('fresh-session', T0 + WINDOW_MS)).toEqual({ ok: true });
	});

	it('warns the operator once per window when the global ceiling trips, then again next window', () => {
		const exhaust = (at: number) => {
			exhaustGlobal(at);
			expect(claimTtsSlot('victim', at).ok).toBe(false);
			expect(claimTtsSlot('victim', at).ok).toBe(false);
		};

		exhaust(T0);
		// Two denials, one warning — denial volume must not become log volume.
		expect(console.warn).toHaveBeenCalledTimes(1);
		expect(vi.mocked(console.warn).mock.calls[0].join(' ')).toContain('TTS');

		// A fresh window re-arms the warning so a sustained flood stays visible.
		exhaust(T0 + WINDOW_MS);
		expect(console.warn).toHaveBeenCalledTimes(2);
	});

	it('stays silent on per-session denials — player noise is not an operator signal', () => {
		drainSession('witch', T0);
		expect(claimTtsSlot('witch', T0).ok).toBe(false);
		expect(console.warn).not.toHaveBeenCalled();
	});

	it('session denials never burn global capacity', () => {
		drainSession('witch', T0); // global now holds exactly TTS_SESSION_LIMIT
		for (let i = 0; i < 50; i++) {
			expect(claimTtsSlot('witch', T0).ok).toBe(false);
		}
		// The hammering burned no global capacity: exactly the remaining allowance grants before
		// the next session is the first refused on the global ceiling.
		let claimed = TTS_SESSION_LIMIT;
		for (let s = 0; claimed < TTS_GLOBAL_LIMIT; s++) {
			for (let i = 0; i < TTS_SESSION_LIMIT && claimed < TTS_GLOBAL_LIMIT; i++) {
				expect(claimTtsSlot(`other-${s}`, T0)).toEqual({ ok: true });
				claimed++;
			}
		}
		expect(claimTtsSlot('one-more', T0).ok).toBe(false);
	});

	it('lazily resets a swept-survivor session whose window expires mid-global-window', () => {
		expect(claimTtsSlot('witch', T0)).toEqual({ ok: true });
		drainSession('late-witch', T0 + 59_000);
		// Rolls the global window; the sweep keeps late-witch (2s old) and drops witch.
		expect(claimTtsSlot('roller', T0 + 61_000)).toEqual({ ok: true });

		// T0+120s: no sweep is due (global window is 59s old) but late-witch's own window
		// has expired — the lazy reset must grant a full fresh allowance, not the drained count.
		drainSession('late-witch', T0 + 120_000);
	});

	it('keeps a still-live session window across a global rollover and sweeps dead ones', () => {
		// witch's window starts at T0 and is stale by the rollover; late-witch's window starts
		// at T0+59s and must survive the sweep with its count intact.
		drainSession('witch', T0);
		expect(claimTtsSlot('late-witch', T0 + 59_000)).toEqual({ ok: true });

		// T0+61s: the global window rolls over. witch was swept → full fresh allowance.
		drainSession('witch', T0 + 61_000);
		// late-witch was kept → only TTS_SESSION_LIMIT - 1 claims remain in its live window.
		for (let i = 0; i < TTS_SESSION_LIMIT - 1; i++) {
			expect(claimTtsSlot('late-witch', T0 + 61_000)).toEqual({ ok: true });
		}
		expect(claimTtsSlot('late-witch', T0 + 61_000).ok).toBe(false);
	});

	it('runs an independent window from the transcription limiter', () => {
		resetTranscribeWindows();
		// Draining TTS leaves transcription untouched — separate limiters, separate ceilings.
		drainSession('witch', T0);
		expect(claimTtsSlot('witch', T0).ok).toBe(false);
		expect(claimTranscribeSlot('witch', T0)).toEqual({ ok: true });
	});
});
