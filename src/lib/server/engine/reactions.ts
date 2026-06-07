// Reaction resolution (S5) — the rules of Scry & Hex over a rival's Ask.
//
// The engine owns the state (charges + the open window, tied to the round lifecycle); this
// owns the policy. Both reactions trigger on an Ask only — a Cast leaves no window, so it can
// never be interrupted (the win check is sacred). At most one reaction resolves per window:
// the engine closes the window on the first one, so once Hex silences a question there is no
// answer left for Scry to overhear.

import type { GameEngine, Reaction } from './engine';
import type { Player } from './actions';

export type ReactionChoice = Reaction | 'Pass';

export type ReactionOutcome =
	| { ok: true; choice: 'Scry'; shareAnswer: true } // the reactor overhears the rival's answer
	| { ok: true; choice: 'Hex'; killAnswer: true } // the question dies; no answer to anyone
	| { ok: true; choice: 'Pass' } // the rival keeps their answer; nothing spent
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
	if (choice === 'Pass') {
		engine.declineReaction();
		return { ok: true, choice: 'Pass' };
	}

	// A window opens only on an Ask, and you react to the *rival's* Ask, never your own.
	const asker = engine.reactionWindow;
	if (asker === null || asker === reactor) return { ok: false, reason: 'no-window' };
	if (!engine.reactionAvailable(reactor, choice)) return { ok: false, reason: 'no-charge' };

	engine.consumeReaction(reactor, choice);
	return choice === 'Scry'
		? { ok: true, choice: 'Scry', shareAnswer: true }
		: { ok: true, choice: 'Hex', killAnswer: true };
}
