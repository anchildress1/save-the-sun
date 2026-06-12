// Live session client: WebSocket lifecycle, mic streaming, and Oracle playback behind
// wake()/sleep(), narrated to the UI as events. Any lifecycle failure emits 'error' and settles
// back to asleep — the button game never depends on this module being alive.

import {
	GoogleGenAI,
	Modality,
	type LiveServerMessage,
	type Part,
	type Session
} from '@google/genai';
import { LIVE_MODEL, MIC_SAMPLE_RATE, ORACLE_VOICE } from '$lib/voice/config';
import { ORACLE_SYSTEM_INSTRUCTION } from '$lib/voice/oraclePersona';
import {
	createSpeaker,
	openMic,
	type MicCapture,
	type MicFailure,
	type Speaker
} from '$lib/voice/audio';

export type VoiceState = 'asleep' | 'waking' | 'listening' | 'hearing' | 'thinking' | 'speaking';
export type VoiceErrorReason = MicFailure | 'token' | 'socket';

export type VoiceEvent =
	| { type: 'waking' }
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
	/** Open the Live session: mic, token, socket. Resolves once listening, or after the wake
	 * fails or is canceled by sleep(). Never rejects. */
	wake(): Promise<void>;
	/** Close everything and return to asleep. Safe in any state. */
	sleep(): void;
	readonly state: VoiceState;
	subscribe(listener: VoiceListener): () => void;
}

