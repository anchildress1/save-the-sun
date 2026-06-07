// Per-session engine registry (S2.5): one GameEngine per sessionId, no shared state.

import { dev } from '$app/environment';
import { GameEngine, selectSecret } from './engine';

// LRU-capped so abandoned rounds can't grow memory without bound. Map keeps insertion
// order, so the first key is the least-recently-used; every access re-inserts to the end.
// Eviction is by access recency, not engine status — a game in active play is touched each
// move so it stays warm, but a round nobody touches can still be evicted. 1000 is far above
// any plausible concurrent jam load while staying trivially small in memory.
export const MAX_SESSIONS = 1000;
const engines = new Map<string, GameEngine>();

function randomSeed(): number {
	return crypto.getRandomValues(new Uint32Array(1))[0];
}

// Dev-only: log the secret so a new round is visible in the server log.
function create(sessionId: string, seed: number): GameEngine {
	if (dev)
		console.debug(
			`[session ${sessionId}] new round — secret: ${selectSecret(seed).name} (seed ${seed})`
		);
	return new GameEngine(seed);
}

// Mark a session most-recently-used (re-insert at the end) and evict the LRU if over cap.
function remember(sessionId: string, engine: GameEngine): GameEngine {
	engines.delete(sessionId);
	engines.set(sessionId, engine);
	if (engines.size > MAX_SESSIONS) {
		// size > cap ⇒ the registry is non-empty, so the first key always exists.
		const [lru] = engines.keys();
		engines.delete(lru);
	}
	return engine;
}

/** The session's engine, lazily created and memoized on first use. */
export function getEngine(sessionId: string): GameEngine {
	const existing = engines.get(sessionId);
	return remember(sessionId, existing ?? create(sessionId, randomSeed()));
}

/** Start a fresh round for one session; pass a seed for a deterministic secret. */
export function resetEngine(sessionId: string, seed?: number): GameEngine {
	return remember(sessionId, create(sessionId, seed ?? randomSeed()));
}

/** Live session count — bounded by MAX_SESSIONS. */
export function sessionCount(): number {
	return engines.size;
}
