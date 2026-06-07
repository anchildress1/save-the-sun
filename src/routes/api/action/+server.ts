import { json, error } from '@sveltejs/kit';
import {
	handleAction,
	gameState,
	type GameAction,
	type SkollTurn,
	type SkollReaction
} from '$lib/server/engine/actions';
import { getEngine, getSkoll } from '$lib/server/engine/session';
import { interpret } from '$lib/server/oracle/gemini';
import { voiceAnswer } from '$lib/server/oracle/oracle';
import { resolveReaction } from '$lib/server/engine/reactions';
import {
	takeSkollTurn,
	resolveSkollAsk,
	type SkollOutcome,
	type SkollState
} from '$lib/server/skoll/skoll';
import { decideSkollMove } from '$lib/server/skoll/gemini';
import { castLine, tauntAt } from '$lib/server/skoll/taunts';
import { mulberry32 } from '$lib/prng';
import type { GameEngine } from '$lib/server/engine/engine';
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

// Same seed + same accumulated state → same fallback move (reproducible for the demo).
function floorRng(skoll: SkollState): () => number {
	return mulberry32((skoll.seed + skoll.facts.length) >>> 0);
}

// Map his resolved turn into the wire DTO the client voices and reacts to.
function describeTurn(out: SkollOutcome, taunt: string): SkollTurn {
	return out.kind === 'cast'
		? {
				taunt,
				cast: {
					line: castLine(out.runeName, out.result.ok && out.result.won),
					won: out.result.ok && out.result.won
				}
			}
		: { taunt, asks: { echo: out.echo } };
}

// Single server entry point for game actions. Both the human UI and the Gemini-driven Sköll
// route through the engine here — no second path. The client's single `pending` flag serializes
// a session's requests, so one Sköll turn never overlaps the next action.
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
	const skoll = getSkoll(locals.sessionId);

	// The human reacting to Sköll's open Ask: resolve the reaction, then close his Ask (Hex kills
	// it before any answer; Pass/Scry answers it, Scry shares it back). This is a distinct path
	// because it completes a turn Sköll already opened, rather than starting a fresh action.
	if (body.type === 'React' && skoll.pendingAsk !== null && engine.reactionWindow === 'Sköll') {
		const askedQuery = skoll.pendingAsk;
		const reaction = resolveReaction(engine, 'Human', body.reaction);
		const answer = resolveSkollAsk(engine, skoll, reaction);
		const skollReaction: SkollReaction = answer.hexed
			? { hexed: true }
			: {
					hexed: false,
					...(answer.shared && { scried: { answer: voiceAnswer(askedQuery, answer.affirmative) } })
				};
		return json({ type: 'React', outcome: reaction, skollReaction, state: gameState(engine) });
	}

	const result = await handleAction(body, { engine, interpret });

	// The human's action handed the turn to Sköll → the wolf plays through the same interface.
	// He casts (the round may end) or opens his own reaction window (the client then prompts).
	const skollTurn = await playSkollIfActive(engine, skoll);

	return json({ ...result, ...(skollTurn && { skoll: skollTurn }), state: gameState(engine) });
};

async function playSkollIfActive(
	engine: GameEngine,
	skoll: SkollState
): Promise<SkollTurn | undefined> {
	if (engine.status !== 'active' || engine.activePlayer !== 'Sköll') return undefined;
	const out = await takeSkollTurn(engine, skoll, decideSkollMove, floorRng(skoll));
	const turn = describeTurn(out, tauntAt(skoll.tauntIndex));
	skoll.tauntIndex += 1;
	return turn;
}
