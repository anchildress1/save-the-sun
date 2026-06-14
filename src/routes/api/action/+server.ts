import { json, error } from '@sveltejs/kit';
import {
	handleAction,
	gameState,
	type GameAction,
	type SkollTurn,
	type SkollReaction,
	type AdvanceResponse,
	type Player
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
import { logEvent, drainGemini, runWithSession, type TurnPart } from '$lib/server/debug/log';
import type { CastResult, GameEngine } from '$lib/server/engine/engine';
import type { RequestHandler } from './$types';

// 'Advance' is not a player action — it's the client asking the engine to run Sköll's pending turn.
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

function castTruth(player: Player, runeName: string, won: boolean): string {
	return won
		? `Cast ${runeName} — the rune is true (${player} wins)`
		: `Cast ${runeName} — wrong, the round continues`;
}

const castWon = (result: CastResult): boolean => result.ok && result.won;

// A verdict is owned by the Engine, never the actor whose turn it was — the referee's truth, not the
// asker's claim.
function engineVerdict(sessionId: string, part: TurnPart, truth: string): void {
	logEvent(sessionId, {
		owner: 'Engine',
		kind: 'deterministic',
		part,
		level: 'info',
		message: truth
	});
}

// Her raw free-text Ask, distinct from the Oracle's reading of it.
function humanAsks(sessionId: string, question: string): void {
	logEvent(sessionId, {
		owner: 'Human',
		kind: 'input',
		part: 'Ask',
		level: 'info',
		message: `asks "${question}"`,
		data: { question }
	});
}

// The raw Gemini I/O, drained onto the log: the Oracle's interpret call is hers; the move and
// reaction calls are Sköll's own.
function geminiEvents(sessionId: string, movePart: TurnPart): void {
	for (const call of drainGemini(sessionId)) {
		const oracle = call.label === 'oracle';
		let part: TurnPart = movePart;
		if (oracle) part = 'Ask';
		else if (call.label === 'reaction') part = 'React';
		logEvent(sessionId, {
			owner: oracle ? 'Oracle' : 'Sköll',
			kind: 'llm',
			part,
			level: call.error ? 'error' : 'info',
			message: `raw Gemini ${call.label} call${call.error ? ' failed' : ''}`,
			data: call.error
				? { request: call.request, error: call.error }
				: { request: call.request, response: call.response }
		});
	}
}

// His templated Ask is surfaced for the human to react to; a Cast carries no flavor line. The query
// rides along so the client can voice the Ask through the TTS route (server recomposes the line).
function describeTurn(out: SkollOutcome): SkollTurn {
	return out.kind === 'ask' ? { asks: { echo: out.echo, query: out.query } } : {};
}

// Validation is pure and runs before the lock; everything touching shared engine/Sköll memory runs
// under the per-session lock, so a duplicate tab / retry / direct POST can't interleave mid-turn.
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

	// runWithSession scopes any raw Gemini I/O teed this turn to THIS session's sink, never another's.
	return withSessionLock(locals.sessionId, () =>
		runWithSession(locals.sessionId, () => resolveAction(body, locals.sessionId))
	);
};

async function resolveAction(body: Partial<GameAction>, sessionId: string): Promise<Response> {
	const engine = getEngine(sessionId);
	const skoll = getSkoll(sessionId);

	// Sköll's turn is its own request so the human's answer lands first. A no-op if it isn't his turn
	// (or his Ask is already parked), so a stray Advance is harmless.
	if ((body.type as string) === 'Advance') {
		const skollTurn = await playSkollIfActive(sessionId, engine, skoll);
		const response: AdvanceResponse = {
			type: 'Advance',
			...(skollTurn && { skoll: skollTurn }),
			state: gameState(engine)
		};
		return json(response);
	}

	// Past Advance, validation in POST guarantees a well-formed player action.
	const action = body as GameAction;

	// The human reacting to Sköll's open Ask: a Hex kills it before any answer; Pass/Scry answers it,
	// Scry shares it back. Distinct path — it closes a turn Sköll already opened.
	if (action.type === 'React' && skoll.pendingAsk !== null && engine.reactionWindow === 'Sköll') {
		const askedQuery = skoll.pendingAsk;
		logEvent(sessionId, {
			owner: 'Human',
			kind: 'input',
			part: 'React',
			level: 'info',
			message: `reacts to Sköll's Ask: ${action.reaction}`,
			data: { choice: action.reaction }
		});
		const reaction = resolveReaction(engine, 'Human', action.reaction);
		const answer = resolveSkollAsk(engine, skoll, reaction);
		engineVerdict(
			sessionId,
			'Ask',
			answer.hexed
				? 'Hexed by the witch — the question dies, his turn spent'
				: voiceAnswer(askedQuery, answer.affirmative)
		);
		const skollReaction: SkollReaction = answer.hexed
			? { hexed: true }
			: {
					hexed: false,
					...(answer.shared && {
						scried: {
							answer: voiceAnswer(askedQuery, answer.affirmative),
							query: askedQuery,
							affirmative: answer.affirmative
						}
					})
				};
		return json({ type: 'React', outcome: reaction, skollReaction, state: gameState(engine) });
	}

	// Gated on it actually being the human's live turn, so a stale Ask (Sköll's turn, or a resolved
	// round) falls through with NO side effects rather than opening a window or spending a charge.
	if (
		action.type === 'Ask' &&
		action.player === 'Human' &&
		engine.status === 'active' &&
		engine.activePlayer === 'Human'
	) {
		return askWithSkollReaction(sessionId, engine, skoll, action.question);
	}

	const result = await handleAction(action, { engine, interpret });
	// The fallback Ask path (stale turn, resolved round) still ran interpret — drain its raw I/O.
	if (result.type === 'Ask') geminiEvents(sessionId, 'Ask');
	if (result.type === 'Cast' && result.cast.ok) {
		const runeName = (action as { runeName: string }).runeName;
		logEvent(sessionId, {
			owner: action.player,
			kind: 'input',
			part: 'Cast',
			level: 'info',
			message: `casts ${runeName}`
		});
		engineVerdict(sessionId, 'Cast', castTruth(action.player, runeName, result.cast.won));
	}
	return json({ ...result, state: gameState(engine) });
}

