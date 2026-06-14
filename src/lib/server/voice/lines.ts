// The allow-list for what the TTS route will voice. The browser never sends free text — it sends a
// descriptor (the "line ID"), and the server composes the exact words from the same functions the
// engine path already uses. Anything that does not compose to a server-owned line returns null and
// is refused, so the route can't be spammed for arbitrary Gemini TTS.

import { parseQuery } from '$lib/server/engine/queries';
import { refusalLine, voiceAnswer } from '$lib/server/oracle/oracle';
import type { RefusalClass } from '$lib/server/oracle/types';

// docs/ux-copy.md §1: the round's first spoken line. The Live persona wrapped these words in a
// stage direction; delivered as audio they are spoken directly.
export const ORACLE_GREETING = 'I wake with the fire.';

const REFUSAL_CLASSES: ReadonlySet<RefusalClass> = new Set([
	'mixed-type',
	'secret-seeking',
	'prompt-injection',
	'negation',
	'unparseable',
	'empty',
	'engine-error'
]);

// The runes span 1-6; an out-of-range power Ask still resolves to a truthful No, but voicing an
// unbounded integer would let a client mint a fresh uncached clip per request. Bound the spoken
// set — the line still renders as text always; only its audio is gated here.
const MAX_POWER = 99;

export type LineDescriptor =
	| { kind: 'greeting' }
	| { kind: 'refusal'; refusal: string }
	| { kind: 'answer'; query: unknown; affirmative: boolean };

/** Compose the exact server-owned line for a descriptor, or null when it is not allow-listed. */
export function composeLine(descriptor: LineDescriptor): string | null {
	switch (descriptor.kind) {
		case 'greeting':
			return ORACLE_GREETING;
		case 'refusal':
			return REFUSAL_CLASSES.has(descriptor.refusal as RefusalClass)
				? refusalLine(descriptor.refusal as RefusalClass)
				: null;
		case 'answer': {
			if (typeof descriptor.affirmative !== 'boolean') return null;
			const query = parseQuery(descriptor.query);
			if (query === null) return null;
			if (query.axis === 'power' && Math.abs(query.value) > MAX_POWER) return null;
			return voiceAnswer(query, descriptor.affirmative);
		}
	}
}

/** Narrow an untrusted payload to a LineDescriptor shape (values still validated by composeLine). */
export function isLineDescriptor(value: unknown): value is LineDescriptor {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	switch (v.kind) {
		case 'greeting':
			return true;
		case 'refusal':
			return typeof v.refusal === 'string';
		case 'answer':
			return 'query' in v && 'affirmative' in v;
		default:
			return false;
	}
}
