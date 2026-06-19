import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const audio = vi.hoisted(() => {
	const speaker = {
		enqueue: vi.fn(),
		stop: vi.fn(),
		close: vi.fn(),
		onDrained: vi.fn(),
		onSpeaking: vi.fn(),
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
	deliver,
	whenDrained,
	subscribeDelivery,
	resetDelivery,
	type DeliveryEvent
} from '$lib/voice/delivery';
import { ORACLE_VOICE, SKOLL_VOICE } from '$lib/voice/config';

const LINE = { kind: 'refusal', refusal: 'empty' } as const;

// The drain handler delivery registers at enable() — calling it simulates the speaker running dry.
const fireDrain = () => {
	const handler = audio.speaker.onDrained.mock.calls.at(-1)?.[0];
	if (!handler) throw new Error('delivery never registered an onDrained handler');
	handler();
};

// The speaking handler delivery registers at enable() — calling it simulates the speaker reaching
// a clip of `voice` in the queue. Playback timing (which voice, when) is the speaker's job, proven
// in audio.test.ts; here we drive it directly to prove delivery forwards it to subscribers.
const fireSpeaking = (voice: 'oracle' | 'skoll') => {
	const handler = audio.speaker.onSpeaking.mock.calls.at(-1)?.[0];
	if (!handler) throw new Error('delivery never registered an onSpeaking handler');
	handler(voice);
};

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

	it('does not fetch TTS once a mute has closed the speaker — no Gemini credit for unheard audio', async () => {
		enableDelivery();
		disableDelivery(); // the page mutes by closing the speaker, not by gating a gain node
		await deliver(LINE);
		expect(fetch).not.toHaveBeenCalled();
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
		expect(audio.speaker.enqueue.mock.calls.map((c) => c[0])).toEqual(['pcm-a', 'pcm-b', 'pcm-c']);
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
		await vi.waitFor(() => expect(audio.speaker.enqueue).toHaveBeenCalledWith('first', 'oracle'));
		disableDelivery();
		releaseSecond();
		await inflight;

		expect(audio.speaker.enqueue.mock.calls.map((c) => c[0])).toEqual(['first']);
		expect(audio.speaker.close).toHaveBeenCalledTimes(1);
	});

	it('aborts the in-flight TTS fetch on stop — a stalled read cannot wedge the chain', async () => {
		let capturedSignal: AbortSignal | undefined;
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
		vi.mocked(fetch).mockImplementationOnce((_url, init) => {
			capturedSignal = (init as RequestInit)?.signal ?? undefined;
			return Promise.resolve(new Response(body));
		});
		enableDelivery();

		const inflight = deliver(LINE);
		await vi.waitFor(() => expect(audio.speaker.enqueue).toHaveBeenCalledWith('first', 'oracle'));
		expect(capturedSignal?.aborted).toBe(false);

		// In real fetch this aborts the body stream and unblocks the pending read; here we assert the
		// mechanism (the controller is reachable from stop) that the old code lacked.
		stopDelivery();
		expect(capturedSignal?.aborted).toBe(true);

		releaseSecond();
		await inflight;
		expect(audio.speaker.enqueue.mock.calls.map((c) => c[0])).toEqual(['first']);
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

		await vi.waitFor(() => expect(audio.speaker.enqueue).toHaveBeenCalledWith('her-1', 'oracle'));
		// The second line has NOT begun — it is queued behind the first, so only one fetch so far.
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(audio.speaker.enqueue.mock.calls.map((c) => c[0])).toEqual(['her-1']);

		releaseFirst();
		await Promise.all([first, second]);

		// Her whole line enqueued before his — no interleaving.
		expect(audio.speaker.enqueue.mock.calls.map((c) => c[0])).toEqual([
			'her-1',
			'her-2',
			'his-1',
			'his-2'
		]);
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
		await vi.waitFor(() => expect(audio.speaker.enqueue).toHaveBeenCalledWith('her-1', 'oracle'));

		stopDelivery(); // a new round bumps generation while the second line is still queued
		releaseFirst();
		await Promise.all([first, second]);

		// The first's remaining chunk and the entire second line are dropped — only the pre-stop chunk
		// played, and the queued line never fetched.
		expect(audio.speaker.enqueue.mock.calls.map((c) => c[0])).toEqual(['her-1']);
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
		await vi.waitFor(() => expect(audio.speaker.enqueue).toHaveBeenCalledWith('first', 'oracle'));
		// A new round stops delivery while this fetch is still streaming.
		stopDelivery();
		releaseSecond();
		await inflight;

		// The stale chunk is dropped, but the speaker stays open (stop, not close).
		expect(audio.speaker.enqueue.mock.calls.map((c) => c[0])).toEqual(['first']);
		expect(audio.speaker.stop).toHaveBeenCalled();
		expect(audio.speaker.close).not.toHaveBeenCalled();
		expect(deliveryReady()).toBe(true);
	});

	it('whenDrained resolves immediately when nothing is playing', async () => {
		enableDelivery();
		audio.speaker.busy = false;
		await expect(whenDrained(1000)).resolves.toBeUndefined();
	});

	it('whenDrained resolves immediately when no speaker is open', async () => {
		await expect(whenDrained(1000)).resolves.toBeUndefined();
	});

	it('whenDrained waits for the speaker to drain', async () => {
		enableDelivery();
		audio.speaker.busy = true;

		let resolved = false;
		const p = whenDrained(10_000).then(() => {
			resolved = true;
		});
		await Promise.resolve();
		expect(resolved).toBe(false);

		fireDrain();
		await p;
		expect(resolved).toBe(true);
	});

	it('whenDrained resolves on timeout even if the speaker never drains', async () => {
		vi.useFakeTimers();
		try {
			enableDelivery();
			audio.speaker.busy = true;
			const p = whenDrained(5000);
			vi.advanceTimersByTime(5000);
			await expect(p).resolves.toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it('whenDrained holds for a line still fetching before any chunk is queued', async () => {
		let releaseFetch: (res: Response) => void = () => {};
		vi.mocked(fetch).mockReturnValueOnce(
			new Promise<Response>((resolve) => {
				releaseFetch = resolve;
			})
		);
		enableDelivery();
		audio.speaker.busy = false; // no chunks queued yet — the old busy-only gate would resolve early

		const inflight = deliver(LINE);
		let drained = false;
		const gate = whenDrained(10_000).then(() => {
			drained = true;
		});

		await Promise.resolve();
		expect(drained).toBe(false); // the line is still in flight; the hold must not release yet

		releaseFetch(ndjsonResponse('pcm-a'));
		await inflight;
		await gate;
		expect(drained).toBe(true);
	});

	it('does not release whenDrained on a mid-stream dry queue while a delivery is still streaming', async () => {
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
		let drained = false;
		const gate = whenDrained(10_000).then(() => {
			drained = true;
		});

		await vi.waitFor(() => expect(audio.speaker.enqueue).toHaveBeenCalledWith('first', 'oracle'));
		// The speaker's queue runs dry mid-stream (the inter-chunk gap outran the queued audio). With
		// the deliver still fetching the next chunk, this must NOT release the hold.
		fireDrain();
		await Promise.resolve();
		expect(drained).toBe(false);

		// Finish the stream; the final drain (pendingDeliveries === 0) releases the hold.
		releaseSecond();
		await inflight;
		await gate;
		expect(drained).toBe(true);
	});

	it('a body-less 200 releases whenDrained on completion, not via the timeout', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
		enableDelivery();
		audio.speaker.busy = false;

		const inflight = deliver(LINE);
		let drained = false;
		// A 10s fallback that this test never advances: resolving proves completion settled it, not the timer.
		const gate = whenDrained(10_000).then(() => {
			drained = true;
		});

		await inflight;
		await gate;
		expect(drained).toBe(true);
		expect(audio.speaker.enqueue).not.toHaveBeenCalled();
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
});

describe('delivery speaking events', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetDelivery();
		audio.speaker.busy = false;
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => vi.unstubAllGlobals());

	function collect(): DeliveryEvent[] {
		const events: DeliveryEvent[] = [];
		subscribeDelivery((e) => events.push(e));
		return events;
	}

	it('forwards the voice the speaker is sounding to subscribers, idle when it drains', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(ndjsonResponse('pcm-a'));
		enableDelivery();
		const events = collect();

		await deliver(LINE); // refusal → her voice, tagged on enqueue
		// Enqueue alone is silent: nothing is "spoken" until the speaker actually reaches the clip.
		expect(events).toEqual([]);

		fireSpeaking('oracle');
		expect(events).toEqual([{ type: 'speaking', voice: 'oracle' }]);

		fireDrain();
		expect(events).toEqual([{ type: 'speaking', voice: 'oracle' }, { type: 'idle' }]);
	});

	it('tags each chunk with the voice its descriptor maps to (his Ask and the loss are Sköll)', async () => {
		vi.mocked(fetch).mockImplementation(async () => ndjsonResponse('pcm-a'));
		enableDelivery();

		await deliver({ kind: 'skoll-ask', query: { axis: 'power', value: 3 } });
		await deliver({ kind: 'outcome', result: 'win', beat: 'coda' });
		await deliver({ kind: 'outcome', result: 'lose', beat: 'verse' });

		// The voice tag is what the speaker later announces — Ask + loss are his, the win is hers.
		expect(audio.speaker.enqueue.mock.calls.map((c) => c[1])).toEqual(['skoll', 'oracle', 'skoll']);
	});

	it('skips an empty NDJSON line without enqueuing it as a clip', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(ndjsonResponse('pcm-a', '', 'pcm-b'));
		enableDelivery();

		await deliver(LINE);

		// The blank line between chunks is dropped, never enqueued as an empty clip.
		expect(audio.speaker.enqueue.mock.calls.map((c) => c[0])).toEqual(['pcm-a', 'pcm-b']);
	});

	it('tags an authored Oracle line as hers', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(ndjsonResponse('pcm'));
		enableDelivery();

		await deliver({
			kind: 'authored',
			id: 'vl-oracle-1',
			voice: ORACLE_VOICE,
			text: 'The sun holds — for now.'
		});

		expect(audio.speaker.enqueue.mock.calls.map((c) => c[1])).toEqual(['oracle']);
	});

	it('tags authored Sköll lines as his', async () => {
		vi.mocked(fetch).mockImplementation(async () => ndjsonResponse('pcm-a'));
		enableDelivery();

		await deliver({ kind: 'outcome', result: 'win', beat: 'coda' });
		await deliver({
			kind: 'authored',
			id: 'vl-skoll-1',
			voice: SKOLL_VOICE,
			text: 'The sun is mine. Your night has no morning.'
		});

		expect(audio.speaker.enqueue.mock.calls.map((c) => c[1])).toEqual(['oracle', 'skoll']);
	});

	it('stays idle when a line produces no audio', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 400 }));
		enableDelivery();
		const events = collect();

		await deliver(LINE);
		expect(events).toEqual([]);
	});

	it('settles to idle on stopDelivery and disableDelivery', async () => {
		vi.mocked(fetch).mockResolvedValue(ndjsonResponse('pcm-a'));
		enableDelivery();
		const events = collect();

		await deliver(LINE);
		fireSpeaking('oracle');
		stopDelivery();
		expect(events).toEqual([{ type: 'speaking', voice: 'oracle' }, { type: 'idle' }]);
	});

	it('unsubscribes cleanly — a dropped listener hears nothing more', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(ndjsonResponse('pcm-a'));
		enableDelivery();
		const events: DeliveryEvent[] = [];
		const off = subscribeDelivery((e) => events.push(e));

		await deliver(LINE);
		fireSpeaking('oracle');
		off();
		fireDrain();
		expect(events).toEqual([{ type: 'speaking', voice: 'oracle' }]);
	});
});
