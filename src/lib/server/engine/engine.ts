// Deterministic engine — the referee and single source of truth.
//
// Owns the board, the secret, turn order, legality, truthful query resolution,
// and the win check. It is the strictest-tested module in the project: an
// untested branch here is an unfair round. The engine NEVER reads either
// player's crossings (those are a private aid) and NEVER exposes the secret
// before a correct cast — the only secret-bearing path is a winning CastResult.

import { runes, type Rune } from '$lib/board';
import { mulberry32 } from '$lib/prng';
import { parseQuery, resolveQuery } from './queries';
import type { Player } from './actions';

export type InvalidReason = 'round-over' | 'not-your-turn' | 'malformed-query' | 'unknown-rune';

/** One-use reactions. Each player holds one of each per round; spending it is permanent. */
export type Reaction = 'Scry' | 'Hex';

export type AskResult =
	| { ok: true; answer: boolean; turnConsumed: true }
	| { ok: false; reason: InvalidReason; turnConsumed: false };

export type CastResult =
	| { ok: true; won: true; rune: Rune; turnConsumed: true }
	| { ok: true; won: false; turnConsumed: true }
	| { ok: false; reason: InvalidReason; turnConsumed: false };

interface Round {
	secret: Rune;
	active: Player;
	status: 'active' | 'won';
	winner: Player | null;
	wrongCasts: Record<Player, number>;
	// Turns consumed this round — a resolved Ask or Cast each spend one. The courtesy passTurn does
	// NOT, so this counts real plays, not alternation flips. Drives the cosmetic night-progress chrome.
	turns: number;
	// One Scry + one Hex per player, spent permanently within the round.
	reactions: Record<Player, Record<Reaction, boolean>>;
	// The open reaction window: the asker whose *pending* Ask the rival may react to before it is
	// answered, or null when none is open. It is opened around a pending Ask (openReactionWindow),
	// NOT as a side effect of a resolved one — so a Hex lands before any answer is produced, never
	// after. A resolved Cast closes it (casts are sacred, never interruptible); a reaction or a
	// decline closes it — at most one reaction per window.
	window: Player | null;
}

/** Pick the secret rune for a seed. Deterministic; the production round path. */
export function selectSecret(seed: number): Rune {
	const rng = mulberry32(seed);
	return runes[Math.floor(rng() * runes.length)];
}

export class GameEngine {
	#round: Round;

	constructor(seed: number) {
		this.#round = GameEngine.#freshRound(seed);
	}

	static #freshRound(seed: number): Round {
		return {
			secret: selectSecret(seed),
			active: 'Human', // strict alternation, human moves first
			status: 'active',
			winner: null,
			wrongCasts: { Human: 0, Sköll: 0 },
			turns: 0,
			reactions: {
				Human: { Scry: true, Hex: true },
				Sköll: { Scry: true, Hex: true }
			},
			window: null
		};
	}

	/** Reseed for a new round: new secret, human-first, all per-round state cleared. */
	newRound(seed: number): void {
		this.#round = GameEngine.#freshRound(seed);
	}

	get activePlayer(): Player {
		return this.#round.active;
	}

	get status(): 'active' | 'won' {
		return this.#round.status;
	}

	get winner(): Player | null {
		return this.#round.winner;
	}

	/** Per-player wrong-cast count. v1 exposes it; the v2 forfeit threshold reads it later. */
	wrongCastCount(player: Player): number {
		return this.#round.wrongCasts[player];
	}

	/** Turns consumed this round (resolved Asks + resolved Casts). Drives night-progress chrome. */
	get turns(): number {
		return this.#round.turns;
	}

	#advance(): void {
		this.#round.active = this.#round.active === 'Human' ? 'Sköll' : 'Human';
	}

	/** Hand the turn on without an action — used to skip a player that has no mover yet. */
	passTurn(): void {
		if (this.#round.status === 'active') this.#advance();
	}

	/**
	 * Resolve an Ask. A refused Ask (out of turn, malformed) never consumes the turn; a
	 * resolved Ask does. Repeating a question is legal play — the Oracle answers the same
	 * truth again; the engine never disallows a re-ask.
	 */
	ask(player: Player, input: unknown): AskResult {
		if (this.#round.status !== 'active')
			return { ok: false, reason: 'round-over', turnConsumed: false };
		if (player !== this.#round.active)
			return { ok: false, reason: 'not-your-turn', turnConsumed: false };

		const query = parseQuery(input);
		if (query === null) return { ok: false, reason: 'malformed-query', turnConsumed: false };

		const answer = resolveQuery(this.#round.secret, query);
		this.#round.turns += 1;
		this.#advance();
		return { ok: true, answer, turnConsumed: true };
	}

	/**
	 * Resolve a Cast. Accepts ANY real rune, crossed or not — the engine never
	 * reads crossings. Only the secret wins; a wrong cast wastes the turn and the
	 * round continues. An unknown rune name is malformed and costs no turn.
	 */
	cast(player: Player, runeName: string): CastResult {
		if (this.#round.status !== 'active')
			return { ok: false, reason: 'round-over', turnConsumed: false };
		if (player !== this.#round.active)
			return { ok: false, reason: 'not-your-turn', turnConsumed: false };

		const rune = runes.find((r) => r.name === runeName);
		if (rune === undefined) return { ok: false, reason: 'unknown-rune', turnConsumed: false };

		this.#round.window = null; // a resolved Cast is sacred — it leaves no reaction window open
		this.#round.turns += 1;

		if (rune.name === this.#round.secret.name) {
			this.#round.status = 'won';
			this.#round.winner = player;
			return { ok: true, won: true, rune: this.#round.secret, turnConsumed: true };
		}

		this.#round.wrongCasts[player] += 1;
		this.#advance();
		return { ok: true, won: false, turnConsumed: true };
	}

	/**
	 * Open a reaction window around a *pending* Ask — the rival may Scry/Hex it before it is
	 * answered. Opened by the orchestration when a player declares an Ask (the S6 seam where
	 * Sköll Asks and the human reacts), not by `ask` itself, so a Hex resolves before any answer
	 * is produced. On Hex the answer is never asked for; on Pass/Scry the orchestration resolves
	 * the Ask after the window closes.
	 */
	openReactionWindow(asker: Player): void {
		this.#round.window = asker;
	}

	/** Whether a player still holds a given reaction this round. */
	reactionAvailable(player: Player, reaction: Reaction): boolean {
		return this.#round.reactions[player][reaction];
	}

	/** The asker whose Ask is open to the rival's reaction, or null when no window is open. */
	get reactionWindow(): Player | null {
		return this.#round.window;
	}

	/** Spend a reaction and close the window — the one reaction this window allows. */
	consumeReaction(player: Player, reaction: Reaction): void {
		this.#round.reactions[player][reaction] = false;
		this.#round.window = null;
	}

	/** Close the window without spending a reaction — the rival let the Ask pass. */
	declineReaction(): void {
		this.#round.window = null;
	}
}
