// The shared delivery seam (voice-as-delivery, P1). One speaker queue any audio source feeds:
// the Oracle's server-TTS clips now, Sköll's prebuilt clips later (P2). Mic-independent — this is
// the audio half of a line; the panel renders the text half on its own. The queue never
// synthesizes; it fetches an already-composed line's audio and plays it.

import { createSpeaker, type Speaker } from './audio';
import type { LineDescriptor } from '$lib/server/voice/lines';

let speaker: Speaker | null = null;
let muted = false;
// Bumped by stop/disable so an in-flight deliver() that is still fetching drops its remaining chunks
// instead of playing a stale line over a fresh round (or a torn-down page).
let generation = 0;
// Prebuilt clips (Sköll), warmed once into memory so a trigger plays without a network round-trip —
// the fetch is the only real latency (decode is sub-millisecond), so caching the base64 text is the
// whole win. Survives the speaker closing/reopening on a mute toggle; the audio source is static.
const clipCache = new Map<string, string>();

/**
 * Init/resume the delivery speaker. MUST run inside a user gesture — browsers block an
 * AudioContext otherwise. Idempotent: a second call while live is a no-op.
 */
export function enableDelivery(): void {
	if (speaker) return;
	speaker = createSpeaker(muted);
}

/** Whether a gesture has opened the speaker — audio plays only once this is true. */
export function deliveryReady(): boolean {
	return speaker !== null;
}

/**
 * Silence/unsilence delivered audio without dropping the queue (R11): captions are untouched.
 * Remembered for a speaker opened later, so the preference survives across enable/disable.
 */
export function setDeliveryMuted(next: boolean): void {
	muted = next;
	speaker?.setMuted(next);
}

/** Close the speaker and drop it; a later {@link enableDelivery} reopens one. */
export function disableDelivery(): void {
	generation++; // invalidate any in-flight deliver() so its late chunks never reach a new speaker
	speaker?.close();
	speaker = null;
}

/** Drop whatever is queued or playing, and invalidate any in-flight fetch, without closing the
 *  speaker — a new round abandons the previous round's unfinished line so it can't bleed over the
 *  fresh one even if its TTS response is still arriving. */
export function stopDelivery(): void {
	generation++;
	speaker?.stop();
}

// A delivery is stale once its speaker was swapped or its generation was bumped (stop/disable) —
// its remaining chunks must not play.
function isStale(active: Speaker, gen: number): boolean {
	return speaker !== active || gen !== generation;
}

// Read the NDJSON stream and enqueue each base64 chunk as it arrives, so playback starts at the
// first chunk. Bails (and aborts the fetch) the moment the delivery goes stale.
async function pumpAudio(
	body: ReadableStream<Uint8Array>,
	active: Speaker,
	gen: number,
	abort: AbortController
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	for (;;) {
		if (isStale(active, gen)) return abort.abort();
		const { done, value } = await reader.read();
		if (done) return;
		buffer += decoder.decode(value, { stream: true });
		let nl: number;
		while ((nl = buffer.indexOf('\n')) >= 0) {
			const chunk = buffer.slice(0, nl);
			buffer = buffer.slice(nl + 1);
			if (isStale(active, gen)) return abort.abort();
			if (chunk) active.enqueue(chunk);
		}
	}
}

/**
 * Voice one server-owned line: stream its audio from the TTS route and enqueue each PCM chunk as
 * it arrives, so she starts speaking at the first chunk rather than after the whole clip. A no-op
 * until a gesture has enabled the speaker. Audio is an enhancement layer — the line is already on
 * the panel — so a synth or network failure stays silent rather than surfacing an error.
 */
export async function deliver(descriptor: LineDescriptor): Promise<void> {
	const active = speaker;
	if (!active) return;
	// Snapshot the generation: a stop/disable during the await drops the rest of this stream so a
	// stale line never plays over a fresh round or a torn-down page.
	const gen = generation;
	const abort = new AbortController();
	try {
		const res = await fetch('/api/voice/tts', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(descriptor),
			signal: abort.signal
		});
		if (res.ok && res.body) await pumpAudio(res.body, active, gen, abort);
	} catch {
		/* network failure or abort — the panel already carries the line; stay silent */
	}
}

/**
 * Voice one prebuilt clip (Sköll, P2) through the same shared speaker the Oracle uses — so the two
 * voices serialize on one queue (R9: he never overlaps her) and the audio toggle's mute gates both.
 * The clip is a static base64 PCM16 @ 24kHz file (same format the TTS route streams), enqueued as one
 * blob — no synthesis, near-zero latency. A no-op until a gesture has enabled the speaker; a fetch
 * failure stays silent since his caption already carries the line (R10).
 */
export async function deliverClip(url: string): Promise<void> {
	const active = speaker;
	if (!active) return;
	// Warm path: a preloaded clip plays with no fetch and no staleness window — enqueue and done.
	const cached = clipCache.get(url);
	if (cached !== undefined) {
		if (cached) active.enqueue(cached);
		return;
	}
	// Cold path: not preloaded (or preload missed) — fetch, cache for next time, then enqueue.
	const gen = generation;
	const abort = new AbortController();
	try {
		const res = await fetch(url, { signal: abort.signal });
		if (!res.ok) return;
		const base64 = (await res.text()).trim();
		clipCache.set(url, base64);
		// A stop/disable during the fetch (new round, torn-down page) drops the clip so it can't bleed
		// over a fresh round.
		if (isStale(active, gen) || base64 === '') return;
		active.enqueue(base64);
	} catch {
		/* network failure or abort — the caption already carries his line; stay silent */
	}
}

/**
 * Warm the prebuilt clip library into memory so the first taunt plays with zero network latency
 * (R8: no perceptible delay). Best-effort and idempotent — an already-cached or failed clip is
 * skipped/retried later by {@link deliverClip}'s cold path. Call once audio is enabled (the opt-in),
 * so silent players never download the library.
 */
export async function preloadClips(urls: string[]): Promise<void> {
	await Promise.all(
		urls.map(async (url) => {
			if (clipCache.has(url)) return;
			try {
				const res = await fetch(url);
				if (res.ok) clipCache.set(url, (await res.text()).trim());
			} catch {
				/* best-effort warm — deliverClip's cold path covers a miss */
			}
		})
	);
}

/**
 * Resolve once the speaker has played out everything queued — or after `timeoutMs`, so a stuck or
 * silent stream never hangs a caller. Resolves immediately when nothing is playing. Used to hold a
 * full-screen takeover (the end-of-round splash) until her last line has actually been heard.
 */
export function whenDrained(timeoutMs: number): Promise<void> {
	const active = speaker;
	if (!active?.busy) return Promise.resolve();
	return new Promise((resolve) => {
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		active.onDrained(finish);
		setTimeout(finish, timeoutMs);
	});
}

/** Test isolation only — module state shared across a test file. */
export function resetDelivery(): void {
	speaker = null;
	muted = false;
	clipCache.clear();
}
