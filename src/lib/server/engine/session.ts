// Single-session engine holder (S2 seam); S3 replaces it with per-player state.

import { dev } from '$app/environment';
import { GameEngine, selectSecret } from './engine';

let engine: GameEngine | null = null;

function randomSeed(): number {
	return crypto.getRandomValues(new Uint32Array(1))[0];
}

// Dev-only: surface the secret on every new round so a reseed (refresh, or an HMR
// module reset) is visible in the server log. Never logged in build/test.
function create(seed: number): GameEngine {
	if (dev) console.debug(`[session] new round — secret: ${selectSecret(seed).name} (seed ${seed})`);
	return new GameEngine(seed);
}

export function getEngine(): GameEngine {
	engine ??= create(randomSeed());
	return engine;
}

/** Start a fresh round; pass a seed for a deterministic secret. */
export function resetEngine(seed?: number): GameEngine {
	engine = create(seed ?? randomSeed());
	return engine;
}
