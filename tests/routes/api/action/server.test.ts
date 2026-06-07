import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the Gemini seam so the route test is deterministic and never touches the
// network or $env. The route is the only place the real adapter is imported.
vi.mock('$lib/server/oracle/gemini', () => ({
	interpret: vi.fn(async () => ({
		kind: 'query',
		query: { axis: 'fill', value: 'Light' },
		paraphrase: 'whether it is light'
	}))
}));

import { POST } from '$routes/api/action/+server';
import { resetEngine } from '$lib/server/engine/session';
import { selectSecret } from '$lib/server/engine/engine';
import { runes } from '$lib/board';

const SEED = 1;
const SID = 'route-session';
// turns: 0 — the actions this const checks (CrossOff/React) never consume a turn.
const HUMAN_TURN = { activePlayer: 'Human', status: 'active', winner: null, turns: 0 };

function call(body: string | object) {
	return callAs(SID, body);
}

function callAs(sessionId: string, body: string | object) {
	const request = new Request('http://localhost/api/action', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
	return POST({ request, locals: { sessionId } } as unknown as Parameters<typeof POST>[0]);
}

describe('POST /api/action', () => {
	beforeEach(() => {
		resetEngine(SID, SEED);
	});

	it('routes a valid Ask through the Oracle', async () => {
		const res = await call({ type: 'Ask', player: 'Human', question: 'is it light?' });
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toMatchObject({ type: 'Ask', oracle: { ok: true } });
	});

	it('lets the human Ask again — the absent Sköll turn is skipped', async () => {
		const first = await (
			await call({ type: 'Ask', player: 'Human', question: 'is it light?' })
		).json();
		expect(first).toMatchObject({ type: 'Ask', oracle: { ok: true } });
		// Without the pre-Sköll skip this second Ask would be rejected as not-your-turn.
		const second = await (
			await call({ type: 'Ask', player: 'Human', question: 'is it dark?' })
		).json();
		expect(second).toMatchObject({ type: 'Ask', oracle: { ok: true } });
	});

	it('routes a Cast to the engine', async () => {
		const res = await call({ type: 'Cast', player: 'Human', runeName: selectSecret(SEED).name });
		const data = await res.json();
		expect(data).toMatchObject({ type: 'Cast', cast: { won: true } });
	});

	it('attaches the post-shim turn state to every response', async () => {
		const data = await (
			await call({ type: 'Ask', player: 'Human', question: 'is it light?' })
		).json();
		// The engine handed the turn to Sköll; the pre-Sköll shim hands it straight back, so
		// the client sees its own turn again — round still active. The resolved Ask spent one turn.
		expect(data.state).toEqual({ activePlayer: 'Human', status: 'active', winner: null, turns: 1 });
	});

	it('reports the resolved round in the state after a winning cast', async () => {
		const data = await (
			await call({ type: 'Cast', player: 'Human', runeName: selectSecret(SEED).name })
		).json();
		expect(data.state).toEqual({ activePlayer: 'Human', status: 'won', winner: 'Human', turns: 1 });
	});

	it('keeps the human on the clock after a wrong cast — round continues', async () => {
		const wrong = runes.find((r) => r.name !== selectSecret(SEED).name)!.name;
		const data = await (await call({ type: 'Cast', player: 'Human', runeName: wrong })).json();
		expect(data).toMatchObject({ type: 'Cast', cast: { ok: true, won: false } });
		expect(data.state).toEqual({ activePlayer: 'Human', status: 'active', winner: null, turns: 1 });
	});

	it('routes a CrossOff without asking the engine to referee it', async () => {
		const res = await call({ type: 'CrossOff', player: 'Human', runeId: 1, crossed: true });
		const data = await res.json();
		// Cross-off never consumes a turn, so the snapshot still shows the human on the clock.
		expect(data).toEqual({ type: 'CrossOff', ok: true, state: { ...HUMAN_TURN } });
	});

	it('routes a React through the shared interface, carrying its outcome and the turn state', async () => {
		const res = await call({ type: 'React', player: 'Human', reaction: 'Pass' });
		const data = await res.json();
		// Pass spends no charge and takes no turn, so the human stays on the clock.
		expect(data).toEqual({
			type: 'React',
			outcome: { ok: true, choice: 'Pass' },
			state: { ...HUMAN_TURN }
		});
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
		const secret = selectSecret(SEED).name;

		// player-one wins their round.
		const win = await (
			await callAs('player-one', { type: 'Cast', player: 'Human', runeName: secret })
		).json();
		expect(win).toMatchObject({ type: 'Cast', cast: { won: true } });

		// player-two's round is untouched — the same winning cast still works.
		const stillWinnable = await (
			await callAs('player-two', { type: 'Cast', player: 'Human', runeName: secret })
		).json();
		expect(stillWinnable).toMatchObject({ type: 'Cast', cast: { won: true } });
	});
});
