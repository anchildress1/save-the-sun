import { json, error } from '@sveltejs/kit';
import { handleAction, type GameAction } from '$lib/server/engine/actions';
import { getEngine } from '$lib/server/engine/session';
import { interpret } from '$lib/server/oracle/gemini';
import type { RequestHandler } from './$types';

const ACTION_TYPES = new Set(['Ask', 'Cast', 'CrossOff', 'React']);
const PLAYERS = new Set(['Human', 'Sköll']);
const REACTIONS = new Set(['Scry', 'Hex', 'Pass']);

function isAction(body: Partial<GameAction>): body is GameAction {
	if (!body || typeof body.type !== 'string' || !ACTION_TYPES.has(body.type)) return false;
	if (!('player' in body) || typeof body.player !== 'string' || !PLAYERS.has(body.player))
		return false;

	switch (body.type) {
		case 'Ask':
			return 'question' in body && typeof body.question === 'string';
		case 'Cast':
			return 'runeName' in body && typeof body.runeName === 'string';
		case 'CrossOff':
			return (
				'runeId' in body &&
				typeof body.runeId === 'number' &&
				Number.isInteger(body.runeId) &&
				'crossed' in body &&
				typeof body.crossed === 'boolean'
			);
		case 'React':
			return (
				'reaction' in body && typeof body.reaction === 'string' && REACTIONS.has(body.reaction)
			);
		default:
			return false;
	}
}

// Single server entry point for game actions. Both the human UI and (later) the
// Gemini-driven Sköll route through handleAction — no second path.
export const POST: RequestHandler = async ({ request, locals }) => {
	let body: Partial<GameAction>;
	try {
		body = await request.json();
	} catch {
		error(400, 'Malformed action payload.');
	}

	if (!body || typeof body.type !== 'string' || !ACTION_TYPES.has(body.type)) {
		error(400, 'Unknown action type.');
	}

	if (!isAction(body)) {
		error(400, 'Malformed action payload.');
	}

	const engine = getEngine(locals.sessionId);
	const result = await handleAction(body, { engine, interpret });

	// Pre-Sköll shim (S6): the opponent has no mover yet, so skip his turn and hand
	// play straight back to the human. Remove once the Gemini opponent is wired.
	if (engine.status === 'active' && engine.activePlayer === 'Sköll') engine.passTurn();

	return json(result);
};
