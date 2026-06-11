import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
	env: { GEMINI_API_KEY: 'test-gemini-key' } as { GEMINI_API_KEY?: string }
}));
vi.mock('$env/dynamic/private', () => ({ env: mock.env }));

import { POST } from '$routes/api/voice/debug/+server';
import { getEvents, resetLog } from '$lib/server/debug/log';

const SID = 'voice-debug-route';

function call(body: BodyInit, sessionId = SID) {
	const request = new Request('http://localhost/api/voice/debug', { method: 'POST', body });
	return POST({ request, locals: { sessionId } } as unknown as Parameters<typeof POST>[0]);
}

const post = (event: unknown, sessionId = SID) => call(JSON.stringify(event), sessionId);

describe('POST /api/voice/debug', () => {
	beforeEach(() => {
		resetLog(SID);
	});

	it('tees a client voice event into the session log under the Voice part', async () => {
		const response = await post({ level: 'error', message: 'voice socket dropped: close 1011' });
		expect(response.status).toBe(204);
		expect(await response.text()).toBe('');
		expect(getEvents(SID)).toEqual([
			{
				seq: 1,
				owner: 'Oracle',
				kind: 'llm',
				part: 'Voice',
				level: 'error',
				message: 'voice socket dropped: close 1011'
			}
		]);
	});

	it('accepts both levels the client sends and keeps events in order', async () => {
		for (const level of ['info', 'error']) {
			expect((await post({ level, message: level })).status).toBe(204);
		}
		expect(getEvents(SID).map((e) => [e.seq, e.level])).toEqual([
			[1, 'info'],
			[2, 'error']
		]);
	});

	it('masks the long-lived key — the sink rule holds through this endpoint too', async () => {
		await post({ level: 'error', message: 'failed at https://api?key=test-gemini-key' });
		expect(getEvents(SID)[0].message).toBe('failed at https://api?key=[gemini-api-key]');
	});

	it('truncates an oversized message to 300 chars', async () => {
		await post({ level: 'info', message: 'x'.repeat(400) });
		expect(getEvents(SID)[0].message).toHaveLength(300);
	});

	it('isolates sessions', async () => {
		await post({ level: 'info', message: 'mine' }, 'voice-debug-other');
		expect(getEvents(SID)).toEqual([]);
		resetLog('voice-debug-other');
	});

	it.each([
		['a non-JSON body', () => call('not json')],
		['a null body', () => post(null)],
		['a missing message', () => post({ level: 'info' })],
		['an empty message', () => post({ level: 'info', message: '' })],
		['a non-string message', () => post({ level: 'info', message: 7 })],
		['a level the client never sends', () => post({ level: 'warn', message: 'hi' })],
		['an unknown level', () => post({ level: 'debug', message: 'hi' })],
		['a missing level', () => post({ message: 'hi' })]
	])('rejects %s with 400 and logs nothing', async (_label, request) => {
		const response = await request();
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('Invalid voice debug event.');
		expect(getEvents(SID)).toEqual([]);
	});
});
