// The server-authored-line gate. Most voiced lines are recomposed from a descriptor (the allow-list
// in lines.ts), so the TTS route can't be abused for arbitrary text. The Oracle's dramatized answer
// is the exception — it's authored by Gemini per Ask, so it can't be recomposed. Instead the server
// SIGNS it: the route voices an authored line only when its HMAC matches, so the gate still admits
// only server-issued text. Free arbitrary text carries no valid signature and is refused.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

// Bind the signature to (voice, text) so a signed line can't be replayed in a different voice or as
// other words — both ride the MAC.
function payload(voice: string, text: string): string {
	return `${voice}\n${text}`;
}

// HMAC key: the server-only Gemini secret reused as signing material. It never leaves the server (the
// signature is opaque), so this needs no new secret or infra. With no key configured, signing/verify
// both fail closed — authored lines simply don't compose, and the deterministic template still voices.
function signingKey(): string | null {
	return env.GEMINI_API_KEY || null;
}

/** Sign an authored line for the gate, or null when no signing key is configured. */
export function signLine(voice: string, text: string): string | null {
	const key = signingKey();
	if (key === null) return null;
	return createHmac('sha256', key).update(payload(voice, text)).digest('base64url');
}

/** Whether `sig` is the server's signature for this exact (voice, text) — the gate's admission check. */
export function verifyLine(voice: string, text: string, sig: string): boolean {
	const expected = signLine(voice, text);
	if (expected === null || !sig) return false;
	const a = Buffer.from(expected);
	const b = Buffer.from(sig);
	// Length-guard first: timingSafeEqual throws on a length mismatch.
	return a.length === b.length && timingSafeEqual(a, b);
}
