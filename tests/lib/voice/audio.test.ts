import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openMic, createSpeaker } from '$lib/voice/audio';
import { MIC_SAMPLE_RATE, SPEAKER_SAMPLE_RATE } from '$lib/voice/config';

interface FakeSource {
	buffer: { duration: number; getChannelData: (i: number) => Float32Array } | null;
	connect: ReturnType<typeof vi.fn>;
	start: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
	onended: (() => void) | null;
}

interface FakeGain {
	gain: { value: number };
	connect: ReturnType<typeof vi.fn>;
}

class FakeAudioContext {
	static instances: FakeAudioContext[] = [];
	sampleRate: number;
	currentTime = 0;
	destination = { sink: true };
	resume = vi.fn(async () => {});
	close = vi.fn(async () => {});
	audioWorklet = { addModule: vi.fn(async () => {}) };
	createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
	sources: FakeSource[] = [];
	gains: FakeGain[] = [];

	constructor(options: { sampleRate: number }) {
		this.sampleRate = options.sampleRate;
		FakeAudioContext.instances.push(this);
	}

	createGain(): FakeGain {
		const gain: FakeGain = { gain: { value: 1 }, connect: vi.fn() };
		this.gains.push(gain);
		return gain;
	}

	createBuffer(_channels: number, length: number, rate: number) {
		const data = new Float32Array(length);
		return { duration: length / rate, getChannelData: () => data };
	}

	createBufferSource(): FakeSource {
		const source: FakeSource = {
			buffer: null,
			connect: vi.fn(),
			start: vi.fn(),
			stop: vi.fn(),
			onended: null
		};
		this.sources.push(source);
		return source;
	}
}

class FakeAudioWorkletNode {
	static instances: FakeAudioWorkletNode[] = [];
	port: { onmessage: ((event: { data: Float32Array }) => void) | null } = { onmessage: null };
	connect = vi.fn();
	disconnect = vi.fn();

	constructor(
		public context: FakeAudioContext,
		public name: string
	) {
		FakeAudioWorkletNode.instances.push(this);
	}
}

let track: { stop: ReturnType<typeof vi.fn> };
let getUserMedia: ReturnType<typeof vi.fn>;

function pcmBase64(...samples: number[]): string {
	const bytes = new Uint8Array(new Int16Array(samples).buffer);
	return btoa(String.fromCharCode(...bytes));
}

function decodePcm(base64: string): number[] {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return [...new Int16Array(bytes.buffer)];
}

