import { getEvents, filterForLevel, debugLevel } from '$lib/server/debug/log';
import type { PageServerLoad } from './$types';

// First paint of the demo log; the page then polls /api/debug to stay live while screen-shared.
// Filtered to the DEBUG_LOG level here so sensitive events never reach the client (see api/debug).
export const load: PageServerLoad = ({ locals }) => {
	const level = debugLevel();
	return { level, events: filterForLevel(getEvents(locals.sessionId), level) };
};
