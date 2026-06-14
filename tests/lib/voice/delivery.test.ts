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
	deliveryReady,
	setDeliveryMuted,
	deliver,
	resetDelivery
} from '$lib/voice/delivery';

const GREETING = { kind: 'greeting' } as const;

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
		await deliver(GREETING);
		expect(fetch).not.toHaveBeenCalled();
		expect(audio.speaker.enqueue).not.toHaveBeenCalled();
	});

	it('streams the line audio and enqueues each chunk as it arrives', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(ndjsonResponse('pcm-a', 'pcm-b', 'pcm-c'));
		enableDelivery();

		await deliver(GREETING);

		expect(fetch).toHaveBeenCalledWith('/api/voice/tts', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(GREETING)
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

		await expect(deliver(GREETING)).resolves.toBeUndefined();
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

		const inflight = deliver(GREETING);
		// Let the first chunk be read, then close the speaker before releasing the second.
		await vi.waitFor(() => expect(audio.speaker.enqueue).toHaveBeenCalledWith('first'));
		disableDelivery();
		releaseSecond();
		await inflight;

		expect(audio.speaker.enqueue.mock.calls.flat()).toEqual(['first']);
		expect(audio.speaker.close).toHaveBeenCalledTimes(1);
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
