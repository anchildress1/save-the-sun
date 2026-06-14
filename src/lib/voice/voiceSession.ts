// Live session client: WebSocket lifecycle, mic streaming, and Oracle playback behind
// wake()/sleep(), narrated to the UI as events. Any lifecycle failure emits 'error' and settles
// back to asleep — except a denied or absent mic, which seals the session into the terminal
// eclipsed state (R1: never re-prompt). The button game never depends on this module being alive.

import {
	GoogleGenAI,
	Modality,
	type FunctionCall,
	type LiveServerMessage,
	type Part,
	type Session
} from '@google/genai';
import { LIVE_MODEL, MIC_SAMPLE_RATE, ORACLE_VOICE } from '$lib/voice/config';
import {
	ORACLE_INVITATION_TRIGGER,
	ORACLE_SYSTEM_INSTRUCTION,
	ORACLE_TOOL_DECLARATIONS
} from '$lib/voice/oraclePersona';
import {
	createSpeaker,
	openMic,
	type MicCapture,
	type MicFailure,
	type Speaker
} from '$lib/voice/audio';

export type VoiceState =
	| 'asleep'
	| 'waking'
	| 'listening'
	| 'hearing'
	| 'thinking'
	| 'speaking'
	| 'eclipsed';
export type VoiceErrorReason = MicFailure | 'token' | 'socket';

export type VoiceEvent =
	| { type: 'waking' }
	| { type: 'listening' }
	| { type: 'hearing'; amplitude: number }
	| { type: 'thinking' }
	| { type: 'speaking' }
	| { type: 'asleep' }
	| { type: 'eclipsed' }
	| { type: 'error'; reason: VoiceErrorReason; notice: string }
	// Text arrives as incremental fragments; turn boundaries ride the state events. One `final` out
	// fragment fires when `thinking` is entered from the player's input phase (hearing → silence, or
	// direct()) — that is the true boundary where trailing outputTranscription chunks have settled.
	// onToolCall also enters `thinking` mid-Oracle-turn (from `speaking`); no `final` fires there.
	| { type: 'transcript'; direction: 'in' | 'out'; text: string; final?: boolean };

export type VoiceListener = (event: VoiceEvent) => void;

export interface VoiceToolCall {
	name: string;
	args: Record<string, unknown>;
}

/** Executes one model tool call against the game; resolves to the outcome line the model voices. */
export type VoiceToolExecutor = (call: VoiceToolCall) => Promise<string>;

export interface VoiceSession {
	/** Open the Live session: mic, token, socket. Resolves once listening — or thinking, when
	 * the wake carries the round's first-wake invitation (S6) — or after the wake fails or is
	 * canceled by sleep(). Never rejects. A no-op once eclipsed — the player who denied the
	 * mic (or has none) is never re-prompted this session. */
	wake(options?: { invitation?: boolean }): Promise<void>;
	/** Close everything and return to asleep. Safe in any state; eclipsed stays sealed. */
	sleep(): void;
	/** Register the executor behind the session's declared tools (S7). The session only carries
	 * calls over and outcomes back; the game lives with the registrant. While unset, calls
	 * answer with an error so the model never hangs on a missing result. */
	setToolExecutor(executor: VoiceToolExecutor | null): void;
	/** Have the Oracle speak a board-made line: sends `text` as one stage-direction turn and
	 * waits in thinking. A no-op unless idle (listening/hearing) — mid-thought or mid-speech a
	 * second queued turn would talk over the one in flight, and the panel already carries the
	 * line. A throwing send means the socket is dead — fails the session. */
	direct(text: string): void;
	readonly state: VoiceState;
	readonly notice: string | null;
	subscribe(listener: VoiceListener): () => void;
}

