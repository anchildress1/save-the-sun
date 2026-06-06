// Oracle deterministic core (S2) — voices the engine's truth, per `ux-copy.md` §1.

import { parseQuery, type PowerOp, type Query } from '$lib/server/engine/queries';
import type { GameEngine } from '$lib/server/engine/engine';
import type { Player } from '$lib/server/engine/actions';
import type { Interpret, OracleResult, RefusalClass } from './types';

const REFUSAL_LINES: Record<RefusalClass, string> = {
	'mixed-type':
		'I read one sign at a time. Ask of fire, or power, or light, or hue — not two at once.',
	'secret-seeking': "That is Sól's to keep until you name it. I will not say.",
	'prompt-injection': 'I answer the longest day, not you. Ask of the runes.',
	unparseable: 'I cannot read that sign. Ask of element, power, light, or hue.',
	empty: 'Speak your question, witch.',
	'engine-error': "The fire gutters — the rite can't reach Sól. Draw breath and try again."
};

/** The exact refusal line for a class (`ux-copy.md` §1 Refusals). */
export function refusalLine(cls: RefusalClass): string {
	return REFUSAL_LINES[cls];
}

function article(word: string): 'a' | 'an' {
	return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function powerPhrase(op: PowerOp, n: number): string {
	switch (op) {
		case 'eq':
		case 'ne':
			return `a rune of ${n} power`;
		case 'lt':
			return `a rune of fewer than ${n} power`;
		case 'lte':
			return `a rune of ${n} or fewer power`;
		case 'gt':
			return `a rune of more than ${n} power`;
		case 'gte':
			return `a rune of ${n} or more power`;
	}
}

/** The `{value-phrase}` a Yes is built around, per axis (`ux-copy.md` §1). */
export function valuePhrase(query: Query): string {
	switch (query.axis) {
		case 'element':
			return `${article(query.value)} ${query.value.toLowerCase()} rune`;
		case 'color':
			return `${article(query.value)} ${query.value.toLowerCase()} rune`;
		case 'fill':
			return `a ${query.value.toLowerCase()} rune`;
		case 'rune':
			return query.value;
		case 'power':
			return powerPhrase(query.op, query.value);
	}
}

/** Yes restates the trait; No is bare. A `ne` query flips Yes to "is not reaching for". */
export function voiceAnswer(query: Query, affirmative: boolean): string {
	if (!affirmative) return 'No.';
	const reach = query.op === 'ne' ? 'is not reaching for' : 'is reaching for';
	return `Yes. Sól ${reach} ${valuePhrase(query)}.`;
}

function refuse(cls: RefusalClass): OracleResult {
	return {
		ok: false,
		reason: 'refusal',
		refusal: cls,
		line: REFUSAL_LINES[cls],
		turnConsumed: false
	};
}

/** Run one Ask through the Oracle: interpret, validate, resolve, voice. */
export async function runOracle(
	engine: GameEngine,
	player: Player,
	question: string,
	interpret: Interpret
): Promise<OracleResult> {
	if (question.trim() === '') return refuse('empty');

	const interpretation = await interpret(question);
	if (interpretation.kind === 'refusal') return refuse(interpretation.refusal);

	// Re-validate: the LLM's query is untrusted, so a bad one is treated as unreadable.
	const query = parseQuery(interpretation.query);
	if (query === null) return refuse('unparseable');

	const result = engine.ask(player, query);
	if (!result.ok) {
		return { ok: false, reason: 'engine', engineReason: result.reason, turnConsumed: false };
	}

	// Fall back to a generic phrase so the echo frame is always well-formed, even
	// if the LLM returns an empty paraphrase.
	const paraphrase = interpretation.paraphrase.trim() || 'the sign you named';
	return {
		ok: true,
		echo: `You ask after ${paraphrase}.`,
		answer: voiceAnswer(query, result.answer),
		affirmative: result.answer,
		turnConsumed: true
	};
}
