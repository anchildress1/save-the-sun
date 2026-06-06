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

	it('rejects an unknown action type with 400', async () => {
		await expect(call({ type: 'Bogus', player: 'Human' })).rejects.toMatchObject({ status: 400 });
	});

	it('rejects a malformed JSON body with 400', async () => {
		await expect(call('not json')).rejects.toMatchObject({ status: 400 });
	});
});
