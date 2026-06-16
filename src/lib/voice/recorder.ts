// Push-to-talk capture. Hold to record, release to get a WAV (PCM16 mono @ 16kHz) the transcribe
// route accepts. The mic stream is acquired per hold and released on let-go (so Chrome's in-use
// indicator clears between holds); the AudioContext + worklet are built once and kept alive so a
// re-acquire pays only getUserMedia, never the worklet load. A denial is remembered so the rite
// never re-prompts. WAV is used over MediaRecorder because Gemini reliably accepts it.

import { MIC_SAMPLE_RATE } from './config';

export type RecorderFailure = 'denied' | 'no-device' | 'audio';
export type RecorderResult = { ok: true } | { ok: false; reason: RecorderFailure };

// Captured speech under this many seconds is treated as an accidental tap — no transcription.
const MIN_UTTERANCE_SECONDS = 0.25;

// Posts each render block of mono samples up to the main thread, which buffers them while recording.
const WORKLET_SOURCE = `
class PcmTapProcessor extends AudioWorkletProcessor {
	process(inputs) {
		const channel = inputs[0] && inputs[0][0];
		if (channel) this.port.postMessage(channel.slice(0));
		return true;
	}
}
registerProcessor('pcm-tap', PcmTapProcessor);
`;

let context: AudioContext | null = null;
let stream: MediaStream | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let node: AudioWorkletNode | null = null;
let buffers: Float32Array[] = [];
let recording = false;
// A denied/absent mic is terminal for the session (R1): never re-prompt once sealed.
let sealed: RecorderFailure | null = null;
// Bumped by closeRecorder so a setup still awaiting permission/worklet when teardown runs discards
// the stream/context it finally gets instead of storing them onto a torn-down (unmounted) page.
let setupGen = 0;

function classify(err: unknown): RecorderFailure {
	if (err instanceof DOMException) {
		if (err.name === 'NotAllowedError' || err.name === 'SecurityError') return 'denied';
		// No device / unsatisfiable constraints are terminal for the session.
		if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') return 'no-device';
		// NotReadableError is an OS/hardware error (mic busy, transiently blocked) — often clears on a
		// later attempt, so it stays in the retryable 'audio' bucket rather than sealing the session.
	}
	return 'audio';
}

// Lazily inside the hold gesture (browsers need one for audio): acquire the mic stream, then build
// the tap onto the kept-alive AudioContext (created + worklet-loaded on first hold, reused after).
async function ensureMic(): Promise<RecorderResult> {
	if (sealed) return { ok: false, reason: sealed };
	if (stream && node && context) return { ok: true };
	// Snapshot the teardown generation: if closeRecorder runs while we're awaiting below, the late
	// resources are released here instead of being stored onto an unmounted page.
	const gen = setupGen;
	const tornDown = () => gen !== setupGen;
	let media: MediaStream;
	try {
		media = await navigator.mediaDevices.getUserMedia({
			audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
		});
	} catch (err) {
		const reason = classify(err);
		// Only a denial or a missing device is terminal — a transient 'audio' error (AbortError,
		// device briefly busy) stays retryable so a blip doesn't seal the mic for the whole session.
		if (reason === 'denied' || reason === 'no-device') sealed = reason;
		return { ok: false, reason };
	}
	if (tornDown()) {
		for (const track of media.getTracks()) track.stop();
		return { ok: false, reason: 'audio' };
	}
	// The context + worklet are built once and survive a release; only a fresh context loads the
	// module (re-adding 'pcm-tap' to a live context throws). createdCtx tracks that fresh build so a
	// teardown that wins the race closes only what this call opened.
	let createdCtx: AudioContext | null = null;
	try {
		let ctx = context;
		if (!ctx) {
			ctx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
			createdCtx = ctx;
			void ctx.resume();
			const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
			try {
				await ctx.audioWorklet.addModule(url);
			} finally {
				URL.revokeObjectURL(url);
			}
			// Teardown may have won while the worklet module loaded — release everything, store nothing.
			if (tornDown()) {
				for (const track of media.getTracks()) track.stop();
				void ctx.close();
				return { ok: false, reason: 'audio' };
			}
		}
		const src = ctx.createMediaStreamSource(media);
		const tap = new AudioWorkletNode(ctx, 'pcm-tap');
		tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
			if (recording) buffers.push(event.data);
		};
		src.connect(tap);
		// An unconnected node is not guaranteed to be pulled by the graph; the worklet stays silent.
		tap.connect(ctx.destination);
		if (tornDown()) {
			for (const track of media.getTracks()) track.stop();
			src.disconnect();
			tap.disconnect();
			if (createdCtx) void createdCtx.close();
			return { ok: false, reason: 'audio' };
		}
		context = ctx;
		stream = media;
		source = src;
		node = tap;
		return { ok: true };
	} catch (err) {
		// Setup is retryable (not sealed), so release the tracks and any context THIS call created — a
		// leaked AudioContext per retry would eventually hit the browser's cap and break all audio.
		for (const track of media.getTracks()) track.stop();
		void createdCtx?.close();
		return { ok: false, reason: classify(err) };
	}
}

