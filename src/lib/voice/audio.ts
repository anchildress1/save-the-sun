// Web Audio playback for the delivery seam — turns base64 PCM16 @ 24kHz chunks into seamless
// audio. Policy (when to play, mute, drain) lives in delivery.ts; this is mechanics only, so it
// stays testable without a browser.

import { SPEAKER_SAMPLE_RATE } from './config';

export interface Speaker {
	/** Queue one base64 PCM16@24kHz chunk, tagged with the voice it belongs to, to play seamlessly
	 *  after whatever is queued. */
	enqueue(base64Pcm: string, voice: string): void;
	/** Stop now, drop the queue. Does not fire the drain or speaking callbacks. */
	stop(): void;
	readonly busy: boolean;
	/** Called whenever playback runs dry naturally (not via stop). */
	onDrained(callback: () => void): void;
	/** Called when the voice currently SOUNDING changes — driven by playback boundaries (a clip
	 *  starting or ending), not by enqueue, so the indicator tracks who is actually being heard:
	 *  his clip shows only once hers has played out, even though both were queued up front. */
	onSpeaking(callback: (voice: string) => void): void;
	/** Output mute: silence playback without touching the queue. Audio still decodes and
	 *  drains on schedule, so `busy`, the callbacks, and caption turn-timing are unchanged — only
	 *  the sound is gated. */
	setMuted(muted: boolean): void;
	close(): void;
}

export function createSpeaker(muted = false): Speaker {
	const context = new AudioContext({ sampleRate: SPEAKER_SAMPLE_RATE });
	void context.resume();
	// A master gain between the sources and the output is the mute seam: gain 0 silences whatever
	// is scheduled without dropping buffers, so unmuting mid-line resumes cleanly.
	const master = context.createGain();
	master.gain.value = muted ? 0 : 1;
	master.connect(context.destination);
	// Scheduled nodes in play order, each tagged with its voice. The front is what's sounding now.
	const queue: { node: AudioBufferSourceNode; voice: string }[] = [];
	let cursor = 0;
	let playingVoice: string | null = null;
	let drained: (() => void) | null = null;
	let speaking: ((voice: string) => void) | null = null;

	// Move the indicator to whatever voice now holds the front of the queue (null = dry). Called at
	// real playback boundaries, so the heard voice — not the enqueue order — drives the medallion.
	function advanceTo(voice: string | null): void {
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
			node.connect(master);
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
		setMuted(next) {
			master.gain.value = next ? 0 : 1;
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
