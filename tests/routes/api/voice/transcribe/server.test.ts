import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stt = vi.hoisted(() => ({
	transcribe: vi.fn(),
	classifyReaction: vi.fn(),
	classifyCast: vi.fn(),
	interpretAsk: vi.fn()
}));
vi.mock('$lib/server/voice/transcribe', () => ({
	transcribe: stt.transcribe,
	classifyReaction: stt.classifyReaction,
	classifyCast: stt.classifyCast,
	interpretAsk: stt.interpretAsk
}));

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

	it('returns a clean 503 when a Gemini call throws — not an unstructured 500', async () => {
		stt.transcribe.mockRejectedValueOnce(new Error('provider exploded'));
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const response = await call('boom', { wavBase64: 'UklGRg==' });

		expect(response.status).toBe(503);
		expect((await response.json()).error).toContain('unavailable');
		errorSpy.mockRestore();
	});

	it('classifies a reaction in reaction mode', async () => {
		stt.classifyReaction.mockResolvedValueOnce('hex');

		const response = await call('react', { wavBase64: 'UklGRg==', mode: 'reaction' });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ choice: 'hex' });
		expect(stt.classifyReaction).toHaveBeenCalledExactlyOnceWith('UklGRg==');
		expect(stt.transcribe).not.toHaveBeenCalled();
	});

	it('matches a cast in cast mode against the board runes', async () => {
		stt.classifyCast.mockResolvedValueOnce('Sowilo');

		const response = await call('cast', {
			wavBase64: 'UklGRg==',
			mode: 'cast',
			runes: ['Sowilo', 'Fehu']
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ rune: 'Sowilo' });
		// Matched against the SERVER's canonical board names, not the client-sent list.
		expect(stt.classifyCast).toHaveBeenCalledWith('UklGRg==', expect.arrayContaining(['Sowilo']));
		expect(stt.transcribe).not.toHaveBeenCalled();
	});

	it('rejects cast mode without a runes array with 400', async () => {
		const response = await call('cast-no-runes', { wavBase64: 'UklGRg==', mode: 'cast' });
		expect(response.status).toBe(400);
		expect(stt.classifyCast).not.toHaveBeenCalled();
	});

	it('detects a hands-free cast in ask mode when the board runes are sent', async () => {
		stt.interpretAsk.mockResolvedValueOnce({ cast: 'Sowilo' });

		const response = await call('hands-free', {
			wavBase64: 'UklGRg==',
			runes: ['Sowilo', 'Fehu']
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ rune: 'Sowilo' });
		// Matched against the SERVER's canonical board names, not the client-sent list.
		expect(stt.interpretAsk).toHaveBeenCalledWith('UklGRg==', expect.arrayContaining(['Sowilo']));
		expect(stt.transcribe).not.toHaveBeenCalled();
	});

	it('returns transcribed text in ask mode when interpretAsk reads a question', async () => {
		stt.interpretAsk.mockResolvedValueOnce({ text: 'is it a fire rune' });

		const response = await call('ask-runes', { wavBase64: 'UklGRg==', runes: ['Sowilo'] });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ text: 'is it a fire rune' });
		expect(stt.transcribe).not.toHaveBeenCalled();
	});

	// The debug tee renders an empty classifier result as '(unclear)' / '(nothing)' — exercise the
	// fallback side of each so a mishear is still diagnosable in the stream.
	it('tees an unclear cast (empty match) in cast mode', async () => {
		stt.classifyCast.mockResolvedValueOnce('');
		const response = await call('cast-unclear', {
			wavBase64: 'UklGRg==',
			mode: 'cast',
			runes: ['Sowilo']
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ rune: '' });
	});

	it('tees an unclear hands-free cast (empty match) in ask mode', async () => {
		stt.interpretAsk.mockResolvedValueOnce({ cast: '' });
		const response = await call('ask-cast-unclear', { wavBase64: 'UklGRg==', runes: ['Sowilo'] });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ rune: '' });
	});

	it('tees nothing-heard when interpretAsk reads an empty question', async () => {
		stt.interpretAsk.mockResolvedValueOnce({ text: '' });
		const response = await call('ask-empty', { wavBase64: 'UklGRg==', runes: ['Sowilo'] });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ text: '' });
	});

	it('tees nothing-heard when a plain transcribe returns empty', async () => {
		stt.transcribe.mockResolvedValueOnce('');
		const response = await call('plain-empty', { wavBase64: 'UklGRg==' });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ text: '' });
	});

	it('rejects an unknown mode with 400', async () => {
		const response = await call('bad-mode', { wavBase64: 'UklGRg==', mode: 'shout' });
		expect(response.status).toBe(400);
		expect(stt.transcribe).not.toHaveBeenCalled();
		expect(stt.classifyReaction).not.toHaveBeenCalled();
	});

	it('rejects a malformed JSON body with 400 before charging the budget', async () => {
		const response = await call('bad-json', 'not json{');
		expect(response.status).toBe(400);
		expect(stt.transcribe).not.toHaveBeenCalled();
	});

	it('rejects a bare JSON null with 400 instead of throwing a 500', async () => {
		const response = await call('null-body', 'null');
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

	it('rejects a body over the request cap with 413, enforced while streaming (no Content-Length trust)', async () => {
		// The cap (MAX_WAV_BASE64 5_000_000 + 16_384 margin) is enforced as the body streams in, so a
		// chunked or Content-Length-less request can't slip an oversized payload past a header check.
		const huge = 'a'.repeat(5_000_000 + 16_384 + 1_000);
		const response = await call('flooder', { wavBase64: huge });
		expect(response.status).toBe(413);
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
