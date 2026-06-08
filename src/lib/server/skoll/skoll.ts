// Sköll's turn orchestration (S6) — the seam where the Gemini opponent plays through the
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
import { parseQuery, type Query } from '$lib/server/engine/queries';
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
	// Rotates the taunt pool; no repeat within a round.
	tauntIndex: number;
	// A plain-hunch opener for the round, surfaced to Gemini on his first move only. Without it a
	// capable model copies whatever opener its prompt last demonstrated (the "always gold" tell);
	// a seeded, trait-level lean makes the first Ask vary per round while staying reproducible.
	hunch: string;
	// One persistent PRNG for the round — floor and reaction gate both draw from it, so variety comes
	// from the advancing stream, not from re-seeding off a state counter each call.
	rng: () => number;
}

/**
 * A trait-level opening hunch — a colour, element, or light/dark the wolf "feels" this round.
 * Drawn from the seed so it varies per round and stays reproducible; trait-level (never a rune by
 * name) so it can never echo the secret rune.
 */
function pickHunch(rng: () => number): string {
	const elements = [...new Set(runes.map((r) => r.element))];
	const colors = [...new Set(runes.map((r) => r.color))];
	const candidates: Query[] = [
		...elements.map((value): Query => ({ axis: 'element', value })),
		...colors.map((value): Query => ({ axis: 'color', value })),
		{ axis: 'fill', value: 'Light' },
		{ axis: 'fill', value: 'Dark' }
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
		tauntIndex: 0,
		hunch: pickHunch(rng),
		rng
	};
}

/** The earned-only view handed to Gemini. Built from state alone — never the secret. */
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
}

/** The Gemini seam: earned-only payload in, one (untrusted) tool call out. */
export type SkollDecide = (payload: SkollPayload) => Promise<RawSkollDecision>;

export type SkollMove = { kind: 'ask'; query: Query } | { kind: 'cast'; runeName: string };
export type SkollSource = 'gemini' | 'floor';

export type SkollOutcome =
	| { kind: 'cast'; source: SkollSource; runeName: string; result: CastResult }
	| { kind: 'ask'; source: SkollSource; query: Query; echo: string };

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

/** Sköll's Ask echo, shown to the human so they can judge whether to Scry or Hex it. Exported so
 *  a page load can rehydrate the interrupt prompt when a round resumes on his parked Ask. */
export function skollAskEcho(query: Query): string {
	return `Sköll asks after ${valuePhrase(query)}.`;
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
	const { move, source } = await planMove(state, decide, rng);

	if (move.kind === 'cast') {
		const result = engine.cast('Sköll', move.runeName);
		if (dev)
			console.debug(`[skoll] cast ${move.runeName} via ${source} → won=${result.ok && result.won}`);
		return { kind: 'cast', source, runeName: move.runeName, result };
	}

	engine.openReactionWindow('Sköll');
	state.pendingAsk = move.query;
	if (dev) console.debug(`[skoll] asks ${JSON.stringify(move.query)} via ${source}`);
	return { kind: 'ask', source, query: move.query, echo: skollAskEcho(move.query) };
}

async function planMove(
	state: SkollState,
	decide: SkollDecide,
	rng: () => number
): Promise<{ move: SkollMove; source: SkollSource }> {
	try {
		const raw = await decide(buildPayload(state));
		const move = validateMove(raw);
		if (move) {
			for (const id of legalCrossOffs(raw.crossOff)) state.crossed.add(id);
			if (dev && state.crossed.size)
				console.debug(`[skoll] sheet: ${[...state.crossed].join(',')}`);
			return { move, source: 'gemini' };
		}
		console.warn(`[skoll] illegal/malformed decision, floor fires: ${JSON.stringify(raw)}`);
	} catch (err) {
		console.error('[skoll] Gemini decision failed, floor fires:', err);
	}
	const floor = chooseFloorMove(state.facts, asked(state), rng);
	return { move: floor, source: 'floor' };
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
	state.pendingAsk = null;
	if (query === null) throw new Error('resolveSkollAsk called with no pending Ask');

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

// --- Sköll reacting to the human's Ask (R12 reverse direction) ---

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

/** What Sköll did to the human's Ask — `killed` means his Hex landed; `scried` means he overheard. */
export interface SkollVsHuman {
	choice: ReactionChoice;
	killed: boolean;
	scried: boolean;
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
): Promise<ReactionChoice> {
	const canScry = engine.reactionAvailable('Sköll', 'Scry');
	const canHex = engine.reactionAvailable('Sköll', 'Hex');
	if (!canScry && !canHex) return 'Pass'; // nothing left to spend — never bluff a reaction
	// Dumb him down: most of the time he doesn't even think to react. Only on the occasional
	// impulse does he consult his judgement (Gemini) at all.
	if (rng() > REACTION_CHANCE) return 'Pass';
	try {
		const raw = await decide({
			askedTrait: valuePhrase(query),
			answers: state.facts.map((f) => ({ trait: valuePhrase(f.query), holds: f.answer })),
			crossedOff: [...state.crossed],
			canScry,
			canHex
		});
		const choice = validateReaction(raw.reaction, canScry, canHex);
		if (choice) return choice;
		console.warn(`[skoll] illegal/unavailable reaction, passing: ${JSON.stringify(raw)}`);
	} catch (err) {
		console.error('[skoll] reaction decision failed, passing:', err);
	}
	return 'Pass'; // the safe floor — never spends a charge, never kills
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
	const choice = await planReaction(engine, state, query, decide, rng);
	const outcome = resolveReaction(engine, 'Sköll', choice);
	if (dev) console.debug(`[skoll] reacts to the human's Ask: ${choice} (landed=${outcome.ok})`);
	return {
		choice,
		killed: outcome.ok && outcome.choice === 'Hex',
		scried: outcome.ok && outcome.choice === 'Scry'
	};
}
