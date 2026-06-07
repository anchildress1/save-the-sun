import { describe, it, expect, vi } from 'vitest';
import {
	buildPayload,
	freshSkollState,
	reactToHumanAsk,
	resolveSkollAsk,
	takeSkollTurn,
	type RawSkollDecision,
	type SkollDecide,
	type SkollPayload,
	type SkollReactionDecide,
	type SkollState
} from '$lib/server/skoll/skoll';
import { GameEngine, selectSecret } from '$lib/server/engine/engine';
import { resolveReaction } from '$lib/server/engine/reactions';
import { mulberry32 } from '$lib/prng';
import { runes } from '$lib/board';

const SEED = 1;
const secretName = () => selectSecret(SEED).name;
const wrongName = () => runes.find((r) => r.name !== secretName())!.name;

/** An engine on Sköll's turn — the human's opening pass hands it straight to the wolf. */
function skollsTurn(): GameEngine {
	const engine = new GameEngine(SEED);
	engine.passTurn(); // Human → Sköll
	expect(engine.activePlayer).toBe('Sköll');
	return engine;
}

const decideAsk = (query: unknown, crossOff?: number[]): SkollDecide =>
	vi.fn(async () => ({ kind: 'ask', query, crossOff }) as RawSkollDecision);
const decideCast = (runeName: string): SkollDecide =>
	vi.fn(async () => ({ kind: 'cast', runeName }) as RawSkollDecision);

describe('buildPayload — earned-only, no secret', () => {
	it('exposes only the public board, his answers, and his sheet', () => {
		const state: SkollState = {
			...freshSkollState(SEED),
			facts: [{ query: { axis: 'element', value: 'Fire' }, answer: true }],
			crossed: new Set([3, 7])
		};
		const payload = buildPayload(state);
		expect(Object.keys(payload).sort()).toEqual(['answers', 'board', 'crossedOff']);
		expect(payload.answers).toEqual([{ trait: 'a fire rune', holds: true }]);
		expect(payload.crossedOff).toEqual([3, 7]);
		// Board carries public traits only — no `fill`-of-secret marker, no human crossings.
		expect(Object.keys(payload.board[0]).sort()).toEqual([
			'color',
			'element',
			'fill',
			'id',
			'name',
			'power'
		]);
	});

	it('is independent of the secret — same state, different secret, identical payload', () => {
		const state = freshSkollState(SEED);
		// buildPayload takes state, not an engine, so two rounds with different secrets are equal.
		expect(buildPayload(state)).toEqual(buildPayload(state));
	});
});

