import { json } from '@sveltejs/kit';
import { gameSnapshot } from '$lib/server/engine/snapshot';
import type { RequestHandler } from './$types';

// Authoritative current-round snapshot for the client to resync after a dropped action response — a
// timed-out or failed POST the server still applied under withSessionLock leaves the client diverged
// (stale turn/board, a retry that no-ops). Same shape as the page load. Read-only: resumes the
// session's round, never resets it.
export const GET: RequestHandler = ({ locals }) => json(gameSnapshot(locals.sessionId));
