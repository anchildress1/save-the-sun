import { json } from '@sveltejs/kit';
import { getEvents } from '$lib/server/debug/log';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	return json({ events: getEvents(locals.sessionId) });
};
