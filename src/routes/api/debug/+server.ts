import { json } from '@sveltejs/kit';
import { getLog } from '$lib/server/debug/log';
import type { RequestHandler } from './$types';

// The demo log for this session (S8). Read-only; the /debug view polls it to refresh on stage.
// Carries no secret — only already-resolved answers and cast verdicts the player has already seen.
export const GET: RequestHandler = ({ locals }) => json({ entries: getLog(locals.sessionId) });
