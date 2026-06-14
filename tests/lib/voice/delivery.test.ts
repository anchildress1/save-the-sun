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
	deliverClip,
	preloadClips,
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

	describe('deliverClip (Sköll, P2)', () => {
		const CLIP = '/audio/skoll/night-opens-1.pcm.b64';

		it('does not fetch or play before the speaker is enabled', async () => {
			await deliverClip(CLIP);
			expect(fetch).not.toHaveBeenCalled();
			expect(audio.speaker.enqueue).not.toHaveBeenCalled();
		});

		it('fetches the static clip and enqueues it as one blob on the shared speaker', async () => {
			vi.mocked(fetch).mockResolvedValueOnce(new Response('skoll-pcm-blob\n'));
			enableDelivery();

			await deliverClip(CLIP);

			expect(fetch).toHaveBeenCalledWith(CLIP, { signal: expect.any(AbortSignal) });
			// Trimmed, single enqueue — the same speaker the Oracle uses, so the two serialize (R9).
			expect(audio.speaker.enqueue.mock.calls.flat()).toEqual(['skoll-pcm-blob']);
		});

		it('stays silent when the clip is missing', async () => {
			vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));
			enableDelivery();

			await deliverClip(CLIP);

			expect(audio.speaker.enqueue).not.toHaveBeenCalled();
		});

		it('stays silent when the fetch rejects', async () => {
			vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
			enableDelivery();

			await expect(deliverClip(CLIP)).resolves.toBeUndefined();
			expect(audio.speaker.enqueue).not.toHaveBeenCalled();
		});

		it('preloads clips into the cache, fetching each once', async () => {
			vi.mocked(fetch).mockImplementation(async (url) => new Response(`blob-for-${String(url)}\n`));
			const urls = ['/audio/skoll/night-opens-1.pcm.b64', '/audio/skoll/hexed-1.pcm.b64'];

			await preloadClips(urls);
			expect(fetch).toHaveBeenCalledTimes(2);

			// A second preload is idempotent — already-cached urls are skipped.
			await preloadClips(urls);
			expect(fetch).toHaveBeenCalledTimes(2);
		});

		it('plays a preloaded clip with no fetch at trigger time', async () => {
			vi.mocked(fetch).mockResolvedValueOnce(new Response('warm-blob\n'));
			await preloadClips([CLIP]);
			expect(fetch).toHaveBeenCalledTimes(1);

			enableDelivery();
			await deliverClip(CLIP);

			// The trigger enqueued from cache — no second fetch.
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(audio.speaker.enqueue.mock.calls.flat()).toEqual(['warm-blob']);
		});

		it('caches a cold-path clip so the next play skips the fetch', async () => {
			vi.mocked(fetch).mockResolvedValueOnce(new Response('cold-blob\n'));
			enableDelivery();

			await deliverClip(CLIP); // cold: fetches + caches
			await deliverClip(CLIP); // warm: no fetch

			expect(fetch).toHaveBeenCalledTimes(1);
			expect(audio.speaker.enqueue.mock.calls.flat()).toEqual(['cold-blob', 'cold-blob']);
		});

		it('drops a clip whose round was stopped while it was fetching', async () => {
			let release: () => void = () => {};
			const body = new ReadableStream<Uint8Array>({
				async start(controller) {
					await new Promise<void>((resolve) => {
						release = resolve;
					});
					controller.enqueue(new TextEncoder().encode('late-blob'));
					controller.close();
				}
			});
			vi.mocked(fetch).mockResolvedValueOnce(new Response(body));
			enableDelivery();

			const inflight = deliverClip(CLIP);
			stopDelivery(); // a new round abandons the previous round's clip
			release();
			await inflight;

			expect(audio.speaker.enqueue).not.toHaveBeenCalled();
		});
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
