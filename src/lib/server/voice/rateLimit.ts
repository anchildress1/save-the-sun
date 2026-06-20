// Abuse guards for Gemini surfaces. In-memory and per-instance, tuned for a single-instance demo service.
// The key is a request fingerprint (ip + session), so repeated hits against one source share the budget.

import { env } from '$env/dynamic/private';

export const resolveLimit = (raw: string | undefined, fallback: number): number => {
	const value = Number(raw);
	if (Number.isInteger(value) && value > 0) return value;
	if (raw !== undefined && raw !== '')
		console.warn(`[rateLimit] invalid limit "${raw}"; using ${fallback}`);
	return fallback;
};

export const TTS_SESSION_LIMIT = resolveLimit(env.TTS_SESSION_LIMIT, 150);
export const TTS_GLOBAL_LIMIT = resolveLimit(env.TTS_GLOBAL_LIMIT, 450);

export const STT_SESSION_LIMIT = resolveLimit(env.STT_SESSION_LIMIT, 15);
export const STT_GLOBAL_LIMIT = resolveLimit(env.STT_GLOBAL_LIMIT, 60);

export const ASK_SESSION_LIMIT = resolveLimit(env.ASK_SESSION_LIMIT, 12);
export const ASK_GLOBAL_LIMIT = resolveLimit(env.ASK_GLOBAL_LIMIT, 48);

export const LITE_SESSION_LIMIT = resolveLimit(env.LITE_SESSION_LIMIT, 90);
export const LITE_GLOBAL_LIMIT = resolveLimit(env.LITE_GLOBAL_LIMIT, 300);

const WINDOW_MS = 60_000;

type RateVerdict = { ok: true } | { ok: false; retryAfterSeconds: number };

interface WindowState {
	count: number;
	start: number;
}

interface Limiter {
	claim(key: string, now?: number): RateVerdict;
	clearKey(key: string): void;
	reset(): void;
}

function denied(window: WindowState, now: number): RateVerdict {
	return {
		ok: false,
		retryAfterSeconds: Math.max(1, Math.ceil((window.start + WINDOW_MS - now) / 1000))
	};
}

function createLimiter(label: string, sessionLimit: number, globalLimit: number): Limiter {
	const sessions = new Map<string, WindowState>();
	let global: WindowState = { count: 0, start: 0 };
	let globalTripLogged = false;

	function resetWindow(now: number): void {
		if (global.start !== 0 && now - global.start < WINDOW_MS) return;
		global = { count: 0, start: now };
		globalTripLogged = false;
		for (const [id, window] of sessions) {
			if (now - window.start >= WINDOW_MS) sessions.delete(id);
		}
	}

	return {
		claim(key, now = Date.now()) {
			resetWindow(now);
			if (global.count >= globalLimit) {
				if (!globalTripLogged) {
					globalTripLogged = true;
					console.warn(`[voice] global ${label} window exhausted`);
				}
				return denied(global, now);
			}

			let session = sessions.get(key);
			if (!session || now - session.start >= WINDOW_MS) {
				session = { count: 0, start: now };
				sessions.set(key, session);
			}
			if (session.count >= sessionLimit) return denied(session, now);

			session.count += 1;
			global.count += 1;
			return { ok: true };
		},
		// Drop ONE key's per-session window — NOT the global. A new game clears the player's own spent
		// budget without touching the global ceiling, so newGame can't be spammed to drain the key.
		clearKey(key) {
			sessions.delete(key);
		},
		reset() {
			sessions.clear();
			global = { count: 0, start: 0 };
			globalTripLogged = false;
		}
	};
}

const ttsLimiter = createLimiter('TTS', TTS_SESSION_LIMIT, TTS_GLOBAL_LIMIT);
const sttLimiter = createLimiter('stt', STT_SESSION_LIMIT, STT_GLOBAL_LIMIT);
const flashLimiter = createLimiter('flash', ASK_SESSION_LIMIT, ASK_GLOBAL_LIMIT);
const liteLimiter = createLimiter('lite', LITE_SESSION_LIMIT, LITE_GLOBAL_LIMIT);

const FORWARDED_IP_HEADERS = ['x-forwarded-for', 'cf-connecting-ip', 'x-real-ip', 'true-client-ip'];
// Sentinel for "no client address" — the literal token proxies send AND our own fallback key part.
const UNKNOWN_ADDRESS = 'unknown';

function normalizeAddress(value: string | null | undefined): string | undefined {
	const normalized = value?.trim();
	if (!normalized) return undefined;
	const first = normalized.split(',')[0]?.trim();
	if (!first || first.toLowerCase() === UNKNOWN_ADDRESS) return undefined;
	if (first[0] === '"' && first.at(-1) === '"') return first.slice(1, -1).trim();
	return first;
}

function resolveAddressFromHeaders(headers: Headers): string | undefined {
	for (const name of FORWARDED_IP_HEADERS) {
		const fromHeader = normalizeAddress(headers.get(name));
		if (fromHeader) return fromHeader;
	}
	const forwarded = headers.get('forwarded');
	if (!forwarded) return undefined;
	const forwardedMatch = /\bfor=([^;,\s"]+)/i.exec(forwarded);
	if (!forwardedMatch) return undefined;
	const token = normalizeAddress(forwardedMatch[1]);
	return token?.replace(/^\[|\]$/g, '');
}

const getClientAddressSafe = (getClientAddress?: () => string | undefined): string | undefined => {
	if (typeof getClientAddress !== 'function') return undefined;
	try {
		return normalizeAddress(getClientAddress());
	} catch (error) {
		console.warn(
			`[rateLimit] failed to read request client address (${error instanceof Error ? error.message : String(error)}), using headers`
		);
		return undefined;
	}
};

/**
 * Build a stable abuse key from network/client fingerprint + browser session.
 * Use this instead of session-only keys if one source is the attack vector.
 */
export const buildLimiterKey = (address: string | undefined, sessionId: string): string =>
	`${address || UNKNOWN_ADDRESS}:${sessionId || 'nosession'}`;

export const resolveLimiterAddress = (
	request: Request,
	getClientAddress?: () => string | undefined
): string => {
	return (
		getClientAddressSafe(getClientAddress) ||
		resolveAddressFromHeaders(request.headers) ||
		UNKNOWN_ADDRESS
	);
};

// Drop a single session's spent windows across every bucket (newGame = a clean slate). Per-session
// only — the global ceilings keep counting, so this can't be spammed to bypass the abuse guard.
export const resetLimiterKey = (key: string): void => {
	for (const limiter of [ttsLimiter, sttLimiter, flashLimiter, liteLimiter]) limiter.clearKey(key);
};

export const claimTtsSlot = (key: string, now?: number): RateVerdict => ttsLimiter.claim(key, now);
export const claimTranscribeSlot = (key: string, now?: number): RateVerdict =>
	sttLimiter.claim(key, now);

export const claimOracleSlot = (key: string, now?: number): RateVerdict =>
	flashLimiter.claim(key, now);
export const claimLiteSlot = (key: string, now?: number): RateVerdict =>
	liteLimiter.claim(key, now);

/** Shared test hook points to reset all Gemini windows. */
export const resetOracleWindows = (): void => {
	flashLimiter.reset();
};

export const resetTtsWindows = (): void => {
	ttsLimiter.reset();
};

export const resetTranscribeWindows = (): void => {
	sttLimiter.reset();
};

export const resetLiteWindows = (): void => {
	liteLimiter.reset();
};
