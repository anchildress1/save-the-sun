// Reaction resolution — the rules of Scry & Hex over a rival's *pending* Ask.
//
// The engine owns the state (charges + the open window, tied to the round lifecycle); this
// owns the policy. The window is opened around a pending Ask, before it is answered, so a
// reaction resolves *first*: Hex (killAnswer) means the orchestration never asks for the answer
// — the question dies before it is produced, not after it has been handed back. Scry (shareAnswer)
// means the orchestration, after resolving the Ask, hands the same answer to the reactor too.
// Both trigger on an Ask only — a Cast leaves no window, so it can never be interrupted (the win
// check is sacred). At most one reaction resolves per window: the engine closes it on the first,
// so once Hex silences a question there is no answer left for Scry to overhear.

import type { GameEngine, Reaction } from './engine';
import type { Player } from './actions';

export type ReactionChoice = Reaction | 'Pass';

export type ReactionOutcome =
	| { ok: true; choice: 'Scry'; shareAnswer: true } // resolve the Ask, hand the answer to the reactor too
	| { ok: true; choice: 'Hex'; killAnswer: true } // don't ask — the question dies before any answer
	| { ok: true; choice: 'Pass' } // resolve the Ask normally; nothing spent
	| { ok: false; reason: 'no-window' | 'no-charge' };

/**
 * Resolve a reactor's choice against the engine's open window. Pass always succeeds (it just
 * lets the Ask stand). Scry/Hex require an open window owned by the *rival* and an unspent
 * charge; either resolves the window and spends the charge.
 */
export function resolveReaction(
	engine: GameEngine,
	reactor: Player,
	choice: ReactionChoice
): ReactionOutcome {
	// The window names the rival's pending Ask; you react to the *rival's* Ask, never your own.
	const asker = engine.reactionWindow;

	if (choice === 'Pass') {
		// Only the rival may let an Ask pass — the asker can't slam their own window shut and
		// deny the rival a reaction. Passing with no rival window to close is a harmless no-op.
		if (asker !== null && asker !== reactor) engine.declineReaction();
		return { ok: true, choice: 'Pass' };
	}

	if (asker === null || asker === reactor) return { ok: false, reason: 'no-window' };
	if (!engine.reactionAvailable(reactor, choice)) return { ok: false, reason: 'no-charge' };

	engine.consumeReaction(reactor, choice);
	return choice === 'Scry'
		? { ok: true, choice: 'Scry', shareAnswer: true }
		: { ok: true, choice: 'Hex', killAnswer: true };
}
