import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock both Gemini seams so the route test is deterministic and never touches the network or
// $env. The route is the only place the real adapters are imported.
vi.mock('$lib/server/oracle/gemini', () => ({
	interpret: vi.fn(async () => ({
		kind: 'query',
		query: { axis: 'fill', value: 'Light' },
		paraphrase: 'whether it is light'
	}))
}));

vi.mock('$lib/server/skoll/gemini', () => ({
	decideSkollMove: vi.fn(async () => ({ kind: 'cast', runeName: WRONG })),
	decideSkollReaction: vi.fn(async () => ({ reaction: 'Pass' }))
}));

import { POST } from '$routes/api/action/+server';
import { decideSkollMove, decideSkollReaction } from '$lib/server/skoll/gemini';
import { resetEngine, getEngine, getSkoll } from '$lib/server/engine/session';
import { getEvents, captureGemini, runWithSession } from '$lib/server/debug/log';
import { selectSecret } from '$lib/server/engine/engine';
import { runes } from '$lib/board';

const SEED = 1;
const SID = 'route-session';
const SECRET = selectSecret(SEED).name;
const WRONG = runes.find((r) => r.name !== selectSecret(SEED).name)!.name;
const HUMAN_TURN = { activePlayer: 'Human', status: 'active', winner: null, turns: 0 };
// Sköll only *considers* reacting when his RNG draw falls under REACTION_CHANCE. Inject a stream
// that always draws 0 so the reaction-wiring tests fire deterministically (no magic seed).
const openGate = (sessionId = SID) => (getSkoll(sessionId).rng = () => 0);

const skollDecides = (impl: () => Promise<unknown>) =>
	(decideSkollMove as ReturnType<typeof vi.fn>).mockImplementation(impl);
const skollReacts = (impl: () => Promise<unknown>) =>
	(decideSkollReaction as ReturnType<typeof vi.fn>).mockImplementation(impl);