/** Whether the mic has been sealed shut (denied / no device) for this session. */
export function recorderSealed(): RecorderFailure | null {
	return sealed;
}

/** Begin capturing on a hold. Opens the mic on first use; resolves once recording (or with the
 *  failure that sealed it). A second start while already recording is a no-op. */
export async function startRecording(): Promise<RecorderResult> {
	if (recording) return { ok: true };
	const ready = await ensureMic();
	if (!ready.ok) return ready;
	buffers = [];
	recording = true;
	return { ok: true };
}

/** Stop capturing on release and assemble the held audio into a base64 WAV. Returns null when
 *  nothing was recording or the utterance was too short to be a real Ask. */
export async function stopRecording(): Promise<{ wavBase64: string } | null> {
	if (!recording) return null;
	recording = false;
	const captured = buffers;
	buffers = [];
	const total = captured.reduce((n, block) => n + block.length, 0);
	const rate = context?.sampleRate ?? MIC_SAMPLE_RATE;
	if (total < rate * MIN_UTTERANCE_SECONDS) return null;

	const samples = new Float32Array(total);
	let offset = 0;
	for (const block of captured) {
		samples.set(block, offset);
		offset += block.length;
	}
	return { wavBase64: encodeWavBase64(samples, rate) };
}

/** Whether a hold is currently capturing. */
export function isRecording(): boolean {
	return recording;
}

function encodeWavBase64(samples: Float32Array, sampleRate: number): string {
	const bytesPerSample = 2;
	const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
	const view = new DataView(buffer);
	const writeString = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.codePointAt(i)!);
	};
	writeString(0, 'RIFF');
	view.setUint32(4, 36 + samples.length * bytesPerSample, true);
	writeString(8, 'WAVE');
	writeString(12, 'fmt ');
	view.setUint32(16, 16, true); // PCM chunk size
	view.setUint16(20, 1, true); // format = PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
	view.setUint16(32, bytesPerSample, true); // block align
	view.setUint16(34, 16, true); // bits per sample
	writeString(36, 'data');
	view.setUint32(40, samples.length * bytesPerSample, true);
	let offset = 44;
	for (const sample of samples) {
		const s = Math.max(-1, Math.min(1, sample));
		view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
		offset += bytesPerSample;
	}
	return bytesToBase64(new Uint8Array(buffer));
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	// 8KB slices keep String.fromCodePoint under the engine's argument cap.
	for (let i = 0; i < bytes.length; i += 0x2000) {
		binary += String.fromCodePoint(...bytes.subarray(i, i + 0x2000));
	}
	return btoa(binary);
}

/** Release the mic stream on hold release, stopping its tracks so Chrome's in-use indicator clears.
 *  The AudioContext + worklet stay alive, so the next hold re-acquires with only a getUserMedia. */
export function releaseRecorder(): void {
	recording = false;
	buffers = [];
	node?.disconnect();
	node = null;
	source?.disconnect();
	source = null;
	for (const track of stream?.getTracks() ?? []) track.stop();
	stream = null;
}

/** Release the mic entirely (page teardown), including the kept-alive context. A later start
 *  rebuilds everything. */
export function closeRecorder(): void {
	setupGen++; // a setup mid-flight will see this and discard the resources it's about to acquire
	releaseRecorder();
	void context?.close();
	context = null;
}

/** Test isolation only — module state shared across a test file. */
export function resetRecorder(): void {
	closeRecorder();
	sealed = null;
}