describe('takeSkollTurn — Gemini plays, engine referees', () => {
	it('[Sec] hands Gemini an earned-only payload, never the secret', async () => {
		const engine = skollsTurn();
		const state = freshSkollState(SEED);
		const decide = decideCast(wrongName());
		await takeSkollTurn(engine, state, decide, mulberry32(1));
		const payload = (decide as ReturnType<typeof vi.fn>).mock.calls[0][0] as SkollPayload;
		const seen = JSON.stringify(payload);
		// The payload reveals no which-rune-is-secret signal: it is pure public board + his facts.
		expect(Object.keys(payload).sort()).toEqual(['answers', 'board', 'crossedOff']);
		expect(seen).not.toContain('secret');
	});

	it('opens the reaction window and parks an Ask (answer comes after the human reacts)', async () => {
		const engine = skollsTurn();
		const state = freshSkollState(SEED);
		const out = await takeSkollTurn(
			engine,
			state,
			decideAsk({ axis: 'fill', value: 'Light' }),
			mulberry32(1)
		);
		expect(out).toMatchObject({ kind: 'ask', source: 'gemini' });
		expect(engine.reactionWindow).toBe('Sköll');
		expect(state.pendingAsk).toEqual({ axis: 'fill', value: 'Light' });
		expect(engine.activePlayer).toBe('Sköll'); // not advanced yet — the Ask is unanswered
	});

	it('records his cross-offs to his private sheet (traceable)', async () => {
		const engine = skollsTurn();
		const state = freshSkollState(SEED);
		await takeSkollTurn(
			engine,
			state,
			decideAsk({ axis: 'fill', value: 'Light' }, [2, 5]),
			mulberry32(1)
		);
		expect([...state.crossed].sort()).toEqual([2, 5]);
	});

	it('drops malformed cross-off ids but keeps the legal move', async () => {
		const engine = skollsTurn();
		const state = freshSkollState(SEED);
		await takeSkollTurn(
			engine,
			state,
			decideAsk({ axis: 'fill', value: 'Light' }, [2, 99, 1.5] as number[]),
			mulberry32(1)
		);
		expect([...state.crossed]).toEqual([2]); // 99 (no such rune) and 1.5 (non-integer) dropped
	});

	it('resolves a Cast immediately — a wrong cast wastes only his turn', async () => {
		const engine = skollsTurn();
		const out = await takeSkollTurn(
			engine,
			freshSkollState(SEED),
			decideCast(wrongName()),
			mulberry32(1)
		);
		expect(out).toMatchObject({ kind: 'cast', source: 'gemini', result: { ok: true, won: false } });
		expect(engine.status).toBe('active');
		expect(engine.activePlayer).toBe('Human'); // turn handed back; round continues
		expect(engine.wrongCastCount('Sköll')).toBe(1);
	});

	it('wins the round on a correct cast', async () => {
		const engine = skollsTurn();
		const out = await takeSkollTurn(
			engine,
			freshSkollState(SEED),
			decideCast(secretName()),
			mulberry32(1)
		);
		expect(out).toMatchObject({ kind: 'cast', result: { ok: true, won: true } });
		expect(engine.status).toBe('won');
		expect(engine.winner).toBe('Sköll');
	});

	it('falls to the floor on an illegal/malformed decision', async () => {
		const engine = skollsTurn();
		const decide: SkollDecide = vi.fn(async () => ({ kind: 'ask', query: { axis: 'nonsense' } }));
		const out = await takeSkollTurn(engine, freshSkollState(SEED), decide, mulberry32(1));
		expect(out.source).toBe('floor');
	});

	it('falls to the floor when Gemini throws', async () => {
		const engine = skollsTurn();
		const decide: SkollDecide = vi.fn(async () => {
			throw new Error('timeout');
		});
		const out = await takeSkollTurn(engine, freshSkollState(SEED), decide, mulberry32(1));
		expect(out.source).toBe('floor');
	});

	it('falls to the floor on an unknown rune cast', async () => {
		const engine = skollsTurn();
		const out = await takeSkollTurn(
			engine,
			freshSkollState(SEED),
			decideCast('NotARune'),
			mulberry32(1)
		);
		expect(out.source).toBe('floor');
	});
});

describe('resolveSkollAsk — closing his Ask after the human reacts', () => {
	function parkedAsk(): { engine: GameEngine; state: SkollState } {
		const engine = skollsTurn();
		const state = freshSkollState(SEED);
		engine.openReactionWindow('Sköll');
		state.pendingAsk = { axis: 'fill', value: 'Light' };
		return { engine, state };
	}

	it('Pass: answers the Ask, records the fact, advances to the human', () => {
		const { engine, state } = parkedAsk();
		const reaction = resolveReaction(engine, 'Human', 'Pass');
		const answer = resolveSkollAsk(engine, state, reaction);
		expect(answer).toMatchObject({ hexed: false, shared: false });
		expect(state.facts).toHaveLength(1);
		expect(state.pendingAsk).toBeNull();
		expect(engine.activePlayer).toBe('Human');
	});

	it('Scry: answers and shares it with the human', () => {
		const { engine, state } = parkedAsk();
		const reaction = resolveReaction(engine, 'Human', 'Scry');
		const answer = resolveSkollAsk(engine, state, reaction);
		expect(answer).toMatchObject({ hexed: false, shared: true });
		expect(state.facts).toHaveLength(1);
	});

	it('Hex: kills the question, spends his turn, records no fact', () => {
		const { engine, state } = parkedAsk();
		const reaction = resolveReaction(engine, 'Human', 'Hex');
		const answer = resolveSkollAsk(engine, state, reaction);
		expect(answer).toEqual({ hexed: true });
		expect(state.facts).toHaveLength(0);
		expect(engine.activePlayer).toBe('Human'); // his turn spent, unanswered
	});

	it('a failed reaction (no charge) is a no-op — the Ask proceeds as a Pass', () => {
		const { engine, state } = parkedAsk();
		engine.consumeReaction('Human', 'Hex'); // spend it first, then try to Hex again
		engine.openReactionWindow('Sköll'); // consumeReaction closed the window; reopen for the retry
		const reaction = resolveReaction(engine, 'Human', 'Hex'); // → { ok: false, reason: 'no-charge' }
		expect(reaction.ok).toBe(false);
		const answer = resolveSkollAsk(engine, state, reaction);
		expect(answer).toMatchObject({ hexed: false, shared: false });
		expect(state.facts).toHaveLength(1); // the question was answered, not killed
	});

	it('throws if called with no parked Ask', () => {
		const engine = skollsTurn();
		const reaction = resolveReaction(engine, 'Human', 'Pass');
		expect(() => resolveSkollAsk(engine, freshSkollState(SEED), reaction)).toThrow();
	});
});

