import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Gemini SDK is mocked — these tests never make a real API call.
const sdk = vi.hoisted(() => {
	const generateContent = vi.fn();
	const GoogleGenAI = vi.fn(function GoogleGenAI(this: {
		models: { generateContent: typeof generateContent };
	}) {
		this.models = { generateContent };
	});
	return { generateContent, GoogleGenAI };
});
vi.mock('@google/genai', () => ({ GoogleGenAI: sdk.GoogleGenAI }));

const mock = vi.hoisted(() => ({
	env: { GEMINI_API_KEY: 'test-gemini-key' } as { GEMINI_API_KEY?: string }
}));
vi.mock('$env/dynamic/private', () => ({ env: mock.env }));

import {
	transcribe,
	classifyReaction,
	classifyCast,
	interpretAsk,
	resetTranscribeClient
} from '$lib/server/voice/transcribe';

const reply = (text: string) => sdk.generateContent.mockResolvedValueOnce({ text });

describe('voice transcribe', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetTranscribeClient();
		mock.env.GEMINI_API_KEY = 'test-gemini-key';
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => vi.restoreAllMocks());

	it('transcribes a question verbatim and sends the WAV as audio/wav', async () => {
		reply('  is it a fire rune  ');
		expect(await transcribe('WAV')).toBe('is it a fire rune');
		const arg = sdk.generateContent.mock.calls[0][0] as {
			contents: { parts: { inlineData?: unknown }[] }[];
		};
		expect(arg.contents[0].parts[0].inlineData).toEqual({ mimeType: 'audio/wav', data: 'WAV' });
	});

	it('returns "" without calling Gemini when the key is missing', async () => {
		mock.env.GEMINI_API_KEY = '';
		expect(await transcribe('WAV')).toBe('');
		expect(sdk.generateContent).not.toHaveBeenCalled();
	});

	it('returns "" when the SDK call fails', async () => {
		sdk.generateContent.mockRejectedValueOnce(new Error('boom'));
		expect(await transcribe('WAV')).toBe('');
	});

	it('masks the key out of a failed-read error before logging it', async () => {
		mock.env.GEMINI_API_KEY = 'secret-key-xyz';
		// An SDK error can embed the request URL — and with it the key — in its message/stack.
		sdk.generateContent.mockRejectedValueOnce(
			new Error('GET https://api?key=secret-key-xyz failed')
		);
		expect(await transcribe('WAV')).toBe('');
		const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
		expect(logged).not.toContain('secret-key-xyz');
		expect(logged).toContain('[gemini-api-key]');
	});

	it('classifies a reaction (lowercased), and unclear for anything else', async () => {
		reply('HEX');
		expect(await classifyReaction('WAV')).toBe('hex');
		reply('whatever');
		expect(await classifyReaction('WAV')).toBe('unclear');
	});

	it('matches a cast only to a board rune', async () => {
		reply('Sowilo');
		expect(await classifyCast('WAV', ['Sowilo', 'Fehu'])).toBe('Sowilo');
		reply('Tyr');
		expect(await classifyCast('WAV', ['Sowilo'])).toBe(''); // off-board → refused
	});

	it('classifyCast returns "" with no candidate names and never calls Gemini', async () => {
		expect(await classifyCast('WAV', [])).toBe('');
		expect(sdk.generateContent).not.toHaveBeenCalled();
	});

	it('interpretAsk reads a question as verbatim text', async () => {
		reply('is it gold');
		expect(await interpretAsk('WAV', ['Sowilo'])).toEqual({ text: 'is it gold' });
	});

	it('interpretAsk reads an explicit cast and matches the board', async () => {
		reply('CAST: Sowilo');
		expect(await interpretAsk('WAV', ['Sowilo', 'Fehu'])).toEqual({ cast: 'Sowilo' });
	});

	it('interpretAsk refuses an off-board cast (cast intent, empty name)', async () => {
		reply('CAST: Tyr');
		expect(await interpretAsk('WAV', ['Sowilo'])).toEqual({ cast: '' });
	});

	it('interpretAsk falls back to a plain transcribe with no board list', async () => {
		reply('is it gold');
		expect(await interpretAsk('WAV', [])).toEqual({ text: 'is it gold' });
	});
});
