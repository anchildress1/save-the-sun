import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const audio = vi.hoisted(() => ({
	openMic: vi.fn(),
	createSpeaker: vi.fn()
}));
vi.mock('$lib/voice/audio', () => audio);

const sdk = vi.hoisted(() => {
	const connect = vi.fn();
	const GoogleGenAI = vi.fn(function (this: { live: { connect: typeof connect } }) {
		this.live = { connect };
	});
	return { connect, GoogleGenAI };
});
vi.mock('@google/genai', () => ({ GoogleGenAI: sdk.GoogleGenAI, Modality: { AUDIO: 'AUDIO' } }));

import { createVoiceSession, type VoiceEvent, type VoiceSession } from '$lib/voice/voiceSession';
import { LIVE_MODEL, ORACLE_VOICE } from '$lib/voice/config';
import { ORACLE_SYSTEM_INSTRUCTION } from '$lib/voice/oraclePersona';

interface Callbacks {
	onmessage: (message: unknown) => void;
	onerror: (event: { message?: string }) => void;
	onclose: (event: { code?: number }) => void;
}

let vs: VoiceSession;
let events: VoiceEvent[];
let micChunk: ((base64Pcm: string, amplitude: number) => void) | undefined;
let micStop: ReturnType<typeof vi.fn>;
let speaker: {
	enqueue: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
	busy: boolean;
	onDrained: ReturnType<typeof vi.fn>;
	drain: (() => void) | undefined;
};
let callbacks: Callbacks | undefined;
let liveSession: { sendRealtimeInput: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
let fetchMock: ReturnType<typeof vi.fn>;

function tokenResponse(body: unknown = { token: 'auth_tokens/t1' }, ok = true, status = 200) {
	return { ok, status, json: async () => body };
}

const eventTypes = () => events.map((e) => e.type);
const teeBodies = () =>
	fetchMock.mock.calls
		.filter(([url]) => url === '/api/voice/debug')
		.map(([, init]) => (init as { body: string }).body);
const tokenCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/voice/token');

/** Drives wake() through mic + token + connect, then completes Live setup. */
async function awaken(): Promise<Promise<void>> {
	const woke = vs.wake();
	await vi.advanceTimersByTimeAsync(0);
	callbacks!.onmessage({ setupComplete: {} });
	await woke;
	return woke;
}

beforeEach(() => {
	vi.useFakeTimers();
	micChunk = undefined;
	callbacks = undefined;
	micStop = vi.fn();
	audio.openMic.mockImplementation(async (onChunk: typeof micChunk) => {
		micChunk = onChunk;
		return { ok: true, mic: { stop: micStop } };
	});
	speaker = {
		enqueue: vi.fn(),
		stop: vi.fn(),
		close: vi.fn(),
		busy: false,
		onDrained: vi.fn((cb: () => void) => {
			speaker.drain = cb;
		}),
		drain: undefined
	};
	audio.createSpeaker.mockReturnValue(speaker);
	liveSession = { sendRealtimeInput: vi.fn(), close: vi.fn() };
	sdk.connect.mockImplementation(async ({ callbacks: registered }: { callbacks: Callbacks }) => {
		callbacks = registered;
		return liveSession;
	});
	fetchMock = vi.fn(async (url: string) =>
		url === '/api/voice/token' ? tokenResponse() : { ok: true, status: 204 }
	);
	vi.stubGlobal('fetch', fetchMock);
	vs = createVoiceSession();
	events = [];
	vs.subscribe((event) => events.push(event));
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('voiceSession wake', () => {
	it('opens the mic before minting a token — a denial never burns a mint slot', async () => {
		await awaken();
		expect(audio.openMic.mock.invocationCallOrder[0]).toBeLessThan(
			fetchMock.mock.invocationCallOrder[0]
		);
		expect(tokenCalls()).toHaveLength(1);
		expect(tokenCalls()[0][1]).toMatchObject({ method: 'POST' });
	});

	it('connects on the ephemeral token with the locked model, Gacrux, persona, and transcription', async () => {
		await awaken();
		expect(sdk.GoogleGenAI).toHaveBeenCalledExactlyOnceWith({
			apiKey: 'auth_tokens/t1',
			httpOptions: { apiVersion: 'v1alpha' }
		});
		expect(sdk.connect).toHaveBeenCalledTimes(1);
		expect(sdk.connect.mock.calls[0][0]).toMatchObject({
			model: LIVE_MODEL,
			config: {
				responseModalities: ['AUDIO'],
				speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: ORACLE_VOICE } } },
				systemInstruction: ORACLE_SYSTEM_INSTRUCTION,
				inputAudioTranscription: {},
				outputAudioTranscription: {}
			}
		});
	});

	it('emits listening once setup completes and tees the awake event', async () => {
		await awaken();
		expect(vs.state).toBe('listening');
		expect(eventTypes()).toEqual(['listening']);
		expect(teeBodies().join(' ')).toContain('voice session awake');
	});

	it('ignores a second wake while already awake', async () => {
		await awaken();
		await vs.wake();
		expect(audio.openMic).toHaveBeenCalledTimes(1);
	});

	it('drops mic chunks captured before the socket is ready', async () => {
		const woke = vs.wake();
		await vi.advanceTimersByTimeAsync(0);
		micChunk!('early', 0.5);
		expect(liveSession.sendRealtimeInput).not.toHaveBeenCalled();
		callbacks!.onmessage({ setupComplete: {} });
		await woke;
		micChunk!('ontime', 0.5);
		expect(liveSession.sendRealtimeInput).toHaveBeenCalledTimes(1);
	});
});

