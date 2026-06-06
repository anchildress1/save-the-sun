// Structured query model for the deterministic engine (S1).
// The engine never sees free text — the Oracle (S2) translates a human's words
// into exactly one of these queries. Sköll's tool calls arrive here too. Every
// query is a single axis: "mixed-type" intent is structurally unrepresentable,
// so it can only be rejected at parse time, never half-resolved.

import { runes, type Rune } from '$lib/board';

export type PowerOp = 'eq' | 'lt' | 'lte' | 'gt' | 'gte';

export interface ElementQuery {
	axis: 'element';
	value: string;
}
export interface FillQuery {
	axis: 'fill';
	value: 'Light' | 'Dark';
}
export interface ColorQuery {
	axis: 'color';
	value: string;
}
export interface RuneQuery {
	axis: 'rune';
	value: string;
}
export interface PowerQuery {
	axis: 'power';
	op: PowerOp;
	value: number;
}

export type Query = ElementQuery | FillQuery | ColorQuery | RuneQuery | PowerQuery;

const ELEMENTS = new Set(runes.map((r) => r.element));
const COLORS = new Set(runes.map((r) => r.color));
const NAMES = new Set(runes.map((r) => r.name));
const POWER_OPS: ReadonlySet<string> = new Set<PowerOp>(['eq', 'lt', 'lte', 'gt', 'gte']);

/**
 * Validate an untrusted query payload into a canonical Query.
 * @param input loosely-typed payload from a UI or LLM tool call
 * @returns the canonical Query, or null when malformed / mixed-type / unknown value
 */
export function parseQuery(input: unknown): Query | null {
	if (typeof input !== 'object' || input === null) return null;
	const q = input as Record<string, unknown>;
	switch (q.axis) {
		case 'element':
			return onlyKeys(q, 'axis', 'value') && typeof q.value === 'string' && ELEMENTS.has(q.value)
				? { axis: 'element', value: q.value }
				: null;
		case 'fill':
			return onlyKeys(q, 'axis', 'value') && (q.value === 'Light' || q.value === 'Dark')
				? { axis: 'fill', value: q.value }
				: null;
		case 'color':
			return onlyKeys(q, 'axis', 'value') && typeof q.value === 'string' && COLORS.has(q.value)
				? { axis: 'color', value: q.value }
				: null;
		case 'rune':
			return onlyKeys(q, 'axis', 'value') && typeof q.value === 'string' && NAMES.has(q.value)
				? { axis: 'rune', value: q.value }
				: null;
		case 'power':
			return onlyKeys(q, 'axis', 'op', 'value') &&
				typeof q.op === 'string' &&
				POWER_OPS.has(q.op) &&
				Number.isInteger(q.value)
				? { axis: 'power', op: q.op as PowerOp, value: q.value as number }
				: null;
		default:
			return null;
	}
}

/**
 * Whether an object's keys are EXACTLY the allowed set — no missing, no extras. Rejects
 * mixed-type payloads like `{ axis: 'element', value: 'Fire', color: 'Red' }`: a query
 * carries one axis, so a stray trait key is a malformed (mixed) query, not a droppable extra.
 */
function onlyKeys(q: Record<string, unknown>, ...allowed: string[]): boolean {
	const keys = Object.keys(q);
	return keys.length === allowed.length && keys.every((k) => allowed.includes(k));
}

/**
 * Resolve a query truthfully against the secret rune.
 * @returns whether the secret satisfies the query
 */
export function resolveQuery(secret: Rune, query: Query): boolean {
	switch (query.axis) {
		case 'element':
			return secret.element === query.value;
		case 'fill':
			return secret.fill === query.value;
		case 'color':
			return secret.color === query.value;
		case 'rune':
			return secret.name === query.value;
		case 'power':
			switch (query.op) {
				case 'eq':
					return secret.power === query.value;
				case 'lt':
					return secret.power < query.value;
				case 'lte':
					return secret.power <= query.value;
				case 'gt':
					return secret.power > query.value;
				case 'gte':
					return secret.power >= query.value;
			}
	}
}

/** Canonical key for already-asked tracking. Two queries collide iff they ask the same thing. */
export function queryKey(query: Query): string {
	return query.axis === 'power'
		? `power:${query.op}:${query.value}`
		: `${query.axis}:${query.value}`;
}
