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
		INTEGER: 'INTEGER',
		OBJECT: 'OBJECT',
		STRING: 'STRING'
	}
}));

vi.mock('$env/dynamic/private', () => ({
	env: { GEMINI_API_KEY: 'test-gemini-key' }
}));

import { interpret } from '$lib/server/oracle/gemini';

function geminiJson(body: object) {
	sdk.generateContent.mockResolvedValueOnce({ text: JSON.stringify(body) });
}

describe('Gemini Oracle adapter', () => {
	beforeEach(() => {
		sdk.generateContent.mockReset();
	});

	it('requests structured JSON with minimal thinking and maps a value query', async () => {
		geminiJson({
			kind: 'query',
			axis: 'element',
			elementValue: 'Fire',
			paraphrase: 'the fire-runes'
		});

		const result = await interpret('Is it a fire rune?');

		expect(result).toEqual({
			kind: 'query',
			query: { axis: 'element', value: 'Fire' },
			paraphrase: 'the fire-runes'
		});
		expect(sdk.generateContent).toHaveBeenCalledWith(
			expect.objectContaining({
				model: 'gemini-3.5-flash',
				contents: 'Is it a fire rune?',
				config: expect.objectContaining({
					responseMimeType: 'application/json',
					thinkingConfig: { thinkingLevel: 'MINIMAL' },
					temperature: 0
				})
			})
		);
	});

	it('maps a power range query', async () => {
		geminiJson({
			kind: 'query',
			axis: 'power',
			powerOp: 'lt',
			powerValue: 3,
			paraphrase: 'fewer than three power'
		});

		await expect(interpret('Fewer than three power?')).resolves.toEqual({
			kind: 'query',
			query: { axis: 'power', op: 'lt', value: 3 },
			paraphrase: 'fewer than three power'
		});
		expect(sdk.generateContent).toHaveBeenCalledOnce();
	});

	it.each(['mixed-type', 'secret-seeking', 'prompt-injection', 'negation'] as const)(
		'maps %s refusals',
		async (refusal) => {
			geminiJson({ kind: 'refusal', refusalClass: refusal });

			await expect(interpret('nope')).resolves.toEqual({ kind: 'refusal', refusal });
			expect(sdk.generateContent).toHaveBeenCalledOnce();
		}
	);

	it('maps missing query fields to an unparseable refusal', async () => {
		geminiJson({ kind: 'query', axis: 'element', paraphrase: 'the broken sign' });

		await expect(interpret('Is it glorp?')).resolves.toEqual({
			kind: 'refusal',
			refusal: 'unparseable'
		});
		expect(sdk.generateContent).toHaveBeenCalledOnce();
	});

	it('maps invalid JSON to the engine-error refusal without throwing', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		sdk.generateContent.mockResolvedValueOnce({ text: '{' });

		await expect(interpret('Is it fire?')).resolves.toEqual({
			kind: 'refusal',
			refusal: 'engine-error'
		});
		expect(consoleError).toHaveBeenCalledOnce();
		expect(sdk.generateContent).toHaveBeenCalledOnce();

		consoleError.mockRestore();
	});
});
