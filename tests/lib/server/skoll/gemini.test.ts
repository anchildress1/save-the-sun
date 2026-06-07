import { beforeEach, describe, expect, it, vi } from 'vitest';

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
	ThinkingLevel: { MINIMAL: 'MINIMAL' },
	Type: {
		ARRAY: 'ARRAY',
		INTEGER: 'INTEGER',
		OBJECT: 'OBJECT',
		STRING: 'STRING'
	}
}));

vi.mock('$env/dynamic/private', () => ({
	env: { GEMINI_API_KEY: 'test-gemini-key' }
}));

import { decideSkollMove, decideSkollReaction } from '$lib/server/skoll/gemini';

function geminiJson(body: object) {
	sdk.generateContent.mockResolvedValueOnce({ text: JSON.stringify(body) });
}

describe('Gemini Sköll adapter', () => {
	beforeEach(() => {
		sdk.generateContent.mockReset();
	});

	it('requests a Gemini 3 Flash move with structured JSON and minimal thinking', async () => {
		geminiJson({ kind: 'ask', axis: 'fill', fillValue: 'Light', crossOff: [1] });

		const result = await decideSkollMove({ board: [], answers: [], crossedOff: [] });

		expect(result).toEqual({
			kind: 'ask',
			query: { axis: 'fill', value: 'Light' },
			crossOff: [1]
		});
		expect(sdk.generateContent).toHaveBeenCalledWith(
			expect.objectContaining({
				model: 'gemini-3-flash-preview',
				config: expect.objectContaining({
					responseMimeType: 'application/json',
					thinkingConfig: { thinkingLevel: 'MINIMAL' },
					temperature: 1
				})
			})
		);
	});

	it('requests Sköll reactions from the same Gemini 3 Flash model', async () => {
		geminiJson({ reaction: 'Hex' });

		const result = await decideSkollReaction({
			askedTrait: 'a light rune',
			answers: [],
			crossedOff: [],
			canScry: true,
			canHex: true
		});

		expect(result).toEqual({ reaction: 'Hex' });
		expect(sdk.generateContent).toHaveBeenCalledWith(
			expect.objectContaining({
				model: 'gemini-3-flash-preview',
				config: expect.objectContaining({
					responseMimeType: 'application/json',
					thinkingConfig: { thinkingLevel: 'MINIMAL' },
					temperature: 1
				})
			})
		);
	});
});
