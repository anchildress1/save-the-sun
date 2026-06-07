// Per-session engine registry (S2.5): one GameEngine per sessionId, no shared state.

import { dev } from '$app/environment';
import { GameEngine, selectSecret } from './engine';

// Unbounded — eviction (TTL/LRU) deferred; not needed at v1 jam scope.
const engines = new Map<string, GameEngine>();

function randomSeed(): number {
	return crypto.getRandomValues(new Uint32Array(1))[0];
}

// Dev-only: log the secret so a reseed is visible in the server log.
function create(sessionId: string, seed: number): GameEngine {
	if (dev)
		console.debug(
			`[session ${sessionId}] new round — secret: ${selectSecret(seed).name} (seed ${seed})`
		);
	return new GameEngine(seed);
}

/** The session's engine, lazily created and memoized on first use. */
export function getEngine(sessionId: string): GameEngine {
	let engine = engines.get(sessionId);
	if (engine === undefined) {
		engine = create(sessionId, randomSeed());
		engines.set(sessionId, engine);
	}
	return engine;
}

/** Start a fresh round for one session; pass a seed for a deterministic secret. */
export function resetEngine(sessionId: string, seed?: number): GameEngine {
	const engine = create(sessionId, seed ?? randomSeed());
	engines.set(sessionId, engine);
	return engine;
}
