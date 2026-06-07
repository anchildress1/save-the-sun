import { json, error } from '@sveltejs/kit';
import {
	handleAction,
	gameState,
	type GameAction,
	type SkollTurn,
	type SkollReaction,
	type AdvanceResponse
} from '$lib/server/engine/actions';
import { getEngine, getSkoll, withSessionLock } from '$lib/server/engine/session';
import { interpret } from '$lib/server/oracle/gemini';
import { voiceAnswer, prepareAsk, answerAsk } from '$lib/server/oracle/oracle';
import { resolveReaction } from '$lib/server/engine/reactions';
import {
	takeSkollTurn,
	resolveSkollAsk,
	reactToHumanAsk,
	type SkollOutcome,
	type SkollState
} from '$lib/server/skoll/skoll';
import { decideSkollMove, decideSkollReaction } from '$lib/server/skoll/gemini';
import { castLine, tauntAt } from '$lib/server/skoll/taunts';
import type { GameEngine } from '$lib/server/engine/engine';
import type { RequestHandler } from './$types';

// 'Advance' is not a player action — it's the client asking the engine to run Sköll's pending turn
// as its own request, so the human's answer never waits behind the wolf's move.
const ACTION_TYPES = new Set(['Ask', 'Cast', 'CrossOff', 'React', 'Advance']);
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

// Single server entry point for game actions. Both the human UI and the Gemini-driven Sköll route
// through the engine here — no second path. Validation is pure (no session state) and runs before
// the lock; everything that touches the shared engine/Sköll memory runs UNDER the per-session lock,
// so a duplicate tab / retry / direct POST can't interleave while a turn awaits Gemini.
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

	// Advance carries no payload; every other type must be a well-formed action.
	if ((body.type as string) !== 'Advance' && !isAction(body)) {
		error(400, 'Malformed action payload.');
	}

	return withSessionLock(locals.sessionId, () => resolveAction(body, locals.sessionId));
};

async function resolveAction(body: Partial<GameAction>, sessionId: string): Promise<Response> {
	const engine = getEngine(sessionId);
	const skoll = getSkoll(sessionId);

	// Sköll's turn is its own request: the client fires this after any action that hands him the
	// turn, so the human's answer lands first and his move shows under a live "Sköll moves." pill.
	// A no-op if it isn't his turn (or his Ask is already parked), so a stray Advance is harmless.
	if ((body.type as string) === 'Advance') {
		const skollTurn = await playSkollIfActive(engine, skoll);
		const response: AdvanceResponse = {
			type: 'Advance',
			...(skollTurn && { skoll: skollTurn }),
			state: gameState(engine)
		};
		return json(response);
	}

	// Past Advance, validation in POST guarantees a well-formed player action.
	const action = body as GameAction;

	// The human reacting to Sköll's open Ask: resolve the reaction, then close his Ask (Hex kills
	// it before any answer; Pass/Scry answers it, Scry shares it back). A distinct path because it
	// completes a turn Sköll already opened, rather than starting a fresh action.
	if (action.type === 'React' && skoll.pendingAsk !== null && engine.reactionWindow === 'Sköll') {
		const askedQuery = skoll.pendingAsk;
		const reaction = resolveReaction(engine, 'Human', action.reaction);
		const answer = resolveSkollAsk(engine, skoll, reaction);
		const skollReaction: SkollReaction = answer.hexed
			? { hexed: true }
			: {
					hexed: false,
					...(answer.shared && { scried: { answer: voiceAnswer(askedQuery, answer.affirmative) } })
				};
		return json({ type: 'React', outcome: reaction, skollReaction, state: gameState(engine) });
	}

	// The human's Ask: Sköll may interrupt it (R12 reverse) before the answer — Hex kills it, Scry
	// overhears it. Gated on it actually being the human's live turn, so a stale Ask (Sköll's turn, or
	// a resolved round) falls through to a clean not-your-turn / round-over with NO side effects —
	// rather than opening a 'Human' window, spending Sköll's charge, or flipping the turn.
	if (
		action.type === 'Ask' &&
		action.player === 'Human' &&
		engine.status === 'active' &&
		engine.activePlayer === 'Human'
	) {
		return askWithSkollReaction(engine, skoll, action.question);
	}

	const result = await handleAction(action, { engine, interpret });
	return json({ ...result, state: gameState(engine) });
}

async function askWithSkollReaction(engine: GameEngine, skoll: SkollState, question: string) {
	const prepared = await prepareAsk(question, interpret);
	// A refusal never opens a window, spends a turn, or rouses Sköll — it just bounces back.
	if (!prepared.ok) return json({ type: 'Ask', oracle: prepared.result, state: gameState(engine) });

	const vs = await reactToHumanAsk(engine, skoll, prepared.query, decideSkollReaction, skoll.rng);
	let oracle;
	if (vs.killed) {
		engine.passTurn(); // her question dies; her turn is spent with no answer
	} else {
		oracle = answerAsk(engine, 'Human', prepared.query, prepared.paraphrase);
		// A Scry lets Sköll overhear her truthful answer — his earned fact, his to use.
		if (vs.scried && oracle.ok)
			skoll.facts.push({ query: prepared.query, answer: oracle.affirmative });
	}

	// The turn now sits with Sköll; the client advances him in a follow-up request.
	return json({
		type: 'Ask',
		...(oracle && { oracle }),
		skollVsYou: { reaction: vs.choice },
		state: gameState(engine)
	});
}

async function playSkollIfActive(
	engine: GameEngine,
	skoll: SkollState
): Promise<SkollTurn | undefined> {
	if (engine.status !== 'active' || engine.activePlayer !== 'Sköll') return undefined;
	// He already has an Ask parked, waiting on the human's reaction — never start a second turn.
	if (skoll.pendingAsk !== null) return undefined;
	const out = await takeSkollTurn(engine, skoll, decideSkollMove, skoll.rng);
	const turn = describeTurn(out, tauntAt(skoll.tauntIndex));
	skoll.tauntIndex += 1;
	return turn;
}
