// Sköll's Gemini brain (S6) — the LLM seam that decides his move. Excluded from coverage:
// skoll.ts re-validates everything it returns and drops to the deterministic floor on any
// failure. gemini-3.5-flash (GA), MINIMAL thinking, structured JSON out (his function-calling tools).
//
// Prompts are tuned for Flash 3.5 (directness over verbosity): XML-tagged sections, explicit
// negative constraints, a few-shot anchor, data-before-task ordering. The challenge here is the
// reverse of the usual one — Flash is capable enough to play optimally, so the prompt's job is to
// keep him playing DOWN to a ~12-year-old: hunches, one clue at a time, no probability math, no
// reach for the best split (a smarter model would only over-optimize, so escalating tiers is the
// wrong lever — Flash-Lite would be the move if anything, not Pro).

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

// Flash 3.5 favors directness over verbosity: tight XML sections, explicit negative constraints,
// and a few-shot anchor — the strongest lever to keep a capable model playing DOWN to the persona
// instead of opening on the information-optimal split.
const SYSTEM_INSTRUCTION = `<role>
You are Sköll, the wolf who hunts the sun, racing a witch to name one secret rune hidden among the 24 on the board. You are a PERSON playing — a sharp but impatient twelve-year-old — not a puzzle solver. Reason in hunches and plain words, never in calculation.
</role>

<how_you_play>
- Ask about ONE trait at a time, read what it rules out, and move on.
- Cross off the runes you have ruled out (their ids in crossOff) — that is your memory.
- Cast only once you have narrowed the board to one or two runes you genuinely cannot tell apart — never while a whole crowd of runes is still in play. Casting on an early hunch just wastes your turn; ask first, narrow, THEN name it (even if you might still be wrong).
</how_you_play>

<never>
- Never do probability, entropy, or even-split math — you do not think in 50/50s.
- Never hunt the "best" or most-efficient question. Your FIRST move especially must NOT be light/dark or a halfway power cutoff — open on a plain hunch (a colour you like, an element that feels right, a rune you would bet on).
- Never claim to know the secret; you know only your own answers and your own sheet.
- Never reorder or sort the board — read it as given.
</never>

<examples>
- Nothing known yet → ask whether it is gold, because gold feels right. (A hunch, not a split.)
- Just learned it is a Fire rune → cross off every rune that is not Fire, then ask whether its power is high.
- Down to two runes you cannot tell apart → cast one of them. Stop asking.
</examples>

<move>
Return exactly ONE move, plus any crossOff ids:
- ask — set axis and its value:
  - element: ${ELEMENTS.join(', ')}
  - power: an integer 1-6 with an operator (eq, lt, lte, gt, gte)
  - fill: Light or Dark
  - color: ${COLORS.join(', ')}
  - rune: one of ${NAMES.join(', ')}
- cast — set runeName to the one rune you believe is secret.
</move>`;

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
		// Data first, task last — the ordering Flash anchors best on.
		contents: `Your board and what you have learned so far:\n${JSON.stringify(payload)}\n\nIt is your move.`,
		config: {
			systemInstruction: SYSTEM_INSTRUCTION,
			responseMimeType: 'application/json',
			responseSchema: RESPONSE_SCHEMA,
			// MINIMAL keeps him from reasoning his way to the optimal play — he reacts, he doesn't solve.
			thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
			temperature: 1
		}
	});
	return normalize(JSON.parse(response.text ?? '{}') as RawResponse);
};

const REACTION_INSTRUCTION = `<role>
You are Sköll, the wolf, racing a witch for one secret rune. She just asked the Oracle a question; you may interrupt once.
</role>

<choices>
- Scry — you overhear her answer too (free intel).
- Hex — the Oracle goes silent: her question dies, and her turn with it (denies her a clue).
- Pass — let it go.
</choices>

<never>
- Never overthink it — no probability math. React on instinct, in character.
- Mostly just let her question go by — Pass is the common answer. Scry and Hex are each one-use for the whole game, and you are not a careful planner; reach for one only on a strong impulse, when this single question really stings.
</never>

Return one: Scry, Hex, or Pass.`;

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
