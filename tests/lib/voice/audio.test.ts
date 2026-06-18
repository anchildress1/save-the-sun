import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpeaker } from '$lib/voice/audio';
import { SPEAKER_SAMPLE_RATE } from '$lib/voice/config';

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

function pcmBase64(...samples: number[]): string {
	const bytes = new Uint8Array(new Int16Array(samples).buffer);
	return btoa(String.fromCharCode(...bytes));
}

beforeEach(() => {
	FakeAudioContext.instances = [];
	vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('createSpeaker', () => {
	it('plays at 24kHz and schedules chunks gaplessly after the queue tail', () => {
		const speaker = createSpeaker();
		const context = FakeAudioContext.instances[0];
		expect(context.sampleRate).toBe(SPEAKER_SAMPLE_RATE);
		context.currentTime = 1;
		speaker.enqueue(pcmBase64(16384, -16384), 'oracle');
		speaker.enqueue(pcmBase64(0, 0), 'oracle');
		const [first, second] = context.sources;
		expect(first.start).toHaveBeenCalledExactlyOnceWith(1);
		expect(second.start).toHaveBeenCalledExactlyOnceWith(1 + 2 / SPEAKER_SAMPLE_RATE);
		expect([...first.buffer!.getChannelData(0)]).toEqual([0.5, -0.5]);
		// Sources → master gain (mute seam) → output.
		const master = context.gains[0];
		expect(first.connect).toHaveBeenCalledExactlyOnceWith(master);
		expect(master.connect).toHaveBeenCalledExactlyOnceWith(context.destination);
	});

	it('reports the heard voice on playback, flipping only when the next clip actually starts', () => {
		const speaker = createSpeaker();
		const context = FakeAudioContext.instances[0];
		const speaking = vi.fn();
		speaker.onSpeaking(speaking);
		// Her two chunks then his — all queued up front, exactly as the serialized delivery chain does.
		speaker.enqueue(pcmBase64(1), 'oracle');
		speaker.enqueue(pcmBase64(2), 'oracle');
		speaker.enqueue(pcmBase64(3), 'skoll');
		// Only her voice is heard at first; his stays queued behind hers — NOT announced early.
		expect(speaking.mock.calls).toEqual([['oracle']]);
		const [o1, o2, s1] = context.sources;
		o1.onended!();
		expect(speaking.mock.calls).toEqual([['oracle']]); // o2 still sounding — no re-announce
		o2.onended!();
		// His clip becomes the one sounding only now — this is the moment the medallion turns to him.
		expect(speaking.mock.calls).toEqual([['oracle'], ['skoll']]);
		s1.onended!(); // queue dry → drained, never a stray speaking event
		expect(speaking.mock.calls).toEqual([['oracle'], ['skoll']]);
	});

	it('starts silent when created muted and restores full gain on unmute', () => {
		const speaker = createSpeaker(true);
		const master = FakeAudioContext.instances[0].gains[0];
		expect(master.gain.value).toBe(0);
		speaker.setMuted(false);
		expect(master.gain.value).toBe(1);
	});

	it('setMuted(true) silences output but still schedules, announces, and drains the queue', () => {
		const speaker = createSpeaker();
		const context = FakeAudioContext.instances[0];
		const master = context.gains[0];
		const drained = vi.fn();
		const speaking = vi.fn();
		speaker.onDrained(drained);
		speaker.onSpeaking(speaking);
		speaker.setMuted(true);
		expect(master.gain.value).toBe(0);
		// Muting attenuates only — playback still schedules, announces, and drains (caption timing holds).
		speaker.enqueue(pcmBase64(1), 'oracle');
		const [source] = context.sources;
		expect(source.start).toHaveBeenCalledTimes(1);
		expect(speaking).toHaveBeenCalledExactlyOnceWith('oracle');
		expect(speaker.busy).toBe(true);
		source.onended!();
		expect(drained).toHaveBeenCalledTimes(1);
	});

	it('reports busy until every scheduled chunk ends, then fires drained once', () => {
		const speaker = createSpeaker();
		const drained = vi.fn();
		speaker.onDrained(drained);
		speaker.enqueue(pcmBase64(1), 'oracle');
		speaker.enqueue(pcmBase64(2), 'oracle');
		const [first, second] = FakeAudioContext.instances[0].sources;
		expect(speaker.busy).toBe(true);
		first.onended!();
		expect(drained).not.toHaveBeenCalled();
		second.onended!();
		expect(drained).toHaveBeenCalledTimes(1);
		expect(speaker.busy).toBe(false);
	});

	it('stop() silences and clears the queue without firing drained or speaking, and resets the cursor', () => {
		const speaker = createSpeaker();
		const context = FakeAudioContext.instances[0];
		const drained = vi.fn();
		speaker.onDrained(drained);
		speaker.enqueue(pcmBase64(1, 2, 3), 'oracle');
		speaker.stop();
		const [first] = context.sources;
		expect(first.stop).toHaveBeenCalledTimes(1);
		expect(first.onended).toBeNull();
		expect(drained).not.toHaveBeenCalled();
		expect(speaker.busy).toBe(false);
		context.currentTime = 5;
		speaker.enqueue(pcmBase64(4), 'oracle');
		expect(context.sources[1].start).toHaveBeenCalledExactlyOnceWith(5);
	});

	it('stop() survives a source that already ended', () => {
		const speaker = createSpeaker();
		speaker.enqueue(pcmBase64(1), 'oracle');
		FakeAudioContext.instances[0].sources[0].stop.mockImplementation(() => {
			throw new DOMException('already stopped', 'InvalidStateError');
		});
		expect(() => speaker.stop()).not.toThrow();
		expect(speaker.busy).toBe(false);
	});

	it('ignores empty and sub-sample payloads', () => {
		const speaker = createSpeaker();
		speaker.enqueue('', 'oracle');
		speaker.enqueue(btoa('x'), 'oracle');
		expect(FakeAudioContext.instances[0].sources).toHaveLength(0);
		expect(speaker.busy).toBe(false);
	});

	it('close() stops playback and closes the context', () => {
		const speaker = createSpeaker();
		speaker.enqueue(pcmBase64(1), 'oracle');
		speaker.close();
		const context = FakeAudioContext.instances[0];
		expect(context.sources[0].stop).toHaveBeenCalledTimes(1);
		expect(context.close).toHaveBeenCalledTimes(1);
	});
});
