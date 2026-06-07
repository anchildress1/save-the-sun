// Shared action interface — the single entry point for game actions (Human + Sköll).

import type { GameEngine, CastResult } from './engine';
import { resolveReaction, type ReactionChoice, type ReactionOutcome } from './reactions';
import { runOracle } from '$lib/server/oracle/oracle';
import type { Interpret, OracleResult } from '$lib/server/oracle/types';

export type Player = 'Human' | 'Sköll';

export interface ActionRequest {
	player: Player;
}

export interface AskAction extends ActionRequest {
	type: 'Ask';
	question: string; // Free-text question
}

export interface CastAction extends ActionRequest {
	type: 'Cast';
	runeName: string;
}

export interface CrossOffAction extends ActionRequest {
	type: 'CrossOff';
	runeId: number;
	crossed: boolean; // true to cross off, false to restore
}

export interface ReactAction extends ActionRequest {
	type: 'React';
	reaction: ReactionChoice;
}

export type GameAction = AskAction | CastAction | CrossOffAction | ReactAction;

/** Injected dependencies so the router stays testable. */
export interface ActionDeps {
	engine: GameEngine;
	interpret: Interpret;
}

export type ActionResult =
	// `oracle` is optional: the route omits it when Sköll Hexes the human's Ask (silenced before any
	// answer) — the wire then carries only `skollVsYou`. handleAction always sets it; the hex path doesn't.
	| { type: 'Ask'; oracle?: OracleResult }
	| { type: 'Cast'; cast: CastResult }
	| { type: 'CrossOff'; ok: true }
	| { type: 'React'; outcome: ReactionOutcome };

/**
 * Public turn snapshot the client needs to know whose move it is and whether the round
 * resolved. Never carries the secret — only the winner once a Cast has already revealed it.
 */
export interface GameState {
	activePlayer: Player;
	status: 'active' | 'won';
	winner: Player | null;
	// Turns consumed this round — public, drives the cosmetic night-progress chrome. Carries no
	// secret signal (it is just a count), and is hydrated on load so the indicator survives a refresh.
	turns: number;
}

/**
 * What Sköll did on his turn, attached to the response after the human's action (S6). He either
 * casts (round may end) or opens a reaction window with his Ask — `asks` present means the client
 * must show the interrupt prompt; his answer is produced only once the human reacts.
 */
export interface SkollTurn {
	taunt: string;
	asks?: { echo: string };
	cast?: { line: string; won: boolean };
}

/** How Sköll's parked Ask resolved after the human reacted (S6). A Hex kills it; a Scry shares it. */
export interface SkollReaction {
	hexed: boolean;
	scried?: { answer: string };
}

/** How Sköll reacted to the *human's* Ask (S6, R12 reverse): Hex kills it, Scry overhears it. */
export interface SkollVsYou {
	reaction: 'Scry' | 'Hex' | 'Pass';
}

/**
 * A parked Sköll Ask carried by the page load (`+page.server.ts`) so a refresh mid-interrupt
 * rehydrates the prompt — the reaction window lives server-side and would otherwise vanish.
 */
export interface PendingReaction {
	echo: string;
	held: { Scry: boolean; Hex: boolean };
}

/**
 * The `Advance` wire response — Sköll's own turn, run as its own request (not a player ActionResult,
 * so it's modeled separately). `skoll` is absent when it wasn't his turn to take.
 */
export interface AdvanceResponse {
	type: 'Advance';
	skoll?: SkollTurn;
	state: GameState;
}

/** Read the engine's public turn state into a wire DTO. */
export function gameState(engine: GameEngine): GameState {
	return {
		activePlayer: engine.activePlayer,
		status: engine.status,
		winner: engine.winner,
		turns: engine.turns
	};
}

/**
 * What the action endpoint returns: the action's own result plus the turn snapshot taken
 * after the request settles (so the client reflects whose move it is and a resolved round).
 * `skoll` rides along when the wolf took his turn in response; `skollReaction` when this
 * response closed his parked Ask (the human's React path).
 */
export type ActionResponse<T extends ActionResult['type'] = ActionResult['type']> = Extract<
	ActionResult,
	{ type: T }
> & { state: GameState; skoll?: SkollTurn; skollReaction?: SkollReaction; skollVsYou?: SkollVsYou };

/** Route one action to the engine/Oracle. */
export async function handleAction(action: GameAction, deps: ActionDeps): Promise<ActionResult> {
	switch (action.type) {
		case 'Ask':
			return {
				type: 'Ask',
				oracle: await runOracle(deps.engine, action.player, action.question, deps.interpret)
			};
		case 'Cast':
			return { type: 'Cast', cast: deps.engine.cast(action.player, action.runeName) };
		case 'CrossOff':
			// Private aid; the engine never referees crossings.
			return { type: 'CrossOff', ok: true };
		case 'React':
			return {
				type: 'React',
				outcome: resolveReaction(deps.engine, action.player, action.reaction)
			};
	}
}
