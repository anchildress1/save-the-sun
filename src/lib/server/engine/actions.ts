// Shared action interface stub (S0)
// This is the single entry point for all game actions for both Human and Sköll.

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

export interface ActionResult {
	success: boolean;
	message: string;
	// Further state will be added in S1/S2/S3
}

export function handleAction(action: GameAction): ActionResult {
	// S0 Stub: In future stories, this will route to the deterministic engine (S1),
	// the Oracle pipeline (S2), or the Reactions handler (S5).
	return {
		success: true,
		message: `Action ${action.type} received for ${action.player}.`
	};
}
