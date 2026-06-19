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

class FakeAudioContext {
	static instances: FakeAudioContext[] = [];
	sampleRate: number;
	currentTime = 0;
	destination = { sink: true };
	resume = vi.fn(async () => {});
	close = vi.fn(async () => {});
	sources: FakeSource[] = [];

	constructor(options: { sampleRate: number }) {
		this.sampleRate = options.sampleRate;
		FakeAudioContext.instances.push(this);
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
		expect(first.connect).toHaveBeenCalledExactlyOnceWith(context.destination);
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

	it('ignores a duplicate onended for a clip already removed from the queue', () => {
		const speaker = createSpeaker();
		const context = FakeAudioContext.instances[0];
		const drained = vi.fn();
		speaker.onDrained(drained);
		speaker.enqueue(pcmBase64(1), 'oracle');
		const [only] = context.sources;
		only.onended!(); // removes the entry; queue dry → drained
		expect(drained).toHaveBeenCalledTimes(1);
		// A late/duplicate onended for the same (already-removed) clip finds idx < 0 — a no-op, never a
		// second splice or a double-drain.
		only.onended!();
		expect(drained).toHaveBeenCalledTimes(1);
		expect(speaker.busy).toBe(false);
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
