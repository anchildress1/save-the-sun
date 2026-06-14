// The allow-list for what the TTS route will voice. The browser never sends free text — it sends a
// descriptor (the "line ID"), and the server composes the exact words from the same functions the
// engine path already uses. Anything that does not compose to a server-owned line returns null and
// is refused, so the route can't be spammed for arbitrary Gemini TTS.

import { parseQuery } from '$lib/server/engine/queries';
import { refusalLine, voiceAnswer } from '$lib/server/oracle/oracle';
import { skollAskEcho } from '$lib/server/skoll/skoll';
import type { RefusalClass } from '$lib/server/oracle/types';
import { ORACLE_VOICE, SKOLL_VOICE } from '$lib/voice/config';
import { REACTION_LINES, carriesAnswer, type ReactionLineId } from '$lib/voice/reactionLines';

const REFUSAL_CLASSES: ReadonlySet<RefusalClass> = new Set([
	'mixed-type',
	'secret-seeking',
	'prompt-injection',
	'negation',
	'unparseable',
	'empty',
	'engine-error'
]);

// Runes span power 1-6, so only that range is ever voiced. An out-of-range power Ask still renders
// as text and resolves truthfully — bounding the spoken set to the real board keeps the cached clip
// library small and stops a client minting unbounded uncached clips (cache/key burn).
const MIN_POWER = 1;
const MAX_POWER = 6;

export type LineDescriptor =
	| { kind: 'refusal'; refusal: string }
	| { kind: 'answer'; query: unknown; affirmative: boolean }
	// Sköll's Ask (a game move, R10): his first-person line composed from the same query the engine
	// parked, so the route still voices only a server-owned line — never arbitrary client text.
	| { kind: 'skoll-ask'; query: unknown }
	// A reaction resolution (Scry/Hex/Pass, ux-copy §3): the fixed framing from REACTION_LINES, plus
	// the overheard answer for the two scry lines (composed from the query, so still server-owned).
	| { kind: 'react'; line: ReactionLineId; query?: unknown; affirmative?: boolean };

// Bound a power query to the real board (runes are 1-6), shared by the answer and scry composers.
function powerInRange(query: ReturnType<typeof parseQuery>): boolean {
	return !(query?.axis === 'power' && (query.value < MIN_POWER || query.value > MAX_POWER));
}

/** Compose the exact server-owned line for a descriptor, or null when it is not allow-listed. */
export function composeLine(descriptor: LineDescriptor): string | null {
	switch (descriptor.kind) {
		case 'refusal':
			return REFUSAL_CLASSES.has(descriptor.refusal as RefusalClass)
				? refusalLine(descriptor.refusal as RefusalClass)
				: null;
		case 'answer': {
			if (typeof descriptor.affirmative !== 'boolean') return null;
			const query = parseQuery(descriptor.query);
			if (query === null) return null;
			if (query.axis === 'power' && (query.value < MIN_POWER || query.value > MAX_POWER))
				return null;
			return voiceAnswer(query, descriptor.affirmative);
		}
		case 'skoll-ask': {
			const query = parseQuery(descriptor.query);
			if (query === null) return null;
			if (query.axis === 'power' && (query.value < MIN_POWER || query.value > MAX_POWER))
				return null;
			return skollAskEcho(query);
		}
		case 'react': {
			const id = descriptor.line;
			if (!(id in REACTION_LINES)) return null;
			const framing = REACTION_LINES[id];
			// Hex/Pass are framing only; the two scry lines lead/trail the overheard answer.
			if (!carriesAnswer(id)) return framing;
			if (typeof descriptor.affirmative !== 'boolean') return null;
			const query = parseQuery(descriptor.query);
			if (query === null || !powerInRange(query)) return null;
			const ans = voiceAnswer(query, descriptor.affirmative);
			// human-scry frames then reveals; skoll-scry reveals then notes he overheard (ux-copy §3).
			return id === 'human-scry' ? `${framing} ${ans}` : `${ans} ${framing}`;
		}
	}
}

/** Which prebuilt voice speaks a descriptor — Sköll's lines in his voice, everything else the Oracle's. */
export function voiceForLine(descriptor: LineDescriptor): string {
	return descriptor.kind === 'skoll-ask' ? SKOLL_VOICE : ORACLE_VOICE;
}

// Director's-notes prompts the TTS model reads as a delivery instruction, speaking only the quoted
// line. A bare line reads flat and generic — the same model says it in two unmistakable registers
// only when each line carries its speaker's note. These shape the two prebuilt voices into character.
const SKOLL_TTS_DIRECTION =
	'Read this line as Sköll, the monstrous wolf who hunts the sun. Deep, gravelly, guttural — a low ' +
	'chest growl, cold and predatory, heavy with menace, never bright or smooth. Keep it clipped. ' +
	'Speak only the line, no narration:';

const ORACLE_TTS_DIRECTION =
	'Read this line as the Oracle, keeper of the rite. Reverent, calm, and certain, with quiet weight ' +
	'— but at a natural, brisk speaking pace; do not slow down, drag, or pause between words, and ' +
	'never sound bright, chatty, or sing-song. She knows the answer before it is asked. Speak only ' +
	'the line, no narration:';

/**
 * The exact text handed to the TTS model for a composed line: each line wrapped in its speaker's
 * director's-notes so the model voices it in character (Sköll's growl, the Oracle's ceremony).
 * Deterministic, so the route can cache by it.
 */
export function synthPrompt(descriptor: LineDescriptor, line: string): string {
	const direction = descriptor.kind === 'skoll-ask' ? SKOLL_TTS_DIRECTION : ORACLE_TTS_DIRECTION;
	return `${direction}\n\n"${line}"`;
}

/** Narrow an untrusted payload to a LineDescriptor shape (values still validated by composeLine). */
export function isLineDescriptor(value: unknown): value is LineDescriptor {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	switch (v.kind) {
		case 'refusal':
			return typeof v.refusal === 'string';
		case 'answer':
			return 'query' in v && 'affirmative' in v;
		case 'skoll-ask':
			return 'query' in v;
		case 'react':
			return typeof v.line === 'string';
		default:
			return false;
	}
}
