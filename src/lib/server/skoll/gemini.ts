// Sköll's Gemini brain (S6) — the LLM seam that decides his move. Excluded from coverage:
// skoll.ts re-validates everything it returns and drops to the deterministic floor on any
// failure. gemini-3.5-flash, MINIMAL thinking, structured JSON out (his function-calling tools).
//
// He is prompted as a PERSON playing the rite, never as an AI: ~12-year-old deduction, one clue
// at a time, no probability math, no exhaustive elimination, casts when he feels sure enough.

import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { env } from '$env/dynamic/private';
import { runes } from '$lib/board';
import type { PowerOp, Query } from '$lib/server/engine/queries';
import type {
	RawSkollDecision,
	SkollDecide,
	SkollPayload,
	SkollReactionDecide,
	SkollReactionView
} from './skoll';

const MODEL = 'gemini-3.5-flash';

const ELEMENTS: string[] = [...new Set(runes.map((r) => r.element))];
const COLORS: string[] = [...new Set(runes.map((r) => r.color))];
const NAMES: string[] = runes.map((r) => r.name);

const SYSTEM_INSTRUCTION = `You are Sköll, the wolf who hunts the sun, playing a rite against a witch. One secret rune is hidden among the 24 on the board. Whoever names it first wins. You are a PERSON playing a game, not a machine solving a puzzle — reason in plain words, the way a sharp twelve-year-old would.

How you think:
- One clue at a time. Ask about a single trait (element, power, light/dark, color), see what it rules out, move on. Do NOT do probability math, entropy, or cross-product elimination. Do NOT enumerate every possibility.
- Do NOT hunt for the "best" or most-efficient question — you are not an optimizer. Especially your FIRST question: don't reach for the cleanest 50/50 split (light/dark, a halfway power cutoff). Open by asking about a specific trait you have a hunch about — a particular element, a color, a power you'd guess — the way a curious kid pokes at the board, not the way a solver narrows it. Variety over efficiency.
- You only know what you have earned: the answers to YOUR questions and the runes on YOUR sheet. You do NOT know the secret and you never claim to.
- The board is given in a fixed order. Do not reorder or sort it. Just read it.
- Cross runes off your sheet as you rule them out — list their ids in crossOff. This is your memory.
- Cast when you feel sure enough — down to a couple of candidates is fine, even if you might be wrong. Don't wait for certainty.

Your move each turn is ONE of:
- ask: pick an axis and value to ask about.
  - element: one of ${ELEMENTS.join(', ')}.
  - power: an integer 1-6 with an operator (eq, lt, lte, gt, gte).
  - fill: Light or Dark.
  - color: one of ${COLORS.join(', ')}.
  - rune: name one rune to test it, one of ${NAMES.join(', ')}.
- cast: name the one rune you believe is secret (runeName).

Return only the structured object.`;

const RESPONSE_SCHEMA = {
	type: Type.OBJECT,
	properties: {
		kind: { type: Type.STRING, enum: ['ask', 'cast'] },
		axis: { type: Type.STRING, enum: ['element', 'power', 'fill', 'color', 'rune'] },
		elementValue: { type: Type.STRING, enum: ELEMENTS },
		colorValue: { type: Type.STRING, enum: COLORS },
		fillValue: { type: Type.STRING, enum: ['Light', 'Dark'] },
		runeName: { type: Type.STRING, enum: NAMES },
		powerOp: { type: Type.STRING, enum: ['eq', 'lt', 'lte', 'gt', 'gte'] },
		powerValue: { type: Type.INTEGER },
		crossOff: { type: Type.ARRAY, items: { type: Type.INTEGER } }
	},
	required: ['kind'],
	propertyOrdering: [
		'kind',
		'axis',
		'elementValue',
		'colorValue',
		'fillValue',
		'runeName',
		'powerOp',
		'powerValue',
		'crossOff'
	]
};

interface RawResponse {
	kind?: string;
	axis?: string;
	elementValue?: string;
	colorValue?: string;
	fillValue?: 'Light' | 'Dark';
	runeName?: string;
	powerOp?: PowerOp;
	powerValue?: number;
	crossOff?: number[];
}

function toQuery(raw: RawResponse): Query | undefined {
	switch (raw.axis) {
		case 'element':
			return raw.elementValue ? { axis: 'element', value: raw.elementValue } : undefined;
		case 'color':
			return raw.colorValue ? { axis: 'color', value: raw.colorValue } : undefined;
		case 'fill':
			return raw.fillValue ? { axis: 'fill', value: raw.fillValue } : undefined;
		case 'rune':
			return raw.runeName ? { axis: 'rune', value: raw.runeName } : undefined;
		case 'power':
			return raw.powerOp && typeof raw.powerValue === 'number'
				? { axis: 'power', op: raw.powerOp, value: raw.powerValue }
				: undefined;
		default:
			return undefined;
	}
}

// Map the flat schema response into a (still untrusted) decision. skoll.ts validates the rest.
function normalize(raw: RawResponse): RawSkollDecision {
	if (raw.kind === 'cast') return { kind: 'cast', runeName: raw.runeName, crossOff: raw.crossOff };
	return { kind: 'ask', query: toQuery(raw), crossOff: raw.crossOff };
}

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
	client ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
	return client;
}

// Throws on transport/parse failure — skoll.ts catches it and plays the deterministic floor.
export const decideSkollMove: SkollDecide = async (payload: SkollPayload) => {
	const response = await ai().models.generateContent({
		model: MODEL,
		contents: JSON.stringify(payload),
		config: {
			systemInstruction: SYSTEM_INSTRUCTION,
			responseMimeType: 'application/json',
			responseSchema: RESPONSE_SCHEMA,
			thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
			temperature: 1
		}
	});
	return normalize(JSON.parse(response.text ?? '{}') as RawResponse);
};

const REACTION_INSTRUCTION = `You are Sköll, the wolf, playing the rite against a witch. She has just asked the Oracle a question. You get ONE interrupt: Scry (you hear her answer too — useful intel), Hex (the Oracle falls silent, her question dies and her turn with it — denies her a clue), or Pass (let it go). Each is one-use for the whole game; spend them when they matter. A person playing — no probability math. Decide in character.`;

const REACTION_SCHEMA = {
	type: Type.OBJECT,
	properties: { reaction: { type: Type.STRING, enum: ['Scry', 'Hex', 'Pass'] } },
	required: ['reaction']
};

// Throws on transport/parse failure — skoll.ts catches it and passes (the reaction floor).
export const decideSkollReaction: SkollReactionDecide = async (view: SkollReactionView) => {
	const response = await ai().models.generateContent({
		model: MODEL,
		contents: JSON.stringify(view),
		config: {
			systemInstruction: REACTION_INSTRUCTION,
			responseMimeType: 'application/json',
			responseSchema: REACTION_SCHEMA,
			thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
			temperature: 1
		}
	});
	return JSON.parse(response.text ?? '{}') as { reaction?: string };
};
