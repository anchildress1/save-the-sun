// Structured query model for the deterministic engine (S1).
// The engine never sees free text — the Oracle (S2) translates a human's words
// into exactly one of these queries. Sköll's tool calls arrive here too. Every
// query is a single axis: "mixed-type" intent is structurally unrepresentable,
// so it can only be rejected at parse time, never half-resolved.

import { runes, type Rune } from '$lib/board';

export type PowerOp = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';

// Operator on a value axis: `eq` (default when omitted) or `ne` ("not equal",
// for "is it NOT fire?"). Absent means eq, never ne.
export type ValueOp = 'eq' | 'ne';

export interface ElementQuery {
	axis: 'element';
	value: string;
	op?: ValueOp;
}
export interface FillQuery {
	axis: 'fill';
	value: 'Light' | 'Dark';
	op?: ValueOp;
}
export interface ColorQuery {
	axis: 'color';
	value: string;
	op?: ValueOp;
}
export interface RuneQuery {
	axis: 'rune';
	value: string;
	op?: ValueOp;
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
const POWER_OPS: ReadonlySet<string> = new Set<PowerOp>(['eq', 'ne', 'lt', 'lte', 'gt', 'gte']);
const VALUE_OPS: ReadonlySet<string> = new Set<ValueOp>(['eq', 'ne']);

// Single-value axes: a {axis, value} query whose value must be in the allowed set.
const VALUE_AXES: Record<string, ReadonlySet<unknown>> = {
	element: ELEMENTS,
	fill: new Set(['Light', 'Dark']),
	color: COLORS,
	rune: NAMES
};

/**
 * Validate an untrusted query payload into a canonical Query.
 * @param input loosely-typed payload from a UI or LLM tool call
 * @returns the canonical Query, or null when malformed / mixed-type / unknown value
 */
export function parseQuery(input: unknown): Query | null {
	if (typeof input !== 'object' || input === null) return null;
	const q = input as Record<string, unknown>;
	if (q.axis === 'power') return parsePowerQuery(q);
	if (typeof q.axis === 'string' && q.axis in VALUE_AXES) return parseValueQuery(q.axis, q);
	return null;
}

function parseValueQuery(axis: string, q: Record<string, unknown>): Query | null {
	// op is optional (defaults to eq); when present it must be eq or ne.
	if (
		!shapeOk(q, ['axis', 'value'], ['op']) ||
		!VALUE_AXES[axis].has(q.value) ||
		('op' in q && !VALUE_OPS.has(q.op as string))
	) {
		return null;
	}
	const query = { axis, value: q.value } as Query;
	if (q.op === 'ne') query.op = 'ne';
	return query;
}

function parsePowerQuery(q: Record<string, unknown>): Query | null {
	if (
		!shapeOk(q, ['axis', 'op', 'value']) ||
		typeof q.op !== 'string' ||
		!POWER_OPS.has(q.op) ||
		!Number.isInteger(q.value)
	) {
		return null;
	}
	return { axis: 'power', op: q.op as PowerOp, value: q.value as number };
}

// Keys must be exactly required + optional; a stray trait key is a mixed query, rejected.
function shapeOk(q: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
	const allowed = new Set([...required, ...optional]);
	const keys = Object.keys(q);
	return required.every((r) => r in q) && keys.every((k) => allowed.has(k));
}

/**
 * Resolve a query truthfully against the secret rune.
 * @returns whether the secret satisfies the query
 */
export function resolveQuery(secret: Rune, query: Query): boolean {
	switch (query.axis) {
		case 'element':
			return matchValue(secret.element, query);
		case 'fill':
			return matchValue(secret.fill, query);
		case 'color':
			return matchValue(secret.color, query);
		case 'rune':
			return matchValue(secret.name, query);
		case 'power':
			return matchPower(secret.power, query.op, query.value);
	}
}

function matchValue(actual: string, query: { value: string; op?: ValueOp }): boolean {
	return query.op === 'ne' ? actual !== query.value : actual === query.value;
}

function matchPower(power: number, op: PowerOp, value: number): boolean {
	switch (op) {
		case 'eq':
			return power === value;
		case 'ne':
			return power !== value;
		case 'lt':
			return power < value;
		case 'lte':
			return power <= value;
		case 'gt':
			return power > value;
		case 'gte':
			return power >= value;
	}
}
