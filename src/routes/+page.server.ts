import { getEngine, getSkoll } from '$lib/server/engine/session';
import { gameState, type PendingReaction } from '$lib/server/engine/actions';
import { skollAskEcho } from '$lib/server/skoll/skoll';
import type { PageServerLoad } from './$types';

// Seed for the on-screen board ORDER only — the shuffle that keeps element/light-dark
// groupings from jumping out. This is display state: public, shown on screen, and later
// shared with Sköll so he reasons over the same layout. It is NOT the secret. The secret
// rune is the engine's own concern (backend referee, chosen independently) and must never
// be derivable from this public order. Generated on the server so SSR and hydration share
// one order.
export const load: PageServerLoad = ({ locals }) => {
	// Lazily ensure the session's engine — a refresh resumes the same round, it does NOT
	// reseed. The secret lives as long as the session; a fresh round comes from POST
	// /api/new-game or a brand-new session (first visit / cleared cookie).
	const engine = getEngine(locals.sessionId);

	// A round can resume on Sköll's *parked* Ask — his question declared, awaiting the human's
	// reaction. The reaction window lives only on the server, so without this the prompt would
	// vanish on refresh and the round would soft-lock (his move can't advance past a parked Ask).
	// Rehydrate the prompt + the human's still-held charges so the interrupt survives a reload.
	// Explicitly typed (not an inferred evolving-`any`) so PageData.pendingReaction stays sound.
	let pendingReaction: PendingReaction | null = null;
	if (engine.reactionWindow === 'Sköll') {
		const skoll = getSkoll(locals.sessionId);
		if (skoll.pendingAsk !== null) {
			pendingReaction = {
				echo: skollAskEcho(skoll.pendingAsk),
				held: {
					Scry: engine.reactionAvailable('Human', 'Scry'),
					Hex: engine.reactionAvailable('Human', 'Hex')
				}
			};
		}
	}

	// Web Crypto rather than Math.random — harmless for a display seed and keeps a single
	// secure RNG path (and clears the Sonar weak-PRNG hotspot). Returns a uint32, which
	// mulberry32 consumes via seed >>> 0.
	return {
		boardSeed: crypto.getRandomValues(new Uint32Array(1))[0],
		// Hydrate the real turn/round state so a resumed round (incl. one already won) renders
		// truthfully on load instead of guessing "Your move." and flipping on the first action.
		state: gameState(engine),
		pendingReaction
	};
};
