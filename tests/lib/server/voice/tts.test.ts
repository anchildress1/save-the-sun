import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => {
	const generateContentStream = vi.fn();
	const GoogleGenAI = vi.fn(function GoogleGenAI(this: {
		models: { generateContentStream: typeof generateContentStream };
	}) {
		this.models = { generateContentStream };
	});
	return { generateContentStream, GoogleGenAI };
});

vi.mock('@google/genai', () => ({
	GoogleGenAI: sdk.GoogleGenAI,
	Modality: { AUDIO: 'AUDIO' }
}));

const mock = vi.hoisted(() => ({
	env: { GEMINI_API_KEY: 'test-gemini-key' } as { GEMINI_API_KEY?: string }
}));

vi.mock('$env/dynamic/private', () => ({ env: mock.env }));

import { synthesizeStream, resetTtsCache } from '$lib/server/voice/tts';
import { ORACLE_VOICE, TTS_MODEL } from '$lib/voice/config';

// A Gemini stream is an async iterable of parts; each part may carry one inline-audio chunk.
function streamOf(...chunks: (string | null)[]) {
	return (async function* () {
		for (const data of chunks) {
			yield {
				candidates: [{ content: { parts: [data === null ? {} : { inlineData: { data } }] } }]
			};
		}
	})();
}

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
	const out: string[] = [];
	for await (const c of gen) out.push(c);
	return out;
}

describe('synthesizeStream', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetTtsCache();
		mock.env.GEMINI_API_KEY = 'test-gemini-key';
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => vi.restoreAllMocks());

	it('streams audio chunks with the Oracle voice, skipping empty parts', async () => {
		sdk.generateContentStream.mockResolvedValueOnce(streamOf('aaa', null, 'bbb'));

		const chunks = await collect(synthesizeStream('I wake with the fire.'));

		expect(chunks).toEqual(['aaa', 'bbb']);
		expect(sdk.generateContentStream).toHaveBeenCalledExactlyOnceWith({
			model: TTS_MODEL,
			contents: [{ role: 'user', parts: [{ text: 'I wake with the fire.' }] }],
			config: {
				responseModalities: ['AUDIO'],
				speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: ORACLE_VOICE } } }
			}
		});
	});

	it('replays a cached clip without a second Gemini call', async () => {
		sdk.generateContentStream.mockResolvedValueOnce(streamOf('one', 'two'));

		const first = await collect(synthesizeStream('Speak your question, witch.'));
		const second = await collect(synthesizeStream('Speak your question, witch.'));

		expect(first).toEqual(['one', 'two']);
		expect(second).toEqual(['one', 'two']);
		expect(sdk.generateContentStream).toHaveBeenCalledTimes(1);
	});

	it('yields nothing without touching the SDK when the key is not configured', async () => {
		mock.env.GEMINI_API_KEY = undefined;

		expect(await collect(synthesizeStream('I wake with the fire.'))).toEqual([]);
		expect(sdk.GoogleGenAI).not.toHaveBeenCalled();
		expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('not configured');
	});

	it('masks the key and stops when the stream rejects', async () => {
		sdk.generateContentStream.mockRejectedValueOnce(
			new Error('500 from https://api?key=test-gemini-key down')
		);

		expect(await collect(synthesizeStream('I wake with the fire.'))).toEqual([]);
		const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
		expect(logged).toContain('[gemini-api-key]');
		expect(logged).not.toContain('test-gemini-key');
	});

	it('does not cache a stream that errors mid-flight', async () => {
		const partial = (async function* () {
			yield { candidates: [{ content: { parts: [{ inlineData: { data: 'half' } }] } }] };
			throw new Error('dropped');
		})();
		sdk.generateContentStream.mockResolvedValueOnce(partial);
		sdk.generateContentStream.mockResolvedValueOnce(streamOf('whole-a', 'whole-b'));

		// First attempt streams one chunk then dies — not cached.
		expect(await collect(synthesizeStream('I wake with the fire.'))).toEqual(['half']);
		// Second attempt re-synthesizes (no cache hit) and returns the complete clip.
		expect(await collect(synthesizeStream('I wake with the fire.'))).toEqual([
			'whole-a',
			'whole-b'
		]);
		expect(sdk.generateContentStream).toHaveBeenCalledTimes(2);
	});
});
