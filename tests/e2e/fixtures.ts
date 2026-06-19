import { test as base, expect } from '@playwright/test';

// Mock the Gemini-backed voice routes for every e2e test, so the suite never reaches a live synth or
// transcription (page.route intercepts in the browser — the request never leaves for the server).
// The deterministic answer comes from each test's own /api/action stub; the voice layer only needs to
// not call out. `/voice/tts` returns an empty NDJSON stream (no audio — the panel already carries the
// line); the rest return a benign empty JSON. Auto-applied via the page fixture so no test can forget.
export const test = base.extend({
	page: async ({ page }, use) => {
		await page.route('**/api/voice/**', (route) =>
			route.request().url().includes('/voice/tts')
				? route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: '' })
				: route.fulfill({ status: 200, contentType: 'application/json', body: '{"text":""}' })
		);
		await use(page);
	}
});

export { expect };
