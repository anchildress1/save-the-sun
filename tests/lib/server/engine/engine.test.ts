import { describe, it, expect } from 'vitest';
import { runes, type Rune } from '$lib/board';
import { GameEngine, selectSecret } from '$lib/server/engine/engine';
import { resolveQuery } from '$lib/server/engine/queries';

const ELEMENTS = [...new Set(runes.map((r) => r.element))];
const COLORS = [...new Set(runes.map((r) => r.color))];
const POWERS = [1, 2, 3, 4, 5, 6];

/** A non-secret rune, so "wrong cast" / "different value" cases are well-defined. */
function otherRune(secret: Rune): Rune {
	return runes.find((r) => r.name !== secret.name) as Rune;
}

/** Deduce the secret using only truthful Asks (no peeking). Returns the surviving candidates. */
function identifyByAsks(secret: Rune): Rune[] {
	let candidates = [...runes];
	for (const value of ELEMENTS) {
		if (resolveQuery(secret, { axis: 'element', value })) {
			candidates = candidates.filter((c) => c.element === value);
		}
	}
	for (const value of POWERS) {
		if (resolveQuery(secret, { axis: 'power', op: 'eq', value })) {
			candidates = candidates.filter((c) => c.power === value);
		}
	}
	for (const value of COLORS) {
		if (resolveQuery(secret, { axis: 'color', value })) {
			candidates = candidates.filter((c) => c.color === value);
		}
	}
	return candidates;
}

describe('selectSecret', () => {
	it('is deterministic — same seed yields the same rune', () => {
		for (const seed of [0, 1, 42, 12345, 999999]) {
			expect(selectSecret(seed).name).toBe(selectSecret(seed).name);
		}
	});

	it('always selects exactly one rune from the board', () => {
		for (let seed = 0; seed < 500; seed++) {
			expect(runes).toContainEqual(selectSecret(seed));
		}
	});
});

describe('GameEngine — starting state (strict alternation, human first)', () => {
	it('starts on the human with an active, unwon round and zero wrong casts', () => {
		const engine = new GameEngine(7);
		expect(engine.activePlayer).toBe('Human');
		expect(engine.status).toBe('active');
		expect(engine.winner).toBeNull();
		expect(engine.wrongCastCount('Human')).toBe(0);
		expect(engine.wrongCastCount('Sköll')).toBe(0);
	});
});

describe('GameEngine.ask — truth + turn accounting', () => {
	it('resolves a valid Ask truthfully and consumes the turn', () => {
		const seed = 7;
		const secret = selectSecret(seed);
		const engine = new GameEngine(seed);
		const query = { axis: 'element', value: secret.element } as const;
		const result = engine.ask('Human', query);
		expect(result).toEqual({ ok: true, answer: true, turnConsumed: true });
		expect(resolveQuery(secret, query)).toBe(true);
		expect(engine.activePlayer).toBe('Sköll');
	});

	it('answers No truthfully without leaking the excluded value', () => {
		const seed = 7;
		const secret = selectSecret(seed);
		const engine = new GameEngine(seed);
		const wrongElement = ELEMENTS.find((e) => e !== secret.element) as string;
		const result = engine.ask('Human', { axis: 'element', value: wrongElement });
		expect(result).toEqual({ ok: true, answer: false, turnConsumed: true });
	});

	it('rejects an out-of-turn Ask without consuming the turn', () => {
		const engine = new GameEngine(7);
		const result = engine.ask('Sköll', { axis: 'element', value: 'Fire' });
		expect(result).toEqual({ ok: false, reason: 'not-your-turn', turnConsumed: false });
		expect(engine.activePlayer).toBe('Human');
	});

	it('rejects a malformed Ask without consuming the turn', () => {
		const engine = new GameEngine(7);
		const result = engine.ask('Human', { axis: 'element', value: 'Shadow' });
		expect(result).toEqual({ ok: false, reason: 'malformed-query', turnConsumed: false });
		expect(engine.activePlayer).toBe('Human');
	});

	it('allows a repeated question — re-asking is legal play, not an error', () => {
		const seed = 7;
		const secret = selectSecret(seed);
		const engine = new GameEngine(seed);
		const query = { axis: 'element', value: secret.element } as const;
		const first = engine.ask('Human', query); // Human → Sköll
		engine.ask('Sköll', { axis: 'fill', value: 'Dark' }); // Sköll → Human
		const repeat = engine.ask('Human', query); // same question again
		// Both resolve identically and each consumes the turn — no "already-asked" refusal.
		expect(repeat).toEqual(first);
		expect(repeat).toEqual({ ok: true, answer: true, turnConsumed: true });
		expect(engine.activePlayer).toBe('Sköll');
	});

	it('alternates strictly, human → Sköll → human', () => {
		const engine = new GameEngine(7);
		expect(engine.ask('Human', { axis: 'fill', value: 'Light' }).ok).toBe(true);
		expect(engine.activePlayer).toBe('Sköll');
		expect(engine.ask('Sköll', { axis: 'fill', value: 'Dark' }).ok).toBe(true);
		expect(engine.activePlayer).toBe('Human');
	});
});

