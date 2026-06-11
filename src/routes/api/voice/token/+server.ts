import { json } from '@sveltejs/kit';
import { GoogleGenAI } from '@google/genai';
import { env } from '$env/dynamic/private';
import { LIVE_MODEL } from '$lib/voice/config';
import { claimMintSlot } from '$lib/server/voice/rateLimit';
import { maskApiKey } from '$lib/server/debug/log';
import type { RequestHandler } from './$types';

// Google's documented defaults for Live ephemeral tokens, set explicitly so the policy is
// visible here and asserted in tests: one connect per token, 60s to use it, 30min session cap.
const SESSION_TTL_MS = 30 * 60 * 1000;
const CONNECT_WINDOW_MS = 60 * 1000;

// Mints a single-use Live API ephemeral token so the browser can open the Oracle's voice
// session without ever seeing the real key. The token is constrained server-side to the
// one Live model the game uses; everything else (voice, persona) is session config in S2.
export const POST: RequestHandler = async ({ locals }) => {
	const verdict = claimMintSlot(locals.sessionId);
	if (!verdict.ok) {
		return json(
			{ error: 'Too many token requests. Try again shortly.' },
			{ status: 429, headers: { 'retry-after': String(verdict.retryAfterSeconds) } }
		);
	}

	if (!env.GEMINI_API_KEY) {
		console.error('[voice] GEMINI_API_KEY is not configured; cannot mint ephemeral token');
		return json({ error: 'Voice is unavailable.' }, { status: 503 });
	}

	try {
		// Ephemeral tokens exist only on v1alpha. Per-request construction is fine: this runs
		// once per medallion wake, and the retry shields the tap from a transient 429/5xx.
		const ai = new GoogleGenAI({
			apiKey: env.GEMINI_API_KEY,
			httpOptions: { apiVersion: 'v1alpha', retryOptions: { attempts: 3 } }
		});
		const now = Date.now();
		const token = await ai.authTokens.create({
			config: {
				uses: 1,
				expireTime: new Date(now + SESSION_TTL_MS).toISOString(),
				newSessionExpireTime: new Date(now + CONNECT_WINDOW_MS).toISOString(),
				liveConnectConstraints: { model: LIVE_MODEL },
				// Omitting this locks the WHOLE LiveConnectConfig (not just the model) and every
				// session dies with close 1011; the empty array means "lock only what's set above".
				lockAdditionalFields: []
			}
		});
		// The SDK types name as optional; a mint without one is unusable, so fail loudly.
		if (!token.name) {
			console.error('[voice] token mint returned no token name');
			return json({ error: 'Voice is unavailable.' }, { status: 503 });
		}
		// The ephemeral token name is the only thing the browser ever holds.
		return json({ token: token.name });
	} catch (err) {
		// Keep the stack (it distinguishes quota vs auth vs transport at 3am) but mask it — an
		// SDK error message can embed the request URL, and with it the key.
		const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
		console.error('[voice] token mint failed:', maskApiKey(detail));
		return json({ error: 'Voice is unavailable.' }, { status: 503 });
	}
};
