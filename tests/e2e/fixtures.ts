import { test as base, expect } from '@playwright/test';

// Auto-stub the voice routes so no e2e test reaches a live synth/transcribe: /voice/tts returns an
// empty NDJSON stream (the panel already carries the line), the rest a benign empty JSON.
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
