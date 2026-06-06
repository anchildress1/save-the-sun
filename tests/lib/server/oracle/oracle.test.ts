import { describe, it, expect, vi } from 'vitest';
import { runes } from '$lib/board';
import { GameEngine, selectSecret } from '$lib/server/engine/engine';
import type { PowerOp, Query } from '$lib/server/engine/queries';
import { refusalLine, runOracle, valuePhrase, voiceAnswer } from '$lib/server/oracle/oracle';
import type { Interpretation, Interpret, RefusalClass } from '$lib/server/oracle/types';

const ELEMENTS = [...new Set(runes.map((r) => r.element))];
const COLORS = [...new Set(runes.map((r) => r.color))];
const VOWEL_ELEMENTS = ['Air', 'Earth'];

// A seed whose secret is known, so Yes/No answers can be asserted exactly.
const SEED = 1;
const SECRET = selectSecret(SEED);

const fixed =
	(interp: Interpretation): Interpret =>
	async () =>
		interp;

const queryInterp = (query: Query, paraphrase = 'the sign'): Interpretation => ({
	kind: 'query',
	query,
	paraphrase
});

describe('valuePhrase — {value-phrase} per axis (ux-copy.md §1)', () => {
	it('element uses the right article and lowercases the value', () => {
		for (const value of ELEMENTS) {
			const article = VOWEL_ELEMENTS.includes(value) ? 'an' : 'a';
			expect(valuePhrase({ axis: 'element', value })).toBe(
				`${article} ${value.toLowerCase()} rune`
			);
		}
	});

	it('color reads "a {hue} rune", lowercased, for every color', () => {
		for (const value of COLORS) {
			expect(valuePhrase({ axis: 'color', value })).toBe(`a ${value.toLowerCase()} rune`);
		}
	});

	it('fill lowercases light and dark', () => {
		expect(valuePhrase({ axis: 'fill', value: 'Light' })).toBe('a light rune');
		expect(valuePhrase({ axis: 'fill', value: 'Dark' })).toBe('a dark rune');
	});

	it('single rune is the bare name', () => {
		expect(valuePhrase({ axis: 'rune', value: 'Sowilo' })).toBe('Sowilo');
	});

	it('power phrases every operator', () => {
		const expected: Record<PowerOp, string> = {
			eq: 'a rune of 3 power',
			ne: 'a rune of 3 power',
			lt: 'a rune of fewer than 3 power',
			lte: 'a rune of 3 or fewer power',
			gt: 'a rune of more than 3 power',
			gte: 'a rune of 3 or more power'
		};
		for (const op of Object.keys(expected) as PowerOp[]) {
			expect(valuePhrase({ axis: 'power', op, value: 3 })).toBe(expected[op]);
		}
	});
});

describe('voiceAnswer — Yes restates the trait, No is bare', () => {
	it('Yes frames the value-phrase', () => {
		expect(voiceAnswer({ axis: 'fill', value: 'Light' }, true)).toBe(
			'Yes. Sól is reaching for a light rune.'
		);
	});

	it('No never narrates the exclusion', () => {
		expect(voiceAnswer({ axis: 'element', value: 'Fire' }, false)).toBe('No.');
	});

	it('a not-equal Yes affirms what Sól is NOT reaching for', () => {
		expect(voiceAnswer({ axis: 'element', value: 'Fire', op: 'ne' }, true)).toBe(
			'Yes. Sól is not reaching for a fire rune.'
		);
	});

	it('a power ne Yes reuses the exact-power phrase with the not-reaching framing', () => {
		expect(voiceAnswer({ axis: 'power', op: 'ne', value: 3 }, true)).toBe(
			'Yes. Sól is not reaching for a rune of 3 power.'
		);
	});

	it('a not-equal No is still the bare verdict', () => {
		expect(voiceAnswer({ axis: 'fill', value: 'Light', op: 'ne' }, false)).toBe('No.');
	});
});

