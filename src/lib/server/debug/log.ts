// Debug log (S8/R8) — the on-stage proof that the engine owns truth, plus a full diagnostic stream
// for development. A per-session chronological event log: human questions, the opponent's action +
// reasoning each turn, the engine's verdicts, and (verbose only) the secret + raw Gemini I/O.
//
// Exposure is gated by DEBUG_LOG (verbose | demo | off):
//   verbose — everything, including `sensitive` events (the secret, raw model request/response)
//   demo    — the screen-shareable subset: sensitive events stripped (no secret, no raw model I/O)
//   off     — the view is disabled
// Default: verbose in dev, off in prod (so a forgotten var never leaks the secret on a live build).
//
// Recorded server-side regardless of level (bounded, no client exposure); the level only decides
// what the /debug API hands back. Lifecycle-linked to the round through session.ts.

import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { Player } from '$lib/server/engine/actions';

export type DebugLevel = 'verbose' | 'demo' | 'off';
export type DebugChannel = 'turn' | 'oracle' | 'skoll' | 'gemini' | 'session';

export interface DebugEvent {
	// Monotonic within a round, so the view renders in order even after the buffer trims.
	seq: number;
	channel: DebugChannel;
	level: 'info' | 'warn' | 'error';
	// Held back unless DEBUG_LOG=verbose: the secret and raw Gemini request/response.
	sensitive?: boolean;
	actor?: Player;
	message: string;
	// Structured detail rendered beneath the line — the interpreted query, the chosen move + source,
	// the raw model I/O, etc. `turn` events carry { truth, inference, source } for the two tagged columns.
	data?: Record<string, unknown>;
}

// Bounded so an abandoned round can't grow memory; a single round never approaches it.
const MAX_EVENTS = 200;
const logs = new Map<string, DebugEvent[]>();

/** Append one event to a session's log, assigning the next seq and trimming the oldest past the cap. */
export function logEvent(sessionId: string, event: Omit<DebugEvent, 'seq'>): void {
	const log = logs.get(sessionId) ?? [];
	const seq = (log.at(-1)?.seq ?? 0) + 1;
	log.push({ ...event, seq });
	if (log.length > MAX_EVENTS) log.shift();
	logs.set(sessionId, log);
}

/** A session's events, oldest first. Empty before the first recorded event. */
export function getEvents(sessionId: string): DebugEvent[] {
	return logs.get(sessionId) ?? [];
}

/** Drop a session's log — a new round starts the demo fresh; eviction reclaims the memory. */
export function resetLog(sessionId: string): void {
	logs.delete(sessionId);
}

/** The exposure level from DEBUG_LOG, validated; default verbose in dev, off in prod. */
export function debugLevel(): DebugLevel {
	const raw = env.DEBUG_LOG;
	if (raw === 'verbose' || raw === 'demo' || raw === 'off') return raw;
	return dev ? 'verbose' : 'off';
}

/** What the view may show at a level: nothing when off, sensitive stripped for demo, all for verbose. */
export function filterForLevel(events: DebugEvent[], level: DebugLevel): DebugEvent[] {
	if (level === 'off') return [];
	if (level === 'verbose') return events;
	return events.filter((e) => !e.sensitive);
}

// --- Raw Gemini I/O sink (verbose only) -------------------------------------------------------
// gemini.ts has no sessionId, so it tees its raw request/response here and the action route (which
// does) drains it onto the session's log right after the call. Best-effort: the route drains inside
// the per-session lock immediately after the one decide() call, so in normal single-flight play the
// drained calls belong to that turn. Under concurrent multi-session VERBOSE debugging two turns could
// interleave their I/O — acceptable for a dev-only diagnostic, never enabled in a real deployment.
export interface GeminiCall {
	label: 'move' | 'reaction';
	request: unknown;
	response?: unknown;
	error?: string;
}

let geminiSink: GeminiCall[] = [];

// The SDK response is a class instance (getters, non-POJO). `json()` tolerates it, but SvelteKit's
// load serializer (devalue) rejects non-POJOs — so snapshot to a plain object here, at ingestion, and
// both the /api/debug response and the /debug page load stay serializable. The JSON round-trip drops
// methods/getters and keeps the data (candidates, usage, headers); a non-serializable value (circular,
// etc.) degrades to its string form rather than crashing the view.
function toSerializable(value: unknown): unknown {
	if (value === undefined) return undefined;
	try {
		return JSON.parse(JSON.stringify(value));
	} catch {
		return String(value);
	}
}

/** gemini.ts tees one raw call here (verbose only); the route drains it onto the session log. */
export function captureGemini(call: GeminiCall): void {
	geminiSink.push({
		...call,
		request: toSerializable(call.request),
		response: toSerializable(call.response)
	});
	if (geminiSink.length > 20) geminiSink.shift(); // never drained (off): stay bounded
}

/** Pull and clear the pending raw Gemini calls. */
export function drainGemini(): GeminiCall[] {
	const out = geminiSink;
	geminiSink = [];
	return out;
}
