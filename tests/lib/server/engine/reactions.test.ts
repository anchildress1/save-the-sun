import { describe, it, expect } from 'vitest';
import { GameEngine, selectSecret } from '$lib/server/engine/engine';
import { resolveReaction } from '$lib/server/engine/reactions';
import { runes } from '$lib/board';

const SEED = 1;
const LIGHT = { axis: 'fill', value: 'Light' } as const;
const wrongRune = () => runes.find((r) => r.name !== selectSecret(SEED).name)!.name;

/** A fresh engine with the Human's Ask resolved, so a window is open for Sköll to react to. */
function afterHumanAsk(): GameEngine {
	const engine = new GameEngine(SEED);
	engine.ask('Human', LIGHT);
	return engine;
}

describe('resolveReaction — Scry & Hex over a rival Ask (S5)', () => {
	it('Scry overhears the answer and spends the charge', () => {
		const engine = afterHumanAsk();
		const outcome = resolveReaction(engine, 'Sköll', 'Scry');
		expect(outcome).toEqual({ ok: true, choice: 'Scry', shareAnswer: true });
		expect(engine.reactionAvailable('Sköll', 'Scry')).toBe(false);
	});

	it('Hex silences the question and spends the charge', () => {
		const engine = afterHumanAsk();
		const outcome = resolveReaction(engine, 'Sköll', 'Hex');
		expect(outcome).toEqual({ ok: true, choice: 'Hex', killAnswer: true });
		expect(engine.reactionAvailable('Sköll', 'Hex')).toBe(false);
	});

	it('Pass lets the Ask stand and spends nothing', () => {
		const engine = afterHumanAsk();
		const outcome = resolveReaction(engine, 'Sköll', 'Pass');
		expect(outcome).toEqual({ ok: true, choice: 'Pass' });
		expect(engine.reactionAvailable('Sköll', 'Scry')).toBe(true);
		expect(engine.reactionAvailable('Sköll', 'Hex')).toBe(true);
		expect(engine.reactionWindow).toBeNull();
	});

	it('allows one of each reaction per round, never a second', () => {
		const engine = afterHumanAsk();
		expect(resolveReaction(engine, 'Sköll', 'Scry').ok).toBe(true);
		// Charge spent; even with a fresh window later, the same reaction can't fire again.
		engine.passTurn(); // hand play back to the human
		engine.ask('Human', LIGHT); // reopens a window the wolf could react to
		expect(resolveReaction(engine, 'Sköll', 'Scry')).toEqual({ ok: false, reason: 'no-charge' });
	});

	it('allows at most one reaction per window — the window closes on the first', () => {
		const engine = afterHumanAsk();
		expect(resolveReaction(engine, 'Sköll', 'Scry').ok).toBe(true);
		// Same window: Hex now has no question left to silence (Scry already closed it).
		expect(resolveReaction(engine, 'Sköll', 'Hex')).toEqual({ ok: false, reason: 'no-window' });
	});

	it('triggers on an Ask only — never on a Cast (the win check is sacred)', () => {
		const engine = afterHumanAsk();
		engine.cast('Sköll', wrongRune()); // a resolved Cast closes the window
		expect(resolveReaction(engine, 'Human', 'Scry')).toEqual({ ok: false, reason: 'no-window' });
		expect(resolveReaction(engine, 'Human', 'Hex')).toEqual({ ok: false, reason: 'no-window' });
	});

	it('is unavailable before any Ask opens a window', () => {
		const engine = new GameEngine(SEED);
		expect(resolveReaction(engine, 'Sköll', 'Scry')).toEqual({ ok: false, reason: 'no-window' });
	});

	it('cannot react to your own Ask — only the rival may', () => {
		const engine = afterHumanAsk(); // window owned by Human
		expect(resolveReaction(engine, 'Human', 'Scry')).toEqual({ ok: false, reason: 'no-window' });
	});
});