describe('reactToHumanAsk — Sköll reacting to the human (R12 reverse)', () => {
	const HUMAN_QUERY = { axis: 'fill', value: 'Light' } as const;
	const reacts = (reaction: string): SkollReactionDecide => vi.fn(async () => ({ reaction }));
	// rng below the REACTION_CHANCE gate, so he actually considers a reaction (consults Gemini).
	const consider = () => 0;

	it('Pass: lets her Ask stand and spends nothing', async () => {
		const engine = new GameEngine(SEED); // human's turn
		const vs = await reactToHumanAsk(
			engine,
			freshSkollState(SEED),
			HUMAN_QUERY,
			reacts('Pass'),
			consider
		);
		expect(vs).toEqual({ choice: 'Pass', killed: false, scried: false });
		expect(engine.reactionAvailable('Sköll', 'Scry')).toBe(true);
		expect(engine.reactionWindow).toBeNull();
	});

	it('Hex: kills her Ask and spends the charge', async () => {
		const engine = new GameEngine(SEED);
		const vs = await reactToHumanAsk(
			engine,
			freshSkollState(SEED),
			HUMAN_QUERY,
			reacts('Hex'),
			consider
		);
		expect(vs).toMatchObject({ choice: 'Hex', killed: true });
		expect(engine.reactionAvailable('Sköll', 'Hex')).toBe(false);
	});

	it('Scry: overhears her answer and spends the charge', async () => {
		const engine = new GameEngine(SEED);
		const vs = await reactToHumanAsk(
			engine,
			freshSkollState(SEED),
			HUMAN_QUERY,
			reacts('Scry'),
			consider
		);
		expect(vs).toMatchObject({ choice: 'Scry', scried: true });
		expect(engine.reactionAvailable('Sköll', 'Scry')).toBe(false);
	});

	it('passes (floor) when the reaction decision throws', async () => {
		const engine = new GameEngine(SEED);
		const decide: SkollReactionDecide = vi.fn(async () => {
			throw new Error('timeout');
		});
		const vs = await reactToHumanAsk(engine, freshSkollState(SEED), HUMAN_QUERY, decide, consider);
		expect(vs.choice).toBe('Pass');
	});

	it('passes (floor) on an illegal reaction value', async () => {
		const engine = new GameEngine(SEED);
		const vs = await reactToHumanAsk(
			engine,
			freshSkollState(SEED),
			HUMAN_QUERY,
			reacts('Howl'),
			consider
		);
		expect(vs.choice).toBe('Pass');
	});

	it('mostly lets the Ask pass without even consulting Gemini (dumbed-down reactions)', async () => {
		const engine = new GameEngine(SEED);
		const decide = reacts('Hex');
		// rng above the gate → he doesn't even consider reacting.
		const vs = await reactToHumanAsk(
			engine,
			freshSkollState(SEED),
			HUMAN_QUERY,
			decide,
			() => 0.99
		);
		expect(vs.choice).toBe('Pass');
		expect(decide).not.toHaveBeenCalled();
		expect(engine.reactionAvailable('Sköll', 'Hex')).toBe(true); // charge untouched
	});

	it('never bluffs a reaction with no charges left — passes without asking', async () => {
		const engine = new GameEngine(SEED);
		engine.consumeReaction('Sköll', 'Scry');
		engine.consumeReaction('Sköll', 'Hex');
		const decide = reacts('Hex');
		const vs = await reactToHumanAsk(engine, freshSkollState(SEED), HUMAN_QUERY, decide, consider);
		expect(vs.choice).toBe('Pass');
		expect(decide).not.toHaveBeenCalled();
	});
});
