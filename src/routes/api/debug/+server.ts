import { json } from '@sveltejs/kit';
import { getEvents, filterForLevel, debugLevel } from '$lib/server/debug/log';
import type { RequestHandler } from './$types';

// The DEBUG_LOG filter runs here, server-side, so sensitive events never reach the wire below verbose.
export const GET: RequestHandler = ({ locals }) => {
	const level = debugLevel();
	return json({ level, events: filterForLevel(getEvents(locals.sessionId), level) });
};
