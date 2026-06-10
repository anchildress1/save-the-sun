// Sköll's turn orchestration — the seam where the Gemini opponent plays through the
// SAME engine interface as the human. Gemini decides; the engine referees. Every tool call is
// validated here before the engine resolves it; an error, timeout, or illegal/malformed call
// drops to the deterministic floor (never as a quality filter on a legal move).
//
// Sköll reasons from EARNED state only — the public board, his own truthful answers, and his
// own crossed-off sheet. The secret and the human's crossings never enter his payload: the
// builder takes his state, not the engine, so the secret is structurally unreachable.

import { dev } from '$app/environment';
import { runes } from '$lib/board';
import { mulberry32 } from '$lib/prng';
import { parseQuery, type PowerOp, type Query } from '$lib/server/engine/queries';
import { valuePhrase } from '$lib/server/oracle/oracle';
import type { GameEngine, CastResult } from '$lib/server/engine/engine';
import {
	resolveReaction,
	type ReactionChoice,
	type ReactionOutcome
} from '$lib/server/engine/reactions';
import { chooseFloorMove, type EarnedFact } from './floor';

/** Sköll's private, per-round memory. Holds no secret and no read of the human's crossings. */
export interface SkollState {
	// Truthful answers he has earned — his resolved Asks and anything he Scried. Drives the floor.
	facts: EarnedFact[];
	// His crossed-off sheet (rune ids) — his working memory, fed back to him, mutated only by his
	// own cross-off tool calls. Nothing reads it back for legality; it is his aid, like the human's.
	crossed: Set<number>;
	// His declared-but-unanswered Ask, awaiting the human's reaction (the interrupt window). The
	// window opens before the answer, so a Hex kills the question before any answer is produced.
	pendingAsk: Query | null;
	// A plain-hunch opener for the round, surfaced to Gemini on his first move only. Without it a
	// capable model copies whatever opener its prompt last demonstrated (the "always gold" tell);
	// a seeded, trait-level lean makes the first Ask vary per round while staying reproducible.
	hunch: string;
	// One persistent PRNG for the round — floor and reaction gate both draw from it, so variety comes
	// from the advancing stream, not from re-seeding off a state counter each call.
	rng: () => number;
}

/** How a move was reached: which seam decided it, and the reasoning to show on stage. */
export interface SkollDecision {
	source: SkollSource;
	reasoning: string;
}

/**
 * A trait-level opening hunch — a color or element the wolf "feels" this round. Drawn from the
 * seed so it varies per round and stays reproducible; a rune by name is excluded so it can never
 * echo the secret, and light/dark is excluded because the prompt forbids a light/dark opener (it is
 * the clean 50/50 split — exactly the optimal play this nudge exists to steer him away from).
 */
function pickHunch(rng: () => number): string {
	const elements = [...new Set(runes.map((r) => r.element))];
	const colors = [...new Set(runes.map((r) => r.color))];
	const candidates: Query[] = [
		...elements.map((value): Query => ({ axis: 'element', value })),
		...colors.map((value): Query => ({ axis: 'color', value }))
	];
	return valuePhrase(candidates[Math.floor(rng() * candidates.length)]);
}

/** A fresh Sköll memory for a new round. The seed is crypto-sourced upstream (session.ts). */
export function freshSkollState(seed: number): SkollState {
	const rng = mulberry32(seed);
	return {
		facts: [],
		crossed: new Set(),
		pendingAsk: null,
		hunch: pickHunch(rng),
		rng
	};
}

/**
 * The view handed to Gemini: his earned state (public board + his answers + his sheet) plus one
 * seeded opening `hunch`. The hunch is a coaching nudge, NOT earned state — it doesn't vary with
 * play and is surfaced only on the opening move. Built from state alone — never the secret.
 */
export interface SkollPayload {
	// The board in fixed order — public traits only. Told not to reorder it (reason, don't compute).
	board: {
		id: number;
		name: string;
		element: string;
		power: number;
		fill: string;
		color: string;
	}[];
	// His earned answers, in words: "a fire rune" → yes/no.
	answers: { trait: string; holds: boolean }[];
	// Rune ids he has crossed off his own sheet.
	crossedOff: number[];
	// His seeded opening hunch (a trait phrase) — used only when he has learned nothing yet.
	hunch: string;
}