describe('GameEngine.cast — only the secret wins; the grid is an aid, never a cage', () => {
	it('wins on the secret and reveals the rune only at the win', () => {
		const seed = 7;
		const secret = selectSecret(seed);
		const engine = new GameEngine(seed);
		const result = engine.cast('Human', secret.name);
		expect(result).toEqual({ ok: true, won: true, rune: secret, turnConsumed: true });
		expect(engine.status).toBe('won');
		expect(engine.winner).toBe('Human');
	});

	it('accepts a cast of any real rune — engine never reads crossings', () => {
		const seed = 7;
		const secret = selectSecret(seed);
		const engine = new GameEngine(seed);
		// The engine is never told about crossings; the secret wins purely on identity.
		expect(engine.cast('Human', secret.name).ok).toBe(true);
	});

	it('wastes the turn on a wrong cast, increments the counter, and continues the round', () => {
		const seed = 7;
		const secret = selectSecret(seed);
		const engine = new GameEngine(seed);
		const result = engine.cast('Human', otherRune(secret).name);
		expect(result).toEqual({ ok: true, won: false, turnConsumed: true });
		expect(engine.status).toBe('active');
		expect(engine.winner).toBeNull();
		expect(engine.wrongCastCount('Human')).toBe(1);
		expect(engine.activePlayer).toBe('Sköll');
	});

	it('counts wrong casts per player and leaves the round running', () => {
		const seed = 7;
		const secret = selectSecret(seed);
		const engine = new GameEngine(seed);
		const wrong = otherRune(secret).name;
		engine.cast('Human', wrong); // Human → Sköll
		engine.cast('Sköll', wrong); // Sköll → Human
		expect(engine.wrongCastCount('Human')).toBe(1);
		expect(engine.wrongCastCount('Sköll')).toBe(1);
		expect(engine.status).toBe('active');
		expect(engine.activePlayer).toBe('Human');
	});

	it('rejects an unknown rune name without consuming the turn', () => {
		const engine = new GameEngine(7);
		const result = engine.cast('Human', 'Definitely-Not-A-Rune');
		expect(result).toEqual({ ok: false, reason: 'unknown-rune', turnConsumed: false });
		expect(engine.activePlayer).toBe('Human');
		expect(engine.wrongCastCount('Human')).toBe(0);
	});

	it('rejects an out-of-turn cast', () => {
		const engine = new GameEngine(7);
		const result = engine.cast('Sköll', selectSecret(7).name);
		expect(result).toEqual({ ok: false, reason: 'not-your-turn', turnConsumed: false });
		expect(engine.status).toBe('active');
	});
});

describe('GameEngine — round is over once won', () => {
	it('refuses further Ask and Cast after a win', () => {
		const seed = 7;
		const engine = new GameEngine(seed);
		engine.cast('Human', selectSecret(seed).name);
		expect(engine.ask('Sköll', { axis: 'fill', value: 'Dark' })).toEqual({
			ok: false,
			reason: 'round-over',
			turnConsumed: false
		});
		expect(engine.cast('Sköll', otherRune(selectSecret(seed)).name)).toEqual({
			ok: false,
			reason: 'round-over',
			turnConsumed: false
		});
	});
});

