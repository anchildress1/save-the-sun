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

const SEED = 1;

function call(body: string | object) {
	const request = new Request('http://localhost/api/action', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
	return POST({ request } as unknown as Parameters<typeof POST>[0]);
}

describe('POST /api/action', () => {
	beforeEach(() => {
		resetEngine(SEED);
	});

	it('routes a valid Ask through the Oracle', async () => {
		const res = await call({ type: 'Ask', player: 'Human', question: 'is it light?' });
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toMatchObject({ type: 'Ask', oracle: { ok: true } });
	});

	it('routes a Cast to the engine', async () => {
		const res = await call({ type: 'Cast', player: 'Human', runeName: selectSecret(SEED).name });
		const data = await res.json();
		expect(data).toMatchObject({ type: 'Cast', cast: { won: true } });
	});

	it('routes a CrossOff without asking the engine to referee it', async () => {
		const res = await call({ type: 'CrossOff', player: 'Human', runeId: 1, crossed: true });
		const data = await res.json();
		expect(data).toEqual({ type: 'CrossOff', ok: true });
	});

	it('routes a React placeholder through the shared interface', async () => {
		const res = await call({ type: 'React', player: 'Human', reaction: 'Pass' });
		const data = await res.json();
		expect(data).toEqual({ type: 'React', ok: true });
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
});
