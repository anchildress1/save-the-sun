import { json, error } from '@sveltejs/kit';
import {
	handleAction,
	gameState,
	type GameAction,
	type SkollTurn,
	type SkollReaction,
	type AdvanceResponse,
	type AuthoredLine,
	type Player
} from '$lib/server/engine/actions';
import { getEngine, getSkoll, withSessionLock, recordLine } from '$lib/server/engine/session';
import { composeLine, type LineDescriptor } from '$lib/server/voice/lines';
import { interpret, composeOracleFlair, composeEndingFlair } from '$lib/server/oracle/gemini';
import { voiceAnswer, prepareAsk, answerAsk } from '$lib/server/oracle/oracle';
import type { OracleResult } from '$lib/server/oracle/types';
import { signLine } from '$lib/server/voice/sign';
import { ORACLE_VOICE, SKOLL_VOICE } from '$lib/voice/config';
import { resolveReaction } from '$lib/server/engine/reactions';
import {
	takeSkollTurn,
	resolveSkollAsk,
	reactToHumanAsk,
	skollCastEcho,
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
		let owner: 'Oracle' | 'Sköll' = 'Sköll';
		let part: TurnPart = movePart;
		switch (call.label) {
			case 'oracle':
			case 'oracle-answer-flair':
				owner = 'Oracle';
				part = 'Ask';
				break;
			case 'oracle-ending-flair':
				owner = 'Oracle';
				part = 'Cast';
				break;
			case 'skoll-ending-flair':
				part = 'Cast';
				break;
			case 'reaction':
				part = 'React';
				break;
		}
		logEvent(sessionId, {
			owner,
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

// Remember the words a committed move voiced (and the descriptor that voices them) so a dropped
// response can recover the real result. Composes through the same allow-list the voice route uses —
// a descriptor that doesn't compose stores nothing, so a non-voiced move never clobbers the prior line.
function rememberLine(sessionId: string, voice: LineDescriptor | null): void {
	if (!voice) return;
	const text = composeLine(voice);
	recordLine(sessionId, text === null ? null : { text, voice });
}

// The Oracle's own line for an Ask result (her answer or refusal); system lines aren't voiced.
// Refusal wins first: a result carrying a refusal must never voice an answer, even if it also reads
// ok — a malformed both-state refuses rather than speaking a verdict it shouldn't.
function oracleVoiceLine(oracle: OracleResult | undefined): LineDescriptor | null {
	if (!oracle) return null;
	if ('refusal' in oracle) return { kind: 'refusal', refusal: oracle.refusal };
	if (oracle.ok) return { kind: 'answer', query: oracle.query, affirmative: oracle.affirmative };
	return null;
}

// The cast outcome's voiced line; only a resolved cast voices (a rejected one never committed).
function castVoiceLine(cast: CastResult, runeName: string): LineDescriptor | null {
	if (!cast.ok) return null;
	return cast.won
		? { kind: 'cast', result: 'true' }
		: { kind: 'cast', result: 'wrong', rune: runeName };
}

// Author + sign the end-screen closing line for the action that just resolved the round (ttd:22): the
// Oracle's blessing on a win, Sköll's gloat on a loss. No-op requests after a won round do not get to
// mint fresh Gemini copy.
async function authorEnding(
	sessionId: string,
	outcome: 'win' | 'lose'
): Promise<AuthoredLine | undefined> {
	const text = await composeEndingFlair(outcome);
	geminiEvents(sessionId, 'Cast'); // a Gemini call happened — tee its raw I/O to the debug log
	if (text === null) return undefined;
	const voice = outcome === 'win' ? ORACLE_VOICE : SKOLL_VOICE;
	const sig = signLine(voice, text);
	return sig === null ? undefined : { kind: 'authored', text, voice, sig };
}

// His templated Ask is surfaced for the human to react to; his WINNING cast rides along too so the
// client can voice it (server recomposes from the rune). A wrong cast carries no line — it just hands
// the turn back. Both lines are recomposed server-side, never replayed from client text.
function describeTurn(out: SkollOutcome): SkollTurn {
	if (out.kind === 'ask') return { asks: { echo: out.echo, query: out.query } };
	if (castWon(out.result))
		return { casts: { echo: skollCastEcho(out.runeName), rune: out.runeName } };
	return {};
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
		const outcomeFlair = skollTurn?.casts ? await authorEnding(sessionId, 'lose') : undefined;
		const response: AdvanceResponse = {
			type: 'Advance',
			...(skollTurn && { skoll: skollTurn }),
			...(outcomeFlair && { outcomeFlair }),
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
		// Mirror the line the client voices for each resolution, so a dropped React response recovers it.
		rememberLine(
			sessionId,
			answer.hexed
				? { kind: 'react', line: 'human-hex' }
				: answer.shared
					? {
							kind: 'react',
							line: 'human-scry',
							query: askedQuery,
							affirmative: answer.affirmative
						}
					: { kind: 'react', line: 'human-pass' }
		);
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
	if (result.type === 'Ask') {
		geminiEvents(sessionId, 'Ask');
		rememberLine(sessionId, oracleVoiceLine(result.oracle));
	}
	if (result.type === 'Cast') {
		if (result.cast.ok) {
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
		rememberLine(sessionId, castVoiceLine(result.cast, (action as { runeName: string }).runeName));
	}
	// A winning cast ends the round — author the winner's closing line exactly once, on that move.
	const outcomeFlair =
		result.type === 'Cast' && result.cast.ok && result.cast.won && engine.winner !== null
			? await authorEnding(sessionId, engine.winner === 'Human' ? 'win' : 'lose')
			: undefined;
	return json({ ...result, state: gameState(engine), ...(outcomeFlair && { outcomeFlair }) });
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
		rememberLine(sessionId, oracleVoiceLine(prepared.result));
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
		if (oracle.ok) {
			// A Scry lets Sköll overhear her answer — his earned fact.
			if (vs.scried) skoll.facts.push({ query: prepared.query, answer: oracle.affirmative });
			// Her spoken reply, owned by the Oracle — distinct from the Engine's verdict of the same
			// truth below, and absent when she's hexed silent (mirrors what the voice route delivers).
			logEvent(sessionId, {
				owner: 'Oracle',
				kind: 'deterministic',
				part: 'Answer',
				level: 'info',
				message: `answers: ${oracle.answer}`,
				data: { affirmative: oracle.affirmative }
			});
		}
	}

	// She authors her verdict aloud on a clean answer (ttd:17): when Sköll neither hexed nor scried, the
	// deterministic line is restyled by Gemini and server-signed, so the route still voices only her own
	// words — never arbitrary text. A failed/slow author leaves `voiced` unset; the client then voices
	// the deterministic `answer`. The engine verdict + the log above stay the canonical deterministic truth.
	if (oracle?.ok && vs.choice === 'Pass') {
		const flair = await composeOracleFlair(oracle.answer);
		geminiEvents(sessionId, 'Ask'); // drain the flair call's raw I/O onto this turn's Ask beat
		const sig = flair ? signLine(ORACLE_VOICE, flair) : null;
		if (flair && sig) oracle.voiced = { kind: 'authored', text: flair, voice: ORACLE_VOICE, sig };
	}

	let truth: string;
	if (vs.killed) truth = 'Hexed by Sköll — the Oracle is silent, her turn spent';
	else if (oracle?.ok) truth = oracle.answer;
	else truth = 'engine declined the Ask';
	engineVerdict(sessionId, 'Ask', truth);

	// Mirror the line the client voices for this outcome (his Hex/Scry framing, or her answer on a
	// Pass), so a dropped Ask response recovers it instead of the false silent line.
	const voice: LineDescriptor | null =
		vs.choice === 'Hex'
			? { kind: 'react', line: 'skoll-hex' }
			: vs.choice === 'Scry' && oracle?.ok
				? {
						kind: 'react',
						line: 'skoll-scry',
						query: prepared.query,
						affirmative: oracle.affirmative
					}
				: oracle?.ok
					? (oracle.voiced ?? {
							kind: 'answer',
							query: prepared.query,
							affirmative: oracle.affirmative
						})
					: null;
	rememberLine(sessionId, voice);

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

	// llm when Gemini decided; deterministic when the floor did (a failure fallback OR the guard's
	// forced cast). A genuine fallback warns so it stands out; the guard cast is normal play (info).
	const floored = out.source === 'floor';
	const deterministic = floored || out.source === 'guard';
	logEvent(sessionId, {
		owner: 'Sköll',
		kind: deterministic ? 'deterministic' : 'llm',
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
	// Mirror his voiced line (his Ask, or his WINNING cast) so a dropped Advance recovers it — a loss
	// screen never rises without his cast line, and a parked Ask keeps its prompt.
	rememberLine(
		sessionId,
		out.kind === 'ask'
			? { kind: 'skoll-ask', query: out.query }
			: castWon(out.result)
				? { kind: 'skoll-cast', rune: out.runeName }
				: null
	);
	return describeTurn(out);
}
