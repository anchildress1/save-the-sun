// The allow-list for what the TTS route will voice. The browser never sends free text — it sends a
// descriptor (the "line ID"), and the server composes the exact words from the same functions the
// engine path already uses. Anything that does not compose to a server-owned line returns null and
// is refused, so the route can't be spammed for arbitrary Gemini TTS.

import { parseQuery } from '$lib/server/engine/queries';
import { refusalLine, voiceAnswer } from '$lib/server/oracle/oracle';
import { skollAskEcho, skollCastEcho } from '$lib/server/skoll/skoll';
import type { RefusalClass } from '$lib/server/oracle/types';
import { ORACLE_VOICE, SKOLL_VOICE } from '$lib/voice/config';
import { REACTION_LINES, carriesAnswer, type ReactionLineId } from '$lib/voice/reactionLines';
import { CAST_TRUE, CAST_FALTERS, wrongCastLine } from '$lib/voice/castLines';
import { OUTCOME_LINES, type Outcome, type OutcomeBeat } from '$lib/voice/outcomeLines';
import { verifyLine } from './sign';
import { runes } from '$lib/board';

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
	// Sköll's winning cast (a game move, R10): his line composed from the rune he named, validated
	// against the board so the route still voices only a server-owned line — just in his voice.
	| { kind: 'skoll-cast'; rune: unknown }
	// A reaction resolution (Scry/Hex/Pass, ux-copy §3): the fixed framing from REACTION_LINES, plus
	// the overheard answer for the two scry lines (composed from the query, so still server-owned).
	| { kind: 'react'; line: ReactionLineId; query?: unknown; affirmative?: boolean }
	// A cast resolution (ux-copy §4): the true/falters lines are fixed; the wrong line names the rune,
	// validated against the board so the route still voices only a server-owned line.
	| { kind: 'cast'; result: 'true' | 'wrong' | 'falters'; rune?: string }
	// The end-screen outcome (ux-copy §4): one beat of the staged splash copy, voiced in sequence — the
	// win in the Oracle's voice, the loss in Sköll's, so the player hears who took the day.
	| { kind: 'outcome'; result: Outcome; beat: OutcomeBeat }
	// The Oracle's dramatized answer (ttd:17): authored by Gemini per Ask, so it can't be recomposed
	// from a descriptor like the others. The server signs it; this voices only when the signature
	// matches, so the route still admits no arbitrary text — just a server-issued line in her voice.
	| { kind: 'authored'; text: string; voice: string; sig: string };

// Parse a query and bound it to the real board (runes are 1-6); null on anything malformed or
// out-of-range. Shared by the answer, Sköll-ask, and scry composers.
function validBoardQuery(raw: unknown): ReturnType<typeof parseQuery> {
	const query = parseQuery(raw);
	if (query === null) return null;
	if (query.axis === 'power' && (query.value < MIN_POWER || query.value > MAX_POWER)) return null;
	return query;
}

function composeAnswer(raw: unknown, affirmative: unknown): string | null {
	if (typeof affirmative !== 'boolean') return null;
	const query = validBoardQuery(raw);
	return query ? voiceAnswer(query, affirmative) : null;
}

function composeReact(line: ReactionLineId, raw: unknown, affirmative: unknown): string | null {
	// own-property only: an inherited key (e.g. "toString") must not pass the allow-list.
	if (!Object.hasOwn(REACTION_LINES, line)) return null;
	const framing = REACTION_LINES[line];
	if (!carriesAnswer(line)) return framing; // Hex/Pass are framing only
	if (typeof affirmative !== 'boolean') return null;
	const query = validBoardQuery(raw);
	if (query === null) return null;
	const ans = voiceAnswer(query, affirmative);
	// human-scry frames then reveals; skoll-scry reveals then notes he overheard (ux-copy §3).
	return line === 'human-scry' ? `${framing} ${ans}` : `${ans} ${framing}`;
}

function composeCast(result: 'true' | 'wrong' | 'falters', rune: unknown): string | null {
	if (result === 'true') return CAST_TRUE;
	if (result === 'falters') return CAST_FALTERS;
	// wrong: name only a real board rune (the cast path already canonicalizes to one).
	const match = runes.find((r) => r.name === rune);
	return match ? wrongCastLine(match.name) : null;
}

function composeOutcome(result: Outcome, beat: OutcomeBeat): string | null {
	// own-property only on both keys: an inherited key must not resolve to a prototype method.
	if (!Object.hasOwn(OUTCOME_LINES, result)) return null;
	const beats = OUTCOME_LINES[result];
	return Object.hasOwn(beats, beat) ? beats[beat] : null;
}

/** Compose the exact server-owned line for a descriptor, or null when it is not allow-listed. */
export function composeLine(descriptor: LineDescriptor): string | null {
	switch (descriptor.kind) {
		case 'refusal':
			return REFUSAL_CLASSES.has(descriptor.refusal as RefusalClass)
				? refusalLine(descriptor.refusal as RefusalClass)
				: null;
		case 'answer':
			return composeAnswer(descriptor.query, descriptor.affirmative);
		case 'skoll-ask': {
			const query = validBoardQuery(descriptor.query);
			return query ? skollAskEcho(query) : null;
		}
		case 'skoll-cast': {
			// Name only a real board rune (the cast path already canonicalizes to one).
			const match = runes.find((r) => r.name === descriptor.rune);
			return match ? skollCastEcho(match.name) : null;
		}
		case 'react':
			return composeReact(descriptor.line, descriptor.query, descriptor.affirmative);
		case 'cast':
			return composeCast(descriptor.result, descriptor.rune);
		case 'outcome':
			return composeOutcome(descriptor.result, descriptor.beat);
		case 'authored':
			// The gate: voice the authored line only when the server's signature matches it exactly.
			return verifyLine(descriptor.voice, descriptor.text, descriptor.sig) ? descriptor.text : null;
	}
}

/** Which prebuilt voice speaks a descriptor — Sköll's lines (his Ask, the loss) in his voice,
 *  everything else the Oracle's. */
export function voiceForLine(descriptor: LineDescriptor): string {
	// An authored line carries its own (signature-bound) voice — composeLine has already verified it by
	// the time the route reads this, so it's trusted here.
	if (descriptor.kind === 'authored') return descriptor.voice;
	const skoll =
		descriptor.kind === 'skoll-ask' ||
		descriptor.kind === 'skoll-cast' ||
		(descriptor.kind === 'outcome' && descriptor.result === 'lose');
	return skoll ? SKOLL_VOICE : ORACLE_VOICE;
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
	const direction =
		voiceForLine(descriptor) === SKOLL_VOICE ? SKOLL_TTS_DIRECTION : ORACLE_TTS_DIRECTION;
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
		case 'skoll-cast':
			return 'rune' in v;
		case 'react':
			return typeof v.line === 'string';
		case 'cast':
			return typeof v.result === 'string';
		case 'outcome':
			return typeof v.result === 'string' && typeof v.beat === 'string';
		case 'authored':
			return typeof v.text === 'string' && typeof v.voice === 'string' && typeof v.sig === 'string';
		default:
			return false;
	}
}
