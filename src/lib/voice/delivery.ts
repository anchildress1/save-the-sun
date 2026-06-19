// The shared delivery seam (voice-as-delivery). One speaker queue any audio source feeds: the
// Oracle's server-TTS clips and Sköll's. Mic-independent — this is the audio half of a line; the
// panel renders the text half on its own. The queue never synthesizes; it fetches an
// already-composed line's audio and plays it.
//
// subscribeDelivery emits a speaking signal (which voice) / idle so the medallion mirrors who is
// being voiced — the indicator that replaced the retired Live mic states.

import { createSpeaker, type Speaker } from './audio';
import type { LineDescriptor } from '$lib/server/voice/lines';
import { speakerOf } from '$lib/voice/speaker';

/** Which prebuilt voice a delivered line carries — the medallion shows the speaker. */
export type DeliveryVoice = 'oracle' | 'skoll';
export type DeliveryEvent = { type: 'speaking'; voice: DeliveryVoice } | { type: 'idle' };
export type DeliveryListener = (event: DeliveryEvent) => void;

let speaker: Speaker | null = null;
// Bumped by stop/disable so an in-flight deliver() that is still fetching drops its remaining chunks
// instead of playing a stale line over a fresh round (or a torn-down page).
let generation = 0;

const listeners = new Set<DeliveryListener>();
// null = idle (nothing being voiced). Tracks the voice currently producing audio so a switch
// (her answer → his Ask) re-emits and a drain settles back to idle.
let speakingVoice: DeliveryVoice | null = null;
// whenDrained() callers — resolved together when the speaker runs dry (or a stop/disable empties it).
const drainWaiters = new Set<() => void>();
// In-flight TTS fetches, reachable so stop/disable can abort a read that's stalled mid-stream —
// otherwise the bumped generation only takes effect on the next chunk, wedging the chain.
const activeFetches = new Set<AbortController>();
// Lines that have been queued but not yet finished streaming. A deliver() fetches before any chunk
// is enqueued, so the speaker isn't busy during that window — whenDrained() must still wait on it.
let pendingDeliveries = 0;

// A stream that stalls mid-flight (chunks stop without `done`) would wedge every later deliver().
// Bound the gap BETWEEN chunks, not the total — long lines legitimately stream over time.
const TTS_IDLE_TIMEOUT_MS = 10_000;

function abortActiveFetches(): void {
	for (const controller of activeFetches) controller.abort();
	activeFetches.clear();
}

function emit(event: DeliveryEvent): void {
	for (const listener of listeners) {
		try {
			listener(event);
		} catch (err) {
			// One broken subscriber must not starve the rest.
			console.error('[delivery] listener threw:', err);
		}
	}
}

