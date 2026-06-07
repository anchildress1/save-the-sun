import { json } from '@sveltejs/kit';
import { resetEngine } from '$lib/server/engine/session';
import type { RequestHandler } from './$types';

// Explicit in-session new round. A refresh resumes, so this (or a brand-new session) is how
// a player gets a fresh secret + layout. Returns a new public board seed (independent of it).
export const POST: RequestHandler = ({ locals }) => {
	resetEngine(locals.sessionId);
	return json({ boardSeed: crypto.getRandomValues(new Uint32Array(1))[0] });
};
