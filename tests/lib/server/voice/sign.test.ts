import { describe, it, expect, vi } from 'vitest';

// sign.ts reuses the Gemini secret as HMAC key; mock the env so the test controls it.
const mock = vi.hoisted(() => ({
	env: { GEMINI_API_KEY: 'sign-test-key' } as { GEMINI_API_KEY?: string }
}));
vi.mock('$env/dynamic/private', () => ({ env: mock.env }));

import { signLine, verifyLine } from '$lib/server/voice/sign';
import { ORACLE_VOICE, SKOLL_VOICE } from '$lib/voice/config';

describe('voice-line signing gate (ttd:17)', () => {
	it('verifies a line it signed', () => {
		const text = 'Yes — the flame-sign burns; Sól reaches for fire.';
		const sig = signLine(ORACLE_VOICE, text);
		expect(sig).not.toBeNull();
		expect(verifyLine(ORACLE_VOICE, text, sig as string)).toBe(true);
	});

	it('rejects tampered text, a swapped voice, and a forged or empty sig', () => {
		const text = 'No. She does not reach past the weight of four.';
		const sig = signLine(ORACLE_VOICE, text) as string;
		expect(verifyLine(ORACLE_VOICE, 'a different line', sig)).toBe(false);
		// The voice is bound into the MAC, so a line can't be replayed in the wrong voice.
		expect(verifyLine(SKOLL_VOICE, text, sig)).toBe(false);
		expect(verifyLine(ORACLE_VOICE, text, 'forged-signature')).toBe(false);
		expect(verifyLine(ORACLE_VOICE, text, '')).toBe(false);
	});

	it('fails closed with no signing key — never signs or verifies', () => {
		mock.env.GEMINI_API_KEY = undefined;
		expect(signLine(ORACLE_VOICE, 'anything')).toBeNull();
		expect(verifyLine(ORACLE_VOICE, 'anything', 'whatever')).toBe(false);
		mock.env.GEMINI_API_KEY = 'sign-test-key';
	});
});