describe('GameEngine.newRound — reseed clears all per-round state', () => {
	it('resets secret, turn, status, and counters', () => {
		const engine = new GameEngine(7);
		engine.ask('Human', { axis: 'element', value: 'Fire' });
		engine.cast('Sköll', otherRune(selectSecret(7)).name);
		engine.newRound(8);
		expect(engine.activePlayer).toBe('Human');
		expect(engine.status).toBe('active');
		expect(engine.winner).toBeNull();
		expect(engine.wrongCastCount('Human')).toBe(0);
		expect(engine.wrongCastCount('Sköll')).toBe(0);
		expect(engine.ask('Human', { axis: 'element', value: 'Fire' }).ok).toBe(true);
	});

	it('selects a fresh secret matching the new seed', () => {
		const engine = new GameEngine(7);
		engine.newRound(8);
		expect(engine.cast('Human', selectSecret(8).name)).toMatchObject({ won: true });
	});
});

describe('GameEngine — secret confidentiality (no path leaks the secret pre-cast)', () => {
	it('exposes no enumerable secret on the instance', () => {
		const engine = new GameEngine(7);
		expect(JSON.stringify(engine)).toBe('{}');
		expect(Object.keys(engine)).toHaveLength(0);
	});

	it('returns only a boolean from an Ask — never the secret', () => {
		const engine = new GameEngine(7);
		const result = engine.ask('Human', { axis: 'element', value: 'Fire' });
		expect(Object.keys(result).sort((a, b) => a.localeCompare(b))).toEqual([
			'answer',
			'ok',
			'turnConsumed'
		]);
	});

	it('does not reveal the rune on a wrong cast', () => {
		const seed = 7;
		const engine = new GameEngine(seed);
		const result = engine.cast('Human', otherRune(selectSecret(seed)).name);
		expect(result).not.toHaveProperty('rune');
	});
});

describe('GameEngine — passTurn skips a player with no mover', () => {
	it('hands the turn on while the round is active', () => {
		const engine = new GameEngine(1);
		engine.ask('Human', { axis: 'fill', value: 'Light' }); // Human → Sköll
		expect(engine.activePlayer).toBe('Sköll');
		engine.passTurn();
		expect(engine.activePlayer).toBe('Human');
	});

	it('is a no-op once the round is won', () => {
		const engine = new GameEngine(1);
		engine.cast('Human', selectSecret(1).name); // win
		engine.passTurn();
		expect(engine.status).toBe('won');
		expect(engine.activePlayer).toBe('Human');
	});
});

describe('GameEngine.turns — consumed-turn count (drives night-progress chrome)', () => {
	it('starts at zero on a fresh round', () => {
		expect(new GameEngine(7).turns).toBe(0);
	});

	it('counts a resolved Ask but never a refused one', () => {
		const engine = new GameEngine(7);
		engine.ask('Human', { axis: 'fill', value: 'Light' }); // resolved → 1
		expect(engine.turns).toBe(1);
		// Out-of-turn (Human already passed to Sköll) and malformed Asks are refused — no count.
		engine.ask('Human', { axis: 'fill', value: 'Light' }); // not-your-turn
		engine.ask('Sköll', { axis: 'element', value: 'Shadow' }); // malformed
		expect(engine.turns).toBe(1);
	});

	it('counts a wrong cast and the winning cast alike (both consume a turn)', () => {
		const seed = 7;
		const secret = selectSecret(seed);
		const engine = new GameEngine(seed);
		engine.cast('Human', otherRune(secret).name); // wrong → 1, Human → Sköll
		expect(engine.turns).toBe(1);
		engine.cast('Sköll', secret.name); // win → 2
		expect(engine.turns).toBe(2);
	});

	it('does not count an unknown-rune cast (refused, no turn spent)', () => {
		const engine = new GameEngine(7);
		engine.cast('Human', 'Definitely-Not-A-Rune');
		expect(engine.turns).toBe(0);
	});

	it('is not bumped by the courtesy passTurn — only real plays count', () => {
		const engine = new GameEngine(1);
		engine.ask('Human', { axis: 'fill', value: 'Light' }); // → 1, Human → Sköll
		engine.passTurn(); // shim hands play back without spending a turn
		expect(engine.turns).toBe(1);
	});

	it('resets to zero on a new round', () => {
		const engine = new GameEngine(7);
		engine.ask('Human', { axis: 'fill', value: 'Light' });
		engine.newRound(8);
		expect(engine.turns).toBe(0);
	});
});

