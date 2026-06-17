// Web Audio playback for the delivery seam — turns base64 PCM16 @ 24kHz chunks into seamless
// audio. Policy (when to play, mute, drain) lives in delivery.ts; this is mechanics only, so it
// stays testable without a browser.

import { SPEAKER_SAMPLE_RATE } from './config';

export interface Speaker {
	/** Queue one base64 PCM16@24kHz chunk to play seamlessly after whatever is queued. */
	enqueue(base64Pcm: string): void;
	/** Stop now, drop the queue. Does not fire the drain callback. */
	stop(): void;
	readonly busy: boolean;
	/** Called whenever playback runs dry naturally (not via stop). */
	onDrained(callback: () => void): void;
	/** Output mute (R11): silence playback without touching the queue. Audio still decodes and
	 *  drains on schedule, so `busy`, the drain callback, and caption turn-timing are unchanged —
	 *  only the sound is gated. */
	setMuted(muted: boolean): void;
	/** Current output level as RMS in [0, 1] — the medallion pulse reads this each frame. Sampled
	 *  pre-mute, so the visual still tracks the line's envelope when the sound is muted. */
	level(): number;
	close(): void;
}

export function createSpeaker(muted = false): Speaker {
	const context = new AudioContext({ sampleRate: SPEAKER_SAMPLE_RATE });
	void context.resume();
	// A master gain between the sources and the output is the mute seam: gain 0 silences whatever
	// is scheduled without dropping buffers, so unmuting mid-line resumes cleanly.
	const master = context.createGain();
	master.gain.value = muted ? 0 : 1;
	// Sources → analyser → master(mute) → destination. The analyser sits PRE-mute so the medallion's
	// pulse tracks the line's real envelope even while the sound is muted (R11: silence the voice,
	// keep the visual + captions).
	const analyser = context.createAnalyser();
	analyser.fftSize = 256;
	analyser.connect(master);
	master.connect(context.destination);
	const levelBuffer = new Uint8Array(analyser.fftSize);
	const active = new Set<AudioBufferSourceNode>();
	let cursor = 0;
	let drained: (() => void) | null = null;

	function stop(): void {
		for (const node of active) {
			// Detach first so a barge-in clear never reads as a natural drain.
			node.onended = null;
			try {
				node.stop();
			} catch {
				// Already ended.
			}
		}
		active.clear();
		cursor = 0;
	}

	return {
		enqueue(base64Pcm) {
			const bytes = base64ToBytes(base64Pcm);
			const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
			if (pcm.length === 0) return;
			const buffer = context.createBuffer(1, pcm.length, SPEAKER_SAMPLE_RATE);
			const channel = buffer.getChannelData(0);
			for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;
			const node = context.createBufferSource();
			node.buffer = buffer;
			node.connect(analyser);
			node.onended = () => {
				active.delete(node);
				if (active.size === 0) drained?.();
			};
			cursor = Math.max(cursor, context.currentTime);
			node.start(cursor);
			cursor += buffer.duration;
			active.add(node);
		},
		stop,
		get busy() {
			return active.size > 0;
		},
		onDrained(callback) {
			drained = callback;
		},
		setMuted(next) {
			master.gain.value = next ? 0 : 1;
		},
		level() {
			analyser.getByteTimeDomainData(levelBuffer);
			let sumSquares = 0;
			for (const byte of levelBuffer) {
				const sample = (byte - 128) / 128; // byte domain (0–255, 128 = silence) → [-1, 1]
				sumSquares += sample * sample;
			}
			return Math.sqrt(sumSquares / levelBuffer.length);
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
