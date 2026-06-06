import { describe, it, expect } from 'vitest';
import { handleAction, type ActionDeps } from '$lib/server/engine/actions';
import { GameEngine, selectSecret } from '$lib/server/engine/engine';
import type { Interpret } from '$lib/server/oracle/types';

const SEED = 1;
const SECRET = selectSecret(SEED);

const interpret: Interpret = async () => ({
	kind: 'query',
	query: { axis: 'fill', value: 'Light' },
	paraphrase: 'whether it is light'
});

const deps = (): ActionDeps => ({ engine: new GameEngine(SEED), interpret });

describe('Shared Action Interface — the single routing point', () => {
	it('routes an Ask through the Oracle', async () => {
		const res = await handleAction(
			{ type: 'Ask', player: 'Human', question: 'is it light?' },
			deps()
		);
		expect(res).toMatchObject({ type: 'Ask', oracle: { ok: true } });
	});

	it('routes a Cast straight to the engine', async () => {
		const res = await handleAction(
			{ type: 'Cast', player: 'Human', runeName: SECRET.name },
			deps()
		);
		expect(res).toMatchObject({ type: 'Cast', cast: { won: true } });
	});

	it('acknowledges a CrossOff without refereeing it', async () => {
		const res = await handleAction(
			{ type: 'CrossOff', player: 'Human', runeId: 5, crossed: true },
			deps()
		);
		expect(res).toEqual({ type: 'CrossOff', ok: true });
	});

	it('acknowledges a React (resolves in S5)', async () => {
		const res = await handleAction({ type: 'React', player: 'Sköll', reaction: 'Scry' }, deps());
		expect(res).toEqual({ type: 'React', ok: true });
	});
});
