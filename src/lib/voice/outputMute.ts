// Output-mute preference (R11): one toggle silences the spoken voices while their captions keep
// rendering. Persisted in sessionStorage so it survives a reload but resets with the tab — "for
// the session," distinct from the per-round view in viewState.ts. Every access is guarded:
// storage throws in private mode, and a failure degrades to unmuted, never to broken play.

/** The sessionStorage key holding the output-mute flag. Exported so tests key against the same
 *  string the module reads/writes, never a drifting literal. */
export const MUTE_STATE_KEY = 'save-the-sun:muted';

/** The persisted mute preference, defaulting to false when unset or unreadable. */
export function readMuted(): boolean {
	try {
		return sessionStorage.getItem(MUTE_STATE_KEY) === 'true';
	} catch {
		return false; // storage unavailable (private mode) — default to audible
	}
}

/** Persist the mute preference. A storage failure is swallowed; the toggle still works in-memory. */
export function writeMuted(muted: boolean): void {
	try {
		sessionStorage.setItem(MUTE_STATE_KEY, String(muted));
	} catch {
		/* storage unavailable (private mode) — non-fatal, the preference just won't resume */
	}
}
