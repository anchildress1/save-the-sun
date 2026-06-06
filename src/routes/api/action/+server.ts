import { json, error } from '@sveltejs/kit';
import { handleAction, type GameAction } from '$lib/server/engine/actions';
import type { RequestHandler } from './$types';

const ACTION_TYPES = new Set(['Ask', 'Cast', 'CrossOff', 'React']);

// Single server entry point for game actions. Both the human UI and (later) the
// Gemini-driven Sköll route through handleAction — no second path.
export const POST: RequestHandler = async ({ request }) => {
	let body: Partial<GameAction>;
	try {
		body = await request.json();
	} catch {
		error(400, 'Malformed action payload.');
	}

	if (!body || typeof body.type !== 'string' || !ACTION_TYPES.has(body.type)) {
		error(400, 'Unknown action type.');
	}

	return json(handleAction(body as GameAction));
};
