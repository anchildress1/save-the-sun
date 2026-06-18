import { getEngine, getSkoll, getRoundId, getBoardSeed, getLastLine } from './session';
import type { RecoverableLine } from './session';
import { gameState, type PendingReaction } from './actions';
import { skollAskEcho } from '$lib/server/skoll/skoll';

export interface GameSnapshot {
	boardSeed: number;
	roundId: string;
	state: ReturnType<typeof gameState>;
	pendingReaction: PendingReaction | null;
	// The last committed voiced line, so a post-timeout resync can restore the real result a dropped
	// response lost — instead of the client's false silent/falters line.
	lastLine: RecoverableLine | null;
}

// The authoritative client view of a session's current round — shared by the page load and the
// /api/state reconcile endpoint so a refresh and a post-timeout resync hydrate identically, one
// source of truth instead of two that can drift. Read-only: resumes the round (getEngine), never
// resets it.
export function gameSnapshot(sessionId: string): GameSnapshot {
	const engine = getEngine(sessionId);

	// A round can sit on Sköll's *parked* Ask — his question declared, awaiting the human's reaction.
	// That window lives only on the server, so rehydrate the prompt + the human's still-held charges
	// or the prompt vanishes and the round soft-locks (his move can't advance past a parked Ask).
	let pendingReaction: PendingReaction | null = null;
	if (engine.reactionWindow === 'Sköll') {
		const skoll = getSkoll(sessionId);
		if (skoll.pendingAsk !== null) {
			pendingReaction = {
				echo: skollAskEcho(skoll.pendingAsk),
				held: {
					Scry: engine.reactionAvailable('Human', 'Scry'),
					Hex: engine.reactionAvailable('Human', 'Hex')
				}
			};
		}
	}

	return {
		// Held for the round's lifetime: a reload resumes the same layout; only a new round reshuffles.
		boardSeed: getBoardSeed(sessionId),
		// Stable per-round token (independent of boardSeed) — the client keys its persisted
		// crossings/transcript to it so a refresh restores the view and a new round clears it.
		roundId: getRoundId(sessionId),
		// The real turn/round state so a resumed round (incl. one already won) renders truthfully.
		state: gameState(engine),
		pendingReaction,
		lastLine: getLastLine(sessionId)
	};
}