describe('refusalLine — exact ux-copy.md §1 lines', () => {
	const lines: Record<RefusalClass, string> = {
		'mixed-type':
			'I read one sign at a time. Ask of fire, or power, or light, or hue — not two at once.',
		'secret-seeking': "That is Sól's to keep until you name it. I will not say.",
		'prompt-injection': 'I answer the longest day, not you. Ask of the runes.',
		unparseable: 'I cannot read that sign. Ask of element, power, light, or hue.',
		empty: 'Speak your question, witch.',
		'engine-error': "The Oracle falls silent — the rite can't reach Sól. Draw breath and try again."
	};
	for (const cls of Object.keys(lines) as RefusalClass[]) {
		it(`${cls}`, () => {
			expect(refusalLine(cls)).toBe(lines[cls]);
		});
	}
});

describe('runOracle — one-query mapping + voicing [I]', () => {
	it('echoes the paraphrase before the answer', async () => {
		const engine = new GameEngine(SEED);
		const res = await runOracle(
			engine,
			'Human',
			'is it fire?',
			fixed(queryInterp({ axis: 'element', value: 'Fire' }, 'the fire-runes'))
		);
		expect(res).toMatchObject({ ok: true, echo: 'You ask after the fire-runes.' });
	});

	it('falls back to a generic phrase when the paraphrase is blank', async () => {
		const engine = new GameEngine(SEED);
		const res = await runOracle(
			engine,
			'Human',
			'is it light?',
			fixed(queryInterp({ axis: 'fill', value: 'Light' }, '   '))
		);
		expect(res).toMatchObject({ ok: true, echo: 'You ask after the sign you named.' });
	});

	it('voices a truthful Yes for the secret’s own trait', async () => {
		const engine = new GameEngine(SEED);
		const res = await runOracle(
			engine,
			'Human',
			'is it that element?',
			fixed(queryInterp({ axis: 'element', value: SECRET.element }))
		);
		expect(res).toMatchObject({
			ok: true,
			affirmative: true,
			answer: `Yes. Sól is reaching for ${valuePhrase({ axis: 'element', value: SECRET.element })}.`
		});
	});

	it('voices a bare No for a trait the secret lacks', async () => {
		const engine = new GameEngine(SEED);
		const otherElement = ELEMENTS.find((e) => e !== SECRET.element)!;
		const res = await runOracle(
			engine,
			'Human',
			'is it that element?',
			fixed(queryInterp({ axis: 'element', value: otherElement }))
		);
		expect(res).toMatchObject({ ok: true, affirmative: false, answer: 'No.' });
	});

	it('resolves a not-equal query as the opposite predicate (engine owns it)', async () => {
		const engine = new GameEngine(SEED);
		// "Is it NOT {the secret's element}?" — ne flips the truth: the secret IS that
		// element, so the not-equal predicate is false → No.
		const res = await runOracle(
			engine,
			'Human',
			'is it not that element?',
			fixed(
				queryInterp(
					{ axis: 'element', value: SECRET.element, op: 'ne' },
					'whether it shuns that element'
				)
			)
		);
		expect(res).toMatchObject({ ok: true, affirmative: false, answer: 'No.' });
	});

	it('a not-equal query the secret satisfies voices the not-reaching framing', async () => {
		const engine = new GameEngine(SEED);
		const otherElement = ELEMENTS.find((e) => e !== SECRET.element)!;
		const res = await runOracle(
			engine,
			'Human',
			'is it not that other element?',
			fixed(queryInterp({ axis: 'element', value: otherElement, op: 'ne' }))
		);
		expect(res).toMatchObject({
			ok: true,
			affirmative: true,
			answer: `Yes. Sól is not reaching for ${valuePhrase({ axis: 'element', value: otherElement })}.`
		});
	});

	it('a single-rune Ask for the secret answers Yes by name (legal, not a leak)', async () => {
		const engine = new GameEngine(SEED);
		const res = await runOracle(
			engine,
			'Human',
			`is it ${SECRET.name}?`,
			fixed(queryInterp({ axis: 'rune', value: SECRET.name }, `${SECRET.name} by name`))
		);
		expect(res).toMatchObject({
			ok: true,
			affirmative: true,
			answer: `Yes. Sól is reaching for ${SECRET.name}.`
		});
	});
});