describe('voiceSession mic streaming and player states', () => {
	beforeEach(async () => {
		await awaken();
		events = [];
	});

	it('streams chunks to the session as 16kHz PCM', () => {
		micChunk!('YmFzZTY0', 0.001);
		expect(liveSession.sendRealtimeInput).toHaveBeenCalledExactlyOnceWith({
			audio: { data: 'YmFzZTY0', mimeType: 'audio/pcm;rate=16000' }
		});
	});

	it('emits hearing with live amplitude on every loud chunk', () => {
		micChunk!('a', 0.5);
		micChunk!('b', 0.3);
		expect(events).toEqual([
			{ type: 'hearing', amplitude: 0.5 },
			{ type: 'hearing', amplitude: 0.3 }
		]);
		expect(vs.state).toBe('hearing');
	});

	it('settles from hearing into thinking after the quiet hold', async () => {
		micChunk!('a', 0.5);
		micChunk!('b', 0.001);
		expect(vs.state).toBe('hearing');
		await vi.advanceTimersByTimeAsync(800);
		expect(vs.state).toBe('thinking');
		expect(eventTypes()).toEqual(['hearing', 'thinking']);
	});

	it('continued speech cancels the pending thinking hold', async () => {
		micChunk!('a', 0.5);
		micChunk!('b', 0.001);
		await vi.advanceTimersByTimeAsync(400);
		micChunk!('c', 0.5);
		await vi.advanceTimersByTimeAsync(800);
		expect(vs.state).toBe('hearing');
	});

	it('rescues a thinking state no reply ever answers back to listening', async () => {
		micChunk!('a', 0.5);
		micChunk!('b', 0.001);
		await vi.advanceTimersByTimeAsync(800);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(vs.state).toBe('listening');
		expect(eventTypes()).toEqual(['hearing', 'thinking', 'listening']);
	});

	it('keeps streaming while the Oracle speaks but never flips to hearing on local echo', () => {
		callbacks!.onmessage({
			serverContent: { modelTurn: { parts: [{ inlineData: { data: 'b64audio' } }] } }
		});
		events = [];
		micChunk!('echo', 0.9);
		expect(liveSession.sendRealtimeInput).toHaveBeenCalledTimes(1);
		expect(events).toEqual([]);
		expect(vs.state).toBe('speaking');
	});
});

