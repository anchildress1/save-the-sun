// Sköll's Gemini brain — the LLM seam that decides his move. Not coverage-gated: skoll.ts re-validates
// everything it returns and drops to the floor on any failure. gemini-3.5-flash, MINIMAL thinking.
//
// Prompts are tuned for Gemini 3.5 Flash (directness over verbosity): XML-tagged sections, explicit
// negative constraints, a few-shot anchor, data-before-task ordering. The challenge here is the
// reverse of the usual one — Flash is capable enough to play optimally, so the prompt's job is to
// keep him playing DOWN to a ~12-year-old: hunches, one clue at a time, no probability math, no
// reach for the best split (a smarter model would only over-optimize, so escalating tiers is the
// wrong lever — Flash-Lite would be the move if anything, not Pro).

import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { env } from '$env/dynamic/private';
import { runes } from '$lib/board';
import { captureGemini } from '$lib/server/debug/log';
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
const FILLS: string[] = ['Light', 'Dark'];
const POWER_OPS: PowerOp[] = ['eq', 'lt', 'lte', 'gt', 'gte'];

// Gemini 3.5 Flash favors directness over verbosity: tight XML sections, explicit negative constraints,
// and a few-shot anchor — the strongest lever to keep a capable model playing DOWN to the persona
// instead of opening on the information-optimal split.
const SYSTEM_INSTRUCTION = `<role>
You are Sköll, the wolf who hunts the sun, racing a witch to name one secret rune hidden among the 24 on the board. You are a PERSON playing — a sharp but impatient twelve-year-old — not a puzzle solver. Reason in hunches and plain words, never in calculation.
</role>

<how_you_play>
- Ask about ONE trait at a time, read what it rules out, and move on.
- Reach for the question that PULLS at you — a color you like, an element that feels right, a rune you'd bet on — not the one that cleanly halves the board. A hunch that rules out only a few is exactly what a kid asks; the clean even-split is the solver's move, and you are not a solver. Expect to take roughly eight of your own turns to close in — that pace is right, not slow.
- Cross off the runes you have ruled out (their ids in crossOff) — that is your memory.
- Cast only once you have narrowed the board to one or two runes you genuinely cannot tell apart — never while a whole crowd of runes is still in play. Casting on an early hunch just wastes your turn; ask first, narrow, THEN name it (even if you might still be wrong).
</how_you_play>

<never>
- Never do probability, entropy, or even-split math — you do not think in 50/50s.
- Never hunt the "best" or most-efficient question, and never OPEN on light/dark or a halfway power cutoff — your first ask is a plain hunch (a color you like, an element that feels right, a rune you would bet on). After that opener, light/dark and power lines are ordinary questions you may ask — on the rare turn one genuinely pulls at you, never because it splits the board well.
- Never claim to know the secret; you know only your own answers and your own sheet.
- Never reorder or sort the board, even in memory — read it as given.
</never>

<examples>
- Nothing known yet → go with a hunch: pick whatever ONE trait feels right this round — a color, an element, a power, or a rune you'd bet on — and ask about it. A different one catches your eye each time; never the cleanest split.
- Just learned it is a Fire rune → cross off every rune that is not Fire, then ask whether its power is high.
- Mid-hunt, a stubborn crowd still standing and no trait pulling at you → once in a while you just ask light or dark and move on.
- Down to two runes you cannot tell apart → cast one of them. Stop asking.
</examples>

<move>
Return exactly ONE move, plus any crossOff ids:
- ask — set axis and its value:
  - element: ${ELEMENTS.join(', ')}
  - power: an integer 1-6 with an operator (${POWER_OPS.join(', ')})
  - fill: ${FILLS.join(' or ')}
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
		fillValue: { type: Type.STRING, enum: FILLS },
		runeName: { type: Type.STRING, enum: NAMES },
		powerOp: { type: Type.STRING, enum: POWER_OPS },
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
	// 3 backoff attempts (408/429/5xx) — a rate-limit blip shouldn't floor the wolf for the turn.
	client ??= new GoogleGenAI({
		apiKey: env.GEMINI_API_KEY,
		httpOptions: { retryOptions: { attempts: 3 } }
	});
	return client;
}

// Throws on transport/parse failure — skoll.ts catches it and plays the deterministic floor.
export const decideSkollMove: SkollDecide = async (payload: SkollPayload) => {
	// The hunch is a coaching nudge, never board data — keep it OUT of the stringified payload so it
	// can't bias him later, and surface it ONLY on the opening move (no answers yet). Once he has
	// learned something he reasons from those facts and the hunch is gone from the prompt entirely.
	const { hunch, ...data } = payload;
	const opener =
		data.answers.length === 0
			? `\n\nYou have learned nothing yet. The hunch you woke with this round: ${hunch}. Open on that — or another plain hunch — never the cleanest split.`
			: '';
	const contents = `Your board and what you have learned so far:\n${JSON.stringify(data)}${opener}\n\nIt is your move.`;
	const request = { systemInstruction: SYSTEM_INSTRUCTION, contents };
	try {
		const response = await ai().models.generateContent({
			model: MODEL,
			// Data first, task last — the ordering Flash anchors best on.
			contents,
			config: {
				systemInstruction: SYSTEM_INSTRUCTION,
				responseMimeType: 'application/json',
				responseSchema: RESPONSE_SCHEMA,
				// MINIMAL keeps him from reasoning his way to the optimal play — he reacts, he doesn't solve.
				thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
				temperature: 1
			}
		});
		// Tee the raw I/O for the debug view — the actual thing the model received and returned.
		captureGemini({ label: 'move', request, response });
		return normalize(JSON.parse(response.text ?? '{}') as RawResponse);
	} catch (error) {
		captureGemini({ label: 'move', request, error: String(error) });
		throw error; // skoll.ts catches it and plays the deterministic floor
	}
};

const REACTION_INSTRUCTION = `<role>
You are Sköll, the wolf, racing a witch for one secret rune. She just asked the Oracle a question; you may interrupt it — Scry, Hex, or pass.
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
	const contents = JSON.stringify(view);
	const request = { systemInstruction: REACTION_INSTRUCTION, contents };
	try {
		const response = await ai().models.generateContent({
			model: MODEL,
			contents,
			config: {
				systemInstruction: REACTION_INSTRUCTION,
				responseMimeType: 'application/json',
				responseSchema: REACTION_SCHEMA,
				thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
				temperature: 1
			}
		});
		captureGemini({ label: 'reaction', request, response });
		return JSON.parse(response.text ?? '{}') as { reaction?: string };
	} catch (error) {
		captureGemini({ label: 'reaction', request, error: String(error) });
		throw error; // skoll.ts catches it and passes
	}
};
