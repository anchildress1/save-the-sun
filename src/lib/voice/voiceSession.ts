// Live session client (S2): WebSocket lifecycle, mic streaming, and Oracle playback behind
// wake()/sleep(), narrated to the UI as events. Any failure emits 'error' and settles back to
// asleep — the button game never depends on this module being alive.

import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from '@google/genai';
import { LIVE_MODEL, MIC_SAMPLE_RATE, ORACLE_VOICE } from '$lib/voice/config';
import { ORACLE_SYSTEM_INSTRUCTION } from '$lib/voice/oraclePersona';
import {
	createSpeaker,
	openMic,
	type MicCapture,
	type MicFailure,
	type Speaker
} from '$lib/voice/audio';

export type VoiceState = 'asleep' | 'listening' | 'hearing' | 'thinking' | 'speaking';
export type VoiceErrorReason = MicFailure | 'token' | 'socket';

export type VoiceEvent =
	| { type: 'listening' }
	| { type: 'hearing'; amplitude: number }
	| { type: 'thinking' }
	| { type: 'speaking' }
	| { type: 'asleep' }
	| { type: 'error'; reason: VoiceErrorReason; notice: string }
	// Text arrives as incremental fragments; turn boundaries ride the state events.
	| { type: 'transcript'; direction: 'in' | 'out'; text: string };

export type VoiceListener = (event: VoiceEvent) => void;

export interface VoiceSession {
	/** Open the Live session: mic, token, socket. Resolves once listening (or after failing). */
	wake(): Promise<void>;
	/** Close everything and return to asleep. Safe in any state. */
	sleep(): void;
	readonly state: VoiceState;
	subscribe(listener: VoiceListener): () => void;
}

// Local RMS only drives the hearing glow; turn-taking belongs to the server VAD.
const SPEECH_RMS_FLOOR = 0.02;
const HEARING_HOLD_MS = 800;
// A cough can reach thinking with no reply ever coming.
const THINKING_FALLBACK_MS = 10_000;
const SETUP_TIMEOUT_MS = 10_000;

// Player-facing notices in the Rite's quiet system register (docs/ux-copy.md).
const NOTICE: Record<VoiceErrorReason, string> = {
	token: 'The fire does not carry your voice tonight. The rite continues by hand.',
	'mic-permission': 'The fire cannot hear you. The rite continues by hand.',
	'mic-missing': 'No voice reaches the fire. The rite continues by hand.',
	audio: 'No voice reaches the fire. The rite continues by hand.',
	socket: "The Oracle's voice falters. The rite continues by hand."
};

