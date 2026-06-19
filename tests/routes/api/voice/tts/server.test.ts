import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tts = vi.hoisted(() => ({ synthesizeStream: vi.fn(), isCached: vi.fn(() => false) }));
vi.mock('$lib/server/voice/tts', () => ({
	synthesizeStream: tts.synthesizeStream,
	isCached: tts.isCached
}));

const mock = vi.hoisted(() => ({
	env: { GEMINI_API_KEY: 'test-gemini-key' } as { GEMINI_API_KEY?: string }
}));
vi.mock('$env/dynamic/private', () => ({ env: mock.env }));

import { POST } from '$routes/api/voice/tts/+server';
import { resetTtsWindows, TTS_SESSION_LIMIT } from '$lib/server/voice/rateLimit';
import { refusalLine } from '$lib/server/oracle/oracle';
import { skollAskEcho, skollCastEcho } from '$lib/server/skoll/skoll';
import { synthPrompt } from '$lib/server/voice/lines';
import { storeVoiceLine } from '$lib/server/engine/session';
import { ORACLE_VOICE, SKOLL_VOICE } from '$lib/voice/config';

function streamOf(...chunks: string[]) {
	return (async function* () {
		yield* chunks;
	})();
}

function call(sessionId: string, body: unknown) {
	return POST({
		locals: { sessionId },
		request: new Request('http://localhost/api/voice/tts', {
			method: 'POST',
			body: typeof body === 'string' ? body : JSON.stringify(body)
		})
	} as unknown as Parameters<typeof POST>[0]);
}