/** Loosely-typed decision from Gemini — validated here before the engine ever sees it. */
export interface RawSkollDecision {
	kind?: string;
	query?: unknown;
	runeName?: string;
	crossOff?: unknown;
	// His thinking trace, when the model returns one. Untrusted display text only — never validated
	// into a move; absent on MINIMAL thinking, in which case the floor's payload stands in.
	reasoning?: string;
}

/** The Gemini seam: earned-only payload in, one (untrusted) tool call out. */
export type SkollDecide = (payload: SkollPayload) => Promise<RawSkollDecision>;

export type SkollMove = { kind: 'ask'; query: Query } | { kind: 'cast'; runeName: string };
export type SkollSource = 'gemini' | 'floor';

export type SkollOutcome =
	| { kind: 'cast'; source: SkollSource; reasoning: string; runeName: string; result: CastResult }
	| { kind: 'ask'; source: SkollSource; reasoning: string; query: Query; echo: string };

/** The answer half of Sköll's Ask, produced after the human's reaction closes the window. */
export type SkollAnswer = { hexed: true } | { hexed: false; affirmative: boolean; shared: boolean };

/** Build the earned-only payload from Sköll's state. Pure; the secret cannot leak through it. */
export function buildPayload(state: SkollState): SkollPayload {
	return {
		board: runes.map((r) => ({
			id: r.id,
			name: r.name,
			element: r.element,
			power: r.power,
			fill: r.fill,
			color: r.color
		})),
		answers: state.facts.map((f) => ({ trait: valuePhrase(f.query), holds: f.answer })),
		crossedOff: [...state.crossed],
		hunch: state.hunch
	};
}

/**
 * A readable one-line digest of the state Sköll reasoned from — the S8 fallback shown when the
 * model returns no thinking trace (and the only "reasoning" available when the floor played, since
 * the floor doesn't reason). Earned facts and his sheet, never the secret.
 */
export function summarizePayload(payload: SkollPayload): string {
	if (payload.answers.length === 0) return `No facts yet; opening hunch: ${payload.hunch}.`;
	const facts = payload.answers.map((a) => `${a.trait} → ${a.holds ? 'yes' : 'no'}`).join('; ');
	const crossed = payload.crossedOff.length ? `; crossed ${payload.crossedOff.length}` : '';
	return `Earned: ${facts}${crossed}.`;
}

const RUNE_IDS = new Set(runes.map((r) => r.id));
const RUNE_NAMES = new Set(runes.map((r) => r.name));

/** Keep only legal rune ids from an untrusted cross-off list; malformed ids are dropped (logged). */
function legalCrossOffs(ids: unknown): number[] {
	if (ids === undefined) return [];
	if (!Array.isArray(ids)) {
		console.warn(`[skoll] ignoring non-array crossOff: ${JSON.stringify(ids)}`);
		return [];
	}
	const legal = ids.filter((id): id is number => Number.isInteger(id) && RUNE_IDS.has(id));
	if (legal.length !== ids.length)
		console.warn(`[skoll] dropped malformed crossOff ids: ${JSON.stringify(ids)} → ${legal}`);
	return legal;
}

/** Validate Gemini's move into a canonical one, or null if illegal/malformed (→ floor). */
function validateMove(raw: RawSkollDecision): SkollMove | null {
	if (raw.kind === 'ask') {
		const query = parseQuery(raw.query);
		return query ? { kind: 'ask', query } : null;
	}
	if (raw.kind === 'cast') {
		return typeof raw.runeName === 'string' && RUNE_NAMES.has(raw.runeName)
			? { kind: 'cast', runeName: raw.runeName }
			: null;
	}
	return null;
}

// Power 1–6 spoken as a word so the line reads as a sentence, not a stat. Deliberately NOT the
// Oracle's digit grammar — Sköll owns his own voice (ux-copy.md §2 Cast Voice Charter).
const POWER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
const numberWord = (n: number) => POWER_WORDS[n] ?? String(n);
const article = (word: string): 'a' | 'an' => (/^[aeiou]/i.test(word) ? 'an' : 'a');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function skollPowerLine(op: PowerOp, n: number): string {
	const word = numberWord(n);
	switch (op) {
		case 'eq':
			return `${cap(word)} power. I can smell it.`;
		case 'lt':
			return `Fewer than ${word} power. I can smell it.`;
		case 'lte':
			return `${cap(word)} power or fewer. I can smell it.`;
		case 'gt':
			return `More than ${word} power. I can smell it.`;
		case 'gte':
			return `${cap(word)} power or more. I can smell it.`;
	}
}