function callAs(sessionId: string, body: string | object) {
	const request = new Request('http://localhost/api/action', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
	return POST({ request, locals: { sessionId } } as unknown as Parameters<typeof POST>[0]);
}

const call = (body: string | object) => callAs(SID, body);
const ask = () => call({ type: 'Ask', player: 'Human', question: 'is it light?' });
const advance = () => call({ type: 'Advance' });
const json = (res: Awaited<ReturnType<typeof call>>) => res.json();

describe('POST /api/action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetEngine(SID, SEED);
		skollDecides(async () => ({ kind: 'cast', runeName: WRONG })); // default: Sköll misplays a cast
		skollReacts(async () => ({ reaction: 'Pass' })); // default: Sköll lets the human's Ask pass
	});

	it('answers the human Ask and hands the turn to Sköll — without taking it', async () => {
		const data = await json(await ask());
		expect(data).toMatchObject({
			type: 'Ask',
			oracle: { ok: true },
			skollVsYou: { reaction: 'Pass' }
		});
		// The wolf's move is a SEPARATE request, so the answer comes back alone, his turn pending.
		expect(data.skoll).toBeUndefined();
		expect(data.state).toMatchObject({ activePlayer: 'Sköll', status: 'active' });
	});

	it('runs Sköll’s turn only on Advance, handing play back after a wrong cast', async () => {
		await ask(); // turn now sits with Sköll
		const data = await json(await advance());
		expect(data.type).toBe('Advance');
		// A Cast carries no flavor line — the outcome is in the turn state (play handed back, round on).
		expect(data.skoll).toEqual({});
		expect(data.state).toMatchObject({ activePlayer: 'Human', status: 'active' });
	});

	it('keeps play going after Sköll casts wrong — the human can Ask again', async () => {
		await ask(); // turn → Sköll
		const afterCast = await json(await advance()); // Sköll casts wrong → turn back to Human
		expect(afterCast.state.activePlayer).toBe('Human');
		// The human's next Ask must resolve (it really is their turn), not bounce as not-your-turn.
		const again = await json(await ask());
		expect(again.oracle).toMatchObject({ ok: true });
		expect(again.state.activePlayer).toBe('Sköll');
		// And the wolf can take another turn.
		const next = await json(await advance());
		expect(next.skoll).toBeDefined();
	});

	it('rejects a stale Human Ask on Sköll’s turn before he can react', async () => {
		await ask(); // turn now sits with Sköll
		const reactionCalls = (decideSkollReaction as ReturnType<typeof vi.fn>).mock.calls.length;
		skollReacts(async () => ({ reaction: 'Hex' }));
		openGate(); // would open the reaction gate if the React path even ran

		const stale = await json(await ask());

		expect(stale).toMatchObject({
			type: 'Ask',
			oracle: { ok: false, reason: 'engine', engineReason: 'not-your-turn' },
			state: { activePlayer: 'Sköll' }
		});
		expect(stale.skollVsYou).toBeUndefined();
		expect((decideSkollReaction as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(
			reactionCalls
		);
		expect(getEngine(SID).reactionAvailable('Sköll', 'Hex')).toBe(true);
	});

	it('rejects an Ask after the round is won — round-over, no side effects', async () => {
		await call({ type: 'Cast', player: 'Human', runeName: SECRET }); // human wins
		skollReacts(async () => ({ reaction: 'Hex' }));
		openGate(); // would open the gate if the reaction path ran — it must not

		const data = await json(await ask());

		expect(data.oracle).toMatchObject({ ok: false, reason: 'engine', engineReason: 'round-over' });
		expect(data.skollVsYou).toBeUndefined();
		expect(getEngine(SID).reactionAvailable('Sköll', 'Hex')).toBe(true); // charge untouched
	});

	it('is a harmless no-op when Advance is called on the human’s turn', async () => {
		const data = await json(await advance()); // fresh round — still the human's move
		expect(data.skoll).toBeUndefined();
		expect(data.state).toMatchObject({ activePlayer: 'Human' });
	});

	it('parks Sköll on an Ask (via Advance) and prompts the human to react', async () => {
		skollDecides(async () => ({ kind: 'ask', query: { axis: 'color', value: 'Gold' } }));
		await ask();
		const data = await json(await advance());
		expect(data.skoll.asks.echo).toBe('A gold rune. Mine.');
		expect(data.state.activePlayer).toBe('Sköll'); // unanswered — still his turn, window open
	});

	it('resolves Sköll Ask when the human lets it pass', async () => {
		skollDecides(async () => ({ kind: 'ask', query: { axis: 'color', value: 'Gold' } }));
		await ask();
		await advance(); // Sköll now has a parked Ask
		const data = await json(await call({ type: 'React', player: 'Human', reaction: 'Pass' }));
		expect(data.skollReaction).toEqual({ hexed: false });
		expect(data.state.activePlayer).toBe('Human');
	});

	it('shares the answer when the human Scries Sköll Ask', async () => {
		skollDecides(async () => ({ kind: 'ask', query: { axis: 'color', value: 'Gold' } }));
		await ask();
		await advance();
		const data = await json(await call({ type: 'React', player: 'Human', reaction: 'Scry' }));
		expect(data.skollReaction.scried.answer).toMatch(/Sól is (not )?reaching for a gold rune\./);
	});

	it('kills the question when the human Hexes Sköll Ask', async () => {
		skollDecides(async () => ({ kind: 'ask', query: { axis: 'color', value: 'Gold' } }));
		await ask();
		await advance();
		const data = await json(await call({ type: 'React', player: 'Human', reaction: 'Hex' }));
		expect(data.skollReaction).toEqual({ hexed: true });
		expect(data.state.activePlayer).toBe('Human');
	});

	it('surfaces the human’s reaction to Sköll’s Ask in the debug stream', async () => {
		skollDecides(async () => ({ kind: 'ask', query: { axis: 'color', value: 'Gold' } }));
		await ask();
		await advance();
		await call({ type: 'React', player: 'Human', reaction: 'Scry' });
		// Her choice is her own input event (owner Human, part React), distinct from the engine's
		// verdict on the now-resolved Ask — without it the demo log jumps straight to the answer.
		const react = getEvents(SID).find((e) => e.owner === 'Human' && e.part === 'React');
		expect(react).toMatchObject({ owner: 'Human', kind: 'input', part: 'React' });
		expect(react?.message).toContain('Scry');
	});

	it('keeps play moving across repeated Sköll-Ask → human-React cycles (no wedge)', async () => {
		skollDecides(async () => ({ kind: 'ask', query: { axis: 'color', value: 'Gold' } }));
		for (let cycle = 0; cycle < 3; cycle++) {
			expect((await json(await ask())).state.activePlayer).toBe('Sköll');
			await advance(); // Sköll parks his Ask
			const reacted = await json(await call({ type: 'React', player: 'Human', reaction: 'Pass' }));
			expect(reacted.state.activePlayer).toBe('Human'); // control always returns to her
		}
	});

	it('ends the round in defeat when Sköll casts true on Advance', async () => {
		skollDecides(async () => ({ kind: 'cast', runeName: SECRET }));
		await ask();
		const data = await json(await advance());
		// The defeat is engine truth in the turn state, not a Sköll flavor line.
		expect(data.skoll).toEqual({});
		expect(data.state).toMatchObject({ status: 'won', winner: 'Sköll' });
	});

	it('falls to the floor on Advance when Sköll Gemini fails — he still moves', async () => {
		skollDecides(async () => {
			throw new Error('timeout');
		});
		await ask();
		const data = await json(await advance());
		// Floor either casts ({}), or asks ({ asks }) — both are valid "he still moved".
		expect(data.skoll.asks !== undefined || Object.keys(data.skoll).length === 0).toBe(true);
	});

	it('lets Sköll Hex the human Ask — no answer comes back, her turn is spent', async () => {
		skollReacts(async () => ({ reaction: 'Hex' }));
		openGate(); // open the reaction gate deterministically
		const data = await json(await ask());
		expect(data.skollVsYou).toEqual({ reaction: 'Hex' });
		expect(data.oracle).toBeUndefined(); // silenced — no Oracle line
		expect(data.state.activePlayer).toBe('Sköll'); // her turn spent → his to take on Advance
	});

	it('lets Sköll Scry the human Ask — she still gets her answer, he overhears it', async () => {
		skollReacts(async () => ({ reaction: 'Scry' }));
		openGate(); // open the reaction gate deterministically
		const data = await json(await ask());
		expect(data.skollVsYou).toEqual({ reaction: 'Scry' });
		expect(data.oracle).toMatchObject({ ok: true });
	});

	it('does not rouse Sköll on a refused Ask — no window, no reaction, no turn', async () => {
		const { interpret } = await import('$lib/server/oracle/gemini');
		(interpret as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
			kind: 'refusal',
			refusal: 'mixed-type'
		}));
		const data = await json(await ask());
		expect(data.oracle).toMatchObject({ ok: false, reason: 'refusal' });
		expect(data.skollVsYou).toBeUndefined();
		expect(data.state.activePlayer).toBe('Human');
	});

	it('wins on the human cast — Sköll never gets a turn', async () => {
		const data = await json(await call({ type: 'Cast', player: 'Human', runeName: SECRET }));
		expect(data).toMatchObject({ type: 'Cast', cast: { won: true } });
		expect(data.state).toEqual({ activePlayer: 'Human', status: 'won', winner: 'Human', turns: 1 });
		expect(data.skoll).toBeUndefined();
	});

	it('hands the wolf his turn after a wrong human cast (taken on Advance)', async () => {
		const wrong = await json(await call({ type: 'Cast', player: 'Human', runeName: WRONG }));
		expect(wrong).toMatchObject({ type: 'Cast', cast: { ok: true, won: false } });
		expect(wrong.skoll).toBeUndefined(); // not folded in
		expect(wrong.state.activePlayer).toBe('Sköll');
		const data = await json(await advance());
		expect(data.skoll).toBeDefined();
	});

	it('routes a bare React (no Sköll Ask pending) as a harmless no-window pass', async () => {
		const data = await json(await call({ type: 'React', player: 'Human', reaction: 'Pass' }));
		expect(data).toEqual({
			type: 'React',
			outcome: { ok: true, choice: 'Pass' },
			state: { ...HUMAN_TURN }
		});
	});

	it('routes a CrossOff without a turn — Sköll does not move', async () => {
		const data = await json(
			await call({ type: 'CrossOff', player: 'Human', runeId: 1, crossed: true })
		);
		expect(data).toEqual({ type: 'CrossOff', ok: true, state: { ...HUMAN_TURN } });
	});

	it('rejects an unknown action type with 400', async () => {
		await expect(call({ type: 'Bogus', player: 'Human' })).rejects.toMatchObject({ status: 400 });
	});

	it('rejects a malformed JSON body with 400', async () => {
		await expect(call('not json')).rejects.toMatchObject({ status: 400 });
	});

	it.each([
		{ label: 'Ask without question', body: { type: 'Ask', player: 'Human' } },
		{ label: 'Ask with non-string question', body: { type: 'Ask', player: 'Human', question: 7 } },
		{ label: 'Cast without runeName', body: { type: 'Cast', player: 'Human' } },
		{
			label: 'Cast with non-string runeName',
			body: { type: 'Cast', player: 'Human', runeName: 7 }
		},
		{
			label: 'CrossOff without runeId',
			body: { type: 'CrossOff', player: 'Human', crossed: true }
		},
		{
			label: 'CrossOff with non-integer runeId',
			body: { type: 'CrossOff', player: 'Human', runeId: 1.5, crossed: true }
		},
		{ label: 'CrossOff without crossed', body: { type: 'CrossOff', player: 'Human', runeId: 1 } },
		{
			label: 'CrossOff with non-boolean crossed',
			body: { type: 'CrossOff', player: 'Human', runeId: 1, crossed: 'yes' }
		},
		{ label: 'React without reaction', body: { type: 'React', player: 'Human' } },
		{
			label: 'React with unknown reaction',
			body: { type: 'React', player: 'Human', reaction: 'Howl' }
		},
		{ label: 'bad player', body: { type: 'Ask', player: 'Moon', question: 'is it light?' } }
	])('rejects malformed $label payloads with 400', async ({ body }) => {
		await expect(call(body)).rejects.toMatchObject({
			status: 400,
			body: expect.objectContaining({ message: 'Malformed action payload.' })
		});
	});

	// Debug log — the chronological stream the /debug view reads. Three orthogonal facts per event:
	// owner (who), kind (input · llm · deterministic), part (turn phase). A verdict is the ENGINE's,
	// never the actor's; the inference that reached a move is its own owner.
	const events = () => getEvents(SID);
	const byOwner = (owner: string) => events().filter((e) => e.owner === owner);
	// Engine verdicts — the deterministic truth rows (the round's opening secret is part 'Round').
	const verdicts = () => byOwner('Engine').filter((e) => e.part !== 'Round');
	const lastVerdict = () => verdicts().at(-1)!;
	// Sköll's on-stage move/reaction events, apart from the raw model I/O (sensitive) he also owns.
	const skollMoves = () => byOwner('Sköll').filter((e) => !e.sensitive);
	const geminiIO = () => byOwner('Sköll').filter((e) => e.sensitive);

	describe('debug log (S8)', () => {
		it('opens the round without exposing the secret or its seed', () => {
			const secretEv = byOwner('Engine').find((e) => e.part === 'Round')!;
			expect(secretEv).toMatchObject({ kind: 'deterministic', part: 'Round' });
			expect(secretEv.message).not.toContain(SECRET);
			expect(secretEv.data).toBeUndefined();
		});

		it('splits a human Ask into her input, the Oracle’s reading, and the engine’s verdict', async () => {
			await ask();
			// Her raw free-text — hers (input), distinct from the Oracle's reading of it.
			const human = byOwner('Human').at(-1)!;
			expect(human).toMatchObject({ kind: 'input', part: 'Ask' });
			expect(human.message).toContain('is it light?');
			expect(human.data).toMatchObject({ question: 'is it light?' });
			// The Oracle's LLM reading — its own event, not bolted onto the engine's verdict.
			const reading = byOwner('Oracle').at(-1)!;
			expect(reading).toMatchObject({ kind: 'llm', part: 'Ask' });
			expect(reading.message).toContain('whether it is light'); // the Oracle's read, in the message
			expect(reading.data).toMatchObject({ query: { axis: 'fill', value: 'Light' } });
			// The verdict is the engine fact — deterministic, no inference attached.
			const v = lastVerdict();
			expect(v).toMatchObject({ kind: 'deterministic', part: 'Ask' });
			expect(v.data).toBeUndefined();
			expect(v.message).toMatch(/^(Yes|No)\. Sól is/);
		});

		it('logs a human Cast as her input plus the engine verdict', async () => {
			await call({ type: 'Cast', player: 'Human', runeName: WRONG });
			const input = byOwner('Human').at(-1)!;
			expect(input).toMatchObject({ kind: 'input', part: 'Cast' });
			expect(input.message).toContain(`casts ${WRONG}`);
			const v = lastVerdict();
			expect(v).toMatchObject({ kind: 'deterministic', part: 'Cast' });
			expect(v.message).toContain('wrong');
		});

		it('logs a Sköll Cast as his llm move plus the engine verdict', async () => {
			await ask(); // hand him the turn
			await advance(); // he casts (default mock: wrong, payload fallback for reasoning)
			const v = lastVerdict();
			expect(v).toMatchObject({ kind: 'deterministic', part: 'Cast' });
			expect(v.message).toContain('wrong'); // engine fact only
			const move = skollMoves().at(-1)!;
			expect(move).toMatchObject({ kind: 'llm', part: 'Cast' });
			expect(move.message).toContain('casts');
			expect(move.data).toMatchObject({ source: 'gemini' });
			expect(String(move.data?.reasoning)).toContain('hunch'); // the earned-only fallback
		});

		it('marks a floored Sköll move deterministic and warns', async () => {
			skollDecides(async () => {
				throw new Error('timeout');
			});
			await ask();
			await advance(); // Gemini throws → floor plays
			const move = skollMoves().at(-1)!;
			expect(move).toMatchObject({ kind: 'deterministic', level: 'warn' });
			expect(move.data).toMatchObject({ source: 'floor' });
		});

		it('parks a Sköll Ask: his move now, the engine verdict only after the human reacts', async () => {
			skollDecides(async () => ({ kind: 'ask', query: { axis: 'color', value: 'Gold' } }));
			await ask();
			await advance(); // his Ask is parked — his move event logged, no verdict on it yet
			expect(verdicts().some((e) => /gold rune/i.test(e.message))).toBe(false);
			const move = skollMoves().at(-1)!;
			expect(move).toMatchObject({ kind: 'llm', part: 'Ask' });
			expect(move.data).toMatchObject({ source: 'gemini' });
			expect(String(move.data?.reasoning)).toContain('hunch');

			await call({ type: 'React', player: 'Human', reaction: 'Pass' });
			const v = lastVerdict();
			expect(v).toMatchObject({ kind: 'deterministic', part: 'Ask' });
			expect(v.message).toMatch(/Sól is (not )?reaching for a gold rune\./); // engine verdict
			expect(v.data).toBeUndefined();
		});

		it('records the engine’s verdict, not a Hex, on a hexed Sköll Ask', async () => {
			skollDecides(async () => ({ kind: 'ask', query: { axis: 'color', value: 'Gold' } }));
			await ask();
			await advance();
			await call({ type: 'React', player: 'Human', reaction: 'Hex' });
			expect(lastVerdict().message).toContain('Hexed');
		});

		it('logs Sköll reacting to the human’s Ask (React part, gemini source → llm)', async () => {
			skollReacts(async () => ({ reaction: 'Pass' }));
			openGate(); // gate open → Gemini decided → source gemini (drives the LLM badge)
			await ask();
			const react = skollMoves().find((e) => e.part === 'React')!;
			expect(react).toMatchObject({ kind: 'llm', part: 'React' });
			expect(react.message).toContain('reacts to your Ask: Pass');
			expect(react.data).toMatchObject({ choice: 'Pass', source: 'gemini' });
		});

		it('shows only what Sköll crossed off THIS move, matching the pre-move reasoning', async () => {
			// His move bundles an Ask + cross-offs. The event must show the delta he crossed this turn,
			// not the post-move cumulative sheet (which read one move ahead of the reasoning beside it).
			skollDecides(async () => ({
				kind: 'ask',
				query: { axis: 'color', value: 'Gold' },
				crossOff: [4, 8]
			}));
			await ask(); // hand him the turn (Pass gate closed → he learns nothing first)
			await advance();
			const move = skollMoves().at(-1)!;
			expect(move.data?.crossedThisMove).toEqual([4, 8]);
			// Reasoning is the state he reasoned FROM — no facts yet → the opening-hunch line, 0 crossed.
			expect(String(move.data?.reasoning)).toContain('hunch');
		});

		it('drains raw Gemini I/O onto the log as a sensitive Sköll llm event (verbose)', async () => {
			// The real seam is mocked here, so seed THIS session's sink the way gemini.ts would (inside
			// the session context), then advance — the route drains it as a sensitive Sköll llm event.
			await ask(); // hand the wolf his turn
			runWithSession(SID, () =>
				captureGemini({ label: 'move', request: { contents: 'board…' }, response: { text: '{}' } })
			);
			await advance();
			const io = geminiIO().at(-1)!;
			expect(io).toMatchObject({ kind: 'llm', sensitive: true });
			expect(io.message).toContain('move');
			expect(io.data).toMatchObject({ response: { text: '{}' } });
		});
	});

	it('keeps two sessions independent through the endpoint', async () => {
		resetEngine('player-one', SEED);
		resetEngine('player-two', SEED);

		const win = await json(
			await callAs('player-one', { type: 'Cast', player: 'Human', runeName: SECRET })
		);
		expect(win).toMatchObject({ type: 'Cast', cast: { won: true } });

		const stillWinnable = await json(
			await callAs('player-two', { type: 'Cast', player: 'Human', runeName: SECRET })
		);
		expect(stillWinnable).toMatchObject({ type: 'Cast', cast: { won: true } });
	});
});