export function createVoiceSession(): VoiceSession {
	let state: VoiceState = 'asleep';
	// Bumped by every teardown; stale async continuations and socket callbacks go quiet.
	let generation = 0;
	let waking = false;
	let liveReady = false;
	let session: Session | null = null;
	let mic: MicCapture | null = null;
	let speaker: Speaker | null = null;
	let lastAmplitude = 0;
	let awaitingDrain = false;
	let hearingQuietTimer: ReturnType<typeof setTimeout> | null = null;
	let thinkingRescueTimer: ReturnType<typeof setTimeout> | null = null;
	let setupResolver: ((ready: boolean) => void) | null = null;
	let setupFailureDetail: string | null = null;
	let sendFailureTeed = false;
	const listeners = new Set<VoiceListener>();

	function emit(event: VoiceEvent): void {
		for (const listener of [...listeners]) {
			try {
				listener(event);
			} catch (err) {
				// One broken subscriber must not starve the rest of the contract.
				console.error('[voice] listener threw:', err);
			}
		}
	}

	function clearTimers(): void {
		if (hearingQuietTimer) clearTimeout(hearingQuietTimer);
		if (thinkingRescueTimer) clearTimeout(thinkingRescueTimer);
		hearingQuietTimer = null;
		thinkingRescueTimer = null;
	}

	// 'hearing' re-emits every chunk so the medallion corona can track live amplitude (S3).
	function toState(next: VoiceState): void {
		const changed = state !== next;
		state = next;
		if (!changed && next !== 'hearing') return;
		if (next === 'hearing') emit({ type: 'hearing', amplitude: lastAmplitude });
		else emit({ type: next });
	}

	function teardown(): void {
		generation++;
		waking = false;
		liveReady = false;
		awaitingDrain = false;
		lastAmplitude = 0;
		clearTimers();
		sendFailureTeed = false;
		setupResolver?.(false);
		setupResolver = null;
		mic?.stop();
		mic = null;
		speaker?.close();
		speaker = null;
		const closing = session;
		session = null;
		try {
			closing?.close();
		} catch {
			// Socket may have died first.
		}
	}

	// The console fallback matters most when the network just died — the failure that kills the
	// socket kills the tee in the same instant, and the diagnostics must not die with it.
	function teeDebug(level: 'info' | 'error', message: string): void {
		void fetch('/api/voice/debug', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ level, message })
		})
			.then((response) => {
				if (!response.ok) console.warn(`[voice] debug tee rejected (${response.status}):`, message);
			})
			.catch(() => console.warn('[voice] debug tee unreachable:', message));
	}

	function fail(reason: VoiceErrorReason, detail: string): void {
		teardown();
		emit({ type: 'error', reason, notice: NOTICE[reason] });
		teeDebug('error', `voice wake failed (${reason}): ${detail}`);
		toState('asleep');
	}

	function onSocketDown(detail: string): void {
		// During setup, wake() owns the failure path — deny it the setupComplete, keep the why.
		if (setupResolver) {
			setupFailureDetail = detail;
			setupResolver(false);
			setupResolver = null;
			return;
		}
		if (state === 'asleep') return;
		teardown();
		emit({ type: 'error', reason: 'socket', notice: NOTICE.socket });
		teeDebug('error', `voice socket dropped: ${detail}`);
		toState('asleep');
	}

	function armThinkingRescue(): void {
		if (thinkingRescueTimer) clearTimeout(thinkingRescueTimer);
		thinkingRescueTimer = setTimeout(() => {
			thinkingRescueTimer = null;
			if (state === 'thinking') toState('listening');
		}, THINKING_FALLBACK_MS);
	}

	function onMicChunk(base64Pcm: string, amplitude: number): void {
		if (!liveReady || !session) return;
		lastAmplitude = amplitude;
		try {
			session.sendRealtimeInput({
				audio: { data: base64Pcm, mimeType: `audio/pcm;rate=${MIC_SAMPLE_RATE}` }
			});
		} catch (err) {
			// A send can race the socket dying (onclose owns that path) — but tee the first one
			// in case the socket only LOOKS alive and every chunk is failing.
			if (!sendFailureTeed) {
				sendFailureTeed = true;
				teeDebug('error', `voice send failed: ${err instanceof Error ? err.message : String(err)}`);
			}
			return;
		}
		// While the Oracle thinks or speaks, residual echo could fake hearing — there the
		// server's interrupted signal is the truth.
		if (state !== 'listening' && state !== 'hearing') return;
		if (amplitude >= SPEECH_RMS_FLOOR) {
			if (hearingQuietTimer) clearTimeout(hearingQuietTimer);
			hearingQuietTimer = null;
			toState('hearing');
		} else if (state === 'hearing' && !hearingQuietTimer) {
			hearingQuietTimer = setTimeout(() => {
				hearingQuietTimer = null;
				if (state === 'hearing') {
					toState('thinking');
					armThinkingRescue();
				}
			}, HEARING_HOLD_MS);
		}
	}

	function onMessage(message: LiveServerMessage): void {
		if (message.setupComplete && setupResolver) {
			setupResolver(true);
			setupResolver = null;
			return;
		}
		const content = message.serverContent;
		if (!content) return;
		if (content.interrupted) {
			speaker?.stop();
			awaitingDrain = false;
			toState('hearing');
		}
		if (content.inputTranscription?.text) {
			emit({ type: 'transcript', direction: 'in', text: content.inputTranscription.text });
		}
		if (content.outputTranscription?.text) {
			emit({ type: 'transcript', direction: 'out', text: content.outputTranscription.text });
		}
		for (const part of content.modelTurn?.parts ?? []) {
			const data = part.inlineData?.data;
			if (typeof data === 'string' && data.length > 0) {
				try {
					speaker?.enqueue(data);
				} catch {
					// A malformed chunk must not throw into the SDK's socket callback.
					teeDebug('error', 'voice audio chunk rejected by the speaker');
					continue;
				}
				if (thinkingRescueTimer) clearTimeout(thinkingRescueTimer);
				thinkingRescueTimer = null;
				toState('speaking');
			}
		}
		if (content.turnComplete) {
			if (speaker?.busy) {
				awaitingDrain = true;
			} else if (state === 'speaking' || state === 'thinking') {
				toState('listening');
			}
		}
	}

	function onDrained(): void {
		if (!awaitingDrain) return;
		awaitingDrain = false;
		if (state === 'speaking') toState('listening');
	}

	async function wake(): Promise<void> {
		if (state !== 'asleep' || waking) return;
		waking = true;
		setupFailureDetail = null;
		const myGeneration = ++generation;

		// Mic first: the permission prompt lands right after the tap, and a denial never burns
		// a rate-limited token mint.
		const verdict = await openMic(onMicChunk);
		if (generation !== myGeneration) {
			if (verdict.ok) verdict.mic.stop();
			return;
		}
		if (!verdict.ok) {
			fail(verdict.reason, verdict.detail);
			return;
		}
		mic = verdict.mic;

		let token: string;
		try {
			const response = await fetch('/api/voice/token', { method: 'POST' });
			if (!response.ok) throw new Error(`token endpoint returned ${response.status}`);
			token = ((await response.json()) as { token?: string }).token ?? '';
			if (!token) throw new Error('token endpoint returned no token');
		} catch (err) {
			if (generation !== myGeneration) return;
			fail('token', err instanceof Error ? err.message : String(err));
			return;
		}
		if (generation !== myGeneration) return;

		speaker = createSpeaker();
		speaker.onDrained(onDrained);

		let connected: Session;
		try {
			const client = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
			connected = await client.live.connect({
				model: LIVE_MODEL,
				config: {
					responseModalities: [Modality.AUDIO],
					speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: ORACLE_VOICE } } },
					systemInstruction: ORACLE_SYSTEM_INSTRUCTION,
					inputAudioTranscription: {},
					outputAudioTranscription: {}
				},
				callbacks: {
					onmessage: (message) => {
						if (generation === myGeneration) onMessage(message);
					},
					onerror: (event) => {
						if (generation === myGeneration) onSocketDown(`error: ${event?.message ?? ''}`);
					},
					onclose: (event) => {
						if (generation === myGeneration) onSocketDown(`close ${event?.code ?? ''}`);
					}
				}
			});
		} catch (err) {
			if (generation !== myGeneration) return;
			// The connect error can embed the single-use token in a URL; keep the stream clean.
			const detail = (err instanceof Error ? err.message : String(err))
				.split(token)
				.join('[ephemeral-token]');
			fail('socket', detail);
			return;
		}
		if (generation !== myGeneration) {
			// Slept while connecting: teardown already ran, so this socket must die here or leak.
			try {
				connected.close();
			} catch {
				// Already closed.
			}
			return;
		}
		session = connected;

		const ready = await new Promise<boolean>((resolve) => {
			setupResolver = resolve;
			setTimeout(() => {
				if (setupResolver === resolve) {
					setupResolver = null;
					resolve(false);
				}
			}, SETUP_TIMEOUT_MS);
		});
		if (generation !== myGeneration) return;
		if (!ready) {
			fail('socket', setupFailureDetail ?? 'session setup never completed');
			return;
		}

		liveReady = true;
		waking = false;
		teeDebug('info', 'voice session awake');
		toState('listening');
	}

	function sleep(): void {
		if (state === 'asleep' && !waking) return;
		const wasAwake = state !== 'asleep';
		teardown();
		if (wasAwake) teeDebug('info', 'voice session slept');
		toState('asleep');
	}

	return {
		wake,
		sleep,
		get state() {
			return state;
		},
		subscribe(listener: VoiceListener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
	};
}

// Inert until wake() — safe to import during SSR.
export const voiceSession: VoiceSession = createVoiceSession();
