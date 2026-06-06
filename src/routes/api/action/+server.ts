import { json, error } from '@sveltejs/kit';
import { handleAction, type GameAction } from '$lib/server/engine/actions';
import { getEngine } from '$lib/server/engine/session';
import { interpret } from '$lib/server/oracle/gemini';
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

	return json(await handleAction(body as GameAction, { engine: getEngine(), interpret }));
};
