// Fixed-window abuse guards for the voice surfaces. In-memory and per-instance: the service runs
// at most 2 instances, so the worst case is 2x these ceilings. The synth/transcribe ceilings exist
// to trip BEFORE Google's own quota — set them to (the key's model RPM / running instances) so a
// 429 surfaces as our clean "try again" instead of a doomed request, and one player can't drain the
// shared key for everyone.

import { env } from '$env/dynamic/private';

/** A positive-integer override (`raw`, from the environment) or the fallback — so a deployment aligns
 *  a ceiling to its key's actual quota (free vs paid tier) without a code change. */
export const resolveLimit = (raw: string | undefined, fallback: number): number => {
	const value = Number(raw);
	return Number.isInteger(value) && value > 0 ? value : fallback;
};

const WINDOW_MS = 60_000;

// Token minting: a legit player re-wakes the medallion at most ~6x/min (silence timeout), so 10
// is headroom.
export const SESSION_LIMIT = 10;
export const GLOBAL_LIMIT = 60;

// TTS synth: only UNCACHED lines claim a slot (cached replays are free), so the budget is Google's
// fresh-synth RPM for the TTS preview model — a tight, unpublished ceiling. The old 200/min sat far
// above it, so we rubber-stamped requests Google then 429'd. Defaults track the free-tier reality
// (~10 RPM); raise via env on a paid key. The per-session slice caps one player below the global so
// a single session can't drain the shared key.
export const TTS_SESSION_LIMIT = resolveLimit(env.TTS_SESSION_LIMIT, 4);
export const TTS_GLOBAL_LIMIT = resolveLimit(env.TTS_GLOBAL_LIMIT, 10);

// Push-to-talk transcription: every held utterance is an uncached Gemini call. (Note: the interpret
// and flair calls draw on the same Flash quota and are still uncapped — a separate scaling gap.)
// Same free-tier-sized defaults, env-tunable.
export const STT_SESSION_LIMIT = resolveLimit(env.STT_SESSION_LIMIT, 4);
export const STT_GLOBAL_LIMIT = resolveLimit(env.STT_GLOBAL_LIMIT, 10);

interface Window {
	count: number;
	start: number;
}

export type RateVerdict = { ok: true } | { ok: false; retryAfterSeconds: number };

function denied(window: Window, now: number): RateVerdict {
	return {
		ok: false,
		retryAfterSeconds: Math.max(1, Math.ceil((window.start + WINDOW_MS - now) / 1000))
	};
}

interface Limiter {
	claim(sessionId: string, now?: number): RateVerdict;
	reset(): void;
}

// One fixed-window limiter: a per-session ceiling under a shared global ceiling. `label` only
// shapes the once-per-window operator warning when the global window trips.
function createLimiter(label: string, sessionLimit: number, globalLimit: number): Limiter {
	const sessions = new Map<string, Window>();
	let global: Window = { count: 0, start: 0 };
	// Once per window: a global trip means abuse or a runaway client — operators must see it —
	// but logging every denied request would make the log itself a flood surface.
	let globalTripLogged = false;

	return {
		claim(sessionId, now = Date.now()) {
			if (now - global.start >= WINDOW_MS) {
				global = { count: 0, start: now };
				globalTripLogged = false;
				// Sweep stale per-session windows on global rollover so the map stays bounded
				// without a per-call scan.
				for (const [id, window] of sessions) {
					if (now - window.start >= WINDOW_MS) sessions.delete(id);
				}
			}
			if (global.count >= globalLimit) {
				if (!globalTripLogged) {
					globalTripLogged = true;
					console.warn(`[voice] global ${label} window exhausted — denying all sessions`);
				}
				return denied(global, now);
			}

			let session = sessions.get(sessionId);
			if (!session || now - session.start >= WINDOW_MS) {
				session = { count: 0, start: now };
				sessions.set(sessionId, session);
			}
			if (session.count >= sessionLimit) return denied(session, now);

			session.count += 1;
			global.count += 1;
			return { ok: true };
		},
		reset() {
			sessions.clear();
			global = { count: 0, start: 0 };
			globalTripLogged = false;
		}
	};
}

const mint = createLimiter('token-mint', SESSION_LIMIT, GLOBAL_LIMIT);
const tts = createLimiter('TTS', TTS_SESSION_LIMIT, TTS_GLOBAL_LIMIT);
const transcribe = createLimiter('transcribe', STT_SESSION_LIMIT, STT_GLOBAL_LIMIT);

/** Claim one token-mint slot for the session; a denial consumes nothing. */
export const claimMintSlot = mint.claim;
/** Test isolation only — the windows are module state shared across a test file. */
export const resetMintWindows = mint.reset;

/** Claim one TTS-synth slot for the session; a denial consumes nothing. */
export const claimTtsSlot = tts.claim;
/** Test isolation only — the windows are module state shared across a test file. */
export const resetTtsWindows = tts.reset;

/** Claim one push-to-talk transcription slot for the session; a denial consumes nothing. */
export const claimTranscribeSlot = transcribe.claim;
/** Test isolation only — the windows are module state shared across a test file. */
export const resetTranscribeWindows = transcribe.reset;
