// Debug log (S8/R8) — the on-stage proof that the engine owns truth. Records each result with the
// engine's deterministic truth beside the LLM-inference that reached it, flags any turn the
// deterministic floor fired, and carries Gemini's reasoning (or the earned-only payload it reasoned
// from, when the model returns no trace). Per-session, lifecycle-linked to the round: reset on a new
// round, evicted with the session. Holds no secret — only already-resolved answers and cast results.

import type { Player } from '$lib/server/engine/actions';
import type { SkollSource } from '$lib/server/skoll/skoll';

/** The two tags the demo contrasts: fact (engine) vs voice/decision (LLM). */
export type ResultTag = 'deterministic-engine' | 'LLM-inference';

export interface DebugEntry {
	// Monotonic within a round, so the view can render moves in order even after the buffer trims.
	seq: number;
	actor: Player;
	action: 'Ask' | 'Cast';
	// deterministic-engine: the truth the engine resolved this turn (the answer, or the cast result).
	truth: string;
	// LLM-inference: how the move was reached — the Oracle's reading of a human Ask, or Sköll's
	// reasoning. Empty for a pure human Cast (the player's own choice, no inference involved).
	inference: string;
	// Sköll moves only: 'gemini' when his own reasoning drove it, 'floor' when the deterministic
	// fallback fired (flagged in the view). Absent for the human side — the Oracle has no floor.
	source?: SkollSource;
}

// Bounded so an abandoned round can't grow memory without limit; a single round never approaches it.
const MAX_ENTRIES = 60;
const logs = new Map<string, DebugEntry[]>();

/** Append one result to a session's log, assigning the next seq and trimming the oldest past the cap. */
export function record(sessionId: string, entry: Omit<DebugEntry, 'seq'>): void {
	const log = logs.get(sessionId) ?? [];
	const seq = (log.at(-1)?.seq ?? 0) + 1;
	log.push({ ...entry, seq });
	if (log.length > MAX_ENTRIES) log.shift();
	logs.set(sessionId, log);
}

/** A session's results, oldest first. Empty before the first recorded turn. */
export function getLog(sessionId: string): DebugEntry[] {
	return logs.get(sessionId) ?? [];
}

/** Drop a session's log — a new round starts the demo fresh; eviction reclaims the memory. */
export function resetLog(sessionId: string): void {
	logs.delete(sessionId);
}

/** Whether the deterministic floor produced this entry (Sköll only). Drives the view's flag. */
export function floorFired(entry: DebugEntry): boolean {
	return entry.source === 'floor';
}
