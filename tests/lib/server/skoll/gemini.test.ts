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

// A fresh-board payload (nothing learned yet) — carries the seeded opening hunch like buildPayload.
const emptyMove = { board: [], answers: [], crossedOff: [], hunch: 'a gold rune' };

describe('Gemini Sköll adapter', () => {
	beforeEach(() => {
		sdk.generateContent.mockReset();
	});

	it('requests a Gemini 3.5 Flash move with structured JSON and minimal thinking', async () => {
		geminiJson({ kind: 'ask', axis: 'fill', fillValue: 'Light', crossOff: [1] });

		const result = await decideSkollMove(emptyMove);

		expect(result).toEqual({
			kind: 'ask',
			query: { axis: 'fill', value: 'Light' },
			crossOff: [1],
			reasoning: ''
		});
		expect(sdk.generateContent).toHaveBeenCalledWith(
			expect.objectContaining({
				model: 'gemini-3.5-flash',
				config: expect.objectContaining({
					responseMimeType: 'application/json',
					thinkingConfig: { thinkingLevel: 'MINIMAL', includeThoughts: true },
					temperature: 1
				})
			})
		);
	});

	it('requests Sköll reactions from the same Gemini 3.5 Flash model', async () => {
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
				model: 'gemini-3.5-flash',
				config: expect.objectContaining({
					responseMimeType: 'application/json',
					thinkingConfig: { thinkingLevel: 'MINIMAL' },
					temperature: 1
				})
			})
		);
	});

	// The flat-schema → Query mapping is the riskiest seam (a field drift silently dumps to the
	// floor), so cover every axis, the cast shape, and the empty-response fallback.
	it.each([
		[
			{ kind: 'ask', axis: 'element', elementValue: 'Fire' },
			{ axis: 'element', value: 'Fire' }
		],
		[
			{ kind: 'ask', axis: 'color', colorValue: 'Gold' },
			{ axis: 'color', value: 'Gold' }
		],
		[
			{ kind: 'ask', axis: 'rune', runeName: 'Sowilo' },
			{ axis: 'rune', value: 'Sowilo' }
		],
		[
			{ kind: 'ask', axis: 'power', powerOp: 'gte', powerValue: 4 },
			{ axis: 'power', op: 'gte', value: 4 }
		]
	])('maps a %o response to its query', async (raw, query) => {
		geminiJson(raw);
		const result = await decideSkollMove(emptyMove);
		expect(result).toMatchObject({ kind: 'ask', query });
	});

	it('maps a cast response, carrying its cross-offs', async () => {
		geminiJson({ kind: 'cast', runeName: 'Tiwaz', crossOff: [3, 7] });
		const result = await decideSkollMove(emptyMove);
		expect(result).toEqual({ kind: 'cast', runeName: 'Tiwaz', crossOff: [3, 7], reasoning: '' });
	});

	it('returns an unreadable ask on an empty response (skoll.ts then floors it)', async () => {
		sdk.generateContent.mockResolvedValueOnce({ text: undefined });
		const result = await decideSkollMove(emptyMove);
		expect(result).toEqual({ kind: 'ask', query: undefined, crossOff: undefined, reasoning: '' });
	});

	it('surfaces his thinking trace for the debug view (S8) when the model returns one', async () => {
		sdk.generateContent.mockResolvedValueOnce({
			text: JSON.stringify({ kind: 'ask', axis: 'color', colorValue: 'Gold' }),
			candidates: [
				{
					content: {
						parts: [
							{ thought: true, text: 'Gold feels lucky. ' },
							{ thought: true, text: 'I will ask that.' },
							{ text: '{"kind":"ask"}' } // the answer part — not a thought, excluded
						]
					}
				}
			]
		});
		const result = await decideSkollMove(emptyMove);
		expect(result.reasoning).toBe('Gold feels lucky. I will ask that.');
	});

	it('surfaces the seeded hunch in the opening prompt when nothing is known', async () => {
		geminiJson({ kind: 'ask', axis: 'color', colorValue: 'Gold' });
		await decideSkollMove({ ...emptyMove, answers: [], hunch: 'a fire rune' });
		const sent = sdk.generateContent.mock.calls[0][0].contents as string;
		expect(sent).toContain('a fire rune');
	});

	it('drops the hunch entirely once he has learned something — value gone, not just the sentence', async () => {
		geminiJson({ kind: 'ask', axis: 'color', colorValue: 'Gold' });
		await decideSkollMove({
			...emptyMove,
			answers: [{ trait: 'a fire rune', holds: false }],
			// A distinctive phrase that appears nowhere else in the payload, so finding it means the
			// hunch leaked into the prompt.
			hunch: 'a teal rune'
		});
		const sent = sdk.generateContent.mock.calls[0][0].contents as string;
		expect(sent).not.toContain('hunch you woke with'); // opener sentence gone
		expect(sent).not.toContain('a teal rune'); // and the value itself is gone, not stringified in
	});
});
