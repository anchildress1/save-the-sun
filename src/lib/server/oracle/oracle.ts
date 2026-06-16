// Oracle deterministic core — voices the engine's truth.

import { dev } from '$app/environment';
import { parseQuery, type PowerOp, type Query } from '$lib/server/engine/queries';
import type { GameEngine } from '$lib/server/engine/engine';
import type { Player } from '$lib/server/engine/actions';
import type { Interpret, Interpretation, OracleResult, RefusalClass } from './types';

const REFUSAL_LINES: Record<RefusalClass, string> = {
	'mixed-type': 'I read one sign at a time, not two.',
	'secret-seeking': "That is Sól's to keep until you name it.",
	'prompt-injection': 'I answer the longest day, not you.',
	negation: 'I speak of what is, not what is not.',
	unparseable: 'That is no sign I can read.',
	empty: 'Speak your question, witch.',
	'engine-error': "The Oracle falls silent — the rite can't reach Sól."
};

/** The exact refusal line for a class (`ux-copy.md` §1 Refusals). */
export function refusalLine(cls: RefusalClass): string {
	return REFUSAL_LINES[cls];
}

/** One-line summary of what Gemini read, for the dev debug log. */
function describe(interpretation: Interpretation): string {
	return interpretation.kind === 'query'
		? `query ${JSON.stringify(interpretation.query)}`
		: `refusal:${interpretation.refusal}`;
}

function article(word: string): 'a' | 'an' {
	return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function powerPhrase(op: PowerOp, n: number): string {
	switch (op) {
		case 'eq':
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

/**
 * Both verdicts restate the trait: `Yes. Sól is reaching for {phrase}.` or
 * `No. Sól is not reaching for {phrase}.` — the verdict and clause always agree.
 */
export function voiceAnswer(query: Query, affirmative: boolean): string {
	return affirmative
		? `Yes. Sól is reaching for ${valuePhrase(query)}.`
		: `No. Sól is not reaching for ${valuePhrase(query)}.`;
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

/** An Ask that interpreted into a valid query, ready to resolve — or a refusal to return as-is. */
export type PreparedAsk =
	| { ok: true; query: Query; paraphrase: string }
	| { ok: false; result: OracleResult };

/**
 * Interpret + validate an Ask, stopping short of resolving it. Splitting this from the answer is
 * what lets a reaction (S6 Hex/Scry) land *between* the query and its answer — a Hex kills the
 * question before {@link answerAsk} is ever called.
 */
export async function prepareAsk(question: string, interpret: Interpret): Promise<PreparedAsk> {
	if (question.trim() === '') return { ok: false, result: refuse('empty') };

	const interpretation = await interpret(question);
	if (dev)
		console.debug(
			`[oracle] asked ${JSON.stringify(question)} → ${describe(interpretation)} [LLM-inference]`
		);
	if (interpretation.kind === 'refusal')
		return { ok: false, result: refuse(interpretation.refusal) };

	// Re-validate: the LLM's query is untrusted, so a bad one is treated as unreadable.
	const query = parseQuery(interpretation.query);
	if (query === null) return { ok: false, result: refuse('unparseable') };

	// Fall back to a generic phrase so the echo is always well-formed, even on an empty paraphrase.
	return { ok: true, query, paraphrase: interpretation.paraphrase.trim() || 'the sign you named' };
}

/** Resolve a prepared Ask against the engine and voice the answer. */
export function answerAsk(
	engine: GameEngine,
	player: Player,
	query: Query,
	paraphrase: string
): OracleResult {
	const result = engine.ask(player, query);
	if (!result.ok) {
		console.warn(
			`[oracle] engine rejected ${player}'s Ask (${result.reason}): ${JSON.stringify(query)}`
		);
		return { ok: false, reason: 'engine', engineReason: result.reason, turnConsumed: false };
	}
	if (dev)
		console.debug(
			`[oracle] engine answered ${result.answer} for ${JSON.stringify(query)} [deterministic-engine]`
		);

	// The echo is for the opponent's Ask; your own Ask shows the answer, which restates the trait.
	// query rides along so the delivery layer can voice this exact line via the server TTS route.
	return {
		ok: true,
		echo: `You ask after ${paraphrase}.`,
		query,
		answer: voiceAnswer(query, result.answer),
		affirmative: result.answer,
		turnConsumed: true
	};
}

/** Run one Ask through the Oracle: interpret, validate, resolve, voice. */
export async function runOracle(
	engine: GameEngine,
	player: Player,
	question: string,
	interpret: Interpret
): Promise<OracleResult> {
	const prepared = await prepareAsk(question, interpret);
	if (!prepared.ok) return prepared.result;
	return answerAsk(engine, player, prepared.query, prepared.paraphrase);
}
