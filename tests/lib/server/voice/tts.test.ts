import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => {
	const generateContent = vi.fn();
	const GoogleGenAI = vi.fn(function GoogleGenAI(this: {
		models: { generateContent: typeof generateContent };
	}) {
		this.models = { generateContent };
	});
	return { generateContent, GoogleGenAI };
});

vi.mock('@google/genai', () => ({
	GoogleGenAI: sdk.GoogleGenAI,
	Modality: { AUDIO: 'AUDIO' }
}));

const mock = vi.hoisted(() => ({
	env: { GEMINI_API_KEY: 'test-gemini-key' } as { GEMINI_API_KEY?: string }
}));

vi.mock('$env/dynamic/private', () => ({ env: mock.env }));

import { synthesize, resetTtsCache } from '$lib/server/voice/tts';
import { ORACLE_VOICE, TTS_MODEL } from '$lib/voice/config';

function audioResponse(data: string) {
	return { candidates: [{ content: { parts: [{ inlineData: { data } }] } }] };
}

describe('synthesize', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetTtsCache();
		mock.env.GEMINI_API_KEY = 'test-gemini-key';
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => vi.restoreAllMocks());

	it('synthesizes a line to base64 audio with the Oracle voice', async () => {
		sdk.generateContent.mockResolvedValueOnce(audioResponse('UECAf...'));

		const result = await synthesize('I wake with the fire.');

		expect(result).toEqual({ ok: true, audio: 'UECAf...' });
		expect(sdk.generateContent).toHaveBeenCalledExactlyOnceWith({
			model: TTS_MODEL,
			contents: [{ role: 'user', parts: [{ text: 'I wake with the fire.' }] }],
			config: {
				responseModalities: ['AUDIO'],
				speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: ORACLE_VOICE } } }
			}
		});
	});

	it('replays a cached clip without a second Gemini call', async () => {
		sdk.generateContent.mockResolvedValueOnce(audioResponse('cached-pcm'));

		const first = await synthesize('Speak your question, witch.');
		const second = await synthesize('Speak your question, witch.');

		expect(first).toEqual({ ok: true, audio: 'cached-pcm' });
		expect(second).toEqual({ ok: true, audio: 'cached-pcm' });
		expect(sdk.generateContent).toHaveBeenCalledTimes(1);
	});

	it('fails without touching the SDK when the key is not configured', async () => {
		mock.env.GEMINI_API_KEY = undefined;

		const result = await synthesize('I wake with the fire.');

		expect(result).toEqual({ ok: false });
		expect(sdk.GoogleGenAI).not.toHaveBeenCalled();
		expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('not configured');
	});

	it('fails when the model returns no audio', async () => {
		sdk.generateContent.mockResolvedValueOnce({ candidates: [{ content: { parts: [] } }] });

		expect(await synthesize('I wake with the fire.')).toEqual({ ok: false });
	});

	it('fails and masks the key when synth rejects', async () => {
		sdk.generateContent.mockRejectedValueOnce(
			new Error('500 from https://api?key=test-gemini-key down')
		);

		const result = await synthesize('I wake with the fire.');

		expect(result).toEqual({ ok: false });
		const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
		expect(logged).toContain('[gemini-api-key]');
		expect(logged).not.toContain('test-gemini-key');
	});

	it('does not cache a failed synth', async () => {
		sdk.generateContent.mockRejectedValueOnce(new Error('transient'));
		sdk.generateContent.mockResolvedValueOnce(audioResponse('recovered'));

		expect(await synthesize('I wake with the fire.')).toEqual({ ok: false });
		expect(await synthesize('I wake with the fire.')).toEqual({ ok: true, audio: 'recovered' });
		expect(sdk.generateContent).toHaveBeenCalledTimes(2);
	});
});
