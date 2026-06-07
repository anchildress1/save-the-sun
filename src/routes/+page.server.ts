import { resetEngine } from '$lib/server/engine/session';
import type { PageServerLoad } from './$types';

// Seed for the on-screen board ORDER only — the shuffle that keeps element/light-dark
// groupings from jumping out. This is display state: public, shown on screen, and later
// shared with Sköll so he reasons over the same layout. It is NOT the secret. The secret
// rune is the engine's own concern (backend referee, chosen independently) and must never
// be derivable from this public order. Generated on the server so SSR and hydration share
// one order.
export const load: PageServerLoad = () => {
	// A refresh starts a new night: reseed the engine (new secret, human-first) so the fresh
	// board this load renders is paired with a fresh secret, not the one kept alive in the
	// module across reloads. (Crossings are client-only and clear on remount; the secret is
	// reseeded independently of the public board order below.)
	resetEngine();
	// Web Crypto rather than Math.random — harmless for a display seed and keeps a single
	// secure RNG path (and clears the Sonar weak-PRNG hotspot). Returns a uint32, which
	// mulberry32 consumes via seed >>> 0.
	return { boardSeed: crypto.getRandomValues(new Uint32Array(1))[0] };
};
