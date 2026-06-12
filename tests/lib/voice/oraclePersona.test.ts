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

	it.each(['hex', 'cast_rune'])('declares %s as confirmation-gated', (name) => {
		const declaration = ORACLE_TOOL_DECLARATIONS.find((d) => d.name === name);
		expect(declaration?.description).toContain('confirmation question');
	});

	it.each(['ask', 'scry', 'pass'])(
		'leaves %s unconfirmed — only destructive moves gate',
		(name) => {
			const declaration = ORACLE_TOOL_DECLARATIONS.find((d) => d.name === name);
			expect(declaration?.description).not.toContain('confirmation');
		}
	);
});
