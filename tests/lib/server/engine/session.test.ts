import { describe, it, expect } from 'vitest';
import { GameEngine, selectSecret } from '$lib/server/engine/engine';
import {
	getEngine,
	getSkoll,
	getRoundId,
	getBoardSeed,
	resetEngine,
	sessionCount,
	storeVoiceLine,
	getVoiceLine,
	withSessionLock,
	MAX_SESSIONS
} from '$lib/server/engine/session';
import { ORACLE_VOICE } from '$lib/voice/config';
import { getEvents, logEvent } from '$lib/server/debug/log';

const SEED = 1;
const A = 'session-a';
const B = 'session-b';

describe('session engine registry', () => {
	it('lazily creates one engine per session and memoizes it', () => {
		const first = getEngine('lazy-session');
		expect(first).toBeInstanceOf(GameEngine);
		expect(getEngine('lazy-session')).toBe(first);
	});

	it('hands different sessions different engine instances', () => {
		expect(getEngine(A)).not.toBe(getEngine(B));
	});

	it('keeps parallel sessions isolated — one round never moves the other', () => {
		const a = resetEngine(A, SEED);
		const b = resetEngine(B, SEED);

		// A plays a turn; B must be untouched (still human-first, fresh).
		a.ask('Human', { axis: 'fill', value: 'Light' });
		expect(a.activePlayer).toBe('Sköll');
		expect(b.activePlayer).toBe('Human');

		// A wins its round; B's round stays active and independently winnable.
		expect(a.cast('Sköll', selectSecret(SEED).name)).toMatchObject({ won: true });
		expect(a.status).toBe('won');
		expect(b.status).toBe('active');
		expect(b.cast('Human', selectSecret(SEED).name)).toMatchObject({ won: true });
	});

	it('resetEngine(seed) makes the secret deterministic for that session', () => {
		resetEngine(A, SEED);
		expect(getEngine(A).cast('Human', selectSecret(SEED).name)).toMatchObject({ won: true });
	});

	it('resetEngine() starts a fresh active round and replaces the prior engine', () => {
		const before = getEngine(A);
		const after = resetEngine(A);
		expect(after).not.toBe(before);
		expect(after.status).toBe('active');
		expect(after.activePlayer).toBe('Human');
	});

	it('throws if called without a sessionId', () => {
		expect(() => getEngine('')).toThrow(/sessionId/);
		expect(() => resetEngine('')).toThrow(/sessionId/);
		expect(() => getSkoll('')).toThrow(/sessionId/);
	});

	it('lazily creates one Sköll memory per session and memoizes it', () => {
		const skoll = getSkoll('wolf-session');
		expect(skoll.facts).toEqual([]);
		expect(getSkoll('wolf-session')).toBe(skoll);
	});

	it('wipes the wolf memory on a new round, but resumes it on a refresh', () => {
		const skoll = getSkoll('wolf-reset');
		skoll.facts.push({ query: { axis: 'fill', value: 'Light' }, answer: true });
		// A bare getEngine (refresh) keeps his accumulated facts...
		getEngine('wolf-reset');
		expect(getSkoll('wolf-reset').facts).toHaveLength(1);
		// ...but a new round clears them.
		resetEngine('wolf-reset', SEED);
		expect(getSkoll('wolf-reset').facts).toEqual([]);
	});

	it('evicts the wolf memory with its engine', () => {
		const skoll = getSkoll('wolf-victim');
		skoll.facts.push({ query: { axis: 'fill', value: 'Light' }, answer: true });
		getEngine('wolf-victim');
		for (let i = 0; i <= MAX_SESSIONS; i++) getEngine(`wolf-flood-${i}`);
		// Evicted alongside the engine → a fresh, empty memory on next access.
		expect(getSkoll('wolf-victim').facts).toEqual([]);
	});

	// The debug log is lifecycle-linked to the round through this registry — the wiring, not just
	// resetLog in isolation.
	it('wipes the debug log on a new round, reopened with the new secret', () => {
		getEngine('log-reset'); // create → logs the round-opened event
		logEvent('log-reset', {
			owner: 'Human',
			kind: 'input',
			part: 'Ask',
			level: 'info',
			message: 'mid-round'
		});
		expect(getEvents('log-reset').length).toBeGreaterThan(1);
		resetEngine('log-reset', SEED); // resetLog clears, then create reopens the round
		const events = getEvents('log-reset');
		expect(events).toHaveLength(1); // only the new round's opening event remains
		expect(events[0]).toMatchObject({ owner: 'Engine', part: 'Round' });
	});

	// The round event names the secret and its seed — the on-stage record is a spoiler by design,
	// so a screen-share can follow the engine's truth from the opening beat.
	it('opens the round log with the secret and its seed', () => {
		resetEngine('log-secret', SEED);
		const [event] = getEvents('log-secret');
		expect(event.message).toContain(selectSecret(SEED).name);
		expect(event.data).toMatchObject({ secret: selectSecret(SEED).name, seed: SEED });
	});

	it('evicts the debug log with its engine', () => {
		getEngine('log-victim'); // log holds the secret event
		expect(getEvents('log-victim').length).toBeGreaterThan(0);
		for (let i = 0; i <= MAX_SESSIONS; i++) getEngine(`log-flood-${i}`);
		expect(getEvents('log-victim')).toEqual([]); // evicted → log gone, not re-created
	});

	it('mints a stable per-round token that survives a refresh and isolates per session', () => {
		const id = getRoundId('round-token');
		expect(id).toMatch(/[0-9a-f-]{36}/i); // a uuid-shaped opaque token, not the seed
		// A bare getEngine (refresh) keeps the same token — the round resumed.
		getEngine('round-token');
		expect(getRoundId('round-token')).toBe(id);
		// A parallel session gets its own token.
		expect(getRoundId('round-token-other')).not.toBe(id);
	});

	it('regenerates the round token on a new round so a stale view never resumes', () => {
		const before = getRoundId('round-token-reset');
		resetEngine('round-token-reset', SEED);
		expect(getRoundId('round-token-reset')).not.toBe(before);
	});

	it('evicts the round token with its engine', () => {
		const id = getRoundId('round-token-victim');
		for (let i = 0; i <= MAX_SESSIONS; i++) getEngine(`token-flood-${i}`);
		// Evicted → a fresh token on next access, not the old one resurrected.
		expect(getRoundId('round-token-victim')).not.toBe(id);
	});

	it('mints a stable board seed that survives a refresh and isolates per session', () => {
		const seed = getBoardSeed('board-seed');
		expect(typeof seed).toBe('number');
		// A bare getEngine (refresh) keeps the same layout seed — the round resumed.
		getEngine('board-seed');
		expect(getBoardSeed('board-seed')).toBe(seed);
		// A parallel session deals its own board.
		expect(getBoardSeed('board-seed-other')).not.toBe(seed);
	});

	it('remints the board seed on a new round so a fresh secret deals a fresh board', () => {
		const before = getBoardSeed('board-seed-reset');
		resetEngine('board-seed-reset', SEED);
		expect(getBoardSeed('board-seed-reset')).not.toBe(before);
	});

	it('evicts the board seed with its engine', () => {
		const seed = getBoardSeed('board-seed-victim');
		for (let i = 0; i <= MAX_SESSIONS; i++) getEngine(`board-flood-${i}`);
		// Evicted → a fresh seed on next access, not the old one resurrected.
		expect(getBoardSeed('board-seed-victim')).not.toBe(seed);
	});

	it('never grows past the session cap', () => {
		for (let i = 0; i <= MAX_SESSIONS + 10; i++) getEngine(`cap-${i}`);
		expect(sessionCount()).toBe(MAX_SESSIONS);
	});

	it('evicts an idle session once the cap is exceeded', () => {
		// Park a known terminal round, then never touch it again.
		resetEngine('idle-victim', SEED);
		getEngine('idle-victim').cast('Human', selectSecret(SEED).name);
		expect(getEngine('idle-victim').status).toBe('won');

		// Flood the cap with fresh sessions — the idle one is older than all of them.
		for (let i = 0; i <= MAX_SESSIONS; i++) getEngine(`flood-${i}`);

		// Evicted → the next access is a brand-new active round, not the won one.
		expect(getEngine('idle-victim').status).toBe('active');
	});

	it('never evicts a session that is still being used', () => {
		resetEngine('active-keep', SEED);
		getEngine('active-keep').cast('Human', selectSecret(SEED).name); // terminal: won

		// Overflow the cap, but touch the kept session every step so it stays most-recent.
		for (let i = 0; i <= MAX_SESSIONS; i++) {
			getEngine(`churn-${i}`);
			getEngine('active-keep');
		}

		// Survived: still the same won round, never reset.
		expect(getEngine('active-keep').status).toBe('won');
	});

	// The authored-line store is bounded per round (MAX_VOICE_LINES) so a marathon round can't grow
	// memory without bound — the oldest id is dropped once over the cap, the recent ones survive.
	it('drops the oldest authored voice line once past the per-round cap', () => {
		const MAX_VOICE_LINES = 32;
		const session = 'voice-line-cap';
		const oldest = storeVoiceLine(session, 'the first line', ORACLE_VOICE);
		let newest = oldest;
		// One more than the cap → the first stored id falls off the front.
		for (let i = 0; i < MAX_VOICE_LINES; i++) {
			newest = storeVoiceLine(session, `line ${i}`, ORACLE_VOICE);
		}
		expect(getVoiceLine(session, oldest)).toBeNull(); // evicted — the route would refuse it
		expect(getVoiceLine(session, newest)).toEqual({ text: 'line 31', voice: ORACLE_VOICE });
	});
});

describe('withSessionLock', () => {
	it('serializes overlapping actions for one session — they run in call order', async () => {
		const order: string[] = [];
		const gated = (label: string, release: Promise<void>) =>
			withSessionLock('lock-order', async () => {
				await release;
				order.push(label);
			});

		let releaseFirst: () => void = () => {};
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		// Fire both back-to-back; the first holds the lock until its gate opens, so the second must wait
		// behind it even though it has no work of its own to await.
		const first = gated('first', firstGate);
		const second = gated('second', Promise.resolve());

		releaseFirst();
		await Promise.all([first, second]);

		expect(order).toEqual(['first', 'second']);
	});

	it('does not wedge the queue when an action rejects — the next still runs', async () => {
		await expect(
			withSessionLock('lock-reject', async () => {
				throw new Error('action blew up');
			})
		).rejects.toThrow('action blew up');

		// The failed tail must not poison the chain: the next action for the same session still resolves.
		await expect(withSessionLock('lock-reject', async () => 'recovered')).resolves.toBe(
			'recovered'
		);
	});
});
