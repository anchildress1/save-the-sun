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

import { AsyncLocalStorage } from 'node:async_hooks';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { Player } from '$lib/server/engine/actions';

export type DebugLevel = 'verbose' | 'demo' | 'off';
export type DebugChannel = 'turn' | 'oracle' | 'skoll' | 'gemini' | 'session';
// Which phase of the turn cycle an event belongs to (shown per card).
export type TurnPart = 'Ask' | 'Cast' | 'React' | 'Round';

export interface DebugEvent {
	// Monotonic within a round, so the view renders in order even after the buffer trims.
	seq: number;
	channel: DebugChannel;
	level: 'info' | 'warn' | 'error';
	// Held back unless DEBUG_LOG=verbose: the secret and raw Gemini request/response.
	sensitive?: boolean;
	// Whose colour the card carries — the human, or Sköll (the channel names the Oracle/Gemini/round).
	actor?: Player;
	// The turn phase this belongs to. The view derives LLM-vs-deterministic from the channel + source
	// (an LLM badge on the Oracle's read, Sköll's gemini moves, and raw Gemini I/O; deterministic
	// otherwise) — that judgement is presentation, not stored here.
	part?: TurnPart;
	message: string;
	// Structured detail rendered beneath the line — the interpreted query, the chosen move + source,
	// the raw model I/O. `skoll` events carry `source` ('gemini'/'floor'), which drives the LLM badge.
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

/** Drop a session's log (and any pending raw I/O) — a new round starts fresh; eviction reclaims it. */
export function resetLog(sessionId: string): void {
	logs.delete(sessionId);
	geminiSinks.delete(sessionId);
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
// gemini.ts has no sessionId, so it tees its raw request/response here and the action route drains
// it onto the session's log right after the call. The sink is keyed PER SESSION via an
// AsyncLocalStorage the route opens around the action — so two players running verbose turns
// concurrently never drain each other's I/O (a process-global sink would).
export interface GeminiCall {
	label: 'move' | 'reaction';
	request: unknown;
	response?: unknown;
	error?: string;
}

const sessionStore = new AsyncLocalStorage<string>();
const geminiSinks = new Map<string, GeminiCall[]>();

/** Open the session context so a Gemini call teed inside `fn` is attributed to this session. */
export function runWithSession<T>(sessionId: string, fn: () => T): T {
	return sessionStore.run(sessionId, fn);
}

/**
 * A JSON-safe snapshot of a value. The SDK response is a class instance (getters, non-POJO) that
 * SvelteKit's load serializer (devalue) rejects — and may carry cycles that crash `json()` too. So
 * walk it into a plain object: own enumerable data only (prototype methods/getters dropped, like
 * JSON), functions/symbols dropped, cycles broken to '[Circular]', Dates to ISO. A throwing getter
 * (or anything else) degrades the whole value to a marker rather than crashing the view.
 */
function toSerializable(value: unknown): unknown {
	if (value === undefined) return undefined;
	try {
		return sanitize(value, new WeakSet());
	} catch {
		return { note: 'value omitted — not serializable' };
	}
}

function sanitize(value: unknown, seen: WeakSet<object>): unknown {
	if (value === null) return null;
	const type = typeof value;
	if (type === 'bigint') return (value as bigint).toString();
	if (type !== 'object') return type === 'function' || type === 'symbol' ? undefined : value;
	if (value instanceof Date) return value.toISOString();
	if (seen.has(value as object)) return '[Circular]';
	seen.add(value as object);
	if (Array.isArray(value)) return value.map((v) => sanitize(v, seen));
	const out: Record<string, unknown> = {};
	for (const [key, v] of Object.entries(value as object)) {
		const s = sanitize(v, seen);
		if (s !== undefined) out[key] = s;
	}
	return out;
}

/** gemini.ts tees one raw call here (verbose only); the route drains it onto the session log. */
export function captureGemini(call: GeminiCall): void {
	const sessionId = sessionStore.getStore();
	if (sessionId === undefined) return; // no session context → nothing to attribute it to
	const sink = geminiSinks.get(sessionId) ?? [];
	sink.push({
		...call,
		request: toSerializable(call.request),
		response: toSerializable(call.response)
	});
	if (sink.length > 20) sink.shift(); // bounded if a session is never drained
	geminiSinks.set(sessionId, sink);
}

/** Pull and clear this session's pending raw Gemini calls. */
export function drainGemini(sessionId: string): GeminiCall[] {
	const out = geminiSinks.get(sessionId) ?? [];
	geminiSinks.delete(sessionId);
	return out;
}
