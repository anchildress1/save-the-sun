import { describe, it, expect } from 'vitest';
import { POST } from './+server';

function call(body: string | object) {
	const request = new Request('http://localhost/api/action', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
	return POST({ request } as unknown as Parameters<typeof POST>[0]);
}

describe('POST /api/action', () => {
	it('routes a valid Ask to the engine and returns its result', async () => {
		const res = await call({ type: 'Ask', player: 'Human', question: 'fire?' });
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.success).toBe(true);
		expect(data.message).toContain('Ask');
	});

	it('routes a valid Cast', async () => {
		const res = await call({ type: 'Cast', player: 'Human', runeName: 'Sowilo' });
		const data = await res.json();
		expect(data.message).toContain('Cast');
	});

	it('rejects an unknown action type with 400', async () => {
		await expect(call({ type: 'Bogus', player: 'Human' })).rejects.toMatchObject({ status: 400 });
	});

	it('rejects a malformed JSON body with 400', async () => {
		await expect(call('not json')).rejects.toMatchObject({ status: 400 });
	});
});
