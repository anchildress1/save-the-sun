// Client-only persistence of the presentation the server never resumes — the human's crossings
// and the visible Oracle line — so a mid-round refresh restores the board to match the resumed
// round and the debug log, instead of resetting to an opening it never actually returned to.
//
// One record under one key. The round id is stored inside it, so a read for a different round
// (a new secret) finds a stale record and returns null — stale crossings/transcript can never
// land on a fresh secret. Every access is guarded: storage throws in private mode, and a
// failure degrades to the prior reset-on-reload behavior, never to broken play.

const KEY = 'save-the-sun:view';

export interface ViewState {
	/** Crossed-off rune ids — keyed by id, not board position, so they survive the reshuffle. */
	crossings: number[];
	/** The single Oracle line currently voiced in the Rite panel. */
	answer: string;
}

function isViewRecord(value: unknown): value is ViewState & { roundId: string } {
	if (typeof value !== 'object' || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.roundId === 'string' &&
		typeof record.answer === 'string' &&
		Array.isArray(record.crossings) &&
		record.crossings.every((id) => typeof id === 'number')
	);
}

/** The persisted view for this round, or null when none, stale (different round), or unreadable. */
export function readViewState(roundId: string): ViewState | null {
	if (!roundId) return null;
	try {
		const raw = localStorage.getItem(KEY);
		if (raw === null) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!isViewRecord(parsed) || parsed.roundId !== roundId) return null;
		return { crossings: parsed.crossings, answer: parsed.answer };
	} catch {
		return null; // unparseable or storage unavailable — degrade to no restore
	}
}

/**
 * Persist the view for this round under a single key — a new round overwrites it, so stale state
 * never lingers. A storage failure is swallowed; the round plays on regardless.
 */
export function writeViewState(roundId: string, state: ViewState): void {
	if (!roundId) return;
	try {
		localStorage.setItem(KEY, JSON.stringify({ roundId, ...state }));
	} catch {
		/* storage unavailable (private mode) — non-fatal, the view just won't resume */
	}
}
