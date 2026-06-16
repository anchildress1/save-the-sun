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

class FakeAnalyser {
	fftSize = 2048;
	connect = vi.fn();
	// Test-controlled byte time-domain data; 128 = silence (the midpoint).
	timeData: number[] = [];
	getByteTimeDomainData(out: Uint8Array): void {
		for (let i = 0; i < out.length; i++) out[i] = this.timeData[i] ?? 128;
	}
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
	analysers: FakeAnalyser[] = [];

	constructor(options: { sampleRate: number }) {
		this.sampleRate = options.sampleRate;
		FakeAudioContext.instances.push(this);
	}

	createGain(): FakeGain {
		const gain: FakeGain = { gain: { value: 1 }, connect: vi.fn() };
		this.gains.push(gain);
		return gain;
	}

	createAnalyser(): FakeAnalyser {
		const analyser = new FakeAnalyser();
		this.analysers.push(analyser);
		return analyser;
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
		speaker.enqueue(pcmBase64(16384, -16384));
		speaker.enqueue(pcmBase64(0, 0));
		const [first, second] = context.sources;
		expect(first.start).toHaveBeenCalledExactlyOnceWith(1);
		expect(second.start).toHaveBeenCalledExactlyOnceWith(1 + 2 / SPEAKER_SAMPLE_RATE);
		expect([...first.buffer!.getChannelData(0)]).toEqual([0.5, -0.5]);
		// Sources → analyser (pre-mute tap for the medallion) → master gain (mute seam) → output.
		const master = context.gains[0];
		const analyser = context.analysers[0];
		expect(first.connect).toHaveBeenCalledExactlyOnceWith(analyser);
		expect(analyser.connect).toHaveBeenCalledExactlyOnceWith(master);
		expect(master.connect).toHaveBeenCalledExactlyOnceWith(context.destination);
	});

	it('reports output level as RMS in [0, 1] — 0 at silence, near 1 at full swing', () => {
		const speaker = createSpeaker();
		const analyser = FakeAudioContext.instances[0].analysers[0];
		// All midpoint bytes (128) → silence → RMS 0.
		expect(speaker.level()).toBe(0);
		// A full-swing wave around the midpoint → RMS near 1.
		analyser.timeData = Array.from({ length: analyser.fftSize }, (_, i) => (i % 2 ? 255 : 0));
		expect(speaker.level()).toBeGreaterThan(0.9);
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
