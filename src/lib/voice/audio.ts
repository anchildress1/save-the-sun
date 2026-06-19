// Web Audio playback for the delivery seam — turns base64 PCM16 @ 24kHz chunks into seamless
// audio. Policy (when to play, mute, drain) lives in delivery.ts; this is mechanics only, so it
// stays testable without a browser.

import { SPEAKER_SAMPLE_RATE } from './config';
import type { DeliveryVoice } from './speaker';

export interface Speaker {
	/** PCM16 @24kHz; scheduled gaplessly after the queue tail, never mixed. */
	enqueue(base64Pcm: string, voice: DeliveryVoice): void;
	/** Drops the queue without firing onDrained/onSpeaking — a barge-in, not a natural end. */
	stop(): void;
	readonly busy: boolean;
	/** Called whenever playback runs dry naturally (not via stop). */
	onDrained(callback: () => void): void;
	/** Fires at playback boundaries (a clip start/end), not at enqueue — so it tracks the voice
	 *  actually being heard, not the order clips were queued. */
	onSpeaking(callback: (voice: DeliveryVoice) => void): void;
	close(): void;
}

export function createSpeaker(): Speaker {
	const context = new AudioContext({ sampleRate: SPEAKER_SAMPLE_RATE });
	void context.resume();
	// Play order; the front of the queue is the voice currently sounding.
	const queue: { node: AudioBufferSourceNode; voice: DeliveryVoice }[] = [];
	let cursor = 0;
	let playingVoice: DeliveryVoice | null = null;
	let drained: (() => void) | null = null;
	let speaking: ((voice: DeliveryVoice) => void) | null = null;

	// Move the indicator to whatever voice now holds the front of the queue (null = dry). Called at
	// real playback boundaries, so the heard voice — not the enqueue order — drives the medallion.
	function advanceTo(voice: DeliveryVoice | null): void {
		if (voice === playingVoice) return;
		playingVoice = voice;
		if (voice === null) drained?.();
		else speaking?.(voice);
	}

	function stop(): void {
		for (const { node } of queue) {
			// Detach first so a barge-in clear never reads as a natural drain.
			node.onended = null;
			try {
				node.stop();
			} catch {
				// Already ended.
			}
		}
		queue.length = 0;
		cursor = 0;
		// Silent: stop() owes no drain/speaking callback — delivery settles the indicator to idle itself.
		playingVoice = null;
	}

	return {
		enqueue(base64Pcm, voice) {
			const bytes = base64ToBytes(base64Pcm);
			const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
			if (pcm.length === 0) return;
			const buffer = context.createBuffer(1, pcm.length, SPEAKER_SAMPLE_RATE);
			const channel = buffer.getChannelData(0);
			for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;
			const node = context.createBufferSource();
			node.buffer = buffer;
			node.connect(context.destination);
			const entry = { node, voice };
			node.onended = () => {
				const idx = queue.indexOf(entry);
				if (idx >= 0) queue.splice(idx, 1);
				// Gapless schedule: the new front is what's sounding now, or null when the queue is dry.
				advanceTo(queue.length ? queue[0].voice : null);
			};
			cursor = Math.max(cursor, context.currentTime);
			node.start(cursor);
			cursor += buffer.duration;
			const wasIdle = queue.length === 0;
			queue.push(entry);
			// A chunk dropped into an idle speaker starts ~now, so its voice is immediately the one heard.
			if (wasIdle) advanceTo(voice);
		},
		stop,
		get busy() {
			return queue.length > 0;
		},
		onDrained(callback) {
			drained = callback;
		},
		onSpeaking(callback) {
			speaking = callback;
		},
		close() {
			stop();
			void context.close();
		}
	};
}

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.codePointAt(i) ?? 0;
	return bytes;
}
