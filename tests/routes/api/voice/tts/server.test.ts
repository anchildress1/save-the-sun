import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tts = vi.hoisted(() => ({
	synthesizeStream: vi.fn(),
	isCached: vi.fn<(text: string, voice: string) => boolean>(() => false)
}));
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
import { getEvents } from '$lib/server/debug/log';
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
			true, // a recomposed line caches and replays
			'happy'
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
		expect(tts.synthesizeStream).toHaveBeenCalledExactlyOnceWith(prompt, SKOLL_VOICE, true, 'wolf');
	});

	it('voices Sköll’s winning cast in his voice, naming the board rune', async () => {
		tts.synthesizeStream.mockReturnValueOnce(streamOf('grr'));
		const line = skollCastEcho('Sowilo');

		const response = await call('wolf-cast', { kind: 'skoll-cast', rune: 'Sowilo' });

		expect(response.status).toBe(200);
		const prompt = synthPrompt(SKOLL_VOICE, line);
		expect(prompt).toContain(`"${line}"`);
		expect(tts.synthesizeStream).toHaveBeenCalledExactlyOnceWith(
			prompt,
			SKOLL_VOICE,
			true,
			'wolf-cast'
		);
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

	it('tees the voice outcome to /debug so a silent Oracle is diagnosable', async () => {
		tts.synthesizeStream.mockReturnValueOnce(streamOf('pcm'));
		const ok = await call('log-ok', { kind: 'refusal', refusal: 'empty' });
		await ok.text(); // consume the stream so its start() runs and the outcome logs
		// The tee carries the spoken line, so two different lines in one voice read apart.
		const voiced = getEvents('log-ok').find((e) => e.part === 'Voice');
		expect(voiced?.message).toBe(`TTS — voiced: "${refusalLine('empty')}"`);

		// An unresolvable line used to 400 silently — now it leaves a trace to follow.
		const res = await call('log-bad', {
			kind: 'authored',
			id: 'nope',
			voice: ORACLE_VOICE,
			text: 'x'
		});
		expect(res.status).toBe(400);
		expect(
			getEvents('log-bad').some(
				(e) => e.level === 'warn' && /TTS — refused.*unknown/.test(e.message)
			)
		).toBe(true);
	});

	it('distinguishes two different lines in one voice — his cast and his Ask read apart', async () => {
		// The end of a Sköll win voices two of his lines back to back; the tee must tell them apart
		// instead of logging both as an indistinguishable bare "voiced".
		tts.synthesizeStream.mockImplementation(() => streamOf('pcm'));
		const castLine = skollCastEcho('Sowilo');
		const query = { axis: 'element', value: 'Fire' };
		const askLine = skollAskEcho(query as Parameters<typeof skollAskEcho>[0]);

		await (await call('two-skoll', { kind: 'skoll-cast', rune: 'Sowilo' })).text();
		await (await call('two-skoll', { kind: 'skoll-ask', query })).text();

		const voiced = getEvents('two-skoll')
			.filter((e) => e.part === 'Voice')
			.map((e) => e.message);
		expect(voiced).toEqual([`TTS — voiced: "${castLine}"`, `TTS — voiced: "${askLine}"`]);
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
			false, // an authored line is unique — never cached
			'authored-sess'
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
			false, // an authored line is unique — never cached
			'authored-sess2'
		);
	});

	it('replays the cached fallback when the authored synth makes no audio', async () => {
		const authored = 'Yes — the flame-sign flares; Sól reaches for fire.';
		const fallback = 'Yes. She reaches for the fire rune.';
		const fallbackPrompt = synthPrompt(ORACLE_VOICE, fallback);
		const id = storeVoiceLine('authored-fb', authored, ORACLE_VOICE, fallback);
		// The deterministic fallback is already cached; the authored synth yields nothing (a mid-stream
		// failure), so the cached fallback replays free — no second uncapped Gemini call.
		tts.isCached.mockImplementation((text) => text === fallbackPrompt);
		tts.synthesizeStream
			.mockReturnValueOnce(streamOf()) // authored: no audio
			.mockReturnValueOnce(streamOf('pcm')); // fallback: the cached clip replays

		const response = await call('authored-fb', {
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
			false,
			'authored-fb'
		);
		expect(tts.synthesizeStream).toHaveBeenNthCalledWith(
			2,
			fallbackPrompt,
			ORACLE_VOICE,
			true,
			'authored-fb'
		);
	});

	it('stays silent — no second synth — when the authored synth fails and the fallback is uncached', async () => {
		const authored = 'Yes — flare, unique.';
		const id = storeVoiceLine('authored-nofb', authored, ORACLE_VOICE, 'Yes. Plain, uncached.');
		// Nothing cached (default). The authored synth yields nothing, so the route must NOT start a
		// second, uncapped synth for the fallback — it stays silent (the panel carries the line).
		tts.synthesizeStream.mockReturnValueOnce(streamOf()); // authored: no audio

		const response = await call('authored-nofb', {
			kind: 'authored',
			id,
			voice: ORACLE_VOICE,
			text: authored
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('');
		expect(tts.synthesizeStream).toHaveBeenCalledTimes(1); // only the authored attempt, no fallback synth
	});

	it('gates an authored line even when its prompt collides with the cache — keyless yields 503, not a silent 200', async () => {
		const authored = 'Yes — a coincidental cache hit.';
		const authoredPrompt = synthPrompt(ORACLE_VOICE, authored);
		const id = storeVoiceLine(
			'authored-collide',
			authored,
			ORACLE_VOICE,
			'Yes. Uncached fallback.'
		);
		// The authored prompt *looks* cached, but it never replays from its own (unique) prompt, so the
		// gate must still run; its fallback is uncached and the key is gone.
		tts.isCached.mockImplementation((text: string) => text === authoredPrompt);
		mock.env.GEMINI_API_KEY = undefined;

		const response = await call('authored-collide', {
			kind: 'authored',
			id,
			voice: ORACLE_VOICE,
			text: authored
		});

		expect(response.status).toBe(503);
		expect(tts.synthesizeStream).not.toHaveBeenCalled();
	});

	it('serves the cached fallback when an authored line is quota-denied, not a silent 429', async () => {
		const authored = 'Yes — unique every call.';
		const fallback = 'Yes. The plain truth.';
		const fallbackPrompt = synthPrompt(ORACLE_VOICE, fallback);
		const id = storeVoiceLine('authored-q', authored, ORACLE_VOICE, fallback);
		// Only the deterministic fallback is cached; the authored prompt and the drain lines are not.
		tts.isCached.mockImplementation((text: string) => text === fallbackPrompt);
		tts.synthesizeStream.mockImplementation(() => streamOf('pcm'));

		// Spend the per-session synth quota on uncached lines.
		for (let i = 0; i < TTS_SESSION_LIMIT; i++) {
			expect((await call('authored-q', { kind: 'refusal', refusal: 'empty' })).status).toBe(200);
		}
		tts.synthesizeStream.mockClear();

		// Quota-denied — but the fallback is cached, so it replays free (200) instead of going silent.
		const response = await call('authored-q', {
			kind: 'authored',
			id,
			voice: ORACLE_VOICE,
			text: authored
		});
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('pcm\n');
		expect(tts.synthesizeStream).toHaveBeenCalledExactlyOnceWith(
			fallbackPrompt,
			ORACLE_VOICE,
			true,
			'authored-q'
		);
	});

	it('voices the cached fallback for an authored line when the key is unset, not 503', async () => {
		const authored = 'Yes — authored, keyless.';
		const fallback = 'Yes. Plain, cached.';
		const fallbackPrompt = synthPrompt(ORACLE_VOICE, fallback);
		const id = storeVoiceLine('authored-keyless', authored, ORACLE_VOICE, fallback);
		tts.isCached.mockImplementation((text: string) => text === fallbackPrompt);
		tts.synthesizeStream.mockImplementation(() => streamOf('pcm'));
		mock.env.GEMINI_API_KEY = undefined;

		const response = await call('authored-keyless', {
			kind: 'authored',
			id,
			voice: ORACLE_VOICE,
			text: authored
		});
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('pcm\n');
		expect(tts.synthesizeStream).toHaveBeenCalledExactlyOnceWith(
			fallbackPrompt,
			ORACLE_VOICE,
			true,
			'authored-keyless'
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
