import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const audio = vi.hoisted(() => {
	const speaker = {
		enqueue: vi.fn(),
		stop: vi.fn(),
		setMuted: vi.fn(),
		close: vi.fn(),
		onDrained: vi.fn(),
		busy: false
	};
	const createSpeaker = vi.fn(() => speaker);
	return { speaker, createSpeaker };
});

vi.mock('$lib/voice/audio', () => ({ createSpeaker: audio.createSpeaker }));

import {
	enableDelivery,
	disableDelivery,
	stopDelivery,
	deliveryReady,
	setDeliveryMuted,
	deliver,
	whenDrained,
	resetDelivery
} from '$lib/voice/delivery';

const LINE = { kind: 'refusal', refusal: 'empty' } as const;

// A streaming TTS response: NDJSON, one base64 chunk per line.
function ndjsonResponse(...chunks: string[]) {
	return new Response(chunks.map((c) => c + '\n').join(''), {
		headers: { 'content-type': 'application/x-ndjson' }
	});
}

describe('delivery seam', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetDelivery();
		audio.speaker.busy = false;
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => vi.unstubAllGlobals());

	it('opens the speaker only on a gesture, idempotently', () => {
		expect(deliveryReady()).toBe(false);
		enableDelivery();
		enableDelivery();
		expect(deliveryReady()).toBe(true);
		expect(audio.createSpeaker).toHaveBeenCalledTimes(1);
	});

	it('does not fetch or play before the speaker is enabled', async () => {
		await deliver(LINE);
		expect(fetch).not.toHaveBeenCalled();
		expect(audio.speaker.enqueue).not.toHaveBeenCalled();
	});

	it('streams the line audio and enqueues each chunk as it arrives', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(ndjsonResponse('pcm-a', 'pcm-b', 'pcm-c'));
		enableDelivery();

		await deliver(LINE);

		expect(fetch).toHaveBeenCalledWith('/api/voice/tts', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(LINE),
			signal: expect.any(AbortSignal)
		});
		expect(audio.speaker.enqueue.mock.calls.flat()).toEqual(['pcm-a', 'pcm-b', 'pcm-c']);
	});

	it('stays silent when the route refuses the line', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 400 }));
		enableDelivery();

		await deliver({ kind: 'refusal', refusal: 'empty' });

		expect(audio.speaker.enqueue).not.toHaveBeenCalled();
	});

	it('stays silent when the fetch rejects', async () => {
		vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
		enableDelivery();

		await expect(deliver(LINE)).resolves.toBeUndefined();
		expect(audio.speaker.enqueue).not.toHaveBeenCalled();
	});

	it('does not enqueue onto a speaker closed mid-stream', async () => {
		// A stream that emits one chunk, then waits — letting the test disable delivery before the
		// second chunk lands. The chunk after the close must not reach the (closed) speaker.
		let releaseSecond: () => void = () => {};
		const body = new ReadableStream<Uint8Array>({
			async start(controller) {
				const enc = new TextEncoder();
				controller.enqueue(enc.encode('first\n'));
				await new Promise<void>((resolve) => {
					releaseSecond = resolve;
				});
				controller.enqueue(enc.encode('second\n'));
				controller.close();
			}
		});
		vi.mocked(fetch).mockResolvedValueOnce(new Response(body));
		enableDelivery();

		const inflight = deliver(LINE);
		// Let the first chunk be read, then close the speaker before releasing the second.
		await vi.waitFor(() => expect(audio.speaker.enqueue).toHaveBeenCalledWith('first'));
		disableDelivery();
		releaseSecond();
		await inflight;

		expect(audio.speaker.enqueue.mock.calls.flat()).toEqual(['first']);
		expect(audio.speaker.close).toHaveBeenCalledTimes(1);
	});

	it('serializes back-to-back deliveries so two lines never interleave their chunks', async () => {
		// The first line streams one chunk, then waits — so the test can prove the second line has not
		// started (it is chained behind the first) before releasing the rest.
		let releaseFirst: () => void = () => {};
		const firstBody = new ReadableStream<Uint8Array>({
			async start(controller) {
				const enc = new TextEncoder();
				controller.enqueue(enc.encode('her-1\n'));
				await new Promise<void>((resolve) => {
					releaseFirst = resolve;
				});
				controller.enqueue(enc.encode('her-2\n'));
				controller.close();
			}
		});
		vi.mocked(fetch)
			.mockResolvedValueOnce(new Response(firstBody))
			.mockResolvedValueOnce(ndjsonResponse('his-1', 'his-2'));
		enableDelivery();

		// Both fire back-to-back (her answer, then his Ask) without awaiting the first.
		const first = deliver(LINE);
		const second = deliver(LINE);

		await vi.waitFor(() => expect(audio.speaker.enqueue).toHaveBeenCalledWith('her-1'));
		// The second line has NOT begun — it is queued behind the first, so only one fetch so far.
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(audio.speaker.enqueue.mock.calls.flat()).toEqual(['her-1']);

		releaseFirst();
		await Promise.all([first, second]);

		// Her whole line enqueued before his — no interleaving.
		expect(audio.speaker.enqueue.mock.calls.flat()).toEqual(['her-1', 'her-2', 'his-1', 'his-2']);
	});

	it('drops a line queued behind an in-flight one when a stop lands before its turn', async () => {
		// The first line streams one chunk then pends; the second is queued behind it. A stop while
		// the second waits its turn (generation captured at enqueue) must drop it — it can't fetch or
		// play into the fresh round even though the speaker stays open.
		let releaseFirst: () => void = () => {};
		const firstBody = new ReadableStream<Uint8Array>({
			async start(controller) {
				const enc = new TextEncoder();
				controller.enqueue(enc.encode('her-1\n'));
				await new Promise<void>((resolve) => {
					releaseFirst = resolve;
				});
				controller.enqueue(enc.encode('her-2\n'));
				controller.close();
			}
		});
		vi.mocked(fetch)
			.mockResolvedValueOnce(new Response(firstBody))
			.mockResolvedValueOnce(ndjsonResponse('his-1', 'his-2'));
		enableDelivery();

		const first = deliver(LINE);
		const second = deliver(LINE);
		await vi.waitFor(() => expect(audio.speaker.enqueue).toHaveBeenCalledWith('her-1'));

		stopDelivery(); // a new round bumps generation while the second line is still queued
		releaseFirst();
		await Promise.all([first, second]);

		// The first's remaining chunk and the entire second line are dropped — only the pre-stop chunk
		// played, and the queued line never fetched.
		expect(audio.speaker.enqueue.mock.calls.flat()).toEqual(['her-1']);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('stopDelivery invalidates an in-flight fetch so late chunks never play', async () => {
		let releaseSecond: () => void = () => {};
		const body = new ReadableStream<Uint8Array>({
			async start(controller) {
				const enc = new TextEncoder();
				controller.enqueue(enc.encode('first\n'));
				await new Promise<void>((resolve) => {
					releaseSecond = resolve;
				});
				controller.enqueue(enc.encode('second\n'));
				controller.close();
			}
		});
		vi.mocked(fetch).mockResolvedValueOnce(new Response(body));
		enableDelivery();

		const inflight = deliver(LINE);
		await vi.waitFor(() => expect(audio.speaker.enqueue).toHaveBeenCalledWith('first'));
		// A new round stops delivery while this fetch is still streaming.
		stopDelivery();
		releaseSecond();
		await inflight;

		// The stale chunk is dropped, but the speaker stays open (stop, not close).
		expect(audio.speaker.enqueue.mock.calls.flat()).toEqual(['first']);
		expect(audio.speaker.stop).toHaveBeenCalled();
		expect(audio.speaker.close).not.toHaveBeenCalled();
		expect(deliveryReady()).toBe(true);
	});

	it('whenDrained resolves immediately when nothing is playing', async () => {
		enableDelivery();
		audio.speaker.busy = false;
		await expect(whenDrained(1000)).resolves.toBeUndefined();
		expect(audio.speaker.onDrained).not.toHaveBeenCalled();
	});

	it('whenDrained resolves immediately when no speaker is open', async () => {
		await expect(whenDrained(1000)).resolves.toBeUndefined();
	});

	it('whenDrained waits for the speaker to drain', async () => {
		enableDelivery();
		audio.speaker.busy = true;
		let drain: () => void = () => {};
		audio.speaker.onDrained.mockImplementation((cb: () => void) => {
			drain = cb;
		});

		let resolved = false;
		const p = whenDrained(10_000).then(() => {
			resolved = true;
		});
		await Promise.resolve();
		expect(resolved).toBe(false);

		drain();
		await p;
		expect(resolved).toBe(true);
	});

	it('whenDrained resolves on timeout even if the speaker never drains', async () => {
		vi.useFakeTimers();
		try {
			enableDelivery();
			audio.speaker.busy = true;
			audio.speaker.onDrained.mockImplementation(() => {});
			const p = whenDrained(5000);
			vi.advanceTimersByTime(5000);
			await expect(p).resolves.toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it('stopDelivery drops the queue without closing the speaker', () => {
		enableDelivery();
		stopDelivery();
		expect(audio.speaker.stop).toHaveBeenCalledTimes(1);
		expect(audio.speaker.close).not.toHaveBeenCalled();
		expect(deliveryReady()).toBe(true);
	});

	it('stopDelivery is a no-op with no speaker open', () => {
		expect(() => stopDelivery()).not.toThrow();
		expect(audio.speaker.stop).not.toHaveBeenCalled();
	});

	it('applies mute to a live speaker and remembers it for a later one', () => {
		enableDelivery();
		setDeliveryMuted(true);
		expect(audio.speaker.setMuted).toHaveBeenCalledWith(true);

		disableDelivery();
		enableDelivery();
		// The reopened speaker starts muted from the remembered preference.
		expect(audio.createSpeaker).toHaveBeenLastCalledWith(true);
	});
});
