// Per-session engine registry: one GameEngine per sessionId, no shared state.

import { dev } from '$app/environment';
import { GameEngine, selectSecret } from './engine';
import { freshSkollState, type SkollState } from '$lib/server/skoll/skoll';
import { resetLog, logEvent } from '$lib/server/debug/log';
import type { LineDescriptor } from '$lib/server/voice/lines';

// LRU-capped so abandoned rounds can't grow memory without bound — Map insertion order makes the
// first key the least-recently-used; every access re-inserts to the end. 1000 is far above any
// plausible jam load.
export const MAX_SESSIONS = 1000;
const engines = new Map<string, GameEngine>();
// Sköll's per-round memory, lifecycle-linked to the engine so the two can never drift.
const skolls = new Map<string, SkollState>();
// A per-round opaque token for the client's view-state storage key — minted on demand,
// dropped on a new round/eviction so it changes exactly when the secret does. It is NOT
// derived from the seed (which would let the client brute-force the secret), so exposing it
// can never leak the answer.
const roundIds = new Map<string, string>();
// The public display seed for the on-screen board order, held for the round's lifetime so a
// reload does not reshuffle. Independent of the secret seed (see roundIds).
const boardSeeds = new Map<string, number>();
// The last committed voiced line per session (the spoken words + the descriptor that voices them).
// A >30s-but-successful action drops its response client-side while the server commits under the
// lock; without this the client can't tell the committed result from a true failure, so it shows a
// false silent/falters line (or a loss screen with no cast). The reconcile read returns this so the
// client can restore the real result instead. Lifecycle-linked to the round.
export interface RecoverableLine {
	text: string;
	voice: LineDescriptor | null;
}
const lastLines = new Map<string, RecoverableLine>();
// Authored (Gemini-written) voice lines awaiting TTS, keyed by an opaque id. The TTS route voices one
// ONLY by id lookup — the client never supplies the spoken words, the same invariant as every other
// descriptor (so the route can't be abused for arbitrary text without any signing). Round-scoped: a
// round authors a handful; the per-session map is bounded and cleared with the round.
export interface AuthoredVoiceLine {
	text: string;
	voice: string;
	// The deterministic, cacheable line the TTS route voices when this authored synth makes no audio.
	fallback: string;
}
const MAX_VOICE_LINES = 32;
const voiceLines = new Map<string, Map<string, AuthoredVoiceLine>>();

function randomSeed(): number {
	return crypto.getRandomValues(new Uint32Array(1))[0];
}

// Open the round's log with the secret — the on-stage record names it (and its seed) so a
// screen-share can follow the engine's truth. The view is a spoiler by design; the only thing the
// log must never carry is the Gemini API key (masked at the sink in log.ts).
function create(sessionId: string, seed: number): GameEngine {
	const secret = selectSecret(seed).name;
	if (dev) console.debug(`[session ${sessionId}] new round — secret: ${secret} (seed ${seed})`);
	logEvent(sessionId, {
		owner: 'Engine',
		kind: 'deterministic',
		part: 'Round',
		level: 'info',
		message: `New round — secret is ${secret}`,
		data: { secret, seed }
	});
	return new GameEngine(seed);
}

// A falsy sessionId would key every caller to one shared engine — the isolation breach this registry
// exists to prevent. Fail loud rather than poison the Map.
function requireId(sessionId: string): void {
	if (!sessionId) throw new Error('session registry called without a sessionId');
}

// Drop everything scoped to a round for one session — his memory, the view-state token, the board
// order, the recoverable + authored lines, and the demo log. Shared by LRU eviction and a fresh round
// so the parallel maps can never drift out of sync (add a new round-scoped map here, once).
function evictRoundState(sessionId: string): void {
	skolls.delete(sessionId);
	roundIds.delete(sessionId);
	boardSeeds.delete(sessionId);
	lastLines.delete(sessionId);
	voiceLines.delete(sessionId);
	resetLog(sessionId);
}

function remember(sessionId: string, engine: GameEngine): GameEngine {
	engines.delete(sessionId);
	engines.set(sessionId, engine);
	if (engines.size > MAX_SESSIONS) {
		// size > cap ⇒ the registry is non-empty, so the first key always exists.
		const [lru] = engines.keys();
		engines.delete(lru);
		evictRoundState(lru);
		// Rare, but the resulting fresh-secret-on-next-access desync is otherwise invisible.
		console.warn(`[session] registry full (${MAX_SESSIONS}); evicted LRU ${lru}`);
	}
	return engine;
}

/** The session's engine, lazily created and memoized on first use. */
export function getEngine(sessionId: string): GameEngine {
	requireId(sessionId);
	const existing = engines.get(sessionId);
	return remember(sessionId, existing ?? create(sessionId, randomSeed()));
}