/** Sköll's Ask in his own voice — first-person, predatory, naming the sign the human judges for
 *  Scry/Hex (ux-copy.md §2). NOT the Oracle's third-person paraphrase. Exported so a page load can
 *  rehydrate the interrupt prompt when a round resumes on his parked Ask. */
export function skollAskEcho(query: Query): string {
	switch (query.axis) {
		case 'element':
			return `I scent ${article(query.value)} ${query.value.toLowerCase()} rune on her.`;
		case 'color':
			return `${cap(article(query.value))} ${query.value.toLowerCase()} rune. Mine.`;
		case 'fill':
			return `Light or dark — I taste a ${query.value.toLowerCase()} one.`;
		case 'rune':
			return `${query.value}. I name it in the dark.`;
		case 'power':
			return skollPowerLine(query.op, query.value);
	}
}

/**
 * Decide and apply Sköll's move. Gemini decides; on any failure (throw, illegal, malformed) the
 * deterministic floor plays instead. Cross-offs (Gemini's only) update his private sheet. A Cast
 * resolves immediately; an Ask opens the reaction window and parks the query for the human's
 * reaction — the answer is produced later, in {@link resolveSkollAsk}, never before the window closes.
 */
export async function takeSkollTurn(
	engine: GameEngine,
	state: SkollState,
	decide: SkollDecide,
	rng: () => number
): Promise<SkollOutcome> {
	const { move, source, reasoning } = await planMove(state, decide, rng);

	if (move.kind === 'cast') {
		const result = engine.cast('Sköll', move.runeName);
		if (dev)
			console.debug(`[skoll] cast ${move.runeName} via ${source} → won=${result.ok && result.won}`);
		return { kind: 'cast', source, reasoning, runeName: move.runeName, result };
	}

	engine.openReactionWindow('Sköll');
	state.pendingAsk = move.query;
	if (dev) console.debug(`[skoll] asks ${JSON.stringify(move.query)} via ${source}`);
	return { kind: 'ask', source, reasoning, query: move.query, echo: skollAskEcho(move.query) };
}

async function planMove(
	state: SkollState,
	decide: SkollDecide,
	rng: () => number
): Promise<{ move: SkollMove } & SkollDecision> {
	const payload = buildPayload(state);
	try {
		const raw = await decide(payload);
		const move = validateMove(raw);
		if (move) {
			for (const id of legalCrossOffs(raw.crossOff)) state.crossed.add(id);
			if (dev && state.crossed.size)
				console.debug(`[skoll] sheet: ${[...state.crossed].join(',')}`);
			// His thinking trace when the model returns one; otherwise the facts he reasoned from.
			return {
				move,
				source: 'gemini',
				reasoning: raw.reasoning?.trim() || summarizePayload(payload)
			};
		}
		console.warn(`[skoll] illegal/malformed decision, floor fires: ${JSON.stringify(raw)}`);
	} catch (err) {
		console.error('[skoll] Gemini decision failed, floor fires:', err);
	}
	// The floor doesn't reason — the demo shows the earned-only state it played from instead.
	const floor = chooseFloorMove(state.facts, asked(state), rng);
	return { move: floor, source: 'floor', reasoning: summarizePayload(payload) };
}

/** Already-asked queries — the answers he holds; the floor excludes them as redundant. */
function asked(state: SkollState): Query[] {
	return state.facts.map((f) => f.query);
}

/**
 * Close Sköll's open Ask after the human's reaction. A Hex kills the question — his turn is spent
 * with no answer produced. Pass or Scry resolves the Ask truthfully and records the earned fact;
 * a Scry hands the same answer to the human too. Either way his pending Ask is cleared.
 */
export function resolveSkollAsk(
	engine: GameEngine,
	state: SkollState,
	reaction: ReactionOutcome
): SkollAnswer {
	const query = state.pendingAsk;
	if (query === null) throw new Error('resolveSkollAsk called with no pending Ask');
	// Clear only once we know there was an Ask — an unexpected call throws without mutating state.
	state.pendingAsk = null;

	if (reaction.ok && reaction.choice === 'Hex') {
		engine.passTurn(); // his turn is spent unanswered; the question dies before any answer
		return { hexed: true };
	}

	// A failed reaction (no charge) is a no-op by the engine's contract — the Ask proceeds as a
	// Pass. The client gates spent charges, so this is unreachable in normal play; log it loudly
	// rather than let an intended Scry/Hex vanish into a silent Pass.
	if (!reaction.ok)
		console.warn(`[skoll] reaction did not land (${reaction.reason}); Ask proceeds`);

	const result = engine.ask('Sköll', query);
	if (!result.ok) throw new Error(`engine rejected Sköll's parked Ask: ${result.reason}`);
	state.facts.push({ query, answer: result.answer });
	const shared = reaction.ok && reaction.choice === 'Scry';
	return { hexed: false, affirmative: result.answer, shared };
}

