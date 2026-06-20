// Sköll's Gemini brain — decides his move. skoll.ts re-validates everything and drops to the floor on
// any failure. Prompt tuned for Flash (XML sections, negative constraints, a few-shot anchor): keep him
// playing DOWN to a ~12-year-old, not solving. Pace comes from the lite tier (see MODEL), not the prompt.

import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { env } from '$env/dynamic/private';
import { ELEMENTS, COLORS, RUNE_NAMES as NAMES } from '$lib/board';
import { captureGemini } from '$lib/server/debug/log';
import { queryFromFields, POWER_OPS, FILLS, type PowerOp } from '$lib/server/engine/queries';
import type {
	RawSkollDecision,
	SkollDecide,
	SkollPayload,
	SkollReactionDecide,
	SkollReactionView
} from './skoll';

// Flash-LITE on purpose: full Flash narrowed in ~5 questions and ignored every slow-down instruction.
// A weaker model plays looser, hunch-driven, like the twelve-year-old he's meant to be. (The Oracle is
// the opposite case — it parses, so it runs full gemini-3.5-flash; the lite tier is Sköll's alone.)
const MODEL = 'gemini-3.1-flash-lite';

const SYSTEM_INSTRUCTION = `<role>
You are Sköll, the wolf who hunts the sun, racing a witch to name one secret rune among the 24 on the board. You are an impatient twelve-year-old, playing out loud.
</role>

<how_you_play>
- Read your answers so far first. They tell you what is already settled; everything else is still open.
- Call out ONE open thing and ask if that is it — and change what KIND you call each turn in a random order: a colour, then a rune you'd point at, then a power, then an element. "The gold rune?", "Is it Sowilo?", "Exactly four power?", "A fire one?" Each question is fresh, about something your answers leave open.
- Cross off the runes the answer rules out (their ids in crossOff — your sheet), and move to the next open thing.
- The "standing" list is the runes still alive — the only ones it can still be. Keep asking until just a few remain, then name one of THOSE.
- You go on your own answers and your sheet alone, and you read the board as it lies.
</how_you_play>

<examples>
- Fresh board → open on whatever you'd shout, and not the same kind each round: "The gold rune, that one's mine" (a colour), or "Is it Sowilo?" (a rune you'd bet on).
- Came back not gold → cross off the gold runes, then switch the kind: "Exactly four power?", or "A fire one?" — never the same kind of question you just asked.
- Still a crowd → keep changing it up: a rune this turn, an element the next, a power after.
- A rune or two left → name one.
</examples>

<move>
Return exactly ONE move, plus any crossOff ids:
- ask — set axis and its value:
  - color: ${COLORS.join(', ')}
  - rune: one of ${NAMES.join(', ')}
  - power: an integer 1-6 with an operator (${POWER_OPS.join(', ')})
  - element: ${ELEMENTS.join(', ')}
  - fill: ${FILLS.join(' or ')}
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

// Map the flat schema response into a (still untrusted) decision. skoll.ts validates the rest.
function normalize(raw: RawResponse): RawSkollDecision {
	if (raw.kind === 'cast') return { kind: 'cast', runeName: raw.runeName, crossOff: raw.crossOff };
	return { kind: 'ask', query: queryFromFields(raw) ?? undefined, crossOff: raw.crossOff };
}

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
	// 1 attempt; limiter-level throttles keep abuse down and prevent retry amplification.
	client ??= new GoogleGenAI({
		apiKey: env.GEMINI_API_KEY,
		httpOptions: { retryOptions: { attempts: 1 } }
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
			? `\n\nNothing learned yet. You woke set on ${hunch} this round — open there, or on any one colour, rune, power, or element you would call out.`
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
				// LOW threads the needle: MINIMAL made the lite model spin (90+ turn games); MEDIUM stopped
				// the spin but sharpened him to ~6 turns (under the window). LOW is enough to track his sheet,
				// not enough to optimize — aiming the pace back into 7.5–9.
				thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
				temperature: 0.7
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
				// Same as the move: minimal thinking + a calmer temperature (was 1) so Pass stays the common
				// answer (the prompt's intent) instead of a coin-flip that over-spends his one Scry/Hex.
				thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
				temperature: 0.4
			}
		});
		captureGemini({ label: 'reaction', request, response });
		return JSON.parse(response.text ?? '{}') as { reaction?: string };
	} catch (error) {
		captureGemini({ label: 'reaction', request, error: String(error) });
		throw error; // skoll.ts catches it and passes
	}
};
