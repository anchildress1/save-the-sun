import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	startRecording,
	stopRecording,
	releaseRecorder,
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

	it('releases the mic stream on release so Chrome stops showing it in use', async () => {
		await startRecording();
		feed(5000);
		await stopRecording();
		releaseRecorder();
		expect(track.stop).toHaveBeenCalledTimes(1); // tracks dropped, indicator clears
		expect(isRecording()).toBe(false);
	});

	it('re-acquires the stream on the next hold but keeps the one context + worklet', async () => {
		await startRecording();
		feed(5000);
		await stopRecording();
		releaseRecorder();

		expect(await startRecording()).toEqual({ ok: true });
		feed(5000);
		expect(await stopRecording()).not.toBeNull();
		// A fresh stream each hold (no re-prompt — the grant is remembered), but the context and its
		// worklet are built once and reused, so a re-acquire never pays the worklet load.
		expect(getUserMedia).toHaveBeenCalledTimes(2);
		expect(FakeAudioContext.instances).toHaveLength(1);
		expect(FakeAudioContext.instances[0].audioWorklet.addModule).toHaveBeenCalledTimes(1);
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
		{ name: 'OverconstrainedError', reason: 'no-device' }
	])('classifies $name as $reason and seals', async ({ name, reason }) => {
		getUserMedia.mockRejectedValueOnce(new DOMException('nope', name));
		expect(await startRecording()).toEqual({ ok: false, reason });
		expect(recorderSealed()).toBe(reason);
		// Sealed: a second hold refuses without re-prompting.
		expect(await startRecording()).toEqual({ ok: false, reason });
		expect(getUserMedia).toHaveBeenCalledTimes(1);
	});

	it.each(['AbortError', 'NotReadableError'])(
		'does NOT seal on a transient %s — a later hold retries the mic',
		async (name) => {
			// NotReadableError is an OS/hardware "device busy" error that often clears — retryable, not sealed.
			getUserMedia.mockRejectedValueOnce(new DOMException('busy', name));
			expect(await startRecording()).toEqual({ ok: false, reason: 'audio' });
			expect(recorderSealed()).toBeNull();
			// The next hold re-prompts and can succeed.
			expect(await startRecording()).toEqual({ ok: true });
			expect(getUserMedia).toHaveBeenCalledTimes(2);
		}
	);

	it('closes the AudioContext (not just the track) when worklet setup fails — no leak', async () => {
		class FailingCtx extends FakeAudioContext {
			audioWorklet = {
				addModule: vi.fn(async () => {
					throw new Error('worklet blocked');
				})
			};
		}
		vi.stubGlobal('AudioContext', FailingCtx);
		expect(await startRecording()).toEqual({ ok: false, reason: 'audio' });
		expect(recorderSealed()).toBeNull(); // setup failure is retryable
		expect(track.stop).toHaveBeenCalledTimes(1);
		expect(FakeAudioContext.instances.at(-1)!.close).toHaveBeenCalledTimes(1);
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

	it('discards a late mic setup when teardown wins the race — no orphaned stream', async () => {
		let finishGum: (stream: { getTracks: () => unknown[] }) => void = () => {};
		getUserMedia.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishGum = resolve;
				})
		);
		const pending = startRecording();
		closeRecorder(); // teardown while getUserMedia is still pending
		finishGum({ getTracks: () => [track] });

		expect(await pending).toEqual({ ok: false, reason: 'audio' });
		// The stream that arrived after teardown is stopped, not stored onto the unmounted page.
		expect(track.stop).toHaveBeenCalledTimes(1);
		expect(recorderSealed()).toBeNull(); // not a terminal failure
	});
});