/** Start a fresh round for one session; pass a seed for a deterministic secret. */
export function resetEngine(sessionId: string, seed?: number): GameEngine {
	requireId(sessionId);
	evictRoundState(sessionId); // a new round wipes his memory, the view token, the board, lines, the log
	return remember(sessionId, create(sessionId, seed ?? randomSeed()));
}

/**
 * The session's per-round token for the client's view-state storage key. Stable across a
 * refresh (same round), regenerated on a new round so persisted crossings/transcript never
 * restore onto a fresh secret. Opaque.
 */
export function getRoundId(sessionId: string): string {
	requireId(sessionId);
	getEngine(sessionId); // ensure the round exists (and re-marks it most-recently-used)
	let id = roundIds.get(sessionId);
	if (id === undefined) {
		id = crypto.randomUUID();
		roundIds.set(sessionId, id);
	}
	return id;
}

/**
 * The session's per-round display seed for the on-screen board order. Stable across a refresh
 * (same round, same layout), reminted with the round so a fresh secret deals a fresh board.
 */
export function getBoardSeed(sessionId: string): number {
	requireId(sessionId);
	getEngine(sessionId); // ensure the round exists (and re-marks it most-recently-used)
	let seed = boardSeeds.get(sessionId);
	if (seed === undefined) {
		seed = randomSeed();
		boardSeeds.set(sessionId, seed);
	}
	return seed;
}

/** The session's Sköll memory, lazily created on his first move and reset with the round. */
export function getSkoll(sessionId: string): SkollState {
	requireId(sessionId);
	let state = skolls.get(sessionId);
	if (state === undefined) {
		state = freshSkollState(randomSeed());
		skolls.set(sessionId, state);
	}
	return state;
}

/**
 * Record the line a just-committed action voiced, so a dropped response can recover the real result.
 * Call on every committed *voiced* move (Ask answer/refusal, reaction resolution, cast outcome, his
 * Ask/cast) — a stale entry would otherwise let the client recover the wrong line. `null` text is a
 * no-op (a move with nothing voiced, e.g. CrossOff, must not clobber the prior line).
 */
export function recordLine(sessionId: string, line: RecoverableLine | null): void {
	requireId(sessionId);
	if (line === null || line.text === '') return;
	lastLines.set(sessionId, line);
}

/** The last committed voiced line for a session, or null if nothing has been spoken this round. */
export function getLastLine(sessionId: string): RecoverableLine | null {
	requireId(sessionId);
	return lastLines.get(sessionId) ?? null;
}

/**
 * Stash an authored line for the TTS route to voice by id. Returns the opaque id the
 * client echoes back — the words live only here, never on the wire the route trusts. Bounded per round.
 */
export function storeVoiceLine(
	sessionId: string,
	text: string,
	voice: string,
	fallback: string
): string {
	requireId(sessionId);
	const id = crypto.randomUUID();
	const lines = voiceLines.get(sessionId) ?? new Map<string, AuthoredVoiceLine>();
	lines.set(id, { text, voice, fallback });
	// Insertion-ordered: drop the oldest once over the cap so a marathon round can't grow unbounded.
	if (lines.size > MAX_VOICE_LINES) lines.delete(lines.keys().next().value as string);
	voiceLines.set(sessionId, lines);
	return id;
}

/** The authored line for an id, or null if unknown/evicted — the route refuses to voice an unknown id. */
export function getVoiceLine(sessionId: string, id: string): AuthoredVoiceLine | null {
	requireId(sessionId);
	return voiceLines.get(sessionId)?.get(id) ?? null;
}

// Per-session single-flight: an action yields mid-flight (takeSkollTurn awaits Gemini) on shared
// state, so without this a duplicate tab / retry / direct POST could interleave and corrupt it.
const locks = new Map<string, Promise<unknown>>();

/** Run `fn` after any in-flight action for this session settles — serializing per-session mutation. */
export function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
	requireId(sessionId);
	const prev = locks.get(sessionId) ?? Promise.resolve();
	const result = prev.then(fn); // prev is a tail that never rejects, so a failure can't wedge the queue
	const tail = result.then(
		() => undefined,
		() => undefined
	);
	locks.set(sessionId, tail);
	void tail.finally(() => {
		if (locks.get(sessionId) === tail) locks.delete(sessionId); // drop drained sessions
	});
	return result;
}

/** Test isolation only — wipe the whole per-session registry so module singleton state can't leak
 *  between tests (the eviction and lifecycle suites assert against a clean map). */
export function resetSessionRegistry(): void {
	engines.clear();
	skolls.clear();
	roundIds.clear();
	boardSeeds.clear();
	lastLines.clear();
	voiceLines.clear();
	locks.clear();
}
