import { describe, it, expect } from 'vitest';
import { GET } from '$routes/api/state/+server';
import { recordLine } from '$lib/server/engine/session';

// No Gemini here — the snapshot reads the in-memory engine the session lazily creates.
function call(sessionId: string) {
	return GET({ locals: { sessionId } } as unknown as Parameters<typeof GET>[0]);
}

describe('GET /api/state', () => {
	it('returns the authoritative round snapshot for the session', async () => {
		const res = await call('state-test-session');

		expect(res.status).toBe(200);
		const snap = (await res.json()) as {
			boardSeed: number;
			roundId: string;
			state: { activePlayer: string; status: string };
			pendingReaction: unknown;
		};
		expect(snap).toMatchObject({
			boardSeed: expect.any(Number),
			roundId: expect.any(String),
			state: expect.objectContaining({
				activePlayer: expect.any(String),
				status: expect.any(String)
			})
		});
		// Present (null when no Ask is parked) — the field always rides the snapshot.
		expect(snap).toHaveProperty('pendingReaction');
	});

	it('resumes the same round across reads — never reseeds', async () => {
		const first = (await (await call('stable-session')).json()) as { roundId: string };
		const second = (await (await call('stable-session')).json()) as { roundId: string };
		expect(second.roundId).toBe(first.roundId);
	});

	// ttd:29: the snapshot carries the last committed voiced line so a dropped response can recover the
	// real result instead of the client's false silent/falters line.
	it('carries the last committed voiced line (null until something is spoken)', async () => {
		const session = 'state-line-session';
		const before = (await (await call(session)).json()) as { lastLine: unknown };
		expect(before.lastLine).toBeNull();

		recordLine(session, {
			text: 'Yes. Sól is reaching for a fire rune.',
			voice: { kind: 'answer', query: { axis: 'element', value: 'Fire' }, affirmative: true }
		});
		const after = (await (await call(session)).json()) as {
			lastLine: { text: string; voice: { kind: string } };
		};
		expect(after.lastLine.text).toBe('Yes. Sól is reaching for a fire rune.');
		expect(after.lastLine.voice.kind).toBe('answer');
	});
});