// Local RMS only drives UI state (hearing glow, thinking handoff); turn-taking belongs to the
// server VAD.
const SPEECH_RMS_FLOOR = 0.02;
const HEARING_HOLD_MS = 800;
// A cough can reach thinking with no reply ever coming.
const THINKING_FALLBACK_MS = 10_000;
const SETUP_TIMEOUT_MS = 10_000;
// A hung token endpoint or blackholed handshake must fail the wake, not strand it in waking.
const TOKEN_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 10_000;

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
	// Bumped by every wake and teardown; stale async continuations and socket callbacks go quiet.
	let generation = 0;
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
	let mintedToken = '';
	let transcriptIn = '';
	let transcriptOut = '';
	const listeners = new Set<VoiceListener>();

	function emit(event: VoiceEvent): void {
		for (const listener of listeners) {
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

	// 'hearing' re-emits every chunk so the medallion corona can track live amplitude.
	function toState(next: VoiceState): void {
		const changed = state !== next;
		state = next;
		if (!changed && next !== 'hearing') return;
		if (next === 'hearing') emit({ type: 'hearing', amplitude: lastAmplitude });
		else emit({ type: next });
	}

	function teardown(): void {
		// First, while the tee can still name the turn: a mid-turn sleep/failure must not
		// swallow what was already transcribed.
		flushTranscripts();
		generation++;
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
	// Scrubbing lives here, the single sink: SDK error and close strings can embed the session's
	// ephemeral token in a URL, and the /debug stream is public.
	function teeDebug(level: 'info' | 'error', message: string, extraToken = ''): void {
		let scrubbed = message;
		for (const token of new Set([mintedToken, extraToken])) {
			if (token) scrubbed = scrubbed.split(token).join('[ephemeral-token]');
		}
		void fetch('/api/voice/debug', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ level, message: scrubbed })
		})
			.then((response) => {
				if (!response.ok) console.warn('[voice] debug tee rejected:', response.status, scrubbed);
			})
			.catch(() => console.warn('[voice] debug tee unreachable:', scrubbed));
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
			if (state === 'thinking') {
				// Routine for a cough; a PATTERN of these in /debug means real turns are being dropped.
				teeDebug('info', 'thinking rescue fired — no reply arrived');
				toState('listening');
			}
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
			// The barge-in cuts her line; what was already transcribed is still worth the tee.
			flushTranscripts();
			toState('hearing');
		}
		relayTranscript('in', content.inputTranscription?.text);
		relayTranscript('out', content.outputTranscription?.text);
		playOracleAudio(content.modelTurn?.parts ?? []);
		if (content.turnComplete) {
			flushTranscripts();
			settleTurn();
		}
	}

	function relayTranscript(direction: 'in' | 'out', text: string | undefined): void {
		if (!text) return;
		emit({ type: 'transcript', direction, text });
		if (direction === 'in') transcriptIn += text;
		else transcriptOut += text;
	}

	// Transcripts reach the UI as live fragments (S10's surface); the /debug stream gets one
	// assembled line per side per turn instead of a fragment flood.
	function flushTranscripts(): void {
		if (transcriptIn) teeDebug('info', `heard: ${transcriptIn}`);
		if (transcriptOut) teeDebug('info', `spoke: ${transcriptOut}`);
		transcriptIn = '';
		transcriptOut = '';
	}

	function playOracleAudio(parts: Part[]): void {
		for (const part of parts) {
			const data = part.inlineData?.data;
			if (typeof data !== 'string' || data.length === 0) continue;
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

	function settleTurn(): void {
		if (speaker?.busy) {
			awaitingDrain = true;
		} else if (state === 'speaking' || state === 'thinking') {
			toState('listening');
		}
	}

	function onDrained(): void {
		if (!awaitingDrain) return;
		awaitingDrain = false;
		if (state === 'speaking') toState('listening');
	}

	// Mic first: the permission prompt lands right after the tap, and a denial never burns
	// a rate-limited token mint.
	async function acquireMic(stale: () => boolean): Promise<boolean> {
		const verdict = await openMic(onMicChunk);
		if (stale()) {
			if (verdict.ok) verdict.mic.stop();
			return false;
		}
		if (!verdict.ok) {
			fail(verdict.reason, verdict.detail);
			return false;
		}
		mic = verdict.mic;
		return true;
	}

	async function acquireToken(stale: () => boolean): Promise<string | null> {
		try {
			const response = await fetch('/api/voice/token', {
				method: 'POST',
				signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS)
			});
			if (!response.ok) throw new Error(`token endpoint returned ${response.status}`);
			const token = ((await response.json()) as { token?: string }).token ?? '';
			if (!token) throw new Error('token endpoint returned no token');
			// A canceled wake can finish after a later wake; never let its token replace the active scrubber.
			if (stale()) return null;
			mintedToken = token;
			return token;
		} catch (err) {
			if (!stale()) fail('token', err instanceof Error ? err.message : String(err));
			return null;
		}
	}

	function openSpeaker(): boolean {
		try {
			speaker = createSpeaker();
			speaker.onDrained(onDrained);
			return true;
		} catch (err) {
			// Synchronous since the caller's last staleness check — nothing to guard against.
			fail('audio', err instanceof Error ? err.message : String(err));
			return false;
		}
	}

	// A connect that resolves after losing the race must die here, or its socket leaks — and a
	// late settle of either kind must reach /debug, or the timeout line is the only diagnostic
	// left when the endpoint was merely slow.
	function raceConnectTimeout(attempt: Promise<Session>, attemptToken: string): Promise<Session> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let timedOut = false;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				timedOut = true;
				reject(new Error(`live connect timed out after ${CONNECT_TIMEOUT_MS}ms`));
			}, CONNECT_TIMEOUT_MS);
		});
		attempt.then(
			(session) => {
				clearTimeout(timer);
				if (!timedOut) return;
				teeDebug('info', 'live connect resolved after the timeout — closing the stale socket');
				try {
					session.close();
				} catch {
					// Already dead.
				}
			},
			(err) => {
				clearTimeout(timer);
				if (timedOut) {
					const detail = err instanceof Error ? err.message : String(err);
					teeDebug('error', `late connect rejection after timeout: ${detail}`, attemptToken);
				}
			}
		);
		return Promise.race([attempt, timeout]);
	}

	async function connectSession(
		token: string,
		myGeneration: number,
		stale: () => boolean
	): Promise<boolean> {
		let connected: Session;
		try {
			const client = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
			connected = await raceConnectTimeout(
				client.live.connect({
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
							// The reason text is where the API explains itself (quota, bad model, 1011 detail).
							if (generation === myGeneration) {
								onSocketDown(`close ${event?.code ?? ''} ${event?.reason ?? ''}`.trim());
							}
						}
					}
				}),
				token
			);
		} catch (err) {
			if (!stale()) fail('socket', err instanceof Error ? err.message : String(err));
			return false;
		}
		if (stale()) {
			// Slept while connecting: teardown already ran, so this socket must die here or leak.
			try {
				connected.close();
			} catch {
				// Already closed.
			}
			return false;
		}
		session = connected;
		return true;
	}

	async function awaitSetup(stale: () => boolean): Promise<boolean> {
		const ready = await new Promise<boolean>((resolve) => {
			setupResolver = resolve;
			setTimeout(() => {
				if (setupResolver === resolve) {
					setupResolver = null;
					resolve(false);
				}
			}, SETUP_TIMEOUT_MS);
		});
		if (stale()) return false;
		if (!ready) {
			fail('socket', setupFailureDetail ?? 'session setup never completed');
			return false;
		}
		return true;
	}

	async function wake(): Promise<void> {
		if (state !== 'asleep') return;
		setupFailureDetail = null;
		const myGeneration = ++generation;
		const stale = () => generation !== myGeneration;
		// Announced before the first await: the permission prompt + mint + connect stretch can run
		// long, and the UI must never read as asleep while the mic is being opened. Waking doubles
		// as the re-entry guard, and it routes a cancel tap into sleep().
		toState('waking');

		if (!(await acquireMic(stale))) return;
		const token = await acquireToken(stale);
		if (token === null) return;
		if (!openSpeaker()) return;
		if (!(await connectSession(token, myGeneration, stale))) return;
		if (!(await awaitSetup(stale))) return;

		liveReady = true;
		teeDebug('info', 'voice session awake');
		toState('listening');
	}

	function sleep(): void {
		if (state === 'asleep') return;
		const canceled = state === 'waking';
		teardown();
		teeDebug('info', canceled ? 'voice wake canceled' : 'voice session slept');
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
