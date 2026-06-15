import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stt = vi.hoisted(() => ({ transcribe: vi.fn() }));
vi.mock('$lib/server/voice/transcribe', () => ({ transcribe: stt.transcribe }));

const mock = vi.hoisted(() => ({
	env: { GEMINI_API_KEY: 'test-gemini-key' } as { GEMINI_API_KEY?: string }
}));
vi.mock('$env/dynamic/private', () => ({ env: mock.env }));

import { POST } from '$routes/api/voice/transcribe/+server';
import { resetTranscribeWindows, STT_SESSION_LIMIT } from '$lib/server/voice/rateLimit';

function call(sessionId: string, body: unknown) {
	return POST({
		locals: { sessionId },
		request: new Request('http://localhost/api/voice/transcribe', {
			method: 'POST',
			body: typeof body === 'string' ? body : JSON.stringify(body)
		})
	} as unknown as Parameters<typeof POST>[0]);
}

describe('POST /api/voice/transcribe', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetTranscribeWindows();
		mock.env.GEMINI_API_KEY = 'test-gemini-key';
	});

	afterEach(() => vi.restoreAllMocks());

	it('transcribes a WAV payload and returns the text', async () => {
		stt.transcribe.mockResolvedValueOnce('is it a fire rune');

		const response = await call('happy', { wavBase64: 'UklGRg==' });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ text: 'is it a fire rune' });
		expect(stt.transcribe).toHaveBeenCalledExactlyOnceWith('UklGRg==');
	});

	it('rejects a malformed JSON body with 400 before charging the budget', async () => {
		const response = await call('bad-json', 'not json{');
		expect(response.status).toBe(400);
		expect(stt.transcribe).not.toHaveBeenCalled();
	});

	it.each([
		{ label: 'missing wav', body: {} },
		{ label: 'empty wav', body: { wavBase64: '' } },
		{ label: 'non-string wav', body: { wavBase64: 42 } },
		{ label: 'oversized wav', body: { wavBase64: 'a'.repeat(5_000_001) } }
	])('rejects $label with 400', async ({ body }) => {
		const response = await call('bad', body);
		expect(response.status).toBe(400);
		expect(stt.transcribe).not.toHaveBeenCalled();
	});

	it('returns 503 when the key is not configured', async () => {
		mock.env.GEMINI_API_KEY = undefined;

		const response = await call('keyless', { wavBase64: 'UklGRg==' });

		expect(response.status).toBe(503);
		expect((await response.json()).error).toBe('Voice is unavailable.');
		expect(stt.transcribe).not.toHaveBeenCalled();
	});

	it('rejects over the per-session limit with 429 and retry-after', async () => {
		stt.transcribe.mockResolvedValue('ok');
		for (let i = 0; i < STT_SESSION_LIMIT; i++) {
			expect((await call('greedy', { wavBase64: 'UklGRg==' })).status).toBe(200);
		}

		const response = await call('greedy', { wavBase64: 'UklGRg==' });

		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('60');
		expect(stt.transcribe).toHaveBeenCalledTimes(STT_SESSION_LIMIT);
	});
});
