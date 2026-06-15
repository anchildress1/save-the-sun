import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	startRecording,
	stopRecording,
	isRecording,
	recorderSealed,
	closeRecorder,
	resetRecorder
} from '$lib/voice/recorder';

interface FakeNode {
	port: { onmessage: ((event: { data: Float32Array }) => void) | null };
	connect: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
}

class FakeAudioContext {
	static instances: FakeAudioContext[] = [];
	sampleRate: number;
	destination = { sink: true };
	resume = vi.fn(async () => {});
	close = vi.fn(async () => {});
	audioWorklet = { addModule: vi.fn(async () => {}) };
	createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));

	constructor(options: { sampleRate: number }) {
		this.sampleRate = options.sampleRate;
		FakeAudioContext.instances.push(this);
	}
}

class FakeAudioWorkletNode implements FakeNode {
	static instances: FakeAudioWorkletNode[] = [];
	port: { onmessage: ((event: { data: Float32Array }) => void) | null } = { onmessage: null };
	connect = vi.fn();
	disconnect = vi.fn();
	constructor() {
		FakeAudioWorkletNode.instances.push(this);
	}
}

let track: { stop: ReturnType<typeof vi.fn> };
let getUserMedia: ReturnType<typeof vi.fn>;

// The single capture node the recorder wired this session.
const tap = () => FakeAudioWorkletNode.instances.at(-1)!;
// Feed the recorder one render block of mono samples, as the worklet would.
const feed = (samples: number) => tap().port.onmessage?.({ data: new Float32Array(samples) });

beforeEach(() => {
	FakeAudioContext.instances = [];
	FakeAudioWorkletNode.instances = [];
	track = { stop: vi.fn() };
	getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
	vi.stubGlobal('AudioContext', FakeAudioContext);
	vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
	vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
	Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:tap'), revokeObjectURL: vi.fn() });
});

afterEach(() => {
	resetRecorder();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('recorder — capture', () => {
	it('opens the mic once and records, returning a WAV on release', async () => {
		expect(await startRecording()).toEqual({ ok: true });
		expect(isRecording()).toBe(true);
		expect(getUserMedia).toHaveBeenCalledTimes(1);

		feed(5000); // > 0.25s at 16kHz → a real utterance
		const clip = await stopRecording();
		expect(isRecording()).toBe(false);
		expect(clip).not.toBeNull();
		const bytes = Uint8Array.from(atob(clip!.wavBase64), (c) => c.charCodeAt(0));
		expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
		expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE');
		expect(bytes.length).toBe(44 + 5000 * 2); // header + PCM16 samples
	});

	it('reuses the open mic on a second hold — no second prompt', async () => {
		await startRecording();
		feed(5000);
		await stopRecording();
		await startRecording();
		expect(getUserMedia).toHaveBeenCalledTimes(1);
	});

	it('returns null for an utterance too short to be a real Ask', async () => {
		await startRecording();
		feed(100); // ~6ms — an accidental tap
		expect(await stopRecording()).toBeNull();
	});

	it('returns null when stop is called with nothing recording', async () => {
		expect(await stopRecording()).toBeNull();
	});

	it('drops audio captured while not recording', async () => {
		await startRecording();
		await stopRecording(); // recording is now false
		feed(5000); // a late worklet block must not buffer
		await startRecording();
		expect(await stopRecording()).toBeNull(); // fresh buffer, nothing captured
	});
});

describe('recorder — permission/device failures seal the session (R1)', () => {
	it.each([
		{ name: 'NotAllowedError', reason: 'denied' },
		{ name: 'SecurityError', reason: 'denied' },
		{ name: 'NotFoundError', reason: 'no-device' },
		{ name: 'NotReadableError', reason: 'no-device' }
	])('classifies $name as $reason and seals', async ({ name, reason }) => {
		getUserMedia.mockRejectedValueOnce(new DOMException('nope', name));
		expect(await startRecording()).toEqual({ ok: false, reason });
		expect(recorderSealed()).toBe(reason);
		// Sealed: a second hold refuses without re-prompting.
		expect(await startRecording()).toEqual({ ok: false, reason });
		expect(getUserMedia).toHaveBeenCalledTimes(1);
	});
});

describe('recorder — teardown', () => {
	it('closeRecorder stops the track and closes the context', async () => {
		await startRecording();
		closeRecorder();
		expect(track.stop).toHaveBeenCalledTimes(1);
		expect(FakeAudioContext.instances[0].close).toHaveBeenCalledTimes(1);
		expect(isRecording()).toBe(false);
	});
});
