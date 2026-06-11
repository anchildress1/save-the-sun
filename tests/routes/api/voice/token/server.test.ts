import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => {
	const create = vi.fn();
	const GoogleGenAI = vi.fn(function GoogleGenAI(this: { authTokens: { create: typeof create } }) {
		this.authTokens = { create };
	});
	return { create, GoogleGenAI };
});

vi.mock('@google/genai', () => ({ GoogleGenAI: sdk.GoogleGenAI }));

const mock = vi.hoisted(() => ({
	env: { GEMINI_API_KEY: 'test-gemini-key' } as { GEMINI_API_KEY?: string }
}));

vi.mock('$env/dynamic/private', () => ({ env: mock.env }));

import { POST } from '$routes/api/voice/token/+server';
import {
	claimMintSlot,
	resetMintWindows,
	SESSION_LIMIT,
	GLOBAL_LIMIT
} from '$lib/server/voice/rateLimit';
import { LIVE_MODEL } from '$lib/voice/config';

const NOW = new Date('2026-06-11T12:00:00.000Z');

function call(sessionId: string) {
	return POST({ locals: { sessionId } } as unknown as Parameters<typeof POST>[0]);
}

describe('POST /api/voice/token', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetMintWindows();
		mock.env.GEMINI_API_KEY = 'test-gemini-key';
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		// The limiter warns when the global window trips; keep the suite output clean.
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('mints a single-use ephemeral token constrained to the Live model only', async () => {
		sdk.create.mockResolvedValueOnce({ name: 'auth_tokens/abc123' });

		const response = await call('mint-happy');
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({ token: 'auth_tokens/abc123' });
		expect(sdk.create).toHaveBeenCalledExactlyOnceWith({
			config: {
				uses: 1,
				// 30 minutes of session, 60 seconds to connect — asserted as absolute instants.
				expireTime: '2026-06-11T12:30:00.000Z',
				newSessionExpireTime: '2026-06-11T12:01:00.000Z',
				liveConnectConstraints: { model: LIVE_MODEL },
				lockAdditionalFields: []
			}
		});
	});

	it('builds the client with the secret key on the v1alpha API with retries', async () => {
		sdk.create.mockResolvedValueOnce({ name: 'auth_tokens/abc123' });

		await call('mint-client');

		expect(sdk.GoogleGenAI).toHaveBeenCalledExactlyOnceWith({
			apiKey: 'test-gemini-key',
			httpOptions: { apiVersion: 'v1alpha', retryOptions: { attempts: 3 } }
		});
	});

	it('never leaks the long-lived key in a success response', async () => {
		sdk.create.mockResolvedValueOnce({ name: 'auth_tokens/abc123' });

		const response = await call('mint-no-leak');
		const body = await response.json();

		expect(Object.keys(body)).toEqual(['token']);
		expect(JSON.stringify(body)).not.toContain('test-gemini-key');
	});

	it('returns 503 and masks the key when the mint call rejects', async () => {
		sdk.create.mockRejectedValueOnce(
			new Error('401 from https://api?key=test-gemini-key rejected')
		);

		const response = await call('mint-fails');
		const body = await response.json();

		expect(response.status).toBe(503);
		expect(body).toEqual({ error: 'Voice is unavailable.' });
		// The upstream error embedded the key; the log sink must only ever see the mask.
		const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
		expect(logged).toContain('[gemini-api-key]');
		expect(logged).not.toContain('test-gemini-key');
	});

	it.each([
		{
			label: 'a non-Error rejection',
			reason: 'plain string failure',
			expected: 'plain string failure'
		},
		{
			label: 'an Error with no stack',
			reason: Object.assign(new Error('stackless test-gemini-key boom'), { stack: undefined }),
			expected: 'stackless [gemini-api-key] boom'
		}
	])('logs the masked detail when the mint rejects with $label', async ({ reason, expected }) => {
		sdk.create.mockRejectedValueOnce(reason);

		const response = await call('mint-odd-failure');

		expect(response.status).toBe(503);
		const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
		expect(logged).toContain(expected);
		expect(logged).not.toContain('test-gemini-key');
	});

	it('returns 503 when the mint succeeds without a token name', async () => {
		sdk.create.mockResolvedValueOnce({});

		const response = await call('mint-nameless');

		expect(response.status).toBe(503);
		expect((await response.json()).error).toBe('Voice is unavailable.');
	});

	it('returns 503 without touching the SDK when the key is not configured', async () => {
		mock.env.GEMINI_API_KEY = undefined;

		const response = await call('mint-keyless');

		expect(response.status).toBe(503);
		expect((await response.json()).error).toBe('Voice is unavailable.');
		expect(sdk.GoogleGenAI).not.toHaveBeenCalled();
		// The misconfiguration is loud for the operator, not just a quiet client 503.
		expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('not configured');
	});

	it('rejects the request over the per-session limit with 429 and retry-after', async () => {
		sdk.create.mockResolvedValue({ name: 'auth_tokens/abc123' });
		for (let i = 0; i < SESSION_LIMIT; i++) {
			expect((await call('mint-greedy')).status).toBe(200);
		}

		const response = await call('mint-greedy');

		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('60');
		expect((await response.json()).error).toContain('Too many token requests');
		// The denied request never reaches the upstream mint.
		expect(sdk.create).toHaveBeenCalledTimes(SESSION_LIMIT);
	});

	it('counts failed mints against the allowance — a retry storm cannot burn the key', async () => {
		sdk.create.mockRejectedValue(new Error('upstream 500'));
		for (let i = 0; i < SESSION_LIMIT; i++) {
			expect((await call('mint-stormy')).status).toBe(503);
		}

		const response = await call('mint-stormy');

		expect(response.status).toBe(429);
		expect(sdk.create).toHaveBeenCalledTimes(SESSION_LIMIT);
	});

	it('still serves other sessions after one session hits its limit', async () => {
		sdk.create.mockResolvedValue({ name: 'auth_tokens/abc123' });
		for (let i = 0; i <= SESSION_LIMIT; i++) await call('mint-hog');

		const response = await call('mint-polite');

		expect(response.status).toBe(200);
		expect((await response.json()).token).toBe('auth_tokens/abc123');
	});

	it('rejects even a fresh session once the global window is exhausted', async () => {
		for (let s = 0; s < GLOBAL_LIMIT / SESSION_LIMIT; s++) {
			for (let i = 0; i < SESSION_LIMIT; i++) {
				expect(claimMintSlot(`mint-flood-${s}`).ok).toBe(true);
			}
		}

		const response = await call('mint-innocent');

		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('60');
		expect(sdk.create).not.toHaveBeenCalled();
	});
});
