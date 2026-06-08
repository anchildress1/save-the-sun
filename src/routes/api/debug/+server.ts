import { json } from '@sveltejs/kit';
import { getEvents, filterForLevel, debugLevel } from '$lib/server/debug/log';
import type { RequestHandler } from './$types';

// The demo log for this session (S8). Read-only; the /debug view polls it to refresh on stage. The
// DEBUG_LOG level decides what is handed back: off → nothing, demo → secret + raw model I/O stripped,
// verbose → everything. The filter runs here, server-side, so sensitive events never reach the wire.
export const GET: RequestHandler = ({ locals }) => {
	const level = debugLevel();
	return json({ level, events: filterForLevel(getEvents(locals.sessionId), level) });
};
