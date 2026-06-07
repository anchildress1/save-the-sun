import { resetEngine } from '$lib/server/engine/session';
import type { PageServerLoad } from './$types';

// Seed for the on-screen board ORDER only — the shuffle that keeps element/light-dark
// groupings from jumping out. This is display state: public, shown on screen, and later
// shared with Sköll so he reasons over the same layout. It is NOT the secret. The secret
// rune is the engine's own concern (backend referee, chosen independently) and must never
// be derivable from this public order. Generated on the server so SSR and hydration share
// one order.
export const load: PageServerLoad = ({ locals }) => {
	// A refresh starts a new night: reseed this session's engine (new secret, human-first).
	resetEngine(locals.sessionId);
	// Web Crypto rather than Math.random — harmless for a display seed and keeps a single
	// secure RNG path (and clears the Sonar weak-PRNG hotspot). Returns a uint32, which
	// mulberry32 consumes via seed >>> 0.
	return { boardSeed: crypto.getRandomValues(new Uint32Array(1))[0] };
};
