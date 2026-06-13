import { describe, expect, it } from 'vitest';
import { ORACLE_SYSTEM_INSTRUCTION, ORACLE_TOOL_DECLARATIONS } from '$lib/voice/oraclePersona';

// S8 (R4): the gate is client-side, but the model must be TAUGHT the confidence contract or it
// either over-confirms (the echo the player tired of) or never asks when it should. These pin
// the persona's half so a rewrite can't silently drop it.
describe('Oracle persona — destructive confirmation (S8)', () => {
	it('carries the irreversibility doctrine', () => {
		expect(ORACLE_SYSTEM_INSTRUCTION).toContain('what is written in fire does not unwrite');
	});

	it('teaches the model to score its certainty so a sure reading skips the echo', () => {
		expect(ORACLE_SYSTEM_INSTRUCTION).toContain('Give a confidence from 0 to 1');
		expect(ORACLE_SYSTEM_INSTRUCTION).toContain('do not make her repeat herself');
	});

	// Scry joined the gate (2026-06-12): it spends the night's single use, same stake as the hex.
	it.each(['scry', 'hex', 'cast_rune'])('declares %s as confidence-gated', (name) => {
		const declaration = ORACLE_TOOL_DECLARATIONS.find((d) => d.name === name);
		expect(declaration?.description).toContain('confirmation question');
		// The model must always score its reading, or a missing confidence silently re-arms the gate.
		expect(declaration?.parameters?.required).toContain('confidence');
	});

	it.each(['ask', 'pass'])('leaves %s unconfirmed — free moves never gate', (name) => {
		const declaration = ORACLE_TOOL_DECLARATIONS.find((d) => d.name === name);
		expect(declaration?.description).not.toContain('confirmation');
		expect(declaration?.parameters?.required ?? []).not.toContain('confidence');
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
