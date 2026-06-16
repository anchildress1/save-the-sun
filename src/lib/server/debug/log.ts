// Debug log — the on-stage proof that the engine owns truth, plus a full diagnostic stream. A
// per-session chronological event log: human questions, the opponent's action + reasoning each turn,
// the engine's verdicts, the round's secret, and the raw Gemini I/O (request text and JSON responses).
//
// One secrecy rule: the GEMINI API KEY never enters this log. The round's secret rune is part of
// the on-stage record (following the engine's truth live is the whole point — the view is a spoiler
// by design); the key is the only thing that must not leak, and it is masked at the sink so no
// caller can tee it by accident.
//
// Always on — the public /debug view IS the demo, live and unauthenticated; there is no exposure
// gate. Recorded server-side (bounded) and lifecycle-linked to the round through session.ts.

import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '$env/dynamic/private';

// Three orthogonal facts set at the source so the view never re-derives them: owner (→ color), kind
// (→ badge), part (→ chip). A verdict is the ENGINE's, never the actor's whose turn it was.
export type Owner = 'Human' | 'Oracle' | 'Sköll' | 'Engine';
export type Kind = 'input' | 'llm' | 'deterministic';
// 'Voice' = the Live-session channel, teed from the browser via /api/voice/debug. 'Answer' = the
// Oracle's spoken reply to an Ask, recorded apart from the Engine's verdict of the same truth.
export type TurnPart = 'Ask' | 'Answer' | 'Cast' | 'React' | 'Round' | 'Voice';

export interface DebugEvent {
	// Monotonic within a round, so the view renders in order even after the buffer trims.
	seq: number;
	owner: Owner;
	kind: Kind;
	part: TurnPart;
	level: 'info' | 'warn' | 'error';
	message: string;
	data?: Record<string, unknown>;
}

// Bounded so an abandoned round can't grow memory; a single round never approaches it.
const MAX_EVENTS = 200;
const logs = new Map<string, DebugEvent[]>();

/** Append one event to a session's log, assigning the next seq and trimming the oldest past the cap. */
export function logEvent(sessionId: string, event: Omit<DebugEvent, 'seq'>): void {
	const log = logs.get(sessionId) ?? [];
	const seq = (log.at(-1)?.seq ?? 0) + 1;
	// Masked + snapshotted here too, not just in captureGemini — every sink enforces the key rule,
	// so a future caller logging a raw SDK error string can't reopen the leak.
	log.push({
		...event,
		seq,
		message: maskApiKey(event.message),
		...(event.data !== undefined && { data: toSerializable(event.data) as DebugEvent['data'] })
	});
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

// --- Raw Gemini I/O sink ------------------------------------------------------------------------
// gemini.ts has no sessionId, so it tees its raw I/O here and the route drains it. Keyed PER SESSION
// via an AsyncLocalStorage so concurrent turns never drain each other's I/O.
export interface GeminiCall {
	label: 'move' | 'reaction' | 'oracle';
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
 * A JSON-safe snapshot of a value. The SDK response is a non-POJO class instance that SvelteKit's
 * load serializer (devalue) rejects, and may carry cycles that crash `json()` — so walk it into a
 * plain object. A throwing getter degrades the whole value to a marker rather than crashing the view.
 */
function toSerializable(value: unknown): unknown {
	if (value === undefined) return undefined;
	try {
		return sanitize(value, new WeakSet());
	} catch {
		return { note: 'value omitted — not serializable' };
	}
}

// The one hard secrecy rule of this log: the Gemini API key never enters it. SDK error strings can
// embed the request URL (and with it the key), so every string is scrubbed at both sinks
// (logEvent and captureGemini) before it is stored. Exported as the single implementation of the
// rule — any other sink that logs SDK errors (e.g. the voice token route) masks through this.
export function maskApiKey(value: string): string {
	const key = env.GEMINI_API_KEY;
	return key ? value.split(key).join('[gemini-api-key]') : value;
}

function sanitize(value: unknown, seen: WeakSet<object>): unknown {
	if (value === null) return null;
	const type = typeof value;
	if (type === 'string') return maskApiKey(value as string);
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

/** gemini.ts tees one raw call here; the route drains it onto the session log. */
export function captureGemini(call: GeminiCall): void {
	const sessionId = sessionStore.getStore();
	if (sessionId === undefined) return; // no session context → nothing to attribute it to
	const sink = geminiSinks.get(sessionId) ?? [];
	sink.push({
		...call,
		request: toSerializable(call.request),
		response: toSerializable(call.response),
		...(call.error !== undefined && { error: maskApiKey(call.error) })
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