beforeEach(() => {
	FakeAudioContext.instances = [];
	FakeAudioWorkletNode.instances = [];
	track = { stop: vi.fn() };
	getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
	vi.stubGlobal('AudioContext', FakeAudioContext);
	vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
	vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
	Object.assign(URL, {
		createObjectURL: vi.fn(() => 'blob:pcm-worklet'),
		revokeObjectURL: vi.fn()
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('openMic', () => {
	it('requests a mono echo-cancelled stream and wires the capture graph at 16kHz', async () => {
		const verdict = await openMic(vi.fn());
		expect(verdict.ok).toBe(true);
		expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({
			audio: {
				channelCount: 1,
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: false
			}
		});
		const context = FakeAudioContext.instances[0];
		expect(context.sampleRate).toBe(MIC_SAMPLE_RATE);
		expect(context.resume).toHaveBeenCalled();
		expect(context.audioWorklet.addModule).toHaveBeenCalledExactlyOnceWith('blob:pcm-worklet');
		expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:pcm-worklet');
		const source = context.createMediaStreamSource.mock.results[0].value;
		const node = FakeAudioWorkletNode.instances[0];
		expect(node.name).toBe('pcm-capture');
		expect(source.connect).toHaveBeenCalledExactlyOnceWith(node);
		expect(node.connect).toHaveBeenCalledExactlyOnceWith(context.destination);
	});

	it('delivers chunks as clamped PCM16 base64 with their RMS amplitude', async () => {
		const onChunk = vi.fn();
		await openMic(onChunk);
		const port = FakeAudioWorkletNode.instances[0].port;
		port.onmessage!({ data: new Float32Array([0.6, -0.8, 1.5, -1.5]) });
		expect(onChunk).toHaveBeenCalledTimes(1);
		const [base64, amplitude] = onChunk.mock.calls[0];
		expect(decodePcm(base64)).toEqual([
			Math.round(0.6 * 0x7fff),
			Math.round(-0.8 * 0x7fff),
			0x7fff,
			-0x7fff
		]);
		expect(amplitude).toBeCloseTo(Math.sqrt((0.36 + 0.64 + 2.25 + 2.25) / 4), 5);
	});

	it('stop() detaches the graph, ends the tracks, and closes the context', async () => {
		const verdict = await openMic(vi.fn());
		if (!verdict.ok) throw new Error('expected mic');
		verdict.mic.stop();
		const context = FakeAudioContext.instances[0];
		const source = context.createMediaStreamSource.mock.results[0].value;
		const node = FakeAudioWorkletNode.instances[0];
		expect(node.port.onmessage).toBeNull();
		expect(source.disconnect).toHaveBeenCalledTimes(1);
		expect(node.disconnect).toHaveBeenCalledTimes(1);
		expect(track.stop).toHaveBeenCalledTimes(1);
		expect(context.close).toHaveBeenCalledTimes(1);
	});

	it.each([
		['NotAllowedError', 'mic-permission'],
		['SecurityError', 'mic-permission'],
		['NotFoundError', 'mic-missing'],
		['OverconstrainedError', 'mic-missing'],
		['NotReadableError', 'mic-missing']
	])('maps getUserMedia %s to %s', async (name, reason) => {
		getUserMedia.mockRejectedValueOnce(new DOMException('denied', name));
		expect(await openMic(vi.fn())).toEqual({ ok: false, reason, detail: `${name}: denied` });
	});

	it('maps an unrecognized getUserMedia failure to audio with its detail', async () => {
		getUserMedia.mockRejectedValueOnce(new Error('weird'));
		expect(await openMic(vi.fn())).toEqual({
			ok: false,
			reason: 'audio',
			detail: 'Error: weird'
		});
	});

	it('maps an unrecognized DOMException name to audio — not every DOMException is a device verdict', async () => {
		getUserMedia.mockRejectedValueOnce(new DOMException('interrupted', 'AbortError'));
		expect(await openMic(vi.fn())).toEqual({
			ok: false,
			reason: 'audio',
			detail: 'AbortError: interrupted'
		});
	});

	it('stringifies a non-Error getUserMedia rejection into the detail', async () => {
		getUserMedia.mockRejectedValueOnce('flat refusal');
		expect(await openMic(vi.fn())).toEqual({
			ok: false,
			reason: 'audio',
			detail: 'flat refusal'
		});
	});

	it('reads an empty capture chunk as silence instead of dividing by zero', async () => {
		const onChunk = vi.fn();
		await openMic(onChunk);
		FakeAudioWorkletNode.instances[0].port.onmessage!({ data: new Float32Array(0) });
		expect(onChunk).toHaveBeenCalledExactlyOnceWith('', 0);
	});

	it('releases the granted mic and closes the context when worklet setup fails', async () => {
		vi.stubGlobal(
			'AudioContext',
			class extends FakeAudioContext {
				override audioWorklet = {
					addModule: vi.fn(async () => Promise.reject(new Error('no worklet')))
				};
			}
		);
		expect(await openMic(vi.fn())).toEqual({
			ok: false,
			reason: 'audio',
			detail: 'Error: no worklet'
		});
		expect(track.stop).toHaveBeenCalledTimes(1);
		expect(FakeAudioContext.instances[0].close).toHaveBeenCalledTimes(1);
	});

	it('releases the granted mic when the AudioContext itself cannot be created', async () => {
		vi.stubGlobal(
			'AudioContext',
			class {
				constructor() {
					throw new Error('context limit reached');
				}
			}
		);
		expect(await openMic(vi.fn())).toEqual({
			ok: false,
			reason: 'audio',
			detail: 'Error: context limit reached'
		});
		expect(track.stop).toHaveBeenCalledTimes(1);
	});
});

describe('createSpeaker', () => {
	it('plays at 24kHz and schedules chunks gaplessly after the queue tail', () => {
		const speaker = createSpeaker();
		const context = FakeAudioContext.instances[0];
		expect(context.sampleRate).toBe(SPEAKER_SAMPLE_RATE);
		context.currentTime = 1;
		speaker.enqueue(pcmBase64(16384, -16384));
		speaker.enqueue(pcmBase64(0, 0));
		const [first, second] = context.sources;
		expect(first.start).toHaveBeenCalledExactlyOnceWith(1);
		expect(second.start).toHaveBeenCalledExactlyOnceWith(1 + 2 / SPEAKER_SAMPLE_RATE);
		expect([...first.buffer!.getChannelData(0)]).toEqual([0.5, -0.5]);
		// Sources feed the master gain (the mute seam); the master alone reaches the output.
		const master = context.gains[0];
		expect(first.connect).toHaveBeenCalledExactlyOnceWith(master);
		expect(master.connect).toHaveBeenCalledExactlyOnceWith(context.destination);
	});

	it('starts silent when created muted and restores full gain on unmute', () => {
		const speaker = createSpeaker(true);
		const master = FakeAudioContext.instances[0].gains[0];
		expect(master.gain.value).toBe(0);
		speaker.setMuted(false);
		expect(master.gain.value).toBe(1);
	});

	it('setMuted(true) silences output but still schedules and drains the queue', () => {
		const speaker = createSpeaker();
		const context = FakeAudioContext.instances[0];
		const master = context.gains[0];
		const drained = vi.fn();
		speaker.onDrained(drained);
		speaker.setMuted(true);
		expect(master.gain.value).toBe(0);
		// Muting attenuates only — playback still schedules and drains, so caption turn-timing holds.
		speaker.enqueue(pcmBase64(1));
		const [source] = context.sources;
		expect(source.start).toHaveBeenCalledTimes(1);
		expect(speaker.busy).toBe(true);
		source.onended!();
		expect(drained).toHaveBeenCalledTimes(1);
	});

	it('reports busy until every scheduled chunk ends, then fires drained once', () => {
		const speaker = createSpeaker();
		const drained = vi.fn();
		speaker.onDrained(drained);
		speaker.enqueue(pcmBase64(1));
		speaker.enqueue(pcmBase64(2));
		const [first, second] = FakeAudioContext.instances[0].sources;
		expect(speaker.busy).toBe(true);
		first.onended!();
		expect(drained).not.toHaveBeenCalled();
		second.onended!();
		expect(drained).toHaveBeenCalledTimes(1);
		expect(speaker.busy).toBe(false);
	});

	it('stop() silences and clears the queue without firing drained, and resets the cursor', () => {
		const speaker = createSpeaker();
		const context = FakeAudioContext.instances[0];
		const drained = vi.fn();
		speaker.onDrained(drained);
		speaker.enqueue(pcmBase64(1, 2, 3));
		speaker.stop();
		const [first] = context.sources;
		expect(first.stop).toHaveBeenCalledTimes(1);
		expect(first.onended).toBeNull();
		expect(drained).not.toHaveBeenCalled();
		expect(speaker.busy).toBe(false);
		context.currentTime = 5;
		speaker.enqueue(pcmBase64(4));
		expect(context.sources[1].start).toHaveBeenCalledExactlyOnceWith(5);
	});

	it('stop() survives a source that already ended', () => {
		const speaker = createSpeaker();
		speaker.enqueue(pcmBase64(1));
		FakeAudioContext.instances[0].sources[0].stop.mockImplementation(() => {
			throw new DOMException('already stopped', 'InvalidStateError');
		});
		expect(() => speaker.stop()).not.toThrow();
		expect(speaker.busy).toBe(false);
	});

	it('ignores empty and sub-sample payloads', () => {
		const speaker = createSpeaker();
		speaker.enqueue('');
		speaker.enqueue(btoa('x'));
		expect(FakeAudioContext.instances[0].sources).toHaveLength(0);
		expect(speaker.busy).toBe(false);
	});

	it('close() stops playback and closes the context', () => {
		const speaker = createSpeaker();
		speaker.enqueue(pcmBase64(1));
		speaker.close();
		const context = FakeAudioContext.instances[0];
		expect(context.sources[0].stop).toHaveBeenCalledTimes(1);
		expect(context.close).toHaveBeenCalledTimes(1);
	});
});
