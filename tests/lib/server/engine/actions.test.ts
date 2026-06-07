import { describe, it, expect } from 'vitest';
import { handleAction, gameState, type ActionDeps } from '$lib/server/engine/actions';
import { GameEngine, selectSecret } from '$lib/server/engine/engine';
import type { Interpret } from '$lib/server/oracle/types';

const SEED = 1;
const SECRET = selectSecret(SEED);

const interpret: Interpret = async () => ({
	kind: 'query',
	query: { axis: 'fill', value: 'Light' },
	paraphrase: 'whether it is light'
});

const deps = (): ActionDeps => ({ engine: new GameEngine(SEED), interpret });

describe('Shared Action Interface — the single routing point', () => {
	it('routes an Ask through the Oracle', async () => {
		const res = await handleAction(
			{ type: 'Ask', player: 'Human', question: 'is it light?' },
			deps()
		);
		expect(res).toMatchObject({ type: 'Ask', oracle: { ok: true } });
	});

	it('routes a Cast straight to the engine', async () => {
		const res = await handleAction(
			{ type: 'Cast', player: 'Human', runeName: SECRET.name },
			deps()
		);
		expect(res).toMatchObject({ type: 'Cast', cast: { won: true } });
	});

	it('acknowledges a CrossOff without refereeing it', async () => {
		const res = await handleAction(
			{ type: 'CrossOff', player: 'Human', runeId: 5, crossed: true },
			deps()
		);
		expect(res).toEqual({ type: 'CrossOff', ok: true });
	});

	it('resolves a rival Scry over an open Ask window', async () => {
		const d = deps();
		// A window is open on the Human's pending Ask (S6 opens this when Sköll Asks); the rival reacts.
		d.engine.openReactionWindow('Human');
		const res = await handleAction({ type: 'React', player: 'Sköll', reaction: 'Scry' }, d);
		expect(res).toEqual({
			type: 'React',
			outcome: { ok: true, choice: 'Scry', shareAnswer: true }
		});
	});

	it('resolves a rival Hex over an open Ask window', async () => {
		const d = deps();
		d.engine.openReactionWindow('Human');
		const res = await handleAction({ type: 'React', player: 'Sköll', reaction: 'Hex' }, d);
		expect(res).toEqual({ type: 'React', outcome: { ok: true, choice: 'Hex', killAnswer: true } });
	});

	it('refuses a reaction with no open window — reactions trigger on an Ask only', async () => {
		const res = await handleAction({ type: 'React', player: 'Sköll', reaction: 'Scry' }, deps());
		expect(res).toEqual({ type: 'React', outcome: { ok: false, reason: 'no-window' } });
	});

	it('routes a Pass through without spending a charge', async () => {
		const res = await handleAction({ type: 'React', player: 'Human', reaction: 'Pass' }, deps());
		expect(res).toEqual({ type: 'React', outcome: { ok: true, choice: 'Pass' } });
	});

	it('keeps Ask and Cast distinct — an Ask never wins the round', async () => {
		const d = deps();
		const res = await handleAction({ type: 'Ask', player: 'Human', question: 'is it light?' }, d);
		// An Ask only ever returns an oracle result — never a cast/win path.
		expect(res.type).toBe('Ask');
		expect(res).not.toHaveProperty('cast');
		// And the engine is untouched as a win: asking is always information.
		expect(d.engine.status).toBe('active');
		expect(d.engine.winner).toBeNull();
	});

	it('keeps Ask and Cast distinct — a Cast never asks', async () => {
		const res = await handleAction(
			{ type: 'Cast', player: 'Human', runeName: SECRET.name },
			deps()
		);
		expect(res.type).toBe('Cast');
		expect(res).not.toHaveProperty('oracle');
	});
});

describe('gameState — public turn snapshot', () => {
	it('reports human-first, active, no winner on a fresh round', () => {
		expect(gameState(new GameEngine(SEED))).toEqual({
			activePlayer: 'Human',
			status: 'active',
			winner: null,
			turns: 0
		});
	});

	it('reports the resolved round and winner after a correct cast', () => {
		const engine = new GameEngine(SEED);
		engine.cast('Human', SECRET.name);
		expect(gameState(engine)).toEqual({
			activePlayer: 'Human',
			status: 'won',
			winner: 'Human',
			turns: 1
		});
	});

	it('hands the turn to Sköll after a resolved Ask (pre-shim engine truth)', () => {
		const engine = new GameEngine(SEED);
		engine.ask('Human', { axis: 'fill', value: 'Light' });
		// Engine alternation is human-first; the route's shim hands it back, not the engine.
		expect(gameState(engine).activePlayer).toBe('Sköll');
	});
});
