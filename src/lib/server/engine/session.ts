// Single-session engine holder (S2 seam); S3 replaces it with per-player state.

import { GameEngine } from './engine';

let engine: GameEngine | null = null;

function randomSeed(): number {
	return crypto.getRandomValues(new Uint32Array(1))[0];
}

export function getEngine(): GameEngine {
	engine ??= new GameEngine(randomSeed());
	return engine;
}

/** Start a fresh round; pass a seed for a deterministic secret. */
export function resetEngine(seed?: number): GameEngine {
	engine = new GameEngine(seed ?? randomSeed());
	return engine;
}
