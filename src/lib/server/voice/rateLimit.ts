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
	if (Number.isInteger(value) && value > 0) return value;
	// A defined-but-rejected override (e.g. "1O", "0", "5.5") is almost always a typo. Fall back, but
	// say so — a silent default reads as "the operator tuned this" when they didn't.
	if (raw !== undefined && raw !== '')
		console.warn(`[rateLimit] ignoring invalid limit "${raw}"; using ${fallback}`);
	return fallback;
};

const WINDOW_MS = 60_000;

// TTS synth: only UNCACHED lines claim a slot (cached replays are free). Active play voices ~2 fresh
// lines per turn (the authored flair + each new answer, before they cache), so a single player burns
// the budget fast — the old free-tier-sized 4/10 throttled the Oracle silent mid-game. Sized for real
// play now: generous per session, with a global abuse ceiling. Env-tune to your key's actual TTS RPM;
// the billing cap is the real spend stop.
export const TTS_SESSION_LIMIT = resolveLimit(env.TTS_SESSION_LIMIT, 30);
export const TTS_GLOBAL_LIMIT = resolveLimit(env.TTS_GLOBAL_LIMIT, 120);

// Push-to-talk transcription: every held utterance is one uncached Gemini call. Lower volume than TTS
// (one per spoken Ask, not per move), but a voice-heavy player still needs headroom. Env-tunable.
export const STT_SESSION_LIMIT = resolveLimit(env.STT_SESSION_LIMIT, 15);
export const STT_GLOBAL_LIMIT = resolveLimit(env.STT_GLOBAL_LIMIT, 60);

// A live Ask fans out to ~3 Gemini calls (Oracle interpret + flair, Sköll reaction) on the same Flash
// quota as voice, with no audio required to trigger it. These are REQUEST budgets, so the effective
// Gemini-call ceiling is ~3x lower — sized so a human (an Ask round-trips in seconds) never trips them
// while a scripted client can't fan a flood of fresh-session asks into a multiple of the call budget.
// Env-tunable for a stricter or paid-tier key.
export const ASK_SESSION_LIMIT = resolveLimit(env.ASK_SESSION_LIMIT, 12);
export const ASK_GLOBAL_LIMIT = resolveLimit(env.ASK_GLOBAL_LIMIT, 48);

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

const tts = createLimiter('TTS', TTS_SESSION_LIMIT, TTS_GLOBAL_LIMIT);
const transcribe = createLimiter('transcribe', STT_SESSION_LIMIT, STT_GLOBAL_LIMIT);
const oracle = createLimiter('Ask', ASK_SESSION_LIMIT, ASK_GLOBAL_LIMIT);
// The /debug voice tee is cheap but unauthenticated and feeds the public demo stream — bound it so a
// client can't flood the operator's view. Generous defaults: a normal session tees a handful a turn.
export const VOICE_DEBUG_SESSION_LIMIT = resolveLimit(env.VOICE_DEBUG_SESSION_LIMIT, 30);
export const VOICE_DEBUG_GLOBAL_LIMIT = resolveLimit(env.VOICE_DEBUG_GLOBAL_LIMIT, 120);
const voiceDebug = createLimiter(
	'voice-debug',
	VOICE_DEBUG_SESSION_LIMIT,
	VOICE_DEBUG_GLOBAL_LIMIT
);

/** Claim one TTS-synth slot for the session; a denial consumes nothing. */
export const claimTtsSlot = tts.claim;
/** Test isolation only — the windows are module state shared across a test file. */
export const resetTtsWindows = tts.reset;

/** Claim one push-to-talk transcription slot for the session; a denial consumes nothing. */
export const claimTranscribeSlot = transcribe.claim;
/** Test isolation only — the windows are module state shared across a test file. */
export const resetTranscribeWindows = transcribe.reset;

/** Claim one Ask-turn slot for the session; a denial consumes nothing. */
export const claimOracleSlot = oracle.claim;
/** Test isolation only — the windows are module state shared across a test file. */
export const resetOracleWindows = oracle.reset;

/** Claim one /debug voice-tee slot for the session; a denial consumes nothing. */
export const claimVoiceDebugSlot = voiceDebug.claim;
/** Test isolation only — the windows are module state shared across a test file. */
export const resetVoiceDebugWindows = voiceDebug.reset;