describe('GameEngine — reaction charges & interrupt window (S5)', () => {
	const LIGHT = { axis: 'fill', value: 'Light' } as const;

	it('starts each round with both reactions held and no open window', () => {
		const engine = new GameEngine(7);
		for (const player of ['Human', 'Sköll'] as const) {
			expect(engine.reactionAvailable(player, 'Scry')).toBe(true);
			expect(engine.reactionAvailable(player, 'Hex')).toBe(true);
		}
		expect(engine.reactionWindow).toBeNull();
	});

	it('opens a window owned by the asker on a resolved Ask', () => {
		const engine = new GameEngine(7);
		engine.ask('Human', LIGHT);
		expect(engine.reactionWindow).toBe('Human');
	});

	it('leaves no window open after a resolved Cast — casts are sacred', () => {
		const seed = 7;
		const engine = new GameEngine(seed);
		engine.ask('Human', LIGHT); // opens a window
		engine.cast('Sköll', otherRune(selectSecret(seed)).name); // wrong cast resolves, closes it
		expect(engine.reactionWindow).toBeNull();
	});

	it('does not open a window on a refused Ask', () => {
		const engine = new GameEngine(7);
		engine.ask('Sköll', LIGHT); // out of turn — refused
		expect(engine.reactionWindow).toBeNull();
	});

	it('spends a reaction and closes the window when consumed', () => {
		const engine = new GameEngine(7);
		engine.ask('Human', LIGHT);
		engine.consumeReaction('Sköll', 'Scry');
		expect(engine.reactionAvailable('Sköll', 'Scry')).toBe(false);
		expect(engine.reactionAvailable('Sköll', 'Hex')).toBe(true);
		expect(engine.reactionWindow).toBeNull();
	});

	it('closes the window without spending when declined', () => {
		const engine = new GameEngine(7);
		engine.ask('Human', LIGHT);
		engine.declineReaction();
		expect(engine.reactionWindow).toBeNull();
		expect(engine.reactionAvailable('Sköll', 'Scry')).toBe(true);
	});

	it('restores both reactions and clears the window on a new round', () => {
		const engine = new GameEngine(7);
		engine.ask('Human', LIGHT);
		engine.consumeReaction('Sköll', 'Hex');
		engine.newRound(8);
		expect(engine.reactionAvailable('Sköll', 'Hex')).toBe(true);
		expect(engine.reactionWindow).toBeNull();
	});
});

describe('GameEngine — round solvability (every secret winnable through legal Asks; Oracle never lies)', () => {
	it('reaches every one of the 24 secrets by some seed', () => {
		const seedFor = new Map<string, number>();
		for (let seed = 0; seed < 5000 && seedFor.size < runes.length; seed++) {
			const name = selectSecret(seed).name;
			if (!seedFor.has(name)) seedFor.set(name, seed);
		}
		expect(seedFor.size).toBe(runes.length);
	});

	it('identifies each secret to exactly one rune via Asks, then wins the cast', () => {
		const seedFor = new Map<string, number>();
		for (let seed = 0; seed < 5000 && seedFor.size < runes.length; seed++) {
			const name = selectSecret(seed).name;
			if (!seedFor.has(name)) seedFor.set(name, seed);
		}
		for (const secret of runes) {
			const candidates = identifyByAsks(secret);
			expect(candidates).toHaveLength(1);
			expect(candidates[0].name).toBe(secret.name);

			const seed = seedFor.get(secret.name) as number;
			const engine = new GameEngine(seed);
			expect(engine.cast('Human', candidates[0].name)).toMatchObject({ won: true });
		}
	});
});