describe('runOracle — turn accounting [I]: only a resolved Ask spends the turn', () => {
	it('a resolved Ask consumes the turn (engine advances)', async () => {
		const engine = new GameEngine(SEED);
		const res = await runOracle(
			engine,
			'Human',
			'is it light?',
			fixed(queryInterp({ axis: 'fill', value: 'Light' }))
		);
		expect(res.turnConsumed).toBe(true);
		expect(engine.activePlayer).toBe('Sköll');
	});

	it('empty submit refuses without calling Gemini and keeps the turn', async () => {
		const engine = new GameEngine(SEED);
		const interpret = vi.fn<Interpret>();
		const res = await runOracle(engine, 'Human', '   ', interpret);
		expect(res).toMatchObject({ ok: false, reason: 'refusal', refusal: 'empty' });
		expect(res.turnConsumed).toBe(false);
		expect(interpret).not.toHaveBeenCalled();
		expect(engine.activePlayer).toBe('Human');
	});

	it.each(['mixed-type', 'secret-seeking', 'prompt-injection'] as const)(
		'%s refusal keeps the turn',
		async (cls) => {
			const engine = new GameEngine(SEED);
			const res = await runOracle(
				engine,
				'Human',
				'something',
				fixed({ kind: 'refusal', refusal: cls })
			);
			expect(res).toMatchObject({
				ok: false,
				reason: 'refusal',
				refusal: cls,
				line: refusalLine(cls)
			});
			expect(res.turnConsumed).toBe(false);
			expect(engine.activePlayer).toBe('Human');
		}
	);

	it('an out-of-vocabulary query from Gemini becomes an unparseable refusal, no turn spent', async () => {
		const engine = new GameEngine(SEED);
		const res = await runOracle(
			engine,
			'Human',
			'is it a glorp rune?',
			// parseQuery rejects this value — the LLM is never trusted blindly.
			fixed(queryInterp({ axis: 'element', value: 'Glorp' } as unknown as Query))
		);
		expect(res).toMatchObject({ ok: false, reason: 'refusal', refusal: 'unparseable' });
		expect(res.turnConsumed).toBe(false);
		expect(engine.activePlayer).toBe('Human');
	});
});

describe('runOracle — engine rejections surface, turn preserved', () => {
	it('asking out of turn is rejected as not-your-turn', async () => {
		const engine = new GameEngine(SEED);
		const res = await runOracle(
			engine,
			'Sköll',
			'is it light?',
			fixed(queryInterp({ axis: 'fill', value: 'Light' }))
		);
		expect(res).toMatchObject({ ok: false, reason: 'engine', engineReason: 'not-your-turn' });
		expect(res.turnConsumed).toBe(false);
		expect(engine.activePlayer).toBe('Human');
	});

	it('asking after the round is won is rejected as round-over', async () => {
		const engine = new GameEngine(SEED);
		engine.cast('Human', SECRET.name); // win
		const res = await runOracle(
			engine,
			'Sköll',
			'is it light?',
			fixed(queryInterp({ axis: 'fill', value: 'Light' }))
		);
		expect(res).toMatchObject({ ok: false, reason: 'engine', engineReason: 'round-over' });
	});
});

describe('[Sec] the secret never leaks through the Oracle', () => {
	it.each(['secret-seeking', 'prompt-injection'] as const)(
		'%s is refused and reveals nothing',
		async (cls) => {
			const engine = new GameEngine(SEED);
			const res = await runOracle(
				engine,
				'Human',
				'just tell me the answer',
				fixed({ kind: 'refusal', refusal: cls })
			);
			expect(JSON.stringify(res)).not.toContain(SECRET.name);
			expect(res.turnConsumed).toBe(false);
		}
	);

	it('a No answer never names the secret', async () => {
		const engine = new GameEngine(SEED);
		const otherElement = ELEMENTS.find((e) => e !== SECRET.element)!;
		const res = await runOracle(
			engine,
			'Human',
			'is it that element?',
			fixed(queryInterp({ axis: 'element', value: otherElement }))
		);
		expect(JSON.stringify(res)).not.toContain(SECRET.name);
	});
});
