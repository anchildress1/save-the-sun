// Structured query model for the deterministic engine.
// The engine never sees free text — the Oracle translates a human's words
// into exactly one of these queries. Sköll's tool calls arrive here too. Every
// query is a single axis: "mixed-type" intent is structurally unrepresentable,
// so it can only be rejected at parse time, never half-resolved.

import { runes, type Rune } from '$lib/board';

// Power comparisons only. There is no negation operator — the Oracle answers what
// IS, so a negated Ask ("is it not fire?") is refused, never turned into a query.
export type PowerOp = 'eq' | 'lt' | 'lte' | 'gt' | 'gte';

// The closed sets the engine referees on — exported as the single source for the Gemini schemas and
// prompts, so what the models are told can't drift from what parseQuery accepts. Mutable arrays (not
// `as const`) so they pass straight into the response schema's `enum`, which wants a string[].
export const POWER_OPS: PowerOp[] = ['eq', 'lt', 'lte', 'gt', 'gte'];
export const FILLS: string[] = ['Light', 'Dark'];

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
const POWER_OP_SET: ReadonlySet<string> = new Set(POWER_OPS);

const VALUE_AXES: Record<string, ReadonlySet<unknown>> = {
	element: ELEMENTS,
	fill: new Set(FILLS),
	color: COLORS,
	rune: NAMES
};

/** The flat field shape both LLM adapters (Oracle + Sköll) return — one Query spread across columns. */
export interface QueryFields {
	axis?: string;
	elementValue?: string;
	colorValue?: string;
	fillValue?: 'Light' | 'Dark';
	runeName?: string;
	powerOp?: PowerOp;
	powerValue?: number;
}

/**
 * Map an LLM adapter's flat tool-call fields into one Query by its axis, or null if the axis's value
 * is absent. Shape only — the caller still re-validates with {@link parseQuery} (LLM output is untrusted).
 */
export function queryFromFields(raw: QueryFields): Query | null {
	switch (raw.axis) {
		case 'element':
			return raw.elementValue ? { axis: 'element', value: raw.elementValue } : null;
		case 'color':
			return raw.colorValue ? { axis: 'color', value: raw.colorValue } : null;
		case 'fill':
			return raw.fillValue ? { axis: 'fill', value: raw.fillValue } : null;
		case 'rune':
			return raw.runeName ? { axis: 'rune', value: raw.runeName } : null;
		case 'power':
			return raw.powerOp && typeof raw.powerValue === 'number'
				? { axis: 'power', op: raw.powerOp, value: raw.powerValue }
				: null;
		default:
			return null;
	}
}

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
	if (!shapeOk(q, 'axis', 'value') || !VALUE_AXES[axis].has(q.value)) return null;
	return { axis, value: q.value } as Query;
}

function parsePowerQuery(q: Record<string, unknown>): Query | null {
	if (
		!shapeOk(q, 'axis', 'op', 'value') ||
		typeof q.op !== 'string' ||
		!POWER_OP_SET.has(q.op) ||
		!Number.isInteger(q.value)
	) {
		return null;
	}
	return { axis: 'power', op: q.op as PowerOp, value: q.value as number };
}

// Keys must be exactly the allowed set — no missing, no extras. A stray trait key makes a
// mixed query (e.g. `{axis:'element', value, color}`); reject it rather than half-resolve.
function shapeOk(q: Record<string, unknown>, ...allowed: string[]): boolean {
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

function matchValue(actual: string, query: { value: string }): boolean {
	return actual === query.value;
}

function matchPower(power: number, op: PowerOp, value: number): boolean {
	switch (op) {
		case 'eq':
			return power === value;
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
