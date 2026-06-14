// The shared delivery seam (voice-as-delivery, P1). One speaker queue any audio source feeds:
// the Oracle's server-TTS clips now, Sköll's prebuilt clips later (P2). Mic-independent — this is
// the audio half of a line; the panel renders the text half on its own. The queue never
// synthesizes; it fetches an already-composed line's audio and plays it.

import { createSpeaker, type Speaker } from './audio';
import type { LineDescriptor } from '$lib/server/voice/lines';

let speaker: Speaker | null = null;
let muted = false;

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
	speaker?.close();
	speaker = null;
}

/** Drop whatever is queued or playing without closing the speaker — a new round abandons the
 *  previous round's unfinished line so it can't bleed over the fresh one. */
export function stopDelivery(): void {
	speaker?.stop();
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
	try {
		const res = await fetch('/api/voice/tts', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(descriptor)
		});
		if (!res.ok || !res.body) return;
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		// NDJSON: one base64 PCM chunk per line. Enqueue each complete line as it streams in; the
		// speaker schedules them back-to-back, so playback starts at the first chunk.
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let nl: number;
			while ((nl = buffer.indexOf('\n')) >= 0) {
				const chunk = buffer.slice(0, nl);
				buffer = buffer.slice(nl + 1);
				// Guard against a disable/re-enable mid-stream — never enqueue onto a closed speaker.
				if (chunk && speaker === active) active.enqueue(chunk);
			}
		}
	} catch {
		/* network failure — the panel already carries the line; stay silent */
	}
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
}
