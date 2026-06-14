import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tts = vi.hoisted(() => ({ synthesizeStream: vi.fn(), isCached: vi.fn(() => false) }));
vi.mock('$lib/server/voice/tts', () => ({
	synthesizeStream: tts.synthesizeStream,
	isCached: tts.isCached
}));

const mock = vi.hoisted(() => ({
	env: { GEMINI_API_KEY: 'test-gemini-key' } as { GEMINI_API_KEY?: string }
}));
vi.mock('$env/dynamic/private', () => ({ env: mock.env }));

import { POST } from '$routes/api/voice/tts/+server';
import { resetTtsWindows, TTS_SESSION_LIMIT } from '$lib/server/voice/rateLimit';
import { refusalLine } from '$lib/server/oracle/oracle';
import { skollAskEcho } from '$lib/server/skoll/skoll';
import { synthPrompt } from '$lib/server/voice/lines';
import { ORACLE_VOICE, SKOLL_VOICE } from '$lib/voice/config';

function streamOf(...chunks: string[]) {
	return (async function* () {
		yield* chunks;
	})();
}

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
		tts.isCached.mockReturnValue(false);
		mock.env.GEMINI_API_KEY = 'test-gemini-key';
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => vi.restoreAllMocks());

	it('streams an allow-listed line as NDJSON base64 chunks', async () => {
		tts.synthesizeStream.mockReturnValueOnce(streamOf('pcm-a', 'pcm-b'));

		const response = await call('happy', { kind: 'refusal', refusal: 'empty' });

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/x-ndjson');
		expect(await response.text()).toBe('pcm-a\npcm-b\n');
		// Her line is synthesized wrapped in the Oracle's director's-notes, in her voice.
		expect(tts.synthesizeStream).toHaveBeenCalledExactlyOnceWith(
			synthPrompt({ kind: 'refusal', refusal: 'empty' }, refusalLine('empty')),
			ORACLE_VOICE
		);
	});

	it('voices Sköll’s Ask in his voice, wrapped in his director’s-notes growl', async () => {
		tts.synthesizeStream.mockReturnValueOnce(streamOf('grr'));
		const query = { axis: 'element', value: 'Fire' };
		const line = skollAskEcho(query as Parameters<typeof skollAskEcho>[0]);

		const response = await call('wolf', { kind: 'skoll-ask', query });

		expect(response.status).toBe(200);
		// The synthesized text is the directed prompt (not the bare line) — that's what makes him growl.
		const prompt = synthPrompt({ kind: 'skoll-ask', query }, line);
		expect(prompt).not.toBe(line);
		expect(prompt).toContain(`"${line}"`);
		expect(tts.synthesizeStream).toHaveBeenCalledExactlyOnceWith(prompt, SKOLL_VOICE);
	});

	it('rejects a malformed JSON body with 400 before charging the budget', async () => {
		const response = await call('bad-json', 'not json{');
		expect(response.status).toBe(400);
		expect(tts.synthesizeStream).not.toHaveBeenCalled();
	});

	it('rejects an unshaped descriptor with 400', async () => {
		const response = await call('bad-shape', { kind: 'whatever' });
		expect(response.status).toBe(400);
		expect(tts.synthesizeStream).not.toHaveBeenCalled();
	});

	it('rejects a well-shaped but non-allow-listed line with 400', async () => {
		const response = await call('not-listed', { kind: 'refusal', refusal: 'made-up' });
		expect(response.status).toBe(400);
		expect(tts.synthesizeStream).not.toHaveBeenCalled();
	});

	it('serves a cached line without spending a synth slot or needing the key', async () => {
		tts.isCached.mockReturnValue(true);
		mock.env.GEMINI_API_KEY = undefined;
		tts.synthesizeStream.mockReturnValue(streamOf('cached-pcm'));

		// Drain far past the per-session synth limit — cached replays never charge it.
		for (let i = 0; i < TTS_SESSION_LIMIT + 5; i++) {
			expect((await call('cache-fan', { kind: 'refusal', refusal: 'empty' })).status).toBe(200);
		}
	});

	it('returns 503 for an uncached line when the key is not configured', async () => {
		mock.env.GEMINI_API_KEY = undefined;

		const response = await call('keyless', { kind: 'refusal', refusal: 'empty' });

		expect(response.status).toBe(503);
		expect((await response.json()).error).toBe('Voice is unavailable.');
		expect(tts.synthesizeStream).not.toHaveBeenCalled();
	});

	it('rejects an uncached request over the per-session limit with 429 and retry-after', async () => {
		tts.synthesizeStream.mockReturnValue(streamOf('pcm'));
		for (let i = 0; i < TTS_SESSION_LIMIT; i++) {
			expect((await call('greedy', { kind: 'refusal', refusal: 'empty' })).status).toBe(200);
		}

		const response = await call('greedy', { kind: 'refusal', refusal: 'empty' });

		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('60');
		expect(tts.synthesizeStream).toHaveBeenCalledTimes(TTS_SESSION_LIMIT);
	});
});
