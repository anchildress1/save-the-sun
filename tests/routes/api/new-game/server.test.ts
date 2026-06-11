import { describe, it, expect } from 'vitest';
import { POST } from '$routes/api/new-game/+server';
import { getEngine, getRoundId, resetEngine } from '$lib/server/engine/session';
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

	it('returns the board seed, round token, and a fresh turn snapshot — no secret-bearing fields', async () => {
		const body = await (await call('shape-session')).json();
		expect(Object.keys(body).sort()).toEqual(['boardSeed', 'roundId', 'state']);
		expect(typeof body.roundId).toBe('string');
		expect(body.roundId.length).toBeGreaterThan(0);
		// The snapshot is the public turn state only — winner is null pre-cast, never the secret.
		expect(body.state).toEqual({ activePlayer: 'Human', status: 'active', winner: null, turns: 0 });
	});

	it('deals a fresh layout each new round — the held seed dies with the old round', async () => {
		const before = await (await call('seed-reshuffle')).json();
		const after = await (await call('seed-reshuffle')).json();
		expect(after.boardSeed).not.toBe(before.boardSeed);
	});

	it('hands back a fresh round token so the client re-keys its persisted view', async () => {
		const before = getRoundId('token-newgame');
		const { roundId } = await (await call('token-newgame')).json();
		// The reset minted a new token; it matches what the session now reports, and is not the old one.
		expect(roundId).not.toBe(before);
		expect(roundId).toBe(getRoundId('token-newgame'));
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

	it('resets the caller and leaves other sessions untouched', async () => {
		// A: untouched bystander, parked with a known winning secret.
		resetEngine('keep-a', SEED);
		const a = getEngine('keep-a');
		// B: a terminal round that the new game must actually reset.
		resetEngine('keep-b', SEED);
		getEngine('keep-b').cast('Human', selectSecret(SEED).name);
		expect(getEngine('keep-b').status).toBe('won');

		await call('keep-b');

		// B was reset...
		expect(getEngine('keep-b').status).toBe('active');
		// ...and A is the same instance, still winnable with its secret.
		expect(getEngine('keep-a')).toBe(a);
		expect(getEngine('keep-a').cast('Human', selectSecret(SEED).name)).toMatchObject({
			won: true
		});
	});
});
