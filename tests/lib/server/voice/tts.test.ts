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

import { synthesizeStream, isCached, resetTtsCache } from '$lib/server/voice/tts';
import { ORACLE_VOICE, SKOLL_VOICE, TTS_MODEL, TTS_FALLBACK_MODEL } from '$lib/voice/config';
import { getEvents } from '$lib/server/debug/log';

// The SDK throws an ApiError carrying the HTTP code on `.status`; 429 is the shared-quota throttle.
const rateLimit = () => Object.assign(new Error('429 RESOURCE_EXHAUSTED'), { status: 429 });

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

		const chunks = await collect(synthesizeStream('I wake with the fire.', ORACLE_VOICE));

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

	it('isCached reports false until a line is synthesized, then true', async () => {
		sdk.generateContentStream.mockResolvedValueOnce(streamOf('pcm'));
		expect(isCached('I wake with the fire.', ORACLE_VOICE)).toBe(false);
		await collect(synthesizeStream('I wake with the fire.', ORACLE_VOICE));
		expect(isCached('I wake with the fire.', ORACLE_VOICE)).toBe(true);
	});

	it('synthesizes the requested voice', async () => {
		sdk.generateContentStream.mockResolvedValueOnce(streamOf('grr'));

		await collect(synthesizeStream('I scent a fire rune on her.', SKOLL_VOICE));

		expect(sdk.generateContentStream).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				config: expect.objectContaining({
					speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: SKOLL_VOICE } } }
				})
			})
		);
	});

	it('caches per voice — the same line in two voices is two clips', async () => {
		sdk.generateContentStream.mockResolvedValue(streamOf('x'));
		const line = 'Two power. I can smell it.';

		await collect(synthesizeStream(line, ORACLE_VOICE));
		expect(isCached(line, ORACLE_VOICE)).toBe(true);
		// The other voice is a separate cache entry — not yet synthesized.
		expect(isCached(line, SKOLL_VOICE)).toBe(false);

		await collect(synthesizeStream(line, SKOLL_VOICE));
		expect(sdk.generateContentStream).toHaveBeenCalledTimes(2);
	});

	it('replays a cached clip without a second Gemini call', async () => {
		sdk.generateContentStream.mockResolvedValueOnce(streamOf('one', 'two'));

		const first = await collect(synthesizeStream('Speak your question, witch.', ORACLE_VOICE));
		const second = await collect(synthesizeStream('Speak your question, witch.', ORACLE_VOICE));

		expect(first).toEqual(['one', 'two']);
		expect(second).toEqual(['one', 'two']);
		expect(sdk.generateContentStream).toHaveBeenCalledTimes(1);
	});

	it('yields nothing without touching the SDK when the key is not configured', async () => {
		mock.env.GEMINI_API_KEY = undefined;

		expect(await collect(synthesizeStream('I wake with the fire.', ORACLE_VOICE))).toEqual([]);
		expect(sdk.GoogleGenAI).not.toHaveBeenCalled();
	});

	it('does not cache an uncacheable (authored) line — a unique clip can never replay', async () => {
		sdk.generateContentStream.mockResolvedValue(streamOf('a', 'b'));
		const line = 'No, she does not reach for the color of the deep.';

		expect(await collect(synthesizeStream(line, ORACLE_VOICE, false))).toEqual(['a', 'b']);
		expect(isCached(line, ORACLE_VOICE)).toBe(false); // never stored — no memory accrual
		// A second call re-synthesizes; there is no cached clip to replay.
		await collect(synthesizeStream(line, ORACLE_VOICE, false));
		expect(sdk.generateContentStream).toHaveBeenCalledTimes(2);
	});

	it('masks the key and stops when the stream rejects', async () => {
		sdk.generateContentStream.mockRejectedValueOnce(
			new Error('500 from https://api?key=test-gemini-key down')
		);

		expect(await collect(synthesizeStream('I wake with the fire.', ORACLE_VOICE))).toEqual([]);
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
		expect(await collect(synthesizeStream('I wake with the fire.', ORACLE_VOICE))).toEqual([
			'half'
		]);
		// Second attempt re-synthesizes (no cache hit) and returns the complete clip.
		expect(await collect(synthesizeStream('I wake with the fire.', ORACLE_VOICE))).toEqual([
			'whole-a',
			'whole-b'
		]);
		expect(sdk.generateContentStream).toHaveBeenCalledTimes(2);
	});

	it('falls back to the older model when the primary 429s before any audio', async () => {
		sdk.generateContentStream.mockRejectedValueOnce(rateLimit());
		sdk.generateContentStream.mockResolvedValueOnce(streamOf('fb-a', 'fb-b'));

		const chunks = await collect(
			synthesizeStream('I wake with the fire.', ORACLE_VOICE, true, 's1')
		);

		expect(chunks).toEqual(['fb-a', 'fb-b']); // the line still speaks, in the same voice
		expect(sdk.generateContentStream).toHaveBeenCalledTimes(2);
		expect(sdk.generateContentStream).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ model: TTS_MODEL })
		);
		expect(sdk.generateContentStream).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ model: TTS_FALLBACK_MODEL })
		);
		// The fallback clip caches under the same key — a replay costs no further synth.
		expect(isCached('I wake with the fire.', ORACLE_VOICE)).toBe(true);
		// The swap is teed to /debug as a warn, not a silent degrade.
		const tee = getEvents('s1').at(-1);
		expect(tee).toMatchObject({ level: 'warn', part: 'Voice' });
		expect(tee?.message).toContain(TTS_FALLBACK_MODEL);
	});

	it('does not fall back once audio has streamed — no double-speak in the other model', async () => {
		const partial429 = (async function* () {
			yield { candidates: [{ content: { parts: [{ inlineData: { data: 'mid' } }] } }] };
			throw rateLimit();
		})();
		sdk.generateContentStream.mockResolvedValueOnce(partial429);

		expect(await collect(synthesizeStream('I wake with the fire.', ORACLE_VOICE))).toEqual(['mid']);
		expect(sdk.generateContentStream).toHaveBeenCalledTimes(1); // the second model is never tried
	});

	it('does not fall back on a non-rate-limit failure', async () => {
		sdk.generateContentStream.mockRejectedValueOnce(new Error('500 internal'));

		expect(await collect(synthesizeStream('I wake with the fire.', ORACLE_VOICE))).toEqual([]);
		expect(sdk.generateContentStream).toHaveBeenCalledTimes(1); // a 500 is terminal, not a fallback
	});

	it('caps the clip cache, evicting the oldest so memory stays bounded', async () => {
		const MAX_CLIPS = 128;
		// A fresh generator per call — a single shared one would be exhausted after the first synth.
		sdk.generateContentStream.mockImplementation(async () => streamOf('pcm'));
		const oldest = 'clip 0';
		// Fill exactly to the cap, then one past it — the very first clip falls off the front.
		for (let i = 0; i < MAX_CLIPS; i++) await collect(synthesizeStream(`clip ${i}`, ORACLE_VOICE));
		expect(isCached(oldest, ORACLE_VOICE)).toBe(true);

		await collect(synthesizeStream(`clip ${MAX_CLIPS}`, ORACLE_VOICE));
		expect(isCached(oldest, ORACLE_VOICE)).toBe(false); // evicted
		expect(isCached(`clip ${MAX_CLIPS}`, ORACLE_VOICE)).toBe(true); // the newest survives
	});
});
