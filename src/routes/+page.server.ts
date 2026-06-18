import { gameSnapshot } from '$lib/server/engine/snapshot';
import type { PageServerLoad } from './$types';

// The board ORDER seed is display state (public, later shared with Sköll so he reasons over the same
// layout) — never the secret, which the engine chooses independently as backend referee. A refresh
// resumes the same round (lazy getEngine inside the snapshot); only POST /api/new-game or a fresh
// session reseeds. See gameSnapshot for the full hydration (turn state + Sköll's parked Ask).
export const load: PageServerLoad = ({ locals }) => gameSnapshot(locals.sessionId);
