import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'pnpm run build && pnpm run preview',
		port: 4173,
		// The e2e/preview app MUST run keyless — never reach live Gemini. e2e stubs /api/action's
		// deterministic answers, but the page still delivers them via /api/voice/tts (audio defaults
		// on); without a key those routes degrade (503/silent) instead of billing real synth. An empty
		// value set here wins over .env, so a local push can't quietly spend the key.
		env: { GEMINI_API_KEY: '' }
	},
	testDir: 'tests/e2e',
	testMatch: '**/*.e2e.{ts,js}',
	// Desktop is the documented target surface (prd.md R10); size the e2e viewport to match.
	use: { viewport: { width: 1536, height: 864 } }
});
