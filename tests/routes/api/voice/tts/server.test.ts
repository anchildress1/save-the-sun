import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tts = vi.hoisted(() => ({ synthesize: vi.fn() }));
vi.mock('$lib/server/voice/tts', () => ({ synthesize: tts.synthesize }));

import { POST } from '$routes/api/voice/tts/+server';
import { resetTtsWindows, TTS_SESSION_LIMIT } from '$lib/server/voice/rateLimit';
import { ORACLE_GREETING } from '$lib/server/voice/lines';

function call(sessionId: string, body: unknown) {
	return POST({
		locals: { sessionId },
		request: new Request('http://localhost/api/voice/tts', {
			method: 'POST',
			body: typeof body === 'string' ? body : JSON.stringify(body)
		})
	} as unknown as Parameters<typeof POST>[0]);
}

describe('POST /api/voice/tts', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetTtsWindows();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => vi.restoreAllMocks());

	it('voices an allow-listed line as base64 audio', async () => {
		tts.synthesize.mockResolvedValueOnce({ ok: true, audio: 'pcm-bytes' });

		const response = await call('happy', { kind: 'greeting' });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ audio: 'pcm-bytes' });
		expect(tts.synthesize).toHaveBeenCalledExactlyOnceWith(ORACLE_GREETING);
	});

	it('rejects a malformed JSON body with 400', async () => {
		const response = await call('bad-json', 'not json{');
		expect(response.status).toBe(400);
		expect(tts.synthesize).not.toHaveBeenCalled();
	});

	it('rejects an unshaped descriptor with 400', async () => {
		const response = await call('bad-shape', { kind: 'whatever' });
		expect(response.status).toBe(400);
		expect(tts.synthesize).not.toHaveBeenCalled();
	});

	it('rejects a well-shaped but non-allow-listed line with 400', async () => {
		const response = await call('not-listed', { kind: 'refusal', refusal: 'made-up' });
		expect(response.status).toBe(400);
		expect(tts.synthesize).not.toHaveBeenCalled();
	});

	it('returns 503 when synthesis fails', async () => {
		tts.synthesize.mockResolvedValueOnce({ ok: false });

		const response = await call('synth-down', { kind: 'greeting' });

		expect(response.status).toBe(503);
		expect((await response.json()).error).toBe('Voice is unavailable.');
	});

	it('rejects requests over the per-session limit with 429 and retry-after', async () => {
		tts.synthesize.mockResolvedValue({ ok: true, audio: 'pcm' });
		for (let i = 0; i < TTS_SESSION_LIMIT; i++) {
			expect((await call('greedy', { kind: 'greeting' })).status).toBe(200);
		}

		const response = await call('greedy', { kind: 'greeting' });

		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('60');
		// The denied request never reaches synthesis.
		expect(tts.synthesize).toHaveBeenCalledTimes(TTS_SESSION_LIMIT);
	});
});
