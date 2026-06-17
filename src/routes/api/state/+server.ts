import { json } from '@sveltejs/kit';
import { gameSnapshot } from '$lib/server/engine/snapshot';
import { withSessionLock } from '$lib/server/engine/session';
import type { RequestHandler } from './$types';

// Authoritative current-round snapshot for the client to resync after a dropped action response — a
// timed-out or failed POST the server still applied under withSessionLock leaves the client diverged
// (stale turn/board, a retry that no-ops). Same shape as the page load.
//
// Read BEHIND withSessionLock: when the client timed out because its action is still running, this
// read must queue behind that in-flight writer and snapshot only once it commits — otherwise the
// resync races the locked mutation and re-applies stale state. Read-only: resumes, never resets.
export const GET: RequestHandler = ({ locals }) =>
	withSessionLock(locals.sessionId, async () => json(gameSnapshot(locals.sessionId)));
