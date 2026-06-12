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
vi.mock('@google/genai', () => ({
	GoogleGenAI: sdk.GoogleGenAI,
	Modality: { AUDIO: 'AUDIO' },
	// oraclePersona builds its tool declarations from the enum — the mock must carry it.
	Type: { OBJECT: 'OBJECT', STRING: 'STRING' }
}));

import { createVoiceSession, type VoiceEvent, type VoiceSession } from '$lib/voice/voiceSession';
import { LIVE_MODEL, ORACLE_VOICE } from '$lib/voice/config';
import {
	ORACLE_INVITATION_TRIGGER,
	ORACLE_SYSTEM_INSTRUCTION,
	ORACLE_TOOL_DECLARATIONS
} from '$lib/voice/oraclePersona';

interface Callbacks {
	onmessage: (message: unknown) => void;
	// The SDK types these as required, but a dying transport can invoke them bare — the
	// session must survive a payloadless callback, so the tests can send one.
	onerror: (event?: { message?: string }) => void;
	onclose: (event?: { code?: number; reason?: string }) => void;
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
let liveSession: {
	sendRealtimeInput: ReturnType<typeof vi.fn>;
	sendClientContent: ReturnType<typeof vi.fn>;
	sendToolResponse: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
};
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
	liveSession = {
		sendRealtimeInput: vi.fn(),
		sendClientContent: vi.fn(),
		sendToolResponse: vi.fn(),
		close: vi.fn()
	};
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

	it('announces waking synchronously at the tap — the UI never reads asleep while the mic opens', async () => {
		const woke = vs.wake();
		expect(vs.state).toBe('waking');
		expect(eventTypes()).toEqual(['waking']);
		await vi.advanceTimersByTimeAsync(0);
		callbacks!.onmessage({ setupComplete: {} });
		await woke;
		expect(vs.state).toBe('listening');
	});

	it('emits listening once setup completes and tees the awake event', async () => {
		await awaken();
		expect(vs.state).toBe('listening');
		expect(eventTypes()).toEqual(['waking', 'listening']);
		expect(teeBodies().join(' ')).toContain('voice session awake');
	});