describe('voiceSession oracle speech', () => {
	beforeEach(async () => {
		await awaken();
		events = [];
	});

	it('enqueues audio parts and emits speaking once per turn', () => {
		callbacks!.onmessage({
			serverContent: {
				modelTurn: { parts: [{ inlineData: { data: 'one' } }, { inlineData: { data: 'two' } }] }
			}
		});
		callbacks!.onmessage({
			serverContent: { modelTurn: { parts: [{ inlineData: { data: 'three' } }] } }
		});
		expect(speaker.enqueue.mock.calls.flat()).toEqual(['one', 'two', 'three']);
		expect(eventTypes()).toEqual(['speaking']);
	});

	it('returns to listening only after playback drains past turnComplete', () => {
		callbacks!.onmessage({
			serverContent: { modelTurn: { parts: [{ inlineData: { data: 'one' } }] } }
		});
		speaker.busy = true;
		callbacks!.onmessage({ serverContent: { turnComplete: true } });
		expect(vs.state).toBe('speaking');
		speaker.busy = false;
		speaker.drain!();
		expect(vs.state).toBe('listening');
		expect(eventTypes()).toEqual(['speaking', 'listening']);
	});

	it('returns to listening immediately when turnComplete finds the speaker idle', () => {
		callbacks!.onmessage({
			serverContent: { modelTurn: { parts: [{ inlineData: { data: 'one' } }] } }
		});
		callbacks!.onmessage({ serverContent: { turnComplete: true } });
		expect(vs.state).toBe('listening');
	});

	it('a mid-turn buffer gap never reads as the turn ending', () => {
		callbacks!.onmessage({
			serverContent: { modelTurn: { parts: [{ inlineData: { data: 'one' } }] } }
		});
		speaker.drain!();
		expect(vs.state).toBe('speaking');
	});

	it('barge-in stops playback at once and shows hearing', () => {
		callbacks!.onmessage({
			serverContent: { modelTurn: { parts: [{ inlineData: { data: 'one' } }] } }
		});
		callbacks!.onmessage({ serverContent: { interrupted: true } });
		expect(speaker.stop).toHaveBeenCalledTimes(1);
		expect(vs.state).toBe('hearing');
	});

	it('barge-in cancels a pending drain so the stale turn never flips state later', () => {
		callbacks!.onmessage({
			serverContent: { modelTurn: { parts: [{ inlineData: { data: 'one' } }] } }
		});
		speaker.busy = true;
		callbacks!.onmessage({ serverContent: { turnComplete: true } });
		callbacks!.onmessage({ serverContent: { interrupted: true } });
		speaker.busy = false;
		speaker.drain!();
		expect(vs.state).toBe('hearing');
	});

	it('audio arriving from thinking cancels the rescue fallback', async () => {
		micChunk!('a', 0.5);
		micChunk!('b', 0.001);
		await vi.advanceTimersByTimeAsync(800);
		callbacks!.onmessage({
			serverContent: { modelTurn: { parts: [{ inlineData: { data: 'one' } }] } }
		});
		await vi.advanceTimersByTimeAsync(10_000);
		expect(vs.state).toBe('speaking');
	});

	it('relays input and output transcripts', () => {
		callbacks!.onmessage({ serverContent: { inputTranscription: { text: 'cast the rune' } } });
		callbacks!.onmessage({ serverContent: { outputTranscription: { text: 'It is cast.' } } });
		expect(events).toEqual([
			{ type: 'transcript', direction: 'in', text: 'cast the rune' },
			{ type: 'transcript', direction: 'out', text: 'It is cast.' }
		]);
	});

	it('ignores server messages with no content', () => {
		callbacks!.onmessage({});
		callbacks!.onmessage({ serverContent: {} });
		expect(events).toEqual([]);
	});
});

describe('voiceSession sleep', () => {
	it('closes mic, socket, and speaker, then emits asleep', async () => {
		await awaken();
		events = [];
		vs.sleep();
		expect(micStop).toHaveBeenCalledTimes(1);
		expect(liveSession.close).toHaveBeenCalledTimes(1);
		expect(speaker.close).toHaveBeenCalledTimes(1);
		expect(eventTypes()).toEqual(['asleep']);
		expect(vs.state).toBe('asleep');
		expect(teeBodies().join(' ')).toContain('voice session slept');
	});

	it('sleep while already asleep is a no-op', () => {
		vs.sleep();
		expect(events).toEqual([]);
	});

	it('sleep mid-wake aborts silently and releases the mic', async () => {
		const woke = vs.wake();
		await vi.advanceTimersByTimeAsync(0);
		vs.sleep();
		await woke;
		expect(micStop).toHaveBeenCalledTimes(1);
		expect(events).toEqual([]);
		expect(vs.state).toBe('asleep');
	});

	it('sleep racing the mic grant releases the mic the moment it lands', async () => {
		let grantMic!: (verdict: unknown) => void;
		audio.openMic.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					grantMic = resolve;
				})
		);
		const woke = vs.wake();
		vs.sleep();
		grantMic({ ok: true, mic: { stop: micStop } });
		await woke;
		expect(micStop).toHaveBeenCalledTimes(1);
		expect(events).toEqual([]);
		expect(tokenCalls()).toHaveLength(0);
	});

	it('an unsubscribed listener hears nothing', async () => {
		const gone = vi.fn();
		const unsubscribe = vs.subscribe(gone);
		unsubscribe();
		await awaken();
		expect(gone).not.toHaveBeenCalled();
		expect(events).toEqual([{ type: 'listening' }]);
	});

	it('a stale socket close after sleep stays silent', async () => {
		await awaken();
		vs.sleep();
		events = [];
		callbacks!.onclose({ code: 1000 });
		expect(events).toEqual([]);
	});

	it('can wake again after sleeping', async () => {
		await awaken();
		vs.sleep();
		await awaken();
		expect(vs.state).toBe('listening');
		expect(audio.openMic).toHaveBeenCalledTimes(2);
	});
});

