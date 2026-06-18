import { describe, expect, it } from 'vitest';
import {
	composeLine,
	isLineDescriptor,
	voiceForLine,
	synthPrompt,
	type LineDescriptor
} from '$lib/server/voice/lines';
import { refusalLine, voiceAnswer } from '$lib/server/oracle/oracle';
import { skollAskEcho, skollCastEcho } from '$lib/server/skoll/skoll';
import { ORACLE_VOICE, SKOLL_VOICE } from '$lib/voice/config';
import { REACTION_LINES } from '$lib/voice/reactionLines';
import { CAST_TRUE, CAST_FALTERS, wrongCastLine } from '$lib/voice/castLines';
import { OUTCOME_LINES } from '$lib/voice/outcomeLines';

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

	it('voices Sköll’s winning cast from the named rune (his own line)', () => {
		expect(composeLine({ kind: 'skoll-cast', rune: 'Sowilo' })).toBe(skollCastEcho('Sowilo'));
	});

	it('refuses a Sköll cast that names no real board rune', () => {
		expect(composeLine({ kind: 'skoll-cast', rune: 'Plastic' })).toBeNull();
		expect(composeLine({ kind: 'skoll-cast', rune: '' })).toBeNull();
		expect(composeLine({ kind: 'skoll-cast', rune: null })).toBeNull();
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

	it('voices the fixed cast lines and a wrong cast naming a real board rune', () => {
		expect(composeLine({ kind: 'cast', result: 'true' })).toBe(CAST_TRUE);
		expect(composeLine({ kind: 'cast', result: 'falters' })).toBe(CAST_FALTERS);
		expect(composeLine({ kind: 'cast', result: 'wrong', rune: 'Sowilo' })).toBe(
			wrongCastLine('Sowilo')
		);
	});

	it('refuses a wrong cast that does not name a real board rune', () => {
		expect(composeLine({ kind: 'cast', result: 'wrong', rune: 'Plastic' })).toBeNull();
		expect(composeLine({ kind: 'cast', result: 'wrong' })).toBeNull();
	});

	it('voices each staged outcome beat (the win lead is spoken at cast, not here)', () => {
		expect(composeLine({ kind: 'outcome', result: 'win', beat: 'verse' })).toBe(
			OUTCOME_LINES.win.verse
		);
		expect(composeLine({ kind: 'outcome', result: 'win', beat: 'coda' })).toBe(
			OUTCOME_LINES.win.coda
		);
		expect(composeLine({ kind: 'outcome', result: 'lose', beat: 'lead' })).toBe(
			OUTCOME_LINES.lose.lead
		);
		expect(composeLine({ kind: 'outcome', result: 'lose', beat: 'verse' })).toBe(
			OUTCOME_LINES.lose.verse
		);
		expect(composeLine({ kind: 'outcome', result: 'lose', beat: 'coda' })).toBe(
			OUTCOME_LINES.lose.coda
		);
	});

	it('rejects an inherited-property beat — only lead/verse/coda compose', () => {
		expect(
			composeLine({ kind: 'outcome', result: 'win', beat: 'toString' } as unknown as LineDescriptor)
		).toBeNull();
	});

	// Allow-list IDs are matched by own-property only — an inherited key (e.g. a prototype method
	// name) must be rejected with null, never resolve to a function the route would synthesize.
	it('rejects an inherited-property id for react and outcome', () => {
		expect(
			composeLine({ kind: 'react', line: 'toString' } as unknown as LineDescriptor)
		).toBeNull();
		expect(
			composeLine({ kind: 'react', line: 'hasOwnProperty' } as unknown as LineDescriptor)
		).toBeNull();
		expect(
			composeLine({
				kind: 'outcome',
				result: 'toString',
				beat: 'coda'
			} as unknown as LineDescriptor)
		).toBeNull();
		expect(
			composeLine({
				kind: 'outcome',
				result: 'constructor',
				beat: 'coda'
			} as unknown as LineDescriptor)
		).toBeNull();
	});
});