describe('POST /api/voice/tts', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetTtsWindows();
		tts.isCached.mockReturnValue(false);
		mock.env.GEMINI_API_KEY = 'test-gemini-key';
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => vi.restoreAllMocks());

	it('streams an allow-listed line as NDJSON base64 chunks', async () => {
		tts.synthesizeStream.mockReturnValueOnce(streamOf('pcm-a', 'pcm-b'));

		const response = await call('happy', { kind: 'refusal', refusal: 'empty' });

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/x-ndjson');
		expect(await response.text()).toBe('pcm-a\npcm-b\n');
		// Her line is synthesized wrapped in the Oracle's director's-notes, in her voice.
		expect(tts.synthesizeStream).toHaveBeenCalledExactlyOnceWith(
			synthPrompt(ORACLE_VOICE, refusalLine('empty')),
			ORACLE_VOICE,
			true // a recomposed line caches and replays
		);
	});

	it('voices Sköll’s Ask in his voice, wrapped in his director’s-notes growl', async () => {
		tts.synthesizeStream.mockReturnValueOnce(streamOf('grr'));
		const query = { axis: 'element', value: 'Fire' };
		const line = skollAskEcho(query as Parameters<typeof skollAskEcho>[0]);

		const response = await call('wolf', { kind: 'skoll-ask', query });

		expect(response.status).toBe(200);
		// The synthesized text is the directed prompt (not the bare line) — that's what makes him growl.
		const prompt = synthPrompt(SKOLL_VOICE, line);
		expect(prompt).not.toBe(line);
		expect(prompt).toContain(`"${line}"`);
		expect(tts.synthesizeStream).toHaveBeenCalledExactlyOnceWith(prompt, SKOLL_VOICE, true);
	});

	it('voices Sköll’s winning cast in his voice, naming the board rune', async () => {
		tts.synthesizeStream.mockReturnValueOnce(streamOf('grr'));
		const line = skollCastEcho('Sowilo');

		const response = await call('wolf-cast', { kind: 'skoll-cast', rune: 'Sowilo' });

		expect(response.status).toBe(200);
		const prompt = synthPrompt(SKOLL_VOICE, line);
		expect(prompt).toContain(`"${line}"`);
		expect(tts.synthesizeStream).toHaveBeenCalledExactlyOnceWith(prompt, SKOLL_VOICE, true);
	});

	it('rejects a Sköll cast that names no board rune with 400', async () => {
		const response = await call('wolf-cast-bad', { kind: 'skoll-cast', rune: 'Plastic' });
		expect(response.status).toBe(400);
	});

	it('rejects a malformed JSON body with 400 before charging the budget', async () => {
		const response = await call('bad-json', 'not json{');
		expect(response.status).toBe(400);
		expect(tts.synthesizeStream).not.toHaveBeenCalled();
	});

	it('rejects an unshaped descriptor with 400', async () => {
		const response = await call('bad-shape', { kind: 'whatever' });
		expect(response.status).toBe(400);
		expect(tts.synthesizeStream).not.toHaveBeenCalled();
	});

	it('voices an authored line by id lookup from the session store (ttd:17)', async () => {
		tts.synthesizeStream.mockReturnValueOnce(streamOf('pcm'));
		const text = 'Yes — the flame-sign burns; Sól reaches for fire.';
		const id = storeVoiceLine('authored-sess', text, ORACLE_VOICE, 'Yes. She reaches for fire.');

		const response = await call('authored-sess', {
			kind: 'authored',
			id,
			voice: ORACLE_VOICE,
			text
		});

		expect(response.status).toBe(200);
		// Voiced in her director's-notes, in her voice — the route resolved the words from the store by id.
		expect(tts.synthesizeStream).toHaveBeenCalledExactlyOnceWith(
			synthPrompt(ORACLE_VOICE, text),
			ORACLE_VOICE,
			false // an authored line is unique — never cached
		);
	});

	it('voices the STORED words, never the wire text — the route admits no arbitrary text', async () => {
		tts.synthesizeStream.mockReturnValueOnce(streamOf('pcm'));
		const stored = 'No. She does not reach into fire.';
		const id = storeVoiceLine('authored-sess2', stored, ORACLE_VOICE, 'No. Not fire.');

		// A caller tampers the wire text, keeping a real id — the route must voice the STORED line.
		await call('authored-sess2', {
			kind: 'authored',
			id,
			voice: ORACLE_VOICE,
			text: 'Whatever a caller wants spoken for free.'
		});

		expect(tts.synthesizeStream).toHaveBeenCalledExactlyOnceWith(
			synthPrompt(ORACLE_VOICE, stored),
			ORACLE_VOICE,
			false // an authored line is unique — never cached
		);
	});

	it('voices the deterministic fallback when the authored synth makes no audio (quota 429)', async () => {
		const authored = 'Yes — the flame-sign flares; Sól reaches for fire.';
		const fallback = 'Yes. She reaches for the fire rune.';
		const id = storeVoiceLine('authored-429', authored, ORACLE_VOICE, fallback);
		// Authored (unique) yields nothing — its synth 429'd; the deterministic line then voices.
		tts.synthesizeStream
			.mockReturnValueOnce(streamOf()) // authored: no audio
			.mockReturnValueOnce(streamOf('pcm')); // fallback: the cacheable clip

		const response = await call('authored-429', {
			kind: 'authored',
			id,
			voice: ORACLE_VOICE,
			text: authored
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('pcm\n');
		expect(tts.synthesizeStream).toHaveBeenNthCalledWith(
			1,
			synthPrompt(ORACLE_VOICE, authored),
			ORACLE_VOICE,
			false // authored is unique — never cached
		);
		// The fallback is the deterministic line, voiced cacheable so it replays free while quota stays out.
		expect(tts.synthesizeStream).toHaveBeenNthCalledWith(
			2,
			synthPrompt(ORACLE_VOICE, fallback),
			ORACLE_VOICE,
			true
		);
	});

	it('never reaches for the fallback when the authored synth voices', async () => {
		const authored = 'No — she turns from the flame.';
		const id = storeVoiceLine('authored-ok', authored, ORACLE_VOICE, 'No. Not fire.');
		tts.synthesizeStream.mockReturnValueOnce(streamOf('pcm')); // authored voiced

		await call('authored-ok', { kind: 'authored', id, voice: ORACLE_VOICE, text: authored });

		expect(tts.synthesizeStream).toHaveBeenCalledTimes(1); // the deterministic line is untouched
	});

	it('refuses an authored line whose id is unknown to the session (no store entry)', async () => {
		const response = await call('authored-sess3', {
			kind: 'authored',
			id: 'no-such-id',
			voice: ORACLE_VOICE,
			text: 'arbitrary'
		});
		expect(response.status).toBe(400);
		expect(tts.synthesizeStream).not.toHaveBeenCalled();
	});

	it('does not cross sessions — an id stored for one session is unknown to another', async () => {
		const id = storeVoiceLine('owner-sess', 'her line', ORACLE_VOICE, 'her plain line');
		const response = await call('other-sess', {
			kind: 'authored',
			id,
			voice: ORACLE_VOICE,
			text: 'x'
		});
		expect(response.status).toBe(400);
		expect(tts.synthesizeStream).not.toHaveBeenCalled();
	});

	it('rejects a well-shaped but non-allow-listed line with 400', async () => {
		const response = await call('not-listed', { kind: 'refusal', refusal: 'made-up' });
		expect(response.status).toBe(400);
		expect(tts.synthesizeStream).not.toHaveBeenCalled();
	});

	it('serves a cached line without spending a synth slot or needing the key', async () => {
		tts.isCached.mockReturnValue(true);
		mock.env.GEMINI_API_KEY = undefined;
		tts.synthesizeStream.mockReturnValue(streamOf('cached-pcm'));

		// Drain far past the per-session synth limit — cached replays never charge it.
		for (let i = 0; i < TTS_SESSION_LIMIT + 5; i++) {
			expect((await call('cache-fan', { kind: 'refusal', refusal: 'empty' })).status).toBe(200);
		}
	});

	it('returns 503 for an uncached line when the key is not configured', async () => {
		mock.env.GEMINI_API_KEY = undefined;

		const response = await call('keyless', { kind: 'refusal', refusal: 'empty' });

		expect(response.status).toBe(503);
		expect((await response.json()).error).toBe('Voice is unavailable.');
		expect(tts.synthesizeStream).not.toHaveBeenCalled();
	});

	it('rejects an uncached request over the per-session limit with 429 and retry-after', async () => {
		tts.synthesizeStream.mockReturnValue(streamOf('pcm'));
		for (let i = 0; i < TTS_SESSION_LIMIT; i++) {
			expect((await call('greedy', { kind: 'refusal', refusal: 'empty' })).status).toBe(200);
		}

		const response = await call('greedy', { kind: 'refusal', refusal: 'empty' });

		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('60');
		expect(tts.synthesizeStream).toHaveBeenCalledTimes(TTS_SESSION_LIMIT);
	});

	it('closes the stream cleanly when the synth generator throws mid-stream — no unhandled rejection', async () => {
		// The route guards the pump: a generator that yields one chunk then throws (a torn stream / client
		// disconnect) is caught and the stream is closed deliberately, matching every other voice path.
		// The response stays a 200 NDJSON carrying the chunk that did arrive; draining it resolves rather
		// than rejecting or hanging.
		tts.synthesizeStream.mockReturnValueOnce(
			(async function* () {
				yield 'pcm-a';
				throw new Error('synth blew up mid-stream');
			})()
		);

		const response = await call('mid-stream-throw', { kind: 'refusal', refusal: 'empty' });

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/x-ndjson');
		// The pre-throw chunk lands; the throw is swallowed and the stream closed — the drain resolves.
		expect(await response.text()).toBe('pcm-a\n');
	});
});
