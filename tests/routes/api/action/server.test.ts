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
import { resetEngine } from '$lib/server/engine/session';
import { selectSecret } from '$lib/server/engine/engine';
import { runes } from '$lib/board';

const SEED = 1;
const SID = 'route-session';
const SECRET = selectSecret(SEED).name;
const WRONG = runes.find((r) => r.name !== selectSecret(SEED).name)!.name;
const HUMAN_TURN = { activePlayer: 'Human', status: 'active', winner: null, turns: 0 };

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

describe('POST /api/action', () => {
	beforeEach(() => {
		resetEngine(SID, SEED);
		skollDecides(async () => ({ kind: 'cast', runeName: WRONG })); // default: Sköll misplays a cast
		skollReacts(async () => ({ reaction: 'Pass' })); // default: Sköll lets the human's Ask pass
	});

	it('answers the human Ask, then lets Sköll take his turn', async () => {
		const data = await (await ask()).json();
		expect(data).toMatchObject({
			type: 'Ask',
			oracle: { ok: true },
			skollVsYou: { reaction: 'Pass' }
		});
		// Sköll played (a wrong cast by default) and handed the turn back; the round continues.
		expect(data.skoll).toMatchObject({ cast: { line: `I name it. ${WRONG}.`, won: false } });
		expect(data.state).toMatchObject({ activePlayer: 'Human', status: 'active' });
	});

	it('lets Sköll Hex the human Ask — no answer comes back, her turn is spent', async () => {
		skollReacts(async () => ({ reaction: 'Hex' }));
		const data = await (await ask()).json();
		expect(data.skollVsYou).toEqual({ reaction: 'Hex' });
		expect(data.oracle).toBeUndefined(); // silenced — no Oracle line
		expect(data.skoll).toBeDefined(); // her turn spent → the wolf plays on
	});

	it('lets Sköll Scry the human Ask — she still gets her answer, he overhears it', async () => {
		skollReacts(async () => ({ reaction: 'Scry' }));
		const data = await (await ask()).json();
		expect(data.skollVsYou).toEqual({ reaction: 'Scry' });
		expect(data.oracle).toMatchObject({ ok: true });
	});

	it('does not rouse Sköll on a refused Ask — no window, no reaction, no turn', async () => {
		const { interpret } = await import('$lib/server/oracle/gemini');
		(interpret as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
			kind: 'refusal',
			refusal: 'mixed-type'
		}));
		const data = await (await ask()).json();
		expect(data.oracle).toMatchObject({ ok: false, reason: 'refusal' });
		expect(data.skollVsYou).toBeUndefined();
		expect(data.skoll).toBeUndefined();
	});

	it('parks Sköll on an Ask and prompts the human to react', async () => {
		skollDecides(async () => ({
			kind: 'ask',
			axis: 'fill',
			query: { axis: 'color', value: 'Gold' }
		}));
		const data = await (await ask()).json();
		expect(data.skoll.asks.echo).toContain('Sköll asks after');
		// His Ask is unanswered — the window is open and it is still his turn.
		expect(data.state.activePlayer).toBe('Sköll');
	});

	it('resolves Sköll Ask when the human lets it pass', async () => {
		skollDecides(async () => ({ kind: 'ask', query: { axis: 'color', value: 'Gold' } }));
		await ask(); // Sköll now has a parked Ask
		const data = await (await call({ type: 'React', player: 'Human', reaction: 'Pass' })).json();
		expect(data.skollReaction).toEqual({ hexed: false });
		expect(data.state.activePlayer).toBe('Human'); // his turn spent, play returns
	});

	it('shares the answer when the human Scries Sköll Ask', async () => {
		skollDecides(async () => ({ kind: 'ask', query: { axis: 'color', value: 'Gold' } }));
		await ask();
		const data = await (await call({ type: 'React', player: 'Human', reaction: 'Scry' })).json();
		expect(data.skollReaction.hexed).toBe(false);
		expect(data.skollReaction.scried.answer).toMatch(/Sól is (not )?reaching for a gold rune\./);
	});

	it('kills the question when the human Hexes Sköll Ask', async () => {
		skollDecides(async () => ({ kind: 'ask', query: { axis: 'color', value: 'Gold' } }));
		await ask();
		const data = await (await call({ type: 'React', player: 'Human', reaction: 'Hex' })).json();
		expect(data.skollReaction).toEqual({ hexed: true });
		expect(data.state.activePlayer).toBe('Human');
	});

	it('ends the round in defeat when Sköll casts true', async () => {
		skollDecides(async () => ({ kind: 'cast', runeName: SECRET }));
		const data = await (await ask()).json();
		expect(data.skoll.cast).toEqual({ line: `The hunt ends. ${SECRET}.`, won: true });
		expect(data.state).toMatchObject({ status: 'won', winner: 'Sköll' });
	});

	it('falls to the floor when Sköll Gemini fails — he still moves', async () => {
		skollDecides(async () => {
			throw new Error('timeout');
		});
		const data = await (await ask()).json();
		// The floor played a legal move (an Ask or a Cast); the round never stalled.
		expect(data.skoll).toBeDefined();
		expect(data.skoll.asks ?? data.skoll.cast).toBeDefined();
	});

	it('wins on the human cast — Sköll never gets a turn', async () => {
		const data = await (await call({ type: 'Cast', player: 'Human', runeName: SECRET })).json();
		expect(data).toMatchObject({ type: 'Cast', cast: { won: true } });
		expect(data.state).toEqual({ activePlayer: 'Human', status: 'won', winner: 'Human', turns: 1 });
		expect(data.skoll).toBeUndefined();
	});

	it('lets Sköll answer a wrong human cast', async () => {
		const data = await (await call({ type: 'Cast', player: 'Human', runeName: WRONG })).json();
		expect(data).toMatchObject({ type: 'Cast', cast: { ok: true, won: false } });
		expect(data.skoll).toBeDefined(); // the wolf takes his turn after the miss
	});

	it('routes a bare React (no Sköll Ask pending) as a harmless no-window pass', async () => {
		const data = await (await call({ type: 'React', player: 'Human', reaction: 'Pass' })).json();
		expect(data).toEqual({
			type: 'React',
			outcome: { ok: true, choice: 'Pass' },
			state: { ...HUMAN_TURN }
		});
	});

	it('routes a CrossOff without a turn — Sköll does not move', async () => {
		const data = await (
			await call({ type: 'CrossOff', player: 'Human', runeId: 1, crossed: true })
		).json();
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

	it('keeps two sessions independent through the endpoint', async () => {
		resetEngine('player-one', SEED);
		resetEngine('player-two', SEED);

		const win = await (
			await callAs('player-one', { type: 'Cast', player: 'Human', runeName: SECRET })
		).json();
		expect(win).toMatchObject({ type: 'Cast', cast: { won: true } });

		const stillWinnable = await (
			await callAs('player-two', { type: 'Cast', player: 'Human', runeName: SECRET })
		).json();
		expect(stillWinnable).toMatchObject({ type: 'Cast', cast: { won: true } });
	});
});
