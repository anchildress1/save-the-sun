// Shared action interface — the single entry point for game actions (Human + Sköll).

import type { GameEngine, CastResult } from './engine';
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
	reaction: 'Scry' | 'Hex' | 'Pass';
}

export type GameAction = AskAction | CastAction | CrossOffAction | ReactAction;

/** Injected dependencies so the router stays testable. */
export interface ActionDeps {
	engine: GameEngine;
	interpret: Interpret;
}

export type ActionResult =
	| { type: 'Ask'; oracle: OracleResult }
	| { type: 'Cast'; cast: CastResult }
	| { type: 'CrossOff'; ok: true }
	| { type: 'React'; ok: true };

/**
 * Public turn snapshot the client needs to know whose move it is and whether the round
 * resolved. Never carries the secret — only the winner once a Cast has already revealed it.
 */
export interface GameState {
	activePlayer: Player;
	status: 'active' | 'won';
	winner: Player | null;
}

/** Read the engine's public turn state into a wire DTO. */
export function gameState(engine: GameEngine): GameState {
	return {
		activePlayer: engine.activePlayer,
		status: engine.status,
		winner: engine.winner
	};
}

/**
 * What the action endpoint returns: the action's own result plus the turn snapshot taken
 * after the request settles (so the client reflects whose move it is and a resolved round).
 */
export type ActionResponse<T extends ActionResult['type'] = ActionResult['type']> = Extract<
	ActionResult,
	{ type: T }
> & { state: GameState };

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
			// Reactions resolve in S5.
			return { type: 'React', ok: true };
	}
}
