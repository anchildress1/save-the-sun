import { getLog } from '$lib/server/debug/log';
import type { PageServerLoad } from './$types';

// First paint of the demo log; the page then polls /api/debug to stay live while screen-shared.
export const load: PageServerLoad = ({ locals }) => ({ entries: getLog(locals.sessionId) });
