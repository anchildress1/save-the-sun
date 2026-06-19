import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock both Gemini seams so the route test is deterministic and never touches the network or
// $env. The route is the only place the real adapters are imported.
vi.mock('$lib/server/oracle/gemini', () => ({
	interpret: vi.fn(async () => ({
		kind: 'query',
		query: { axis: 'fill', value: 'Light' },
		paraphrase: 'whether it is light'
	})),
	// Default: no flair (the deterministic line / fixed beat stands). Tests override to prove the
	// authored paths.
	composeOracleFlair: vi.fn(async () => null),
	composeEndingFlair: vi.fn(async () => null)
}));

// debug/log.ts reads this to mask the key out of any logged text; provide it so the route's logging
// path resolves the virtual env module under test. (No signing here — authored lines are store-by-id.)
vi.mock('$env/dynamic/private', () => ({ env: { GEMINI_API_KEY: 'route-test-key' } }));

vi.mock('$lib/server/skoll/gemini', () => ({
	decideSkollMove: vi.fn(async () => ({ kind: 'cast', runeName: WRONG })),
	decideSkollReaction: vi.fn(async () => ({ reaction: 'Pass' }))
}));

import { POST } from '$routes/api/action/+server';
import { decideSkollMove, decideSkollReaction } from '$lib/server/skoll/gemini';
import {
	resetEngine,
	getEngine,
	getSkoll,
	getVoiceLine,
	getLastLine
} from '$lib/server/engine/session';
import { getEvents, captureGemini, runWithSession } from '$lib/server/debug/log';
import { resetOracleWindows, ASK_SESSION_LIMIT } from '$lib/server/voice/rateLimit';
import { selectSecret } from '$lib/server/engine/engine';
import { ORACLE_VOICE, SKOLL_VOICE } from '$lib/voice/config';
import { OUTCOME_LINES, VOICED_SEQUENCE } from '$lib/voice/outcomeLines';
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
		resetOracleWindows(); // the Ask limiter is module state — clear it so cases don't share a window
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

	it('rate-limits the Ask turn once the session window is spent, with a retry-after', async () => {
		for (let i = 0; i < ASK_SESSION_LIMIT; i++) {
			resetEngine(SID, SEED); // each Ask consumes the live human turn — re-arm it
			expect((await ask()).status).toBe(200);
		}
		resetEngine(SID, SEED);
		const denied = await ask();
		expect(denied.status).toBe(429);
		expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);
	});

	it('voices a Gemini-authored line, stored by id, on a clean answer (ttd:17)', async () => {
		const { composeOracleFlair } = await import('$lib/server/oracle/gemini');
		// The verdict for this query/seed is "No"; a faithful flair opens with that same word.
		(composeOracleFlair as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			'No — the white sign stays cold; Sól does not reach into light.'
		);

		const data = await json(await ask());

		expect(data.oracle.voiced).toMatchObject({
			kind: 'authored',
			text: 'No — the white sign stays cold; Sól does not reach into light.',
			voice: ORACLE_VOICE
		});
		// The words live in the session store, keyed by the id on the wire — the route voices them by
		// lookup, never from the wire. The stored line matches the display text; the deterministic answer
		// rides along as the cacheable fallback the TTS route voices if the authored synth 429s.
		expect(getVoiceLine(SID, data.oracle.voiced.id)).toEqual({
			text: 'No — the white sign stays cold; Sól does not reach into light.',
			voice: ORACLE_VOICE,
			fallback: data.oracle.answer
		});
	});

	it('drops a flair that flips the verdict — falls back to the deterministic answer (P1)', async () => {
		// restore in finally so the silenced console.warn can't leak into later tests in this file
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const { composeOracleFlair } = await import('$lib/server/oracle/gemini');
			// The real verdict here is "No"; a flair that opens "Yes" changed the meaning, so it's discarded
			// and the client voices the deterministic answer instead — the Oracle never lies, even in flair.
			(composeOracleFlair as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
				'Yes — she reaches into light.'
			);

			const data = await json(await ask());

			expect(data.oracle.ok).toBe(true);
			expect(data.oracle.voiced).toBeUndefined();
			expect(warn).toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	it('omits the authored line when flair fails — the deterministic answer stands (ttd:17)', async () => {
		// composeOracleFlair defaults to null (no flair); the response carries no authored line to voice.
		const data = await json(await ask());
		expect(data.oracle.ok).toBe(true);
		expect(data.oracle.voiced).toBeUndefined();
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

	it('ends the round in defeat when Sköll casts true on Advance, carrying his cast to voice', async () => {
		skollDecides(async () => ({ kind: 'cast', runeName: SECRET }));
		await ask();
		const data = await json(await advance());
		// The defeat is engine truth in the turn state; his winning cast also rides the wire so the
		// client can voice it (a game move, R10) — the rune for the server to recompose, the echo as text.
		expect(data.skoll).toEqual({ casts: { echo: `I name it. ${SECRET}.`, rune: SECRET } });
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

	it('carries the Oracle blessing (her voice, stored by id) when the human cast wins (ttd:22)', async () => {
		const { composeEndingFlair } = await import('$lib/server/oracle/gemini');
		(composeEndingFlair as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			'The dawn is kept; Sól climbs free.'
		);

		const data = await json(await call({ type: 'Cast', player: 'Human', runeName: SECRET }));

		expect(data.outcomeFlair).toMatchObject({
			kind: 'authored',
			text: 'The dawn is kept; Sól climbs free.',
			voice: ORACLE_VOICE
		});
		expect(getVoiceLine(SID, data.outcomeFlair.id)).toEqual({
			text: 'The dawn is kept; Sól climbs free.',
			voice: ORACLE_VOICE,
			fallback: OUTCOME_LINES.win[VOICED_SEQUENCE.win[0]] // the deterministic splash beat
		});
	});

	it('carries Sköll’s gloat (his voice, stored by id) when his Advance cast wins (ttd:22)', async () => {
		const { composeEndingFlair } = await import('$lib/server/oracle/gemini');
		(composeEndingFlair as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			'The sun is mine. Your night has no morning.'
		);
		skollDecides(async () => ({ kind: 'cast', runeName: SECRET }));

		await ask();
		const data = await json(await advance());

		expect(data.state).toMatchObject({ status: 'won', winner: 'Sköll' });
		expect(data.outcomeFlair).toMatchObject({
			kind: 'authored',
			text: 'The sun is mine. Your night has no morning.',
			voice: SKOLL_VOICE
		});
		expect(getVoiceLine(SID, data.outcomeFlair.id)).toEqual({
			text: 'The sun is mine. Your night has no morning.',
			voice: SKOLL_VOICE,
			fallback: OUTCOME_LINES.lose[VOICED_SEQUENCE.lose[0]] // the deterministic splash beat
		});
	});

	it('does not mint fresh ending flair for no-op actions after the round is already won', async () => {
		const { composeEndingFlair } = await import('$lib/server/oracle/gemini');
		(composeEndingFlair as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			'The dawn is kept; Sól climbs free.'
		);

		const win = await json(await call({ type: 'Cast', player: 'Human', runeName: SECRET }));
		const advanceNoop = await json(await advance());
		const staleCast = await json(await call({ type: 'Cast', player: 'Human', runeName: SECRET }));

		expect(win.outcomeFlair?.text).toBe('The dawn is kept; Sól climbs free.');
		expect(advanceNoop.outcomeFlair).toBeUndefined();
		expect(staleCast.cast).toMatchObject({ ok: false, reason: 'round-over' });
		expect(staleCast.outcomeFlair).toBeUndefined();
		expect(composeEndingFlair).toHaveBeenCalledTimes(1);
	});

	it('omits outcomeFlair when ending authoring fails — client falls back to the fixed beat (ttd:22)', async () => {
		// composeEndingFlair defaults to null; a winning cast carries no authored line.
		const data = await json(await call({ type: 'Cast', player: 'Human', runeName: SECRET }));
		expect(data.cast.won).toBe(true);
		expect(data.outcomeFlair).toBeUndefined();
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
	// Sköll's on-stage move/reaction events, apart from the raw model I/O he also owns.
	const isRawIO = (e: { message: string }) => e.message.startsWith('raw Gemini');
	const skollMoves = () => byOwner('Sköll').filter((e) => !isRawIO(e));
	const geminiIO = () => byOwner('Sköll').filter(isRawIO);

	describe('debug log (S8)', () => {
		it('opens the round naming the secret and its seed — the on-stage record is a spoiler by design', () => {
			const secretEv = byOwner('Engine').find((e) => e.part === 'Round')!;
			expect(secretEv).toMatchObject({ kind: 'deterministic', part: 'Round' });
			expect(secretEv.message).toContain(SECRET);
			expect(secretEv.data).toMatchObject({ secret: SECRET, seed: SEED });
		});

		it('splits a human Ask into her input, the Oracle’s reading and answer, and the engine’s verdict', async () => {
			await ask();
			// Her raw free-text — hers (input), distinct from the Oracle's reading of it.
			const human = byOwner('Human').at(-1)!;
			expect(human).toMatchObject({ kind: 'input', part: 'Ask' });
			expect(human.message).toContain('is it light?');
			expect(human.data).toMatchObject({ question: 'is it light?' });
			// The Oracle's LLM reading — its own event, not bolted onto the engine's verdict.
			const reading = byOwner('Oracle').find((e) => e.part === 'Ask')!;
			expect(reading).toMatchObject({ kind: 'llm', part: 'Ask' });
			expect(reading.message).toContain('whether it is light'); // the Oracle's read, in the message
			expect(reading.data).toMatchObject({ query: { axis: 'fill', value: 'Light' } });
			// Her spoken answer — the Oracle's own event, separate from the engine's verdict below.
			const answer = byOwner('Oracle').find((e) => e.part === 'Answer')!;
			expect(answer).toMatchObject({ kind: 'deterministic', part: 'Answer' });
			expect(answer.message).toMatch(/^answers: (Yes|No)\. Sól is/);
			expect(answer.data).toHaveProperty('affirmative');
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

		it('drains raw Gemini I/O onto the log as a Sköll llm event', async () => {
			// The real seam is mocked here, so seed THIS session's sink the way gemini.ts would (inside
			// the session context), then advance — the route drains it as a Sköll llm event.
			await ask(); // hand the wolf his turn
			runWithSession(SID, () =>
				captureGemini({ label: 'move', request: { contents: 'board…' }, response: { text: '{}' } })
			);
			await advance();
			const io = geminiIO().at(-1)!;
			expect(io).toMatchObject({ kind: 'llm', owner: 'Sköll' });
			expect(io.message).toContain('move');
			expect(io.data).toMatchObject({ response: { text: '{}' } });
		});

		it('drains a raw oracle call as the Oracle’s own llm event on the Ask', async () => {
			// The interpret seam is mocked, so tee the oracle call the way oracle/gemini.ts would; the
			// next Ask drains it attributed to the Oracle (owner), not Sköll.
			runWithSession(SID, () =>
				captureGemini({ label: 'oracle', request: { contents: 'is it light?' }, response: {} })
			);
			await ask();
			const io = byOwner('Oracle').find(isRawIO)!;
			expect(io).toMatchObject({ kind: 'llm', part: 'Ask' });
			expect(io.message).toContain('oracle');
		});

		it('attributes ending flair raw I/O to the ending speaker on the Cast beat', async () => {
			skollDecides(async () => ({ kind: 'cast', runeName: SECRET }));
			await ask();
			runWithSession(SID, () =>
				captureGemini({
					label: 'skoll-ending-flair',
					request: { contents: 'closing gloat' },
					response: { text: 'The sun is mine.' }
				})
			);

			await advance();

			const io = byOwner('Sköll').find((e) => e.message.includes('skoll-ending-flair'))!;
			expect(io).toMatchObject({ kind: 'llm', owner: 'Sköll', part: 'Cast' });
			expect(byOwner('Oracle').some((e) => e.message.includes('skoll-ending-flair'))).toBe(false);
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

	// ttd:29 — every committed voiced move records its line + descriptor so a dropped response recovers
	// the real result instead of the client's false silent/falters line. The route is where it's written.
	describe('lastLine recovery wiring (ttd:29)', () => {
		it('records the answer line + descriptor on a committed human Ask', async () => {
			await ask(); // a clean answer (Sköll passes by default)
			const last = getLastLine(SID);
			expect(last).not.toBeNull();
			// The query/seed verdict here is "No"; the recovered line is her deterministic answer.
			expect(last!.text).toMatch(/^(Yes|No)\. Sól is/);
			expect(last!.voice).toMatchObject({ kind: 'answer' });
		});

		it('records the cast outcome line + descriptor on a committed human Cast', async () => {
			await call({ type: 'Cast', player: 'Human', runeName: WRONG }); // a resolved wrong cast
			const last = getLastLine(SID);
			expect(last).not.toBeNull();
			// A wrong cast voices the "wrong" line naming the rune the human cast.
			expect(last!.voice).toMatchObject({ kind: 'cast', result: 'wrong', rune: WRONG });
			expect(last!.text).toContain(WRONG);
		});

		it('does not clobber the prior recorded line on a CrossOff (nothing voiced)', async () => {
			await ask(); // records her answer line
			const before = getLastLine(SID);
			expect(before).not.toBeNull();
			// A CrossOff voices nothing — rememberLine must be a no-op, leaving the prior line intact.
			await call({ type: 'CrossOff', player: 'Human', runeId: 1, crossed: true });
			expect(getLastLine(SID)).toEqual(before);
		});
	});
});
