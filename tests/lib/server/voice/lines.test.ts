import { describe, expect, it } from 'vitest';
import {
	composeLine,
	isLineDescriptor,
	voiceForLine,
	synthPrompt,
	type LineDescriptor
} from '$lib/server/voice/lines';
import { refusalLine, voiceAnswer } from '$lib/server/oracle/oracle';
import { skollAskEcho } from '$lib/server/skoll/skoll';
import { ORACLE_VOICE, SKOLL_VOICE } from '$lib/voice/config';
import { REACTION_LINES } from '$lib/voice/reactionLines';

describe('composeLine', () => {
	it('voices every refusal class with the canonical line', () => {
		for (const refusal of [
			'mixed-type',
			'secret-seeking',
			'prompt-injection',
			'negation',
			'unparseable',
			'empty',
			'engine-error'
		] as const) {
			expect(composeLine({ kind: 'refusal', refusal })).toBe(refusalLine(refusal));
		}
	});

	it('refuses an unknown refusal class', () => {
		expect(composeLine({ kind: 'refusal', refusal: 'not-a-class' })).toBeNull();
	});

	it('voices a value-axis answer, both verdicts', () => {
		const query = { axis: 'element', value: 'Sun' } as const;
		expect(composeLine({ kind: 'answer', query, affirmative: true })).toBe(
			voiceAnswer(query, true)
		);
		expect(composeLine({ kind: 'answer', query, affirmative: false })).toBe(
			voiceAnswer(query, false)
		);
	});

	it('voices an in-range power answer', () => {
		const query = { axis: 'power', op: 'gte', value: 4 } as const;
		expect(composeLine({ kind: 'answer', query, affirmative: true })).toBe(
			voiceAnswer(query, true)
		);
	});

	it('refuses a power answer outside the rune range (1-6)', () => {
		for (const value of [0, 7, 99]) {
			expect(
				composeLine({
					kind: 'answer',
					query: { axis: 'power', op: 'eq', value },
					affirmative: true
				})
			).toBeNull();
		}
	});

	it('refuses a malformed query', () => {
		expect(
			composeLine({
				kind: 'answer',
				query: { axis: 'element', value: 'Plastic' },
				affirmative: true
			})
		).toBeNull();
		expect(composeLine({ kind: 'answer', query: null, affirmative: true })).toBeNull();
	});

	it('refuses a non-boolean affirmative', () => {
		expect(
			composeLine({
				kind: 'answer',
				query: { axis: 'element', value: 'Sun' },
				affirmative: 'yes'
			} as unknown as LineDescriptor)
		).toBeNull();
	});

	it('voices Sköll’s Ask from the parked query (his own line, not the Oracle’s)', () => {
		const query = { axis: 'element', value: 'Fire' } as const;
		expect(composeLine({ kind: 'skoll-ask', query })).toBe(skollAskEcho(query));
	});

	it('refuses a malformed or out-of-range Sköll Ask query', () => {
		expect(
			composeLine({ kind: 'skoll-ask', query: { axis: 'element', value: 'Plastic' } })
		).toBeNull();
		expect(
			composeLine({ kind: 'skoll-ask', query: { axis: 'power', op: 'eq', value: 9 } })
		).toBeNull();
		expect(composeLine({ kind: 'skoll-ask', query: null })).toBeNull();
	});

	it('voices a framing-only reaction line verbatim', () => {
		expect(composeLine({ kind: 'react', line: 'human-hex' })).toBe(REACTION_LINES['human-hex']);
		expect(composeLine({ kind: 'react', line: 'human-pass' })).toBe(REACTION_LINES['human-pass']);
		expect(composeLine({ kind: 'react', line: 'skoll-hex' })).toBe(REACTION_LINES['skoll-hex']);
	});

	it('composes a scry line with the overheard answer, in §3 order', () => {
		const query = { axis: 'element', value: 'Fire' } as const;
		const ans = voiceAnswer(query, true);
		expect(composeLine({ kind: 'react', line: 'human-scry', query, affirmative: true })).toBe(
			`${REACTION_LINES['human-scry']} ${ans}`
		);
		expect(composeLine({ kind: 'react', line: 'skoll-scry', query, affirmative: true })).toBe(
			`${ans} ${REACTION_LINES['skoll-scry']}`
		);
	});

	it('refuses a scry line without a valid answer, and an unknown reaction line', () => {
		expect(composeLine({ kind: 'react', line: 'human-scry' })).toBeNull();
		expect(
			composeLine({ kind: 'react', line: 'skoll-scry', query: null, affirmative: true })
		).toBeNull();
		expect(composeLine({ kind: 'react', line: 'nope' } as unknown as LineDescriptor)).toBeNull();
	});
});

describe('voiceForLine', () => {
	it('routes Sköll’s Ask to his voice, everything else to the Oracle’s', () => {
		expect(voiceForLine({ kind: 'skoll-ask', query: {} })).toBe(SKOLL_VOICE);
		expect(voiceForLine({ kind: 'refusal', refusal: 'empty' })).toBe(ORACLE_VOICE);
		expect(voiceForLine({ kind: 'answer', query: {}, affirmative: true })).toBe(ORACLE_VOICE);
		expect(voiceForLine({ kind: 'react', line: 'human-hex' })).toBe(ORACLE_VOICE);
	});
});

describe('synthPrompt', () => {
	it('wraps each line in its speaker’s director’s-notes, quoting the line', () => {
		const skoll = synthPrompt({ kind: 'skoll-ask', query: {} }, 'I scent a fire rune on her.');
		const oracle = synthPrompt(
			{ kind: 'refusal', refusal: 'empty' },
			'Speak your question, witch.'
		);
		// Each carries its own direction (distinct) and ends on the quoted line, not the bare line.
		expect(skoll).toContain('"I scent a fire rune on her."');
		expect(skoll).not.toBe('I scent a fire rune on her.');
		expect(oracle).toContain('"Speak your question, witch."');
		expect(skoll.slice(0, 40)).not.toBe(oracle.slice(0, 40)); // different speaker notes
	});
});

describe('isLineDescriptor', () => {
	it('accepts the line kinds', () => {
		expect(isLineDescriptor({ kind: 'refusal', refusal: 'empty' })).toBe(true);
		expect(isLineDescriptor({ kind: 'answer', query: {}, affirmative: true })).toBe(true);
		expect(isLineDescriptor({ kind: 'skoll-ask', query: {} })).toBe(true);
		expect(isLineDescriptor({ kind: 'react', line: 'human-hex' })).toBe(true);
	});

	it('rejects malformed shapes', () => {
		expect(isLineDescriptor(null)).toBe(false);
		expect(isLineDescriptor('refusal')).toBe(false);
		expect(isLineDescriptor({ kind: 'greeting' })).toBe(false);
		expect(isLineDescriptor({ kind: 'unknown' })).toBe(false);
		expect(isLineDescriptor({ kind: 'refusal' })).toBe(false);
		expect(isLineDescriptor({ kind: 'answer', query: {} })).toBe(false);
		expect(isLineDescriptor({ kind: 'skoll-ask' })).toBe(false);
		expect(isLineDescriptor({ kind: 'react' })).toBe(false);
	});
});
