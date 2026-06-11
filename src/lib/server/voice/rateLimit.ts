// Fixed-window abuse guard for voice token minting. In-memory is deliberate: the service runs
// at most 2 instances, so the worst case is 2x these ceilings — still a hard cap on key burn.

const WINDOW_MS = 60_000;
// A legit player re-wakes the medallion at most ~6x/min (8s silence timeout), so 10 is headroom.
export const SESSION_LIMIT = 10;
export const GLOBAL_LIMIT = 60;

interface MintWindow {
	count: number;
	start: number;
}

const sessions = new Map<string, MintWindow>();
let global: MintWindow = { count: 0, start: 0 };
// Once per window: a global trip means abuse or a runaway client — operators must see it —
// but logging every denied request would make the log itself a flood surface.
let globalTripLogged = false;

export type MintVerdict = { ok: true } | { ok: false; retryAfterSeconds: number };

function denied(window: MintWindow, now: number): MintVerdict {
	return {
		ok: false,
		retryAfterSeconds: Math.max(1, Math.ceil((window.start + WINDOW_MS - now) / 1000))
	};
}

/** Claim one token-mint slot for the session; a denial consumes nothing. */
export function claimMintSlot(sessionId: string, now = Date.now()): MintVerdict {
	if (now - global.start >= WINDOW_MS) {
		global = { count: 0, start: now };
		globalTripLogged = false;
		// Sweep stale per-session windows on global rollover so the map stays bounded
		// without a per-call scan.
		for (const [id, window] of sessions) {
			if (now - window.start >= WINDOW_MS) sessions.delete(id);
		}
	}
	if (global.count >= GLOBAL_LIMIT) {
		if (!globalTripLogged) {
			globalTripLogged = true;
			console.warn('[voice] global token-mint window exhausted — denying all sessions');
		}
		return denied(global, now);
	}

	let session = sessions.get(sessionId);
	if (!session || now - session.start >= WINDOW_MS) {
		session = { count: 0, start: now };
		sessions.set(sessionId, session);
	}
	if (session.count >= SESSION_LIMIT) return denied(session, now);

	session.count += 1;
	global.count += 1;
	return { ok: true };
}

/** Test isolation only — the windows are module state shared across a test file. */
export function resetMintWindows(): void {
	sessions.clear();
	global = { count: 0, start: 0 };
	globalTripLogged = false;
}
