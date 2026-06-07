import { json } from '@sveltejs/kit';
import { resetEngine } from '$lib/server/engine/session';
import type { RequestHandler } from './$types';

// Explicit new round. A refresh resumes the round, so this is the only path to a fresh
// secret + layout. Returns a new public board seed (independent of the secret).
export const POST: RequestHandler = ({ locals }) => {
	resetEngine(locals.sessionId);
	return json({ boardSeed: crypto.getRandomValues(new Uint32Array(1))[0] });
};
