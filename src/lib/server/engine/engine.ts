// Deterministic engine — the referee and single source of truth (S1).
//
// Owns the board, the secret, turn order, legality, truthful query resolution,
// and the win check. It is the strictest-tested module in the project: an
// untested branch here is an unfair round. The engine NEVER reads either
// player's crossings (those are a private aid) and NEVER exposes the secret
// before a correct cast — the only secret-bearing path is a winning CastResult.

import { runes, type Rune } from '$lib/board';
import { parseQuery, queryKey, resolveQuery } from './queries';
import type { Player } from './actions';

export type InvalidReason =
	| 'round-over'
	| 'not-your-turn'
	| 'malformed-query'
	| 'already-asked'
	| 'unknown-rune';

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
	asked: Record<Player, Set<string>>;
}

// mulberry32: a tiny, fast, fully deterministic PRNG. Same seed → same stream,
// which is what makes a round reproducible for the demo.
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
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
			asked: { Human: new Set(), Sköll: new Set() }
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

	#advance(): void {
		this.#round.active = this.#round.active === 'Human' ? 'Sköll' : 'Human';
	}

	/**
	 * Resolve an Ask. A refused Ask (out of turn, malformed, already asked) never
	 * consumes the turn; a resolved Ask does.
	 */
	ask(player: Player, input: unknown): AskResult {
		if (this.#round.status !== 'active')
			return { ok: false, reason: 'round-over', turnConsumed: false };
		if (player !== this.#round.active)
			return { ok: false, reason: 'not-your-turn', turnConsumed: false };

		const query = parseQuery(input);
		if (query === null) return { ok: false, reason: 'malformed-query', turnConsumed: false };

		const key = queryKey(query);
		if (this.#round.asked[player].has(key))
			return { ok: false, reason: 'already-asked', turnConsumed: false };

		this.#round.asked[player].add(key);
		const answer = resolveQuery(this.#round.secret, query);
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

		if (rune.name === this.#round.secret.name) {
			this.#round.status = 'won';
			this.#round.winner = player;
			return { ok: true, won: true, rune: this.#round.secret, turnConsumed: true };
		}

		this.#round.wrongCasts[player] += 1;
		this.#advance();
		return { ok: true, won: false, turnConsumed: true };
	}
}