describe('voiceSession failures', () => {
	it.each([
		['mic-permission', 'The fire cannot hear you. The rite continues by hand.'],
		['mic-missing', 'No voice reaches the fire. The rite continues by hand.'],
		['audio', 'No voice reaches the fire. The rite continues by hand.']
	] as const)('mic failure %s emits its notice and never mints a token', async (reason, notice) => {
		audio.openMic.mockResolvedValueOnce({ ok: false, reason, detail: 'NotAllowedError: denied' });
		await vs.wake();
		expect(events).toEqual([{ type: 'error', reason, notice }]);
		expect(tokenCalls()).toHaveLength(0);
		expect(vs.state).toBe('asleep');
		expect(teeBodies().join(' ')).toContain('NotAllowedError: denied');
	});

	it.each([
		['endpoint denial', () => tokenResponse({ error: 'nope' }, false, 429)],
		['missing token in body', () => tokenResponse({})],
		[
			'network rejection',
			() => {
				throw new Error('offline');
			}
		]
	])('token failure (%s) emits error token and releases the mic', async (_label, respond) => {
		fetchMock.mockImplementation(async (url: string) => {
			if (url === '/api/voice/token') return respond();
			return { ok: true, status: 204 };
		});
		await vs.wake();
		expect(events).toEqual([
			{
				type: 'error',
				reason: 'token',
				notice: 'The fire does not carry your voice tonight. The rite continues by hand.'
			}
		]);
		expect(micStop).toHaveBeenCalledTimes(1);
		expect(sdk.connect).not.toHaveBeenCalled();
		expect(vs.state).toBe('asleep');
	});

	it('connect rejection emits error socket and scrubs the token from the debug tee', async () => {
		sdk.connect.mockRejectedValueOnce(
			new Error('rejected at wss://host?access_token=auth_tokens/t1')
		);
		await vs.wake();
		expect(events.filter((e) => e.type === 'error')).toEqual([
			{
				type: 'error',
				reason: 'socket',
				notice: "The Oracle's voice falters. The rite continues by hand."
			}
		]);
		const teed = teeBodies().join(' ');
		expect(teed).toContain('[ephemeral-token]');
		expect(teed).not.toContain('auth_tokens/t1');
		expect(micStop).toHaveBeenCalledTimes(1);
	});

	it('a setup that never completes times out into error socket', async () => {
		const woke = vs.wake();
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(10_000);
		await woke;
		expect(eventTypes()).toEqual(['error']);
		expect(events[0]).toMatchObject({ reason: 'socket' });
		expect(vs.state).toBe('asleep');
		expect(micStop).toHaveBeenCalledTimes(1);
	});

	it('a socket that closes during setup fails the wake exactly once', async () => {
		const woke = vs.wake();
		await vi.advanceTimersByTimeAsync(0);
		callbacks!.onclose({ code: 1011 });
		await woke;
		expect(eventTypes()).toEqual(['error']);
		expect(vs.state).toBe('asleep');
	});

	it.each([
		['close', (cbs: Callbacks) => cbs.onclose({ code: 1006 })],
		['error', (cbs: Callbacks) => cbs.onerror({ message: 'reset' })]
	])(
		'socket %s after awake emits error, tears down, and reverts to asleep',
		async (_label, down) => {
			await awaken();
			events = [];
			down(callbacks!);
			expect(events).toEqual([
				{
					type: 'error',
					reason: 'socket',
					notice: "The Oracle's voice falters. The rite continues by hand."
				},
				{ type: 'asleep' }
			]);
			expect(micStop).toHaveBeenCalledTimes(1);
			expect(speaker.close).toHaveBeenCalledTimes(1);
			expect(vs.state).toBe('asleep');
		}
	);

	it('sleep racing the connect closes the freshly opened socket instead of leaking it', async () => {
		let finishConnect!: (session: unknown) => void;
		sdk.connect.mockImplementationOnce(
			({ callbacks: registered }: { callbacks: Callbacks }) =>
				new Promise((resolve) => {
					callbacks = registered;
					finishConnect = () => resolve(liveSession);
				})
		);
		const woke = vs.wake();
		await vi.advanceTimersByTimeAsync(0);
		vs.sleep();
		finishConnect(liveSession);
		await woke;
		expect(liveSession.close).toHaveBeenCalledTimes(1);
		expect(events).toEqual([]);
		expect(vs.state).toBe('asleep');
	});

	it('a double-tap wake runs the sequence once', async () => {
		const first = vs.wake();
		const second = vs.wake();
		await vi.advanceTimersByTimeAsync(0);
		callbacks!.onmessage({ setupComplete: {} });
		await Promise.all([first, second]);
		expect(audio.openMic).toHaveBeenCalledTimes(1);
		expect(tokenCalls()).toHaveLength(1);
		expect(eventTypes()).toEqual(['listening']);
	});

	it('can wake cleanly after a failed wake', async () => {
		audio.openMic.mockResolvedValueOnce({ ok: false, reason: 'audio', detail: 'no context' });
		await vs.wake();
		events = [];
		await awaken();
		expect(vs.state).toBe('listening');
		expect(eventTypes()).toEqual(['listening']);
	});

	it('a socket close during setup carries its close code into the tee', async () => {
		const woke = vs.wake();
		await vi.advanceTimersByTimeAsync(0);
		callbacks!.onclose({ code: 1011 });
		await woke;
		expect(teeBodies().join(' ')).toContain('close 1011');
	});

	it('tees the first failed send once, not per chunk', async () => {
		await awaken();
		liveSession.sendRealtimeInput.mockImplementation(() => {
			throw new Error('serialization blew up');
		});
		micChunk!('a', 0.5);
		micChunk!('b', 0.5);
		const sendTees = teeBodies().filter((b) => b.includes('voice send failed'));
		expect(sendTees).toHaveLength(1);
		expect(sendTees[0]).toContain('serialization blew up');
	});

	it('a malformed audio chunk is dropped without reaching speaking', async () => {
		await awaken();
		events = [];
		speaker.enqueue.mockImplementation(() => {
			throw new Error('bad base64');
		});
		callbacks!.onmessage({
			serverContent: { modelTurn: { parts: [{ inlineData: { data: '!!!' } }] } }
		});
		expect(events).toEqual([]);
		expect(vs.state).toBe('listening');
		expect(teeBodies().join(' ')).toContain('voice audio chunk rejected');
	});

	it('a throwing subscriber never starves the others', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const broken = vi.fn(() => {
			throw new Error('subscriber bug');
		});
		vs.subscribe(broken);
		const after = vi.fn();
		vs.subscribe(after);
		await awaken();
		expect(broken).toHaveBeenCalled();
		expect(after).toHaveBeenCalledWith({ type: 'listening' });
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it('an unreachable debug tee falls back to the console', async () => {
		const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		fetchMock.mockImplementation(async (url: string) => {
			if (url === '/api/voice/token') return tokenResponse();
			throw new Error('tee down');
		});
		await awaken();
		await vi.advanceTimersByTimeAsync(0);
		expect(consoleWarn).toHaveBeenCalledWith(
			'[voice] debug tee unreachable:',
			'voice session awake'
		);
		consoleWarn.mockRestore();
	});

	it('a rejected debug tee falls back to the console with the status', async () => {
		const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		fetchMock.mockImplementation(async (url: string) =>
			url === '/api/voice/token' ? tokenResponse() : { ok: false, status: 400 }
		);
		await awaken();
		await vi.advanceTimersByTimeAsync(0);
		expect(consoleWarn).toHaveBeenCalledWith(
			'[voice] debug tee rejected:',
			400,
			'voice session awake'
		);
		consoleWarn.mockRestore();
	});

	it('a speaker setup failure releases the mic, reports audio failure, and allows retry', async () => {
		audio.createSpeaker.mockImplementationOnce(() => {
			throw new Error('no output device');
		});

		await vs.wake();

		expect(events).toEqual([
			{
				type: 'error',
				reason: 'audio',
				notice: 'No voice reaches the fire. The rite continues by hand.'
			}
		]);
		expect(micStop).toHaveBeenCalledTimes(1);
		expect(vs.state).toBe('asleep');

		events = [];
		await awaken();

		expect(vs.state).toBe('listening');
		expect(eventTypes()).toEqual(['listening']);
	});

	it('a failing debug tee never disturbs the session', async () => {
		fetchMock.mockImplementation(async (url: string) => {
			if (url === '/api/voice/token') return tokenResponse();
			throw new Error('tee down');
		});
		await awaken();
		expect(vs.state).toBe('listening');
	});

	it('a send racing the socket death is swallowed', async () => {
		await awaken();
		liveSession.sendRealtimeInput.mockImplementation(() => {
			throw new Error('socket is closed');
		});
		expect(() => micChunk!('a', 0.5)).not.toThrow();
		expect(vs.state).toBe('listening');
	});

	it('a session close that throws during teardown is swallowed', async () => {
		await awaken();
		liveSession.close.mockImplementation(() => {
			throw new Error('already closed');
		});
		vs.sleep();
		expect(vs.state).toBe('asleep');
	});
});
