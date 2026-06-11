// Per-session engine registry: one GameEngine per sessionId, no shared state.

import { dev } from '$app/environment';
import { GameEngine, selectSecret } from './engine';
import { freshSkollState, type SkollState } from '$lib/server/skoll/skoll';
import { resetLog, logEvent } from '$lib/server/debug/log';

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
// reload does not reshuffle. Independent of the secret seed — exposing it can't leak the answer.
const boardSeeds = new Map<string, number>();

function randomSeed(): number {
	return crypto.getRandomValues(new Uint32Array(1))[0];
}

// Open the round's log. The secret (and its seed, which derives it) never enters the log stream at
// any level — the dev console line is the only place it is spoken, and that never leaves the server.
function create(sessionId: string, seed: number): GameEngine {
	const secret = selectSecret(seed).name;
	if (dev) console.debug(`[session ${sessionId}] new round — secret: ${secret} (seed ${seed})`);
	logEvent(sessionId, {
		owner: 'Engine',
		kind: 'deterministic',
		part: 'Round',
		level: 'info',
		message: 'New round — the secret is chosen and sealed'
	});
	return new GameEngine(seed);
}

// A falsy sessionId would key every caller to one shared engine — the isolation breach this registry
// exists to prevent. Fail loud rather than poison the Map.
function requireId(sessionId: string): void {
	if (!sessionId) throw new Error('session registry called without a sessionId');
}

function remember(sessionId: string, engine: GameEngine): GameEngine {
	engines.delete(sessionId);
	engines.set(sessionId, engine);
	if (engines.size > MAX_SESSIONS) {
		// size > cap ⇒ the registry is non-empty, so the first key always exists.
		const [lru] = engines.keys();
		engines.delete(lru);
		skolls.delete(lru); // his memory dies with the round it belonged to
		roundIds.delete(lru); // and the view-state token keyed to that round
		boardSeeds.delete(lru); // and the round's board order
		resetLog(lru); // and the demo log, lifecycle-linked to the same round
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
	skolls.delete(sessionId); // a new round wipes the wolf's memory; recreated lazily on his turn
	roundIds.delete(sessionId); // and the view-state token — the next read mints a fresh round id
	boardSeeds.delete(sessionId); // and the board order — a fresh round deals a fresh layout
	resetLog(sessionId); // and the demo log — a fresh round starts the on-stage record over
	return remember(sessionId, create(sessionId, seed ?? randomSeed()));
}

/**
 * The session's per-round token for the client's view-state storage key. Stable across a
 * refresh (same round), regenerated on a new round so persisted crossings/transcript never
 * restore onto a fresh secret. Opaque and independent of the secret seed.
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

/** Live session count — bounded by MAX_SESSIONS. */
export function sessionCount(): number {
	return engines.size;
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