async function askWithSkollReaction(
	sessionId: string,
	engine: GameEngine,
	skoll: SkollState,
	question: string
) {
	const prepared = await prepareAsk(question, interpret);
	humanAsks(sessionId, question);
	// Drain her interpret call now so its raw I/O lands between her Ask and the Oracle's reading.
	geminiEvents(sessionId, 'Ask');
	// A refusal never opens a window, spends a turn, or rouses Sköll.
	if (!prepared.ok) {
		logEvent(sessionId, {
			owner: 'Oracle',
			kind: 'llm',
			part: 'Ask',
			level: 'warn',
			message: `Oracle refuses the sign`,
			data: { result: prepared.result }
		});
		return json({ type: 'Ask', oracle: prepared.result, state: gameState(engine) });
	}
	logEvent(sessionId, {
		owner: 'Oracle',
		kind: 'llm',
		part: 'Ask',
		level: 'info',
		message: `reads it as: ${prepared.paraphrase}`,
		data: { query: prepared.query }
	});

	const vs = await reactToHumanAsk(engine, skoll, prepared.query, decideSkollReaction, skoll.rng);
	geminiEvents(sessionId, 'React');
	logEvent(sessionId, {
		owner: 'Sköll',
		kind: vs.source === 'gemini' ? 'llm' : 'deterministic',
		part: 'React',
		level: 'info',
		message: `reacts to your Ask: ${vs.choice}`,
		data: { choice: vs.choice, source: vs.source }
	});

	let oracle;
	if (vs.killed) {
		engine.passTurn(); // her question dies; her turn is spent with no answer
	} else {
		oracle = answerAsk(engine, 'Human', prepared.query, prepared.paraphrase);
		// A Scry lets Sköll overhear her answer — his earned fact.
		if (vs.scried && oracle.ok)
			skoll.facts.push({ query: prepared.query, answer: oracle.affirmative });
	}

	let truth: string;
	if (vs.killed) truth = 'Hexed by Sköll — the Oracle is silent, her turn spent';
	else if (oracle?.ok) truth = oracle.answer;
	else truth = 'engine declined the Ask';
	engineVerdict(sessionId, 'Ask', truth);

	// The turn now sits with Sköll; the client advances him in a follow-up request.
	return json({
		type: 'Ask',
		...(oracle && { oracle }),
		skollVsYou: { reaction: vs.choice },
		state: gameState(engine)
	});
}

async function playSkollIfActive(
	sessionId: string,
	engine: GameEngine,
	skoll: SkollState
): Promise<SkollTurn | undefined> {
	if (engine.status !== 'active' || engine.activePlayer !== 'Sköll') return undefined;
	// He already has an Ask parked, waiting on the human's reaction — never start a second turn.
	if (skoll.pendingAsk !== null) return undefined;
	// Snapshot the sheet BEFORE the move so the event shows only the delta crossed THIS turn, matching
	// `reasoning` (the pre-move state) — not the post-move sheet, which read one move ahead.
	const before = new Set(skoll.crossed);
	const out = await takeSkollTurn(engine, skoll, decideSkollMove, skoll.rng);
	const part: TurnPart = out.kind === 'cast' ? 'Cast' : 'Ask';
	geminiEvents(sessionId, part);
	const crossedThisMove = [...skoll.crossed].filter((id) => !before.has(id));

	// llm when Gemini decided, deterministic + warn when the floor did (so a fallback stands out).
	const floored = out.source === 'floor';
	logEvent(sessionId, {
		owner: 'Sköll',
		kind: floored ? 'deterministic' : 'llm',
		part,
		level: floored ? 'warn' : 'info',
		message: out.kind === 'cast' ? `casts ${out.runeName}` : out.echo,
		data: {
			source: out.source,
			reasoning: out.reasoning,
			...(crossedThisMove.length > 0 && { crossedThisMove })
		}
	});

	// His Cast resolves now; his Ask's verdict waits for the human's reaction.
	if (out.kind === 'cast')
		engineVerdict(sessionId, 'Cast', castTruth('Sköll', out.runeName, castWon(out.result)));
	return describeTurn(out);
}
