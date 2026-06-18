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

import { interpret, composeOracleFlair } from '$lib/server/oracle/gemini';

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

	// Every operator must survive the adapter unchanged — the symbol prompt (= < <= > >=)
	// leans on this passthrough, so a dropped or remapped op would silently mis-answer.
	it.each(['eq', 'lt', 'lte', 'gt', 'gte'] as const)('maps a power %s query', async (op) => {
		geminiJson({
			kind: 'query',
			axis: 'power',
			powerOp: op,
			powerValue: 3,
			paraphrase: 'three power'
		});

		await expect(interpret('three power?')).resolves.toEqual({
			kind: 'query',
			query: { axis: 'power', op, value: 3 },
			paraphrase: 'three power'
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

describe('composeOracleFlair (ttd:17)', () => {
	beforeEach(() => {
		sdk.generateContent.mockReset();
	});

	it('dramatizes a verdict — full Flash, MINIMAL thinking, temp 1, bounded output', async () => {
		sdk.generateContent.mockResolvedValueOnce({ text: 'Yes — the flame-sign burns; she reaches.' });

		const line = await composeOracleFlair('Yes. Sól is reaching for a fire rune.');

		expect(line).toBe('Yes — the flame-sign burns; she reaches.');
		expect(sdk.generateContent).toHaveBeenCalledWith(
			expect.objectContaining({
				model: 'gemini-3.5-flash',
				config: expect.objectContaining({
					thinkingConfig: { thinkingLevel: 'MINIMAL' },
					temperature: 1,
					maxOutputTokens: 64
				})
			})
		);
	});

	it('takes the first line and strips wrapping quotes the model may add', async () => {
		sdk.generateContent.mockResolvedValueOnce({ text: '"No. She does not reach."\n(stage note)' });
		expect(await composeOracleFlair('No. Sól is not reaching for fire.')).toBe(
			'No. She does not reach.'
		);
	});

	it('falls back to null on an empty response (caller voices the deterministic line)', async () => {
		sdk.generateContent.mockResolvedValueOnce({ text: '   ' });
		expect(await composeOracleFlair('Yes. Sól is reaching for fire.')).toBeNull();
	});

	it('falls back to null on a model error — never throws into the Ask path', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		sdk.generateContent.mockRejectedValueOnce(new Error('429'));
		expect(await composeOracleFlair('Yes. Sól is reaching for fire.')).toBeNull();
		expect(consoleError).toHaveBeenCalledOnce();
		consoleError.mockRestore();
	});
});
