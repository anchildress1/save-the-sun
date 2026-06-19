import type { GameState } from '$lib/server/engine/actions';

// Canonical game-state shapes shared by the page suites. A fixed seed keeps the board order
// deterministic; the hydrated state opens the page human-first on a live round. Tests that need a
// different turn count spread an override (`{ ...HUMAN_WON, turns: N }`) rather than a new fixture.
export const HUMAN_TURN: GameState = {
	activePlayer: 'Human',
	status: 'active',
	winner: null,
	turns: 0
};
export const SKOLL_TURN: GameState = {
	activePlayer: 'Sköll',
	status: 'active',
	winner: null,
	turns: 1
};
export const HUMAN_WON: GameState = {
	activePlayer: 'Human',
	status: 'won',
	winner: 'Human',
	turns: 1
};
export const SKOLL_WON: GameState = {
	activePlayer: 'Sköll',
	status: 'won',
	winner: 'Sköll',
	turns: 5
};

// The common Oracle refusal line both suites assert against.
export const ASK_ANSWER = 'No. Sól is not reaching for a fire rune.';

type PendingReaction = { echo: string; held: { Scry: boolean; Hex: boolean } } | null;

// Full page props (data normally comes from +page.server.ts).
export const props = (
	state: GameState,
	pendingReaction: PendingReaction = null,
	roundId = 'test-round'
) => ({
	data: { boardSeed: 0, roundId, state, pendingReaction, lastLine: null },
	params: {},
	form: null
});

export const propsWith = (state: GameState) => props(state);