// Local RMS only drives UI state (hearing glow, thinking handoff); turn-taking belongs to the
// server VAD.
const SPEECH_RMS_FLOOR = 0.02;
const HEARING_HOLD_MS = 800;
// A cough can reach thinking with no reply ever coming.
const THINKING_FALLBACK_MS = 10_000;
// R7: this long with no recognizable player speech idles the session back to asleep.
const SILENCE_TIMEOUT_MS = 5_000;
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
	let notice: string | null = null;
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
	let silenceTimer: ReturnType<typeof setTimeout> | null = null;
	let setupResolver: ((ready: boolean) => void) | null = null;
	let setupFailureDetail: string | null = null;
	let sendFailureTeed = false;
	let mintedToken = '';
	let transcriptIn = '';
	let transcriptOut = '';
	let toolExecutor: VoiceToolExecutor | null = null;
	// Calls the model cancelled (barge-in) while their engine round-trip was still in flight.
	const cancelledToolIds = new Set<string>();
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
		clearSilenceClock();
	}

	function clearSilenceClock(): void {
		if (silenceTimer) clearTimeout(silenceTimer);
		silenceTimer = null;
	}

	function restartSilenceClock(): void {
		clearSilenceClock();
		silenceTimer = setTimeout(() => {
			silenceTimer = null;
			// Silent by design (R7): no error, no notice, no nudge — the medallion just sleeps.
			teardown();
			teeDebug('info', 'voice session idled — silence timeout');
			toState('asleep');
		}, SILENCE_TIMEOUT_MS);
	}

	// 'hearing' re-emits every chunk so the medallion corona can track live amplitude.
	function toState(next: VoiceState): void {
		const prev = state;
		const changed = prev !== next;
		state = next;
		// R7 clock runs only on the player's turn; hearing arms-if-unset so RMS never resets
		// it, while a barge-in cutting straight from speaking still gets a fresh clock.
		if (next === 'listening') restartSilenceClock();
		else if (next === 'hearing') {
			if (!silenceTimer) restartSilenceClock();
		} else clearSilenceClock();
		if (!changed && next !== 'hearing') return;
		// `final` fires only at the true player→Oracle boundary: silence timer from `hearing`
		// or a direct() call from `listening`. onToolCall also calls toState('thinking') from
		// `speaking` mid-Oracle-turn — that is not the boundary where all chunks have settled,
		// so transcriptOut must keep accumulating until the player's silence fires.
		if (next === 'thinking' && (prev === 'hearing' || prev === 'listening')) {
			if (transcriptOut)
				emit({ type: 'transcript', direction: 'out', text: transcriptOut, final: true });
			flushTranscriptOut();
		}
		if (next === 'hearing') emit({ type: 'hearing', amplitude: lastAmplitude });
		else emit({ type: next });
	}

	function teardown(): void {
		// A mid-turn sleep/failure flushes transcriptIn to /debug but never emits a UI `final` —
		// the `final` belongs to `thinking`, and teardown skips thinking entirely.
		flushTranscripts();
		flushTranscriptOut();
		generation++;
		liveReady = false;
		awaitingDrain = false;
		lastAmplitude = 0;
		clearTimers();
		sendFailureTeed = false;
		cancelledToolIds.clear();
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
	function teeDebug(
		level: 'info' | 'error',
		message: string,
		extraToken = '',
		data?: Record<string, unknown>
	): void {
		let scrubbed = message;
		for (const token of new Set([mintedToken, extraToken])) {
			if (token) scrubbed = scrubbed.split(token).join('[ephemeral-token]');
		}
		const body: Record<string, unknown> = { level, message: scrubbed };
		if (data !== undefined) body.data = data;
		// keepalive: the final slept/transcript tees fire during page teardown and must survive it.
		void fetch('/api/voice/debug', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			keepalive: true
		})
			.then((response) => {
				if (!response.ok) console.warn('[voice] debug tee rejected:', response.status, scrubbed);
			})
			.catch(() => console.warn('[voice] debug tee unreachable:', scrubbed));
	}

	function fail(reason: VoiceErrorReason, detail: string): void {
		teardown();
		notice = NOTICE[reason];
		emit({ type: 'error', reason, notice });
		teeDebug('error', `voice wake failed (${reason}): ${detail}`);
		// A denied or absent mic is final for the session: eclipsed seals wake() shut so the
		// player is never re-prompted. Everything else settles to asleep and stays retryable.
		toState(reason === 'mic-permission' || reason === 'mic-missing' ? 'eclipsed' : 'asleep');
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
				// Flush what was heard NOW, or it silently rides into the next turn's heard: line.
				flushTranscripts();
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
		if (message.toolCall?.functionCalls?.length) onToolCall(message.toolCall.functionCalls);
		if (message.toolCallCancellation?.ids?.length) {
			for (const id of message.toolCallCancellation.ids) cancelledToolIds.add(id);
			teeDebug('info', `tool calls cancelled: ${message.toolCallCancellation.ids.join(', ')}`);
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
		if (direction === 'in') {
			transcriptIn += text;
			// A final transcript landing in thinking must not arm a clock the Oracle's turn owns.
			if (state === 'listening' || state === 'hearing') restartSilenceClock();
		} else {
			transcriptOut += text;
		}
	}

	// Transcripts reach the UI as live fragments (S10's surface); the /debug stream gets one
	// assembled line per side per turn. The `final` out fragment is deferred to `thinking` (the
	// true SDK turn boundary) so it always carries the complete assembled text — turnComplete has
	// no ordering guarantee with outputTranscription, so firing there could emit a partial line.
	function flushTranscripts(): void {
		if (transcriptIn) teeDebug('info', `heard: ${transcriptIn}`);
		transcriptIn = '';
	}

	// Tee and reset the Oracle's assembled out-transcript. Called at `thinking` (start of next
	// player turn) and on teardown — the two moments we know trailing chunks have settled.
	function flushTranscriptOut(): void {
		if (transcriptOut) {
			teeDebug('info', `spoke: ${transcriptOut}`);
			transcriptOut = '';
		}
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

	// The tool call IS the model's reply — disarm the rescue and hold thinking (clock paused)
	// through the engine round-trip; it re-arms once the result is sent and she owes speech again.
	// Calls answer independently, so one slow action never holds another's result.
	function onToolCall(calls: FunctionCall[]): void {
		if (thinkingRescueTimer) clearTimeout(thinkingRescueTimer);
		thinkingRescueTimer = null;
		toState('thinking');
		for (const call of calls) void runToolCall(call, generation);
	}

	async function runToolCall(call: FunctionCall, myGeneration: number): Promise<void> {
		const name = call.name ?? '';
		teeDebug('info', `tool call: ${name}`, '', { args: call.args ?? {} });
		let response: Record<string, unknown>;
		try {
			if (!toolExecutor) throw new Error('no tool executor registered');
			response = { output: await toolExecutor({ name, args: call.args ?? {} }) };
		} catch (err) {
			// The model voices the failure in character; the truth is "the move did not land."
			response = { error: err instanceof Error ? err.message : String(err) };
		}
		// Slept or failed while the engine worked: the action stands (committed server-side),
		// but this socket is gone — there is nothing left to answer.
		if (generation !== myGeneration || !session) return;
		if (call.id && cancelledToolIds.delete(call.id)) {
			// Barge-in cancelled the call. The engine effect stands (a committed action is never
			// rolled back); only the answer is dropped — the model has already moved on.
			teeDebug('info', `tool result dropped — ${name} was cancelled`);
			return;
		}
		try {
			session.sendToolResponse({
				functionResponses: [{ ...(call.id && { id: call.id }), name, response }]
			});
		} catch (err) {
			fail(
				'socket',
				`tool response send failed: ${err instanceof Error ? err.message : String(err)}`
			);
			return;
		}
		teeDebug('info', `tool result: ${name}`, '', response);
		if (state === 'thinking') armThinkingRescue();
	}

	function direct(text: string): void {
		if (!liveReady || !session) return;
		if (state !== 'listening' && state !== 'hearing') {
			teeDebug('info', `direction dropped while ${state}`);
			return;
		}
		try {
			session.sendClientContent({
				turns: [{ role: 'user', parts: [{ text }] }],
				turnComplete: true
			});
		} catch (err) {
			fail('socket', `direction send failed: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}
		toState('thinking');
		armThinkingRescue();
	}

	// Mic first: the permission prompt lands right after the tap, and a denial never burns
	// a rate-limited token mint.
	async function acquireMic(stale: () => boolean): Promise<boolean> {
		const verdict = await openMic(onMicChunk);
		if (stale()) {
			if (verdict.ok) {
				verdict.mic.stop();
			} else if (
				(verdict.reason === 'mic-permission' || verdict.reason === 'mic-missing') &&
				state === 'asleep'
			) {
				// A denial landing after a cancel tap is still a fact about the player (R1): seal it,
				// or the next tap re-prompts. A newer in-flight wake observes the denial itself.
				fail(verdict.reason, verdict.detail);
			}
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

	// Returns the socket so the caller never needs an unreachable null re-check on `session`.
	async function connectSession(
		token: string,
		myGeneration: number,
		stale: () => boolean
	): Promise<Session | null> {
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
						tools: [{ functionDeclarations: ORACLE_TOOL_DECLARATIONS }],
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
							const detail = `close ${event?.code ?? ''} ${event?.reason ?? ''}`.trim();
							if (generation === myGeneration) {
								onSocketDown(detail);
							} else if (event?.reason) {
								// A close landing after the wake already failed (e.g. setup timeout) carries
								// the only explanation of WHY — generation-gating must not eat it.
								teeDebug('info', `stale socket ${detail}`, token);
							}
						}
					}
				}),
				token
			);
		} catch (err) {
			if (!stale()) fail('socket', err instanceof Error ? err.message : String(err));
			return null;
		}
		if (stale()) {
			// Slept while connecting: teardown already ran, so this socket must die here or leak.
			try {
				connected.close();
			} catch {
				// Already closed.
			}
			return null;
		}
		session = connected;
		return connected;
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

	// Waits in thinking (clock paused, rescue armed). A send that throws means the socket is
	// already dead or dying — fail the wake so the next tap retries with the invitation intact.
	function beginInvitation(live: Session): void {
		try {
			live.sendClientContent({
				turns: [{ role: 'user', parts: [{ text: ORACLE_INVITATION_TRIGGER }] }],
				turnComplete: true
			});
		} catch (err) {
			fail('socket', `invitation send failed: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}
		teeDebug('info', 'voice invitation sent');
		toState('thinking');
		armThinkingRescue();
	}

	async function wake(options?: { invitation?: boolean }): Promise<void> {
		if (state === 'eclipsed') return;
		if (state !== 'asleep') {
			// info, not error: a double-tap race lands here routinely — and 'warn' isn't a level
			// the /debug stream accepts.
			teeDebug('info', 'voice session already awake');
			return;
		}
		notice = null;
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
		const connected = await connectSession(token, myGeneration, stale);
		if (!connected) return;
		if (!(await awaitSetup(stale))) return;

		liveReady = true;
		teeDebug('info', 'voice session awake');
		if (options?.invitation) beginInvitation(connected);
		else toState('listening');
	}

	function sleep(): void {
		// Eclipsed is terminal: a sleep (medallion tap, page unmount) must not re-arm wake()
		// by settling back to asleep.
		if (state === 'asleep' || state === 'eclipsed') return;
		const canceled = state === 'waking';
		teardown();
		teeDebug('info', canceled ? 'voice wake canceled' : 'voice session slept');
		toState('asleep');
	}

	return {
		wake,
		sleep,
		setToolExecutor(executor: VoiceToolExecutor | null) {
			toolExecutor = executor;
		},
		direct,
		get state() {
			return state;
		},
		get notice() {
			return notice;
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
