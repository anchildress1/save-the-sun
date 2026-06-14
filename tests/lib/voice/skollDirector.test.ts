import { describe, expect, it } from 'vitest';
import { createSkollDirector, clipUrl } from '$lib/voice/skollDirector';
import { SKOLL_SCRIPT } from '$lib/voice/skollScript';

// A deterministic rng cycling through a fixed list, so variant picks are predictable in tests.
function seq(values: number[]): () => number {
	let i = 0;
	return () => values[i++ % values.length];
}

describe('skollDirector', () => {
	it('clipUrl points at the static clip path', () => {
		expect(clipUrl('night-opens-1')).toBe('/audio/skoll/night-opens-1.pcm.b64');
	});

	it('opens the night on his first turn, then taunts by hunt stage', () => {
		const d = createSkollDirector(seq([0]));
		const first = d.turn(1);
		expect(first?.id.startsWith('night-opens')).toBe(true);
		expect(first?.url).toBe(clipUrl(first!.id));
		expect(first?.caption).toBe(SKOLL_SCRIPT['night-opens'].variants[0].text);

		// turns > 2 but <= 5 → the closing stage on the next turn.
		expect(d.turn(4)?.id.startsWith('hunt-closing')).toBe(true);
	});

	it('fires each hunt stage at most once a night, null otherwise', () => {
		const d = createSkollDirector(seq([0]));
		d.turn(1); // night-opens (his first)
		expect(d.turn(1)?.id.startsWith('hunt-far')).toBe(true); // turns <= 2 → far
		expect(d.turn(2)).toBeNull(); // still far — already fired
		expect(d.turn(4)?.id.startsWith('hunt-closing')).toBe(true); // <= 5 → closing
		expect(d.turn(5)).toBeNull(); // still closing
		expect(d.turn(8)?.id.startsWith('hunt-near')).toBe(true); // > 5 → near
		expect(d.turn(9)).toBeNull();
	});

	it('maps each event to its bucket', () => {
		const d = createSkollDirector(seq([0]));
		expect(d.wrongCast().id.startsWith('wrong-cast')).toBe(true);
		expect(d.hexed().id.startsWith('hexed')).toBe(true);
		expect(d.playerWin().id.startsWith('defeat-exit')).toBe(true);
	});

	it('never repeats a line within a night, and never back-to-back across a refill', () => {
		// wrong-cast has 3 variants; rng=0 always picks the head of the remaining pool.
		const d = createSkollDirector(seq([0]));
		const variants = SKOLL_SCRIPT['wrong-cast'].variants.length;
		const first = Array.from({ length: variants }, () => d.wrongCast().id);
		expect(new Set(first).size).toBe(variants); // all distinct — a full sweep, no repeat

		// The pool refills now; the next pick must not equal the last of the previous sweep.
		const next = d.wrongCast().id;
		expect(next).not.toBe(first[first.length - 1]);
	});

	it('reset forgets the first-turn and milestone memory', () => {
		const d = createSkollDirector(seq([0]));
		d.turn(1); // opens the night
		expect(d.turn(1)?.id.startsWith('hunt-far')).toBe(true);
		d.reset();
		// After a reset his next turn opens the night again.
		expect(d.turn(1)?.id.startsWith('night-opens')).toBe(true);
	});

	it('honors the injected rng for variant choice', () => {
		// rng=0.99 selects the last index of each pool deterministically.
		const d = createSkollDirector(seq([0.99]));
		const picked = d.wrongCast().id;
		const last = SKOLL_SCRIPT['wrong-cast'].variants.at(-1)!.id;
		expect(picked).toBe(last);
	});
});
