import { test as base, expect } from '@playwright/test';

// Hard guarantee that NO e2e test reaches live Gemini: every Gemini-backed route is stubbed here, at
// the fixture level. /api/action is the Oracle/Sköll path — a game-playing test registers its own
// deterministic stub (which overrides this one), and any action that ISN'T stubbed aborts here,
// failing the test loudly instead of billing a real Ask/Advance. /api/voice/** returns a benign empty
// body (tts → empty NDJSON; the panel already carries the line). These are the only Gemini callers.
export const test = base.extend({
	page: async ({ page }, use) => {
		await page.route('**/api/action', (route) => route.abort());
		await page.route('**/api/voice/**', (route) =>
			route.request().url().includes('/voice/tts')
				? route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: '' })
				: route.fulfill({ status: 200, contentType: 'application/json', body: '{"text":""}' })
		);
		await use(page);
	}
});

export { expect };
