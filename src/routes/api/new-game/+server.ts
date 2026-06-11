import { json } from '@sveltejs/kit';
import { resetEngine, getRoundId, getBoardSeed } from '$lib/server/engine/session';
import { gameState } from '$lib/server/engine/actions';
import type { RequestHandler } from './$types';

// Explicit in-session new round. A refresh resumes, so this (or a brand-new session) is how
// a player gets a fresh secret + layout. Returns a new public board seed (independent of it),
// the fresh per-round token (so the client re-keys its view storage to the new round), and the
// fresh turn snapshot, so the client resets from engine truth rather than guessing.
export const POST: RequestHandler = ({ locals }) => {
	const engine = resetEngine(locals.sessionId);
	return json({
		// The reset dropped the held seed, so this mints the fresh round's layout.
		boardSeed: getBoardSeed(locals.sessionId),
		roundId: getRoundId(locals.sessionId),
		state: gameState(engine)
	});
};
