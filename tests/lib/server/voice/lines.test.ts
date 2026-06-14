import { describe, expect, it } from 'vitest';
import {
	composeLine,
	isLineDescriptor,
	voiceForLine,
	type LineDescriptor
} from '$lib/server/voice/lines';
import { refusalLine, voiceAnswer } from '$lib/server/oracle/oracle';
import { skollAskEcho } from '$lib/server/skoll/skoll';
import { ORACLE_VOICE, SKOLL_VOICE } from '$lib/voice/config';

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
});

describe('voiceForLine', () => {
	it('routes Sköll’s Ask to his voice, everything else to the Oracle’s', () => {
		expect(voiceForLine({ kind: 'skoll-ask', query: {} })).toBe(SKOLL_VOICE);
		expect(voiceForLine({ kind: 'refusal', refusal: 'empty' })).toBe(ORACLE_VOICE);
		expect(voiceForLine({ kind: 'answer', query: {}, affirmative: true })).toBe(ORACLE_VOICE);
	});
});

describe('isLineDescriptor', () => {
	it('accepts the three line kinds', () => {
		expect(isLineDescriptor({ kind: 'refusal', refusal: 'empty' })).toBe(true);
		expect(isLineDescriptor({ kind: 'answer', query: {}, affirmative: true })).toBe(true);
		expect(isLineDescriptor({ kind: 'skoll-ask', query: {} })).toBe(true);
	});

	it('rejects malformed shapes', () => {
		expect(isLineDescriptor(null)).toBe(false);
		expect(isLineDescriptor('refusal')).toBe(false);
		expect(isLineDescriptor({ kind: 'greeting' })).toBe(false);
		expect(isLineDescriptor({ kind: 'unknown' })).toBe(false);
		expect(isLineDescriptor({ kind: 'refusal' })).toBe(false);
		expect(isLineDescriptor({ kind: 'answer', query: {} })).toBe(false);
		expect(isLineDescriptor({ kind: 'skoll-ask' })).toBe(false);
	});
});
