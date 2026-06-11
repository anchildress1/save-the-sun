// Web Audio mechanics only — voiceSession.ts owns all policy, so the state machine stays
// testable without a browser.

import { MIC_SAMPLE_RATE, SPEAKER_SAMPLE_RATE } from './config';

// 128ms at 16kHz: low enough latency for barge-in VAD, coarse enough not to flood the socket.
const CHUNK_SAMPLES = 2048;

// Inlined + Blob URL so the worklet ships inside the bundle with no separate static asset.
const WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.pending = [];
		this.length = 0;
	}
	process(inputs) {
		const channel = inputs[0] && inputs[0][0];
		if (!channel) return true;
		this.pending.push(channel.slice(0));
		this.length += channel.length;
		if (this.length >= ${CHUNK_SAMPLES}) {
			const out = new Float32Array(this.length);
			let offset = 0;
			for (const block of this.pending) {
				out.set(block, offset);
				offset += block.length;
			}
			this.pending = [];
			this.length = 0;
			this.port.postMessage(out, [out.buffer]);
		}
		return true;
	}
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
`;

export type MicFailure = 'mic-permission' | 'mic-missing' | 'audio';

export interface MicCapture {
	stop(): void;
}

export type MicVerdict =
	| { ok: true; mic: MicCapture }
	| { ok: false; reason: MicFailure; detail: string };

/** Each captured chunk as base64 PCM16@16kHz plus its RMS amplitude (0..~1). */
export type MicChunkHandler = (base64Pcm: string, amplitude: number) => void;

function micFailure(err: unknown): MicFailure {
	if (err instanceof DOMException) {
		if (err.name === 'NotAllowedError' || err.name === 'SecurityError') return 'mic-permission';
		// NotReadableError = device exists but is unusable — same player-facing path as no device.
		if (
			err.name === 'NotFoundError' ||
			err.name === 'OverconstrainedError' ||
			err.name === 'NotReadableError'
		) {
			return 'mic-missing';
		}
	}
	return 'audio';
}

// The reason alone can't distinguish a blocked worklet from a dead AudioContext in the tee.
function failureDetail(err: unknown): string {
	return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/**
 * Open the microphone and stream PCM chunks to `onChunk` until stopped. Echo cancellation is
 * required: the mic keeps streaming while the Oracle speaks (that is how server-side barge-in
 * works), so her voice must not loop back as input.
 */
export async function openMic(onChunk: MicChunkHandler): Promise<MicVerdict> {
	let stream: MediaStream;
	try {
		stream = await navigator.mediaDevices.getUserMedia({
			audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
		});
	} catch (err) {
		return { ok: false, reason: micFailure(err), detail: failureDetail(err) };
	}

	let context: AudioContext;
	try {
		context = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
	} catch (err) {
		for (const track of stream.getTracks()) track.stop();
		return { ok: false, reason: 'audio', detail: failureDetail(err) };
	}

	try {
		// A context created outside the tap's synchronous call stack can start suspended.
		void context.resume();
		const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
		try {
			await context.audioWorklet.addModule(workletUrl);
		} finally {
			URL.revokeObjectURL(workletUrl);
		}
		const source = context.createMediaStreamSource(stream);
		const node = new AudioWorkletNode(context, 'pcm-capture');
		node.port.onmessage = (event: MessageEvent<Float32Array>) => {
			onChunk(toBase64Pcm(event.data), rms(event.data));
		};
		source.connect(node);
		// An unconnected node is not guaranteed to be pulled by the graph; the worklet stays silent.
		node.connect(context.destination);
		return {
			ok: true,
			mic: {
				stop() {
					node.port.onmessage = null;
					source.disconnect();
					node.disconnect();
					for (const track of stream.getTracks()) track.stop();
					void context.close();
				}
			}
		};
	} catch (err) {
		// Release the granted mic so the browser's recording indicator turns off, and close the
		// context — browsers cap live AudioContexts, so leaking one per failed wake starves later ones.
		for (const track of stream.getTracks()) track.stop();
		void context.close();
		return { ok: false, reason: 'audio', detail: failureDetail(err) };
	}
}

export interface Speaker {
	/** Queue one base64 PCM16@24kHz chunk to play seamlessly after whatever is queued. */
	enqueue(base64Pcm: string): void;
	/** Barge-in: stop now, drop the queue. Does not fire the drain callback. */
	stop(): void;
	readonly busy: boolean;
	/** Called whenever playback runs dry naturally (not via stop). */
	onDrained(callback: () => void): void;
	close(): void;
}

export function createSpeaker(): Speaker {
	const context = new AudioContext({ sampleRate: SPEAKER_SAMPLE_RATE });
	void context.resume();
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
			node.connect(context.destination);
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
		close() {
			stop();
			void context.close();
		}
	};
}

function rms(samples: Float32Array): number {
	let sum = 0;
	for (const sample of samples) sum += sample * sample;
	return Math.sqrt(sum / (samples.length || 1));
}

function toBase64Pcm(samples: Float32Array): string {
	const pcm = new Int16Array(samples.length);
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]));
		pcm[i] = Math.round(s * 0x7fff);
	}
	return bytesToBase64(new Uint8Array(pcm.buffer));
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	// 8KB slices keep String.fromCodePoint under the engine's argument cap.
	for (let i = 0; i < bytes.length; i += 0x2000) {
		binary += String.fromCodePoint(...bytes.subarray(i, i + 0x2000));
	}
	return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.codePointAt(i) ?? 0;
	return bytes;
}
