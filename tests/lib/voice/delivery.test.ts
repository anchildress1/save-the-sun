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

function audioOk(data: string) {
	return { ok: true, json: async () => ({ audio: data }) } as Response;
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

	it('fetches the line audio and enqueues it once enabled', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(audioOk('pcm-bytes'));
		enableDelivery();

		await deliver(GREETING);

		expect(fetch).toHaveBeenCalledWith('/api/voice/tts', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(GREETING)
		});
		expect(audio.speaker.enqueue).toHaveBeenCalledExactlyOnceWith('pcm-bytes');
	});

	it('stays silent when the route refuses the line', async () => {
		vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
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

	it('does not enqueue onto a speaker closed mid-fetch', async () => {
		let release: (r: Response) => void = () => {};
		vi.mocked(fetch).mockReturnValueOnce(
			new Promise<Response>((resolve) => {
				release = resolve;
			})
		);
		enableDelivery();

		const inflight = deliver(GREETING);
		disableDelivery();
		release(audioOk('late-pcm'));
		await inflight;

		expect(audio.speaker.enqueue).not.toHaveBeenCalled();
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