	it('mints the token under an abort timeout so a hung endpoint fails the wake', async () => {
		await awaken();
		expect((tokenCalls()[0][1] as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
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

	it('sleep mid-quiet-hold clears the timer — no ghost thinking after the mic closes', async () => {
		micChunk!('a', 0.5);
		micChunk!('b', 0.001); // arms the quiet hold
		vs.sleep();
		events = [];
		await vi.advanceTimersByTimeAsync(11_000);
		expect(events).toEqual([]);
		expect(vs.state).toBe('asleep');
	});

	it('sleep while thinking clears the rescue — a dead session never rescues later', async () => {
		micChunk!('a', 0.5);
		micChunk!('b', 0.001);
		await vi.advanceTimersByTimeAsync(800); // thinking, rescue armed
		vs.sleep();
		events = [];
		await vi.advanceTimersByTimeAsync(10_000);
		expect(events).toEqual([]);
		expect(teeBodies().join(' ')).not.toContain('thinking rescue fired');
	});

	it('a second thinking inside one rescue window re-arms it — the stale timer never fires early', async () => {
		micChunk!('a', 0.5);
		micChunk!('b', 0.001);
		await vi.advanceTimersByTimeAsync(800); // thinking #1 at t=800; its rescue would fire at t=10800
		callbacks!.onmessage({ serverContent: { interrupted: true } }); // barge-in back to hearing
		micChunk!('c', 0.001);
		await vi.advanceTimersByTimeAsync(800); // thinking #2 at t=1600; re-armed rescue due t=11600
		expect(vs.state).toBe('thinking');
		await vi.advanceTimersByTimeAsync(9_500); // t=11100 — past the stale timer's mark, before the live one
		expect(vs.state).toBe('thinking');
		await vi.advanceTimersByTimeAsync(500); // t=11600 — the re-armed rescue fires once
		expect(vs.state).toBe('listening');
		expect(teeBodies().filter((b) => b.includes('thinking rescue fired'))).toHaveLength(1);
	});

	it('a rescue landing after the turn settled stays silent — no tee, no state churn', async () => {
		micChunk!('a', 0.5);
		micChunk!('b', 0.001);
		await vi.advanceTimersByTimeAsync(800); // thinking, rescue armed
		callbacks!.onmessage({ serverContent: { turnComplete: true } }); // settles to listening, timer left live
		events = [];
		// The R7 silence clock idles the session at the 5s mark; its teardown also clears the
		// stale rescue, so the only event in this window is the silent asleep.
		await vi.advanceTimersByTimeAsync(10_000);
		expect(events).toEqual([{ type: 'asleep' }]);
		expect(vs.state).toBe('asleep');
		expect(teeBodies().join(' ')).not.toContain('thinking rescue fired');
	});

	it('a quiet-hold expiring after the Oracle starts speaking never drags her into thinking', async () => {
		micChunk!('a', 0.5);
		micChunk!('b', 0.001); // arms the hold
		callbacks!.onmessage({
			serverContent: { modelTurn: { parts: [{ inlineData: { data: 'reply' } }] } }
		});
		await vi.advanceTimersByTimeAsync(800);
		expect(vs.state).toBe('speaking');
		expect(eventTypes()).not.toContain('thinking');
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

	it('a turnComplete with no audio settles thinking straight back to listening', async () => {
		micChunk!('a', 0.5);
		micChunk!('b', 0.001);
		await vi.advanceTimersByTimeAsync(800);
		expect(vs.state).toBe('thinking');
		// The model can end a turn without speaking (e.g. a safety skip) — the UI must not sit
		// in thinking for the full rescue window.
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

	it('skips audio parts with missing or empty data without touching the speaker', () => {
		callbacks!.onmessage({
			serverContent: {
				modelTurn: { parts: [{}, { inlineData: {} }, { inlineData: { data: '' } }] }
			}
		});
		expect(speaker.enqueue).not.toHaveBeenCalled();
		expect(events).toEqual([]);
		expect(vs.state).toBe('listening');
	});

	it('tees one assembled transcript line per side on turnComplete — no fragment flood', () => {
		callbacks!.onmessage({ serverContent: { inputTranscription: { text: 'cast ' } } });
		callbacks!.onmessage({ serverContent: { inputTranscription: { text: 'the rune' } } });
		callbacks!.onmessage({ serverContent: { outputTranscription: { text: 'It is cast.' } } });
		callbacks!.onmessage({ serverContent: { turnComplete: true } });
		const tees = teeBodies();
		expect(tees.filter((body) => body.includes('heard:'))).toHaveLength(1);
		expect(tees.join(' ')).toContain('heard: cast the rune');
		expect(tees.join(' ')).toContain('spoke: It is cast.');
	});

	it('a silent turnComplete tees no transcript lines', () => {
		callbacks!.onmessage({ serverContent: { turnComplete: true } });
		const teed = teeBodies().join(' ');
		expect(teed).not.toContain('heard:');
		expect(teed).not.toContain('spoke:');
	});

	it('a barge-in flushes the cut line to the tee', () => {
		callbacks!.onmessage({ serverContent: { outputTranscription: { text: 'The night holds' } } });
		callbacks!.onmessage({ serverContent: { interrupted: true } });
		expect(teeBodies().join(' ')).toContain('spoke: The night holds');
	});

	it('sleep mid-turn surfaces the partial transcript instead of swallowing it', () => {
		callbacks!.onmessage({ serverContent: { inputTranscription: { text: 'is it a fire rune' } } });
		vs.sleep();
		expect(teeBodies().join(' ')).toContain('heard: is it a fire rune');
	});
});

describe('voiceSession silence timeout (S5)', () => {
	beforeEach(async () => {
		await awaken();
		events = [];
	});

	it('idles to asleep after 5s of no recognizable speech — mic, socket, and speaker all close', async () => {
		await vi.advanceTimersByTimeAsync(5_000);
		expect(micStop).toHaveBeenCalledTimes(1);
		expect(liveSession.close).toHaveBeenCalledTimes(1);
		expect(speaker.close).toHaveBeenCalledTimes(1);
		expect(events).toEqual([{ type: 'asleep' }]);
		expect(vs.state).toBe('asleep');
		expect(teeBodies().join(' ')).toContain('silence timeout');
	});

	it('idles silently — no error event, no notice, no audio nudge (R7)', async () => {
		await vi.advanceTimersByTimeAsync(5_000);
		expect(eventTypes()).not.toContain('error');
		expect(vs.notice).toBeNull();
		expect(speaker.enqueue).not.toHaveBeenCalled();
	});

	it('an input transcript resets the clock — recognizable speech keeps the session awake', async () => {
		await vi.advanceTimersByTimeAsync(4_000);
		callbacks!.onmessage({ serverContent: { inputTranscription: { text: 'oracle' } } });
		await vi.advanceTimersByTimeAsync(4_000); // 8s total, but only 4s since the last words
		expect(vs.state).toBe('listening');
		await vi.advanceTimersByTimeAsync(1_000); // 5s since the last words
		expect(vs.state).toBe('asleep');
	});

	it('a transcript landing mid-hearing resets the clock — a long sentence is never cut off', async () => {
		for (let i = 0; i < 8; i++) {
			micChunk!('speech', 0.5);
			callbacks!.onmessage({ serverContent: { inputTranscription: { text: 'word ' } } });
			await vi.advanceTimersByTimeAsync(1_000);
		}
		expect(vs.state).toBe('hearing'); // 8s of continuous speech outlives the 5s clock
		await vi.advanceTimersByTimeAsync(5_000); // then true silence idles it
		expect(vs.state).toBe('asleep');
	});

	it('RMS noise never resets the clock — a fan flaring the corona is not recognizable speech', async () => {
		for (let i = 0; i < 5; i++) {
			micChunk!('hum', 0.5);
			await vi.advanceTimersByTimeAsync(1_000);
		}
		expect(vs.state).toBe('asleep');
	});

	it("the clock pauses while the Oracle speaks — her speech never counts as the player's silence", async () => {
		callbacks!.onmessage({
			serverContent: { modelTurn: { parts: [{ inlineData: { data: 'line' } }] } }
		});
		await vi.advanceTimersByTimeAsync(20_000);
		expect(vs.state).toBe('speaking');
	});

	it('the clock starts fresh only after her playback drains past turnComplete', async () => {
		callbacks!.onmessage({
			serverContent: { modelTurn: { parts: [{ inlineData: { data: 'line' } }] } }
		});
		speaker.busy = true;
		callbacks!.onmessage({ serverContent: { turnComplete: true } });
		await vi.advanceTimersByTimeAsync(4_000); // would have idled already if speaking counted
		speaker.busy = false;
		speaker.drain!();
		expect(vs.state).toBe('listening');
		await vi.advanceTimersByTimeAsync(4_999);
		expect(vs.state).toBe('listening');
		await vi.advanceTimersByTimeAsync(1);
		expect(vs.state).toBe('asleep');
	});

	it('the clock pauses in thinking — waiting on the Oracle is not the player going quiet', async () => {
		micChunk!('a', 0.5);
		micChunk!('b', 0.001);
		await vi.advanceTimersByTimeAsync(800); // thinking at t=800
		await vi.advanceTimersByTimeAsync(6_000); // past any leaked 5s expiry, before the 10s rescue
		expect(vs.state).toBe('thinking');
	});

	it("a final transcript landing in thinking never arms a clock the Oracle's turn owns", async () => {
		micChunk!('a', 0.5);
		micChunk!('b', 0.001);
		await vi.advanceTimersByTimeAsync(800); // thinking
		callbacks!.onmessage({ serverContent: { inputTranscription: { text: 'late words' } } });
		await vi.advanceTimersByTimeAsync(6_000);
		expect(vs.state).toBe('thinking');
	});

	it('a barge-in into hearing arms the clock — a false interrupt with no speech still idles', async () => {
		callbacks!.onmessage({
			serverContent: { modelTurn: { parts: [{ inlineData: { data: 'line' } }] } }
		});
		callbacks!.onmessage({ serverContent: { interrupted: true } }); // speaking → hearing, clock was paused
		expect(vs.state).toBe('hearing');
		await vi.advanceTimersByTimeAsync(5_000);
		expect(vs.state).toBe('asleep');
	});

	it('the thinking rescue hands the clock back — a dropped turn still idles from listening', async () => {
		micChunk!('a', 0.5);
		micChunk!('b', 0.001);
		await vi.advanceTimersByTimeAsync(800);
		await vi.advanceTimersByTimeAsync(10_000); // rescue → listening
		expect(vs.state).toBe('listening');
		await vi.advanceTimersByTimeAsync(5_000);
		expect(vs.state).toBe('asleep');
	});

	it('a medallion tap resumes after a silence idle (R7)', async () => {
		await vi.advanceTimersByTimeAsync(5_000);
		expect(vs.state).toBe('asleep');
		events = [];
		await awaken();
		expect(vs.state).toBe('listening');
		expect(audio.openMic).toHaveBeenCalledTimes(2);
	});

	it('sleep clears the clock — no ghost idle after the mic closes', async () => {
		vs.sleep();
		events = [];
		await vi.advanceTimersByTimeAsync(6_000);
		expect(events).toEqual([]);
		expect(teeBodies().join(' ')).not.toContain('silence timeout');
	});
});

describe('voiceSession wake invitation (S6)', () => {
	/** Drives wake({ invitation: true }) through mic + token + connect, then completes setup. */
	async function awakenInvited(): Promise<void> {
		const woke = vs.wake({ invitation: true });
		await vi.advanceTimersByTimeAsync(0);
		callbacks!.onmessage({ setupComplete: {} });
		await woke;
	}

	it('sends one stage-direction turn and waits in thinking — never a first listening', async () => {
		await awakenInvited();
		expect(liveSession.sendClientContent).toHaveBeenCalledExactlyOnceWith({
			turns: [{ role: 'user', parts: [{ text: ORACLE_INVITATION_TRIGGER }] }],
			turnComplete: true
		});
		expect(vs.state).toBe('thinking');
		expect(eventTypes()).toEqual(['waking', 'thinking']);
		expect(teeBodies().join(' ')).toContain('voice invitation sent');
	});

	it('a wake without the invitation never sends a turn — subsequent wakes resume silent', async () => {
		await awaken();
		expect(liveSession.sendClientContent).not.toHaveBeenCalled();
		expect(vs.state).toBe('listening');
	});

	it('the silence clock stays paused while the invitation is pending', async () => {
		await awakenInvited();
		await vi.advanceTimersByTimeAsync(6_000); // past the 5s clock, before the 10s rescue
		expect(vs.state).toBe('thinking');
	});

	it('her invitation plays through speaking and the clock arms only after it drains', async () => {
		await awakenInvited();
		callbacks!.onmessage({
			serverContent: { modelTurn: { parts: [{ inlineData: { data: 'inv' } }] } }
		});
		expect(vs.state).toBe('speaking');
		speaker.busy = true;
		callbacks!.onmessage({ serverContent: { turnComplete: true } });
		await vi.advanceTimersByTimeAsync(20_000); // her speech never counts as the player's silence
		expect(vs.state).toBe('speaking');
		speaker.busy = false;
		speaker.drain!();
		expect(vs.state).toBe('listening');
		await vi.advanceTimersByTimeAsync(5_000);
		expect(vs.state).toBe('asleep');
	});

	it('an invitation the model never answers rescues to listening, then idles', async () => {
		await awakenInvited();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(vs.state).toBe('listening');
		expect(teeBodies().join(' ')).toContain('thinking rescue fired');
		await vi.advanceTimersByTimeAsync(5_000);
		expect(vs.state).toBe('asleep');
	});

	it('barge-in cuts the invitation like any other line', async () => {
		await awakenInvited();
		callbacks!.onmessage({
			serverContent: { modelTurn: { parts: [{ inlineData: { data: 'inv' } }] } }
		});
		callbacks!.onmessage({ serverContent: { interrupted: true } });
		expect(speaker.stop).toHaveBeenCalledTimes(1);
		expect(vs.state).toBe('hearing');
	});

	it('a failed invitation send fails the wake — the invitation is never burned unspoken', async () => {
		liveSession.sendClientContent.mockImplementation(() => {
			throw new Error('socket already closing');
		});
		await awakenInvited();
		expect(eventTypes()).toEqual(['waking', 'error', 'asleep']);
		expect(events[1]).toMatchObject({ reason: 'socket' });
		expect(vs.state).toBe('asleep');
		expect(micStop).toHaveBeenCalledTimes(1);
		expect(teeBodies().join(' ')).toContain('invitation send failed: socket already closing');
	});

	it('an invitation send throwing a non-Error still tees its text', async () => {
		liveSession.sendClientContent.mockImplementation(() => {
			throw 'serializer died';
		});
		await awakenInvited();
		expect(vs.state).toBe('asleep');
		expect(teeBodies().join(' ')).toContain('invitation send failed: serializer died');
	});

	it('a canceled invitation wake never sends the turn', async () => {
		const woke = vs.wake({ invitation: true });
		await vi.advanceTimersByTimeAsync(0); // connected, setup still pending
		vs.sleep();
		await woke;
		expect(liveSession.sendClientContent).not.toHaveBeenCalled();
		expect(vs.state).toBe('asleep');
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

	it('a cancel tap mid-wake reverts to asleep, releases the mic, and tees the cancel', async () => {
		const woke = vs.wake();
		await vi.advanceTimersByTimeAsync(0);
		vs.sleep();
		await woke;
		expect(micStop).toHaveBeenCalledTimes(1);
		expect(eventTypes()).toEqual(['waking', 'asleep']);
		expect(vs.state).toBe('asleep');
		expect(teeBodies().join(' ')).toContain('voice wake canceled');
	});

	it('sleep racing the token mint never opens the speaker or socket', async () => {
		let mintToken!: (value: unknown) => void;
		fetchMock.mockImplementation((url: string) =>
			url === '/api/voice/token'
				? new Promise((resolve) => {
						mintToken = resolve;
					})
				: Promise.resolve({ ok: true, status: 204 })
		);
		const woke = vs.wake();
		await vi.advanceTimersByTimeAsync(0); // mic granted, mint still pending
		vs.sleep();
		mintToken(tokenResponse());
		await woke;
		expect(audio.createSpeaker).not.toHaveBeenCalled();
		expect(sdk.connect).not.toHaveBeenCalled();
		expect(eventTypes()).toEqual(['waking', 'asleep']);
	});

	it('a stale token response never replaces the scrub token for a later wake', async () => {
		let tokenMints = 0;
		let mintStaleToken!: (value: unknown) => void;
		fetchMock.mockImplementation((url: string) => {
			if (url !== '/api/voice/token') return Promise.resolve({ ok: true, status: 204 });
			tokenMints++;
			if (tokenMints === 1) {
				return new Promise((resolve) => {
					mintStaleToken = resolve;
				});
			}
			return Promise.resolve(tokenResponse({ token: 'auth_tokens/active' }));
		});

		const staleWake = vs.wake();
		await vi.advanceTimersByTimeAsync(0);
		vs.sleep();

		const activeWake = vs.wake();
		await vi.advanceTimersByTimeAsync(0);
		callbacks!.onmessage({ setupComplete: {} });
		await activeWake;

		mintStaleToken(tokenResponse({ token: 'auth_tokens/stale' }));
		await staleWake;
		callbacks!.onclose({ code: 1011, reason: 'quota for auth_tokens/active' });

		const teed = teeBodies().join(' ');
		expect(teed).toContain('[ephemeral-token]');
		expect(teed).not.toContain('auth_tokens/active');
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
		expect(eventTypes()).toEqual(['waking', 'asleep']);
		expect(tokenCalls()).toHaveLength(0);
	});

	it('an unsubscribed listener hears nothing', async () => {
		const gone = vi.fn();
		const unsubscribe = vs.subscribe(gone);
		unsubscribe();
		await awaken();
		expect(gone).not.toHaveBeenCalled();
		expect(events).toEqual([{ type: 'waking' }, { type: 'listening' }]);
	});

	it('a stale socket close after sleep stays silent', async () => {
		await awaken();
		vs.sleep();
		events = [];
		callbacks!.onclose({ code: 1000 });
		expect(events).toEqual([]);
	});

	it('a stale socket error after sleep stays silent', async () => {
		await awaken();
		vs.sleep();
		events = [];
		callbacks!.onerror({ message: 'late reset' });
		expect(events).toEqual([]);
		expect(vs.state).toBe('asleep');
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
	// S4: a denied or absent mic is final — the session seals into eclipsed, never asleep.
	it.each([
		['mic-permission', 'The fire cannot hear you. The rite continues by hand.'],
		['mic-missing', 'No voice reaches the fire. The rite continues by hand.']
	] as const)(
		'mic failure %s emits its notice, never mints a token, and seals into eclipsed',
		async (reason, notice) => {
			audio.openMic.mockResolvedValueOnce({ ok: false, reason, detail: 'NotAllowedError: denied' });
			await vs.wake();
			expect(events).toEqual([
				{ type: 'waking' },
				{ type: 'error', reason, notice },
				{ type: 'eclipsed' }
			]);
			expect(tokenCalls()).toHaveLength(0);
			expect(vs.state).toBe('eclipsed');
			expect(teeBodies().join(' ')).toContain('NotAllowedError: denied');
		}
	);

	it('a generic audio failure stays retryable — it settles to asleep, not eclipsed', async () => {
		audio.openMic.mockResolvedValueOnce({
			ok: false,
			reason: 'audio',
			detail: 'AudioContext refused'
		});
		await vs.wake();
		expect(events).toEqual([
			{ type: 'waking' },
			{
				type: 'error',
				reason: 'audio',
				notice: 'No voice reaches the fire. The rite continues by hand.'
			},
			{ type: 'asleep' }
		]);
		expect(tokenCalls()).toHaveLength(0);
		expect(vs.state).toBe('asleep');
	});

	it('a wake after the eclipse is a silent no-op — the player is never re-prompted (S4)', async () => {
		audio.openMic.mockResolvedValueOnce({
			ok: false,
			reason: 'mic-permission',
			detail: 'NotAllowedError: denied'
		});
		await vs.wake();
		events = [];
		await vs.wake();
		expect(audio.openMic).toHaveBeenCalledTimes(1);
		expect(events).toEqual([]);
		expect(vs.state).toBe('eclipsed');
	});

	it('a denial landing after a cancel tap still seals — the next tap must not re-prompt (S4)', async () => {
		let denyMic!: (verdict: unknown) => void;
		audio.openMic.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					denyMic = resolve;
				})
		);
		const woke = vs.wake();
		vs.sleep(); // cancel while the permission prompt is still up
		denyMic({ ok: false, reason: 'mic-permission', detail: 'NotAllowedError: denied' });
		await woke;
		expect(eventTypes()).toEqual(['waking', 'asleep', 'error', 'eclipsed']);
		expect(vs.state).toBe('eclipsed');
		await vs.wake();
		expect(audio.openMic).toHaveBeenCalledTimes(1);
	});

	it('a stale audio failure after a cancel stays retryable — only the mic verdicts seal', async () => {
		let failMic!: (verdict: unknown) => void;
		audio.openMic.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					failMic = resolve;
				})
		);
		const woke = vs.wake();
		vs.sleep();
		failMic({ ok: false, reason: 'audio', detail: 'AudioContext refused' });
		await woke;
		expect(eventTypes()).toEqual(['waking', 'asleep']);
		expect(vs.state).toBe('asleep');
	});

	it('a stale denial never blows away a newer in-flight wake — it observes its own verdict', async () => {
		let denyFirst!: (verdict: unknown) => void;
		audio.openMic.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					denyFirst = resolve;
				})
		);
		const first = vs.wake();
		vs.sleep();
		const second = vs.wake(); // default mock grants this wake's mic
		await vi.advanceTimersByTimeAsync(0);
		callbacks!.onmessage({ setupComplete: {} });
		await second;
		denyFirst({ ok: false, reason: 'mic-permission', detail: 'NotAllowedError: denied' });
		await first;
		expect(vs.state).toBe('listening');
		expect(audio.openMic).toHaveBeenCalledTimes(2);
	});

	it('sleep while eclipsed leaves the seal — it never re-arms wake() through asleep (S4)', async () => {
		audio.openMic.mockResolvedValueOnce({
			ok: false,
			reason: 'mic-missing',
			detail: 'NotFoundError: no device'
		});
		await vs.wake();
		events = [];
		vs.sleep();
		expect(events).toEqual([]);
		expect(vs.state).toBe('eclipsed');
		// And the seal still holds against a wake after the sleep attempt.
		await vs.wake();
		expect(audio.openMic).toHaveBeenCalledTimes(1);
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
			{ type: 'waking' },
			{
				type: 'error',
				reason: 'token',
				notice: 'The fire does not carry your voice tonight. The rite continues by hand.'
			},
			{ type: 'asleep' }
		]);
		expect(micStop).toHaveBeenCalledTimes(1);
		expect(sdk.connect).not.toHaveBeenCalled();
		expect(vs.state).toBe('asleep');
	});

	it('a token rejection landing after sleep stays silent — the cancel already settled it', async () => {
		let rejectMint!: (err: Error) => void;
		fetchMock.mockImplementation((url: string) =>
			url === '/api/voice/token'
				? new Promise((_, reject) => {
						rejectMint = reject;
					})
				: Promise.resolve({ ok: true, status: 204 })
		);
		const woke = vs.wake();
		await vi.advanceTimersByTimeAsync(0); // mic granted, mint pending
		vs.sleep();
		rejectMint(new Error('offline'));
		await woke;
		expect(eventTypes()).toEqual(['waking', 'asleep']);
		expect(vs.state).toBe('asleep');
	});

	it('a connect rejection landing after sleep stays silent — no error for a canceled wake', async () => {
		let failConnect!: (err: Error) => void;
		sdk.connect.mockImplementationOnce(
			() =>
				new Promise((_, reject) => {
					failConnect = reject;
				})
		);
		const woke = vs.wake();
		await vi.advanceTimersByTimeAsync(0); // mic + token done, connect pending
		vs.sleep();
		failConnect(new Error('refused'));
		await woke;
		expect(eventTypes()).toEqual(['waking', 'asleep']);
		expect(vs.state).toBe('asleep');
	});

	it('a connect rejecting with a non-Error still fails the wake with its text', async () => {
		sdk.connect.mockRejectedValueOnce('socket exploded');
		await vs.wake();
		expect(events.filter((e) => e.type === 'error')).toEqual([
			{
				type: 'error',
				reason: 'socket',
				notice: "The Oracle's voice falters. The rite continues by hand."
			}
		]);
		expect(teeBodies().join(' ')).toContain('socket exploded');
	});

	it('a late connect rejection with a non-Error tees its text', async () => {
		let failConnect!: (err: unknown) => void;
		sdk.connect.mockImplementationOnce(
			() =>
				new Promise((_, reject) => {
					failConnect = reject;
				})
		);
		const woke = vs.wake();
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(10_000); // timeout fails the wake first
		await woke;
		failConnect('quota text');
		await vi.advanceTimersByTimeAsync(0);
		expect(teeBodies().join(' ')).toContain('late connect rejection after timeout: quota text');
	});

	it('a socket error with no payload still tears down with a bare detail', async () => {
		await awaken();
		events = [];
		callbacks!.onerror();
		expect(eventTypes()).toEqual(['error', 'asleep']);
		expect(vs.state).toBe('asleep');
		expect(teeBodies().join(' ')).toContain('voice socket dropped: error:');
	});

	it('a payloadless stale close after sleep stays out of the tee', async () => {
		await awaken();
		vs.sleep();
		const teesBefore = teeBodies().length;
		callbacks!.onclose();
		expect(teeBodies().length).toBe(teesBefore);
		expect(vs.state).toBe('asleep');
	});

	it('a socket close after awake carries its reason into the tee, token scrubbed', async () => {
		await awaken();
		callbacks!.onclose({ code: 1011, reason: 'quota exceeded for auth_tokens/t1' });
		const teed = teeBodies().join(' ');
		expect(teed).toContain('close 1011 quota exceeded');
		expect(teed).toContain('[ephemeral-token]');
		expect(teed).not.toContain('auth_tokens/t1');
	});

	it('stale server messages after sleep are ignored', async () => {
		await awaken();
		vs.sleep();
		events = [];
		callbacks!.onmessage({
			serverContent: { modelTurn: { parts: [{ inlineData: { data: 'late' } }] } }
		});
		expect(events).toEqual([]);
		expect(speaker.enqueue).not.toHaveBeenCalled();
	});

	it('the thinking rescue tees an info event so dropped turns are diagnosable', async () => {
		await awaken();
		micChunk!('a', 0.5);
		micChunk!('b', 0.001);
		await vi.advanceTimersByTimeAsync(800);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(teeBodies().join(' ')).toContain('thinking rescue fired');
	});

	it('the thinking rescue flushes what was heard — the lost turn is named, not merged into the next', async () => {
		await awaken();
		callbacks!.onmessage({ serverContent: { inputTranscription: { text: 'is it a fire rune' } } });
		micChunk!('a', 0.5);
		micChunk!('b', 0.001);
		await vi.advanceTimersByTimeAsync(800);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(teeBodies().join(' ')).toContain('heard: is it a fire rune');
		// And the buffer is clear: a later turn must not re-carry the dropped utterance.
		callbacks!.onmessage({ serverContent: { inputTranscription: { text: 'is it gold' } } });
		callbacks!.onmessage({ serverContent: { turnComplete: true } });
		const heardLines = teeBodies().filter((body) => body.includes('heard:'));
		expect(heardLines.at(-1)).toContain('is it gold');
		expect(heardLines.at(-1)).not.toContain('fire rune');
	});

	it('a stale close with a reason still tees — the why of a setup timeout must not vanish', async () => {
		const woke = vs.wake();
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(10_000); // setup timeout fails the wake first
		await woke;
		callbacks!.onclose({ code: 1011, reason: 'quota exceeded for auth_tokens/t1' });
		const teed = teeBodies().join(' ');
		expect(teed).toContain('stale socket close 1011');
		expect(teed).toContain('[ephemeral-token]');
		expect(teed).not.toContain('auth_tokens/t1');
	});

	it('a reasonless stale close after a normal sleep stays out of the tee', async () => {
		await awaken();
		vs.sleep();
		const teesBefore = teeBodies().length;
		callbacks!.onclose({ code: 1000 });
		expect(teeBodies().length).toBe(teesBefore);
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
		expect(eventTypes()).toEqual(['waking', 'error', 'asleep']);
		expect(events[1]).toMatchObject({ reason: 'socket' });
		expect(vs.state).toBe('asleep');
		expect(micStop).toHaveBeenCalledTimes(1);
	});

	it('a hung connect times out into error socket instead of stranding the wake', async () => {
		sdk.connect.mockImplementationOnce(() => new Promise(() => {}));
		const woke = vs.wake();
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(10_000);
		await woke;
		expect(eventTypes()).toEqual(['waking', 'error', 'asleep']);
		expect(events[1]).toMatchObject({ reason: 'socket' });
		expect(micStop).toHaveBeenCalledTimes(1);
		expect(teeBodies().join(' ')).toContain('live connect timed out');
	});

	it('a connect resolving after its timeout closes the late socket instead of leaking it', async () => {
		let finishConnect!: () => void;
		sdk.connect.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishConnect = () => resolve(liveSession);
				})
		);
		const woke = vs.wake();
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(10_000);
		await woke;
		expect(vs.state).toBe('asleep');
		finishConnect();
		await vi.advanceTimersByTimeAsync(0);
		expect(liveSession.close).toHaveBeenCalledTimes(1);
		// The late settle is diagnosable: "alive but slow" and "dead" are different tunings.
		expect(teeBodies().join(' ')).toContain('closing the stale socket');
	});

	it('a connect rejecting after its timeout lands its reason in the tee, token scrubbed', async () => {
		let failConnect!: (err: Error) => void;
		sdk.connect.mockImplementationOnce(
			() =>
				new Promise((_, reject) => {
					failConnect = reject;
				})
		);
		const woke = vs.wake();
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(10_000);
		await woke;
		failConnect(new Error('quota refused for auth_tokens/t1'));
		await vi.advanceTimersByTimeAsync(0);
		const teed = teeBodies().join(' ');
		expect(teed).toContain('late connect rejection after timeout');
		expect(teed).toContain('[ephemeral-token]');
		expect(teed).not.toContain('auth_tokens/t1');
	});

	it('a stale late connect rejection scrubs its old token after a later wake mints a new one', async () => {
		let tokenMints = 0;
		fetchMock.mockImplementation(async (url: string) => {
			if (url !== '/api/voice/token') return { ok: true, status: 204 };
			tokenMints++;
			return tokenResponse({
				token: tokenMints === 1 ? 'auth_tokens/stale' : 'auth_tokens/active'
			});
		});
		let connectAttempts = 0;
		let failStaleConnect!: (err: Error) => void;
		sdk.connect.mockImplementation(({ callbacks: registered }: { callbacks: Callbacks }) => {
			connectAttempts++;
			if (connectAttempts === 1) {
				return new Promise((_, reject) => {
					failStaleConnect = reject;
				});
			}
			callbacks = registered;
			return Promise.resolve(liveSession);
		});

		const staleWake = vs.wake();
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(10_000);
		await staleWake;

		const activeWake = vs.wake();
		await vi.advanceTimersByTimeAsync(0);
		callbacks!.onmessage({ setupComplete: {} });
		await activeWake;

		failStaleConnect(new Error('quota refused for auth_tokens/stale and auth_tokens/active'));
		await vi.advanceTimersByTimeAsync(0);

		const teed = teeBodies().join(' ');
		expect(teed).toContain('late connect rejection after timeout');
		expect(teed).toContain('[ephemeral-token]');
		expect(teed).not.toContain('auth_tokens/stale');
		expect(teed).not.toContain('auth_tokens/active');
	});

	it('a socket that closes during setup fails the wake exactly once', async () => {
		const woke = vs.wake();
		await vi.advanceTimersByTimeAsync(0);
		callbacks!.onclose({ code: 1011 });
		await woke;
		expect(eventTypes()).toEqual(['waking', 'error', 'asleep']);
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
		expect(eventTypes()).toEqual(['waking', 'asleep']);
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
		expect(eventTypes()).toEqual(['waking', 'listening']);
	});

	it('can wake cleanly after a failed wake', async () => {
		audio.openMic.mockResolvedValueOnce({ ok: false, reason: 'audio', detail: 'no context' });
		await vs.wake();
		events = [];
		await awaken();
		expect(vs.state).toBe('listening');
		expect(eventTypes()).toEqual(['waking', 'listening']);
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

	it('a send throwing a non-Error still tees its text', async () => {
		await awaken();
		liveSession.sendRealtimeInput.mockImplementation(() => {
			throw 'serializer died';
		});
		micChunk!('a', 0.5);
		expect(teeBodies().join(' ')).toContain('voice send failed: serializer died');
	});

	it('a token mint rejecting with a non-Error still fails the wake with its text', async () => {
		fetchMock.mockImplementation(async (url: string) => {
			if (url === '/api/voice/token') throw 'flat offline';
			return { ok: true, status: 204 };
		});
		await vs.wake();
		expect(events.filter((e) => e.type === 'error')).toEqual([
			{
				type: 'error',
				reason: 'token',
				notice: 'The fire does not carry your voice tonight. The rite continues by hand.'
			}
		]);
		expect(teeBodies().join(' ')).toContain('flat offline');
	});

	it('a speaker setup throwing a non-Error still reports the audio failure with its text', async () => {
		audio.createSpeaker.mockImplementationOnce(() => {
			throw 'no output device';
		});
		await vs.wake();
		expect(events.filter((e) => e.type === 'error')).toEqual([
			{
				type: 'error',
				reason: 'audio',
				notice: 'No voice reaches the fire. The rite continues by hand.'
			}
		]);
		expect(teeBodies().join(' ')).toContain('no output device');
	});

	it('a socket error whose payload lacks a message tears down with a bare detail', async () => {
		await awaken();
		events = [];
		callbacks!.onerror({});
		expect(eventTypes()).toEqual(['error', 'asleep']);
		expect(teeBodies().join(' ')).toContain('voice socket dropped: error:');
	});

	it('exposes the last failure notice for a remounting page; quiet before any failure', async () => {
		expect(vs.notice).toBeNull();
		audio.openMic.mockResolvedValueOnce({
			ok: false,
			reason: 'mic-permission',
			detail: 'NotAllowedError: denied'
		});
		await vs.wake();
		expect(vs.notice).toBe('The fire cannot hear you. The rite continues by hand.');
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
			{ type: 'waking' },
			{
				type: 'error',
				reason: 'audio',
				notice: 'No voice reaches the fire. The rite continues by hand.'
			},
			{ type: 'asleep' }
		]);
		expect(micStop).toHaveBeenCalledTimes(1);
		expect(vs.state).toBe('asleep');

		events = [];
		await awaken();

		expect(vs.state).toBe('listening');
		expect(eventTypes()).toEqual(['waking', 'listening']);
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

describe('voiceSession engine tools (S7)', () => {
	it('declares the five engine tools on connect — the same actions the buttons answer to', async () => {
		await awaken();
		expect(sdk.connect.mock.calls[0][0].config.tools).toEqual([
			{ functionDeclarations: ORACLE_TOOL_DECLARATIONS }
		]);
		expect(ORACLE_TOOL_DECLARATIONS.map((d) => d.name)).toEqual([
			'ask',
			'scry',
			'hex',
			'pass',
			'cast_rune'
		]);
	});

	it('carries a tool call to the executor and answers with its outcome', async () => {
		await awaken();
		const executor = vi.fn(async () => 'Yes. Sól is reaching for a fire rune.');
		vs.setToolExecutor(executor);
		callbacks!.onmessage({
			toolCall: { functionCalls: [{ id: 'c1', name: 'ask', args: { question: 'is it fire?' } }] }
		});
		// The engine round-trip waits in thinking: the silence clock is paused, the medallion orbits.
		expect(vs.state).toBe('thinking');
		await vi.advanceTimersByTimeAsync(0);
		expect(executor).toHaveBeenCalledExactlyOnceWith({
			name: 'ask',
			args: { question: 'is it fire?' }
		});
		expect(liveSession.sendToolResponse).toHaveBeenCalledExactlyOnceWith({
			functionResponses: [
				{ id: 'c1', name: 'ask', response: { output: 'Yes. Sól is reaching for a fire rune.' } }
			]
		});
		// The voiced outcome is still owed — the turn stays with the model.
		expect(vs.state).toBe('thinking');
	});

	it('answers each call of a batch independently', async () => {
		await awaken();
		vs.setToolExecutor(async ({ name }) => `${name} done`);
		callbacks!.onmessage({
			toolCall: {
				functionCalls: [
					{ id: 'c1', name: 'pass', args: {} },
					{ id: 'c2', name: 'scry', args: {} }
				]
			}
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(liveSession.sendToolResponse).toHaveBeenCalledTimes(2);
		expect(liveSession.sendToolResponse).toHaveBeenCalledWith({
			functionResponses: [{ id: 'c1', name: 'pass', response: { output: 'pass done' } }]
		});
		expect(liveSession.sendToolResponse).toHaveBeenCalledWith({
			functionResponses: [{ id: 'c2', name: 'scry', response: { output: 'scry done' } }]
		});
	});

	it('answers a throwing executor with the error — the model voices the failure, never hangs', async () => {
		await awaken();
		vs.setToolExecutor(async () => {
			throw new Error('the engine declined');
		});
		callbacks!.onmessage({ toolCall: { functionCalls: [{ id: 'c1', name: 'hex', args: {} }] } });
		await vi.advanceTimersByTimeAsync(0);
		expect(liveSession.sendToolResponse).toHaveBeenCalledExactlyOnceWith({
			functionResponses: [{ id: 'c1', name: 'hex', response: { error: 'the engine declined' } }]
		});
	});

	it('answers with an error when no executor is registered', async () => {
		await awaken();
		callbacks!.onmessage({ toolCall: { functionCalls: [{ id: 'c1', name: 'pass', args: {} }] } });
		await vi.advanceTimersByTimeAsync(0);
		expect(liveSession.sendToolResponse).toHaveBeenCalledExactlyOnceWith({
			functionResponses: [
				{ id: 'c1', name: 'pass', response: { error: 'no tool executor registered' } }
			]
		});
	});

	it('drops the result when sleep lands mid-execution — never answers on a dead socket', async () => {
		await awaken();
		let settle!: (line: string) => void;
		vs.setToolExecutor(
			() =>
				new Promise<string>((resolve) => {
					settle = resolve;
				})
		);
		callbacks!.onmessage({ toolCall: { functionCalls: [{ id: 'c1', name: 'pass', args: {} }] } });
		vs.sleep();
		settle('held');
		await vi.advanceTimersByTimeAsync(0);
		expect(liveSession.sendToolResponse).not.toHaveBeenCalled();
	});

	it('drops a result the model cancelled — the engine effect stands, only the answer dies', async () => {
		await awaken();
		let settle!: (line: string) => void;
		vs.setToolExecutor(
			() =>
				new Promise<string>((resolve) => {
					settle = resolve;
				})
		);
		callbacks!.onmessage({
			toolCall: { functionCalls: [{ id: 'c1', name: 'cast_rune', args: { rune: 'Sowilo' } }] }
		});
		callbacks!.onmessage({ toolCallCancellation: { ids: ['c1'] } });
		settle('The rune is true.');
		await vi.advanceTimersByTimeAsync(0);
		expect(liveSession.sendToolResponse).not.toHaveBeenCalled();
		expect(teeBodies().join(' ')).toContain('cancelled');
	});

	it('a throwing tool response send fails the session as a socket loss', async () => {
		await awaken();
		vs.setToolExecutor(async () => 'done');
		liveSession.sendToolResponse.mockImplementation(() => {
			throw new Error('socket is closed');
		});
		callbacks!.onmessage({ toolCall: { functionCalls: [{ id: 'c1', name: 'pass', args: {} }] } });
		await vi.advanceTimersByTimeAsync(0);
		expect(vs.state).toBe('asleep');
		expect(events).toContainEqual({
			type: 'error',
			reason: 'socket',
			notice: "The Oracle's voice falters. The rite continues by hand."
		});
	});

	it('a tool call disarms the thinking rescue — the engine round-trip is the reply', async () => {
		await awaken();
		// Speech settles into thinking, arming the 10s rescue…
		micChunk!('a', 0.5);
		micChunk!('b', 0.001);
		await vi.advanceTimersByTimeAsync(800);
		expect(vs.state).toBe('thinking');
		let settle!: (line: string) => void;
		vs.setToolExecutor(
			() =>
				new Promise<string>((resolve) => {
					settle = resolve;
				})
		);
		callbacks!.onmessage({ toolCall: { functionCalls: [{ id: 'c1', name: 'pass', args: {} }] } });
		// …but a slow engine must not be rescued out from under its own pending result.
		await vi.advanceTimersByTimeAsync(15_000);
		expect(vs.state).toBe('thinking');
		settle('held');
		await vi.advanceTimersByTimeAsync(0);
		expect(liveSession.sendToolResponse).toHaveBeenCalledTimes(1);
	});

	it('re-arms the rescue after the result is sent — a dropped voicing settles to listening', async () => {
		await awaken();
		vs.setToolExecutor(async () => 'done');
		callbacks!.onmessage({ toolCall: { functionCalls: [{ id: 'c1', name: 'pass', args: {} }] } });
		await vi.advanceTimersByTimeAsync(0);
		expect(vs.state).toBe('thinking');
		await vi.advanceTimersByTimeAsync(10_000);
		expect(vs.state).toBe('listening');
	});
});

describe('voiceSession direct (S7)', () => {
	const DIRECTION =
		'(Stage direction: speak exactly this: "Yes. Sól is reaching for a fire rune.")';

	it('sends the direction as one user turn and waits in thinking with the rescue armed', async () => {
		await awaken();
		vs.direct(DIRECTION);
		expect(liveSession.sendClientContent).toHaveBeenCalledExactlyOnceWith({
			turns: [{ role: 'user', parts: [{ text: DIRECTION }] }],
			turnComplete: true
		});
		expect(vs.state).toBe('thinking');
		await vi.advanceTimersByTimeAsync(10_000);
		expect(vs.state).toBe('listening');
	});

	it('is a no-op while asleep', () => {
		vs.direct(DIRECTION);
		expect(liveSession.sendClientContent).not.toHaveBeenCalled();
		expect(vs.state).toBe('asleep');
	});

	it('drops the direction while the Oracle is mid-turn — never talks over a turn in flight', async () => {
		await awaken();
		micChunk!('a', 0.5);
		micChunk!('b', 0.001);
		await vi.advanceTimersByTimeAsync(800);
		expect(vs.state).toBe('thinking');
		vs.direct(DIRECTION);
		expect(liveSession.sendClientContent).not.toHaveBeenCalled();
		expect(teeBodies().join(' ')).toContain('direction dropped');
	});

	it('a throwing send fails the session as a socket loss', async () => {
		await awaken();
		liveSession.sendClientContent.mockImplementation(() => {
			throw new Error('socket is closed');
		});
		vs.direct(DIRECTION);
		expect(vs.state).toBe('asleep');
		expect(events).toContainEqual({
			type: 'error',
			reason: 'socket',
			notice: "The Oracle's voice falters. The rite continues by hand."
		});
	});
});