/** Subscribe to speaking/idle events. Returns an unsubscribe. */
export function subscribeDelivery(listener: DeliveryListener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function setSpeaking(voice: DeliveryVoice): void {
	if (speakingVoice === voice) return;
	speakingVoice = voice;
	emit({ type: 'speaking', voice });
}

function goIdle(): void {
	if (speakingVoice === null) return;
	speakingVoice = null;
	emit({ type: 'idle' });
}

// The speaker's queue ran dry. A delivery still streaming more chunks (pendingDeliveries > 0) means
// this is only a mid-stream gap — the inter-chunk wait outran the queued audio — not the end, so hold
// the waiters until the last line finishes (retirePending settles them when the fetch completes).
function handleDrained(): void {
	if (pendingDeliveries > 0) return;
	goIdle();
	flushDrainWaiters();
}

function flushDrainWaiters(): void {
	const waiters = [...drainWaiters];
	drainWaiters.clear();
	for (const waiter of waiters) waiter();
}

/**
 * Init/resume the delivery speaker. MUST run inside a user gesture — browsers block an
 * AudioContext otherwise. Idempotent: a second call while live is a no-op.
 */
export function enableDelivery(): void {
	if (speaker) return;
	speaker = createSpeaker();
	speaker.onDrained(handleDrained);
	// The speaker reports the voice actually sounding (playback-driven), so the indicator flips to
	// Sköll only once his clip starts — not when his chunks were queued behind her still-playing line.
	speaker.onSpeaking((voice) => setSpeaking(voice as DeliveryVoice));
}

/** Whether a gesture has opened the speaker — audio plays only once this is true. */
export function deliveryReady(): boolean {
	return speaker !== null;
}

/** Close the speaker and drop it; a later {@link enableDelivery} reopens one. */
export function disableDelivery(): void {
	generation++; // invalidate any in-flight deliver() so its late chunks never reach a new speaker
	abortActiveFetches(); // cut a stalled read now, not on its next (maybe-never) chunk
	speaker?.close();
	speaker = null;
	goIdle();
	flushDrainWaiters(); // the queue is gone — no natural drain will come
}

/** Drop whatever is queued or playing, and invalidate any in-flight fetch, without closing the
 *  speaker — a new round abandons the previous round's unfinished line so it can't bleed over the
 *  fresh one even if its TTS response is still arriving. */
export function stopDelivery(): void {
	generation++;
	abortActiveFetches(); // cut a stalled read now, not on its next (maybe-never) chunk
	speaker?.stop();
	goIdle();
	flushDrainWaiters(); // stop() does not fire onDrained — release waiters here
}

// A delivery is stale once its speaker was swapped or its generation was bumped (stop/disable) —
// its remaining chunks must not play.
function isStale(active: Speaker, gen: number): boolean {
	return speaker !== active || gen !== generation;
}

// Read the NDJSON stream and enqueue each base64 chunk as it arrives, so playback starts at the
// first chunk. Bails (and aborts the fetch) the moment the delivery goes stale. Each chunk is tagged
// with this line's voice; the speaker flips the indicator when that voice actually starts playing.
async function pumpAudio(
	body: ReadableStream<Uint8Array>,
	active: Speaker,
	gen: number,
	voice: DeliveryVoice,
	abort: AbortController
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let idle: ReturnType<typeof setTimeout> | undefined;
	const armIdle = () => {
		clearTimeout(idle);
		idle = setTimeout(() => abort.abort(), TTS_IDLE_TIMEOUT_MS);
	};
	try {
		for (;;) {
			if (isStale(active, gen)) return abort.abort();
			armIdle();
			const { done, value } = await reader.read();
			clearTimeout(idle); // the chunk landed — the timer measures only the wait BETWEEN chunks, never decode/enqueue
			if (done) return;
			buffer += decoder.decode(value, { stream: true });
			let nl: number;
			while ((nl = buffer.indexOf('\n')) >= 0) {
				const chunk = buffer.slice(0, nl);
				buffer = buffer.slice(nl + 1);
				if (isStale(active, gen)) return abort.abort();
				if (chunk) active.enqueue(chunk, voice);
			}
		}
	} finally {
		clearTimeout(idle);
	}
}

// Lines are delivered one at a time, in call order. Two `deliver()`s firing back-to-back (the
// Oracle's answer, then Sköll's Ask on the same turn) each stream chunks into the ONE shared speaker
// as they arrive — run concurrently they interleave into the speaker's cumulative cursor, garbling
// both into a broken-up "competing" mess. Chaining each line behind the previous keeps her whole line
// enqueued before his begins, so they play in order. A failing line can't wedge the chain (catch).
let chain: Promise<void> = Promise.resolve();

/**
 * Voice one server-owned line: stream its audio from the TTS route and enqueue each PCM chunk as
 * it arrives, so the speaker starts at the first chunk rather than after the whole clip. Serialized
 * behind any in-flight line (see {@link chain}). A no-op until a gesture has enabled the speaker.
 * Audio is an enhancement layer — the line is already on the panel — so a synth or network failure
 * stays silent rather than surfacing an error.
 */
export function deliver(descriptor: LineDescriptor): Promise<void> {
	const active = speaker;
	if (!active) return Promise.resolve();
	// Snapshot the speaker + generation at ENQUEUE time, not when the chain reaches this line: a
	// stop/disable while it waits its turn behind an in-flight line bumps generation, and the queued
	// line must then drop (isStale) instead of fetching/playing into the fresh round.
	const gen = generation;
	const voice = speakerOf(descriptor);
	pendingDeliveries++;
	const run = chain.then(() => streamLine(descriptor, active, gen, voice));
	chain = run.catch(() => {});
	// Retire this line's pending slot once it settles. A line that produced no audio — a body-less
	// 200, or a failed/aborted fetch — never makes the speaker busy, so no onDrained would fire to
	// release whenDrained() waiters: settle them here when nothing is left queued or playing.
	void run.then(retirePending, retirePending);
	return run;
}

function retirePending(): void {
	pendingDeliveries--;
	if (pendingDeliveries === 0 && !speaker?.busy) handleDrained();
}

async function streamLine(
	descriptor: LineDescriptor,
	active: Speaker,
	gen: number,
	voice: DeliveryVoice
): Promise<void> {
	// Stale if a stop/disable bumped the generation (or swapped the speaker) since this line was
	// enqueued — whether that happened while it waited its turn or mid-stream below.
	if (isStale(active, gen)) return;
	const abort = new AbortController();
	activeFetches.add(abort);
	// pumpAudio's idle timer only covers gaps once headers arrive — bound the connect/first-byte wait
	// too, or a fetch that stalls before responding leaves this line awaiting forever and wedges every
	// later deliver() behind it on the chain. Cleared the moment the response resolves.
	const connect = setTimeout(() => abort.abort(), TTS_IDLE_TIMEOUT_MS);
	try {
		const res = await fetch('/api/voice/tts', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(descriptor),
			signal: abort.signal
		});
		clearTimeout(connect);
		if (res.ok && res.body) await pumpAudio(res.body, active, gen, voice, abort);
	} catch {
		/* network failure or abort — the panel already carries the line; stay silent */
	} finally {
		clearTimeout(connect);
		activeFetches.delete(abort);
	}
}

/**
 * Resolve once the speaker has played out everything queued — or after `timeoutMs`, so a stuck or
 * silent stream never hangs a caller. Resolves immediately when nothing is playing. Used to hold a
 * full-screen takeover (the end-of-round splash) until her last line has actually been heard.
 */
export function whenDrained(timeoutMs: number): Promise<void> {
	// A deliver() still fetching has no audio queued yet, so the speaker isn't busy — but the line is
	// coming. Hold while any delivery is outstanding, not only while audio is actively playing, or a
	// "hold until heard" caller resolves before the first chunk ever lands.
	if (pendingDeliveries === 0 && !speaker?.busy) return Promise.resolve();
	return new Promise((resolve) => {
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer); // an early drain shouldn't leave the fallback timer pending
			drainWaiters.delete(finish);
			resolve();
		};
		// finish only reads `timer` when it runs (after this line), so the const reference is safe.
		const timer = setTimeout(finish, timeoutMs);
		drainWaiters.add(finish);
	});
}

/** Test isolation only — module state shared across a test file. */
export function resetDelivery(): void {
	speaker = null;
	chain = Promise.resolve();
	speakingVoice = null;
	pendingDeliveries = 0;
	listeners.clear();
	drainWaiters.clear();
	activeFetches.clear();
}