// --- Sköll reacting to the human's Ask (the reverse direction) ---

/** The earned-only view for a reaction decision: his state + the trait the human just asked. */
export interface SkollReactionView {
	askedTrait: string;
	answers: { trait: string; holds: boolean }[];
	crossedOff: number[];
	canScry: boolean;
	canHex: boolean;
}

/** The Gemini reaction seam: a reaction view in, an (untrusted) choice out. */
export type SkollReactionDecide = (view: SkollReactionView) => Promise<{ reaction?: string }>;

/** What Sköll did to the human's Ask — `killed` means his Hex landed; `scried` means he overheard.
 *  `source` marks whether Gemini decided the reaction or the floor passed (drives the debug LLM badge). */
export interface SkollVsHuman {
	choice: ReactionChoice;
	killed: boolean;
	scried: boolean;
	source: SkollSource;
}

function validateReaction(raw: unknown, canScry: boolean, canHex: boolean): ReactionChoice | null {
	if (raw === 'Scry') return canScry ? 'Scry' : null;
	if (raw === 'Hex') return canHex ? 'Hex' : null;
	if (raw === 'Pass') return 'Pass';
	return null;
}

// How often Sköll even *considers* reacting to an Ask. Without this gate Gemini interrupts every
// single Ask, far too cannily for a twelve-year-old; at 0.65 he thinks to react about two-thirds of
// the time (and may still Pass when he does), so he shows up in the rite often without policing
// every question. Higher = a more present wolf; lower = a sleepier one.
const REACTION_CHANCE = 0.65;

async function planReaction(
	engine: GameEngine,
	state: SkollState,
	query: Query,
	decide: SkollReactionDecide,
	rng: () => number
): Promise<{ choice: ReactionChoice; source: SkollSource }> {
	const floorPass = { choice: 'Pass' as ReactionChoice, source: 'floor' as SkollSource };
	const canScry = engine.reactionAvailable('Sköll', 'Scry');
	const canHex = engine.reactionAvailable('Sköll', 'Hex');
	if (!canScry && !canHex) return floorPass; // nothing left to spend — never bluff a reaction
	// Dumb him down: most of the time he doesn't even think to react. Only on the occasional
	// impulse does he consult his judgement (Gemini) at all.
	if (rng() > REACTION_CHANCE) return floorPass;
	try {
		const raw = await decide({
			askedTrait: valuePhrase(query),
			answers: state.facts.map((f) => ({ trait: valuePhrase(f.query), holds: f.answer })),
			crossedOff: [...state.crossed],
			canScry,
			canHex
		});
		const choice = validateReaction(raw.reaction, canScry, canHex);
		if (choice) return { choice, source: 'gemini' };
		console.warn(`[skoll] illegal/unavailable reaction, passing: ${JSON.stringify(raw)}`);
	} catch (err) {
		console.error('[skoll] reaction decision failed, passing:', err);
	}
	return floorPass; // the safe floor — never spends a charge, never kills
}

/**
 * Let Sköll react to the human's *pending* Ask, before its answer (the S5 window, reverse
 * direction). Opens the window on the human's Ask, asks Gemini whether to Scry/Hex/Pass (floor =
 * Pass on any failure), and resolves it. The caller answers the Ask afterward — unless `killed`,
 * in which case the question dies and the human's turn is spent with no answer.
 */
export async function reactToHumanAsk(
	engine: GameEngine,
	state: SkollState,
	query: Query,
	decide: SkollReactionDecide,
	rng: () => number
): Promise<SkollVsHuman> {
	engine.openReactionWindow('Human');
	const { choice, source } = await planReaction(engine, state, query, decide, rng);
	const outcome = resolveReaction(engine, 'Sköll', choice);
	if (dev) console.debug(`[skoll] reacts to the human's Ask: ${choice} (landed=${outcome.ok})`);
	return {
		choice,
		killed: outcome.ok && outcome.choice === 'Hex',
		scried: outcome.ok && outcome.choice === 'Scry',
		source
	};
}
