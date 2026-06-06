import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: { command: 'pnpm run build && pnpm run preview', port: 4173 },
	testMatch: '**/*.e2e.{ts,js}',
	// Desktop is the documented target surface (prd.md R10); size the e2e viewport to match.
	use: { viewport: { width: 1536, height: 864 } }
});
