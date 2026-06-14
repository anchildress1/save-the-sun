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

/**
 * Voice one server-owned line: fetch its audio from the TTS route and enqueue it. A no-op until a
 * gesture has enabled the speaker. Audio is an enhancement layer — the line is already on the
 * panel — so a synth or network failure stays silent rather than surfacing an error.
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
		if (!res.ok) return;
		const { audio } = (await res.json()) as { audio?: string };
		// Guard against a disable/re-enable during the await — never enqueue onto a closed speaker.
		if (audio && speaker === active) active.enqueue(audio);
	} catch {
		/* network failure — the panel already carries the line; stay silent */
	}
}

/** Test isolation only — module state shared across a test file. */
export function resetDelivery(): void {
	speaker = null;
	muted = false;
}
