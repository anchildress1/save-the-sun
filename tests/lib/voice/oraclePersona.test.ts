import { describe, expect, it } from 'vitest';
import { ORACLE_SYSTEM_INSTRUCTION, ORACLE_TOOL_DECLARATIONS } from '$lib/voice/oraclePersona';

// S8 (R4): the gate is client-side, but the model must be TAUGHT the exchange or every
// destructive move costs an extra round-trip of confusion. These pin the persona's half
// of the contract so a rewrite can't silently drop it.
describe('Oracle persona — destructive confirmation (S8)', () => {
	it('carries the irreversibility doctrine', () => {
		expect(ORACLE_SYSTEM_INSTRUCTION).toContain('what is written in fire does not unwrite');
	});

	it('teaches the two-call confirmation exchange', () => {
		expect(ORACLE_SYSTEM_INSTRUCTION).toContain('demands her word twice');
	});

	// Scry joined the gate (2026-06-12): it spends the night's single use, same stake as the hex.
	it.each(['scry', 'hex', 'cast_rune'])('declares %s as confirmation-gated', (name) => {
		const declaration = ORACLE_TOOL_DECLARATIONS.find((d) => d.name === name);
		expect(declaration?.description).toContain('confirmation question');
	});

	it.each(['ask', 'pass'])('leaves %s unconfirmed — free moves never gate', (name) => {
		const declaration = ORACLE_TOOL_DECLARATIONS.find((d) => d.name === name);
		expect(declaration?.description).not.toContain('confirmation');
	});
});

// TTD 14: asking a new question while his question hangs IS a pass — she should never have to
// say the word. The deterministic behavior lives in the executor (auto-pass + ask); these pin the
// persona's half so the model voices it as one fluent move, not a refusal to act.
describe('Oracle persona — a new question is an implicit pass (TTD 14)', () => {
	it('teaches that a new question while his hangs is itself a pass', () => {
		expect(ORACLE_SYSTEM_INSTRUCTION).toContain('that itself is a pass: call ask');
	});

	it('tells her she never has to say the word pass', () => {
		expect(ORACLE_SYSTEM_INSTRUCTION).toContain('She never has to say the word "pass"');
	});

	it('shows a worked example of a new question passing his and answering hers', () => {
		expect(ORACLE_SYSTEM_INSTRUCTION).toContain('a new question is itself a pass: calls ask');
	});

	it('declares pass as wordless, with a new ask routing to ask not pass', () => {
		const pass = ORACLE_TOOL_DECLARATIONS.find((d) => d.name === 'pass');
		expect(pass?.description).toContain('that new ask is itself the pass, so call ask, not this');
		// The S8 free-tool invariant still holds: pass never gates.
		expect(pass?.description).not.toContain('confirmation');
	});
});
