import { describe, it, expect } from 'vitest';
import { POST } from '$routes/api/new-game/+server';
import { getEngine, resetEngine } from '$lib/server/engine/session';
import { selectSecret } from '$lib/server/engine/engine';

const SEED = 1;

function call(sessionId: string) {
	return POST({ locals: { sessionId } } as unknown as Parameters<typeof POST>[0]);
}

describe('POST /api/new-game', () => {
	it('returns a fresh uint32 board seed', async () => {
		const { boardSeed } = await (await call('seed-session')).json();
		expect(Number.isInteger(boardSeed)).toBe(true);
		expect(boardSeed).toBeGreaterThanOrEqual(0);
		expect(boardSeed).toBeLessThan(2 ** 32);
	});

	it('resets the session to a fresh active round', async () => {
		// Win the current round so its status is terminal...
		resetEngine('reset-session', SEED);
		getEngine('reset-session').cast('Human', selectSecret(SEED).name);
		expect(getEngine('reset-session').status).toBe('won');

		// ...then a new game must hand back an active, human-first round.
		await call('reset-session');
		expect(getEngine('reset-session').status).toBe('active');
		expect(getEngine('reset-session').activePlayer).toBe('Human');
	});

	it('resets only the calling session', async () => {
		resetEngine('keep-a', SEED);
		const a = getEngine('keep-a');
		await call('keep-b'); // new game for B must not touch A
		expect(getEngine('keep-a')).toBe(a);
		expect(getEngine('keep-a').cast('Human', selectSecret(SEED).name)).toMatchObject({
			won: true
		});
	});
});