describe('voiceForLine', () => {
	it('routes Sköll’s Ask to his voice, everything else to the Oracle’s', () => {
		expect(voiceForLine({ kind: 'skoll-ask', query: {} })).toBe(SKOLL_VOICE);
		expect(voiceForLine({ kind: 'skoll-cast', rune: 'Sowilo' })).toBe(SKOLL_VOICE);
		expect(voiceForLine({ kind: 'refusal', refusal: 'empty' })).toBe(ORACLE_VOICE);
		expect(voiceForLine({ kind: 'answer', query: {}, affirmative: true })).toBe(ORACLE_VOICE);
		expect(voiceForLine({ kind: 'react', line: 'human-hex' })).toBe(ORACLE_VOICE);
		expect(voiceForLine({ kind: 'cast', result: 'true' })).toBe(ORACLE_VOICE);
		// The outcome splits by who took the day: a win is hers, a loss is his.
		expect(voiceForLine({ kind: 'outcome', result: 'win', beat: 'coda' })).toBe(ORACLE_VOICE);
		expect(voiceForLine({ kind: 'outcome', result: 'lose', beat: 'verse' })).toBe(SKOLL_VOICE);
	});

	it('voices an authored line in its own carried voice (ttd:17/ttd:22)', () => {
		expect(
			voiceForLine({ kind: 'authored', id: 'vl-1', voice: SKOLL_VOICE, text: 'his gloat' })
		).toBe(SKOLL_VOICE);
		expect(
			voiceForLine({ kind: 'authored', id: 'vl-2', voice: ORACLE_VOICE, text: 'her blessing' })
		).toBe(ORACLE_VOICE);
	});
});

describe('synthPrompt', () => {
	it('wraps each line in its voice’s director’s-notes, quoting the line', () => {
		const skoll = synthPrompt(SKOLL_VOICE, 'I scent a fire rune on her.');
		const oracle = synthPrompt(ORACLE_VOICE, 'Speak your question, witch.');
		// Each carries its own direction (distinct) and ends on the quoted line, not the bare line.
		expect(skoll).toContain('"I scent a fire rune on her."');
		expect(skoll).not.toBe('I scent a fire rune on her.');
		expect(oracle).toContain('"Speak your question, witch."');
		expect(skoll.slice(0, 40)).not.toBe(oracle.slice(0, 40)); // different speaker notes
	});

	it('keys the director’s-notes on the voice — Sköll’s growl vs the Oracle’s notes', () => {
		// Same voice → same direction, whatever the line (an authored line and a composed one match).
		expect(synthPrompt(SKOLL_VOICE, 'The night is everlasting.').slice(0, 40)).toBe(
			synthPrompt(SKOLL_VOICE, 'x').slice(0, 40)
		);
		expect(synthPrompt(ORACLE_VOICE, 'The light is yours to keep.').slice(0, 40)).toBe(
			synthPrompt(ORACLE_VOICE, 'x').slice(0, 40)
		);
		expect(synthPrompt(SKOLL_VOICE, 'x').slice(0, 40)).not.toBe(
			synthPrompt(ORACLE_VOICE, 'x').slice(0, 40)
		);
	});
});

describe('isLineDescriptor', () => {
	it('accepts the line kinds', () => {
		expect(isLineDescriptor({ kind: 'refusal', refusal: 'empty' })).toBe(true);
		expect(isLineDescriptor({ kind: 'answer', query: {}, affirmative: true })).toBe(true);
		expect(isLineDescriptor({ kind: 'skoll-ask', query: {} })).toBe(true);
		expect(isLineDescriptor({ kind: 'skoll-cast', rune: 'Sowilo' })).toBe(true);
		expect(isLineDescriptor({ kind: 'react', line: 'human-hex' })).toBe(true);
		expect(isLineDescriptor({ kind: 'cast', result: 'true' })).toBe(true);
		expect(isLineDescriptor({ kind: 'outcome', result: 'win', beat: 'coda' })).toBe(true);
		// authored carries the words' display copy + voice + the store id (the words live server-side).
		expect(
			isLineDescriptor({ kind: 'authored', id: 'vl-1', voice: ORACLE_VOICE, text: 'her line' })
		).toBe(true);
	});

	it('rejects malformed shapes', () => {
		expect(isLineDescriptor(null)).toBe(false);
		expect(isLineDescriptor('refusal')).toBe(false);
		expect(isLineDescriptor({ kind: 'greeting' })).toBe(false);
		expect(isLineDescriptor({ kind: 'unknown' })).toBe(false);
		expect(isLineDescriptor({ kind: 'refusal' })).toBe(false);
		expect(isLineDescriptor({ kind: 'answer', query: {} })).toBe(false);
		expect(isLineDescriptor({ kind: 'skoll-ask' })).toBe(false);
		expect(isLineDescriptor({ kind: 'skoll-cast' })).toBe(false);
		expect(isLineDescriptor({ kind: 'react' })).toBe(false);
		expect(isLineDescriptor({ kind: 'cast' })).toBe(false);
		expect(isLineDescriptor({ kind: 'outcome', result: 'win' })).toBe(false); // beat required
		// authored requires all three string fields — dropping any one fails the guard.
		expect(isLineDescriptor({ kind: 'authored', voice: ORACLE_VOICE, text: 'x' })).toBe(false); // no id
		expect(isLineDescriptor({ kind: 'authored', id: 'vl-1', text: 'x' })).toBe(false); // no voice
		expect(isLineDescriptor({ kind: 'authored', id: 'vl-1', voice: ORACLE_VOICE })).toBe(false); // no text
	});
});
