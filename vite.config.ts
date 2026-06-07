import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
	plugins: [sveltekit()],
	// Keep the dev server from reloading the live app when a test run or build rewrites
	// generated artifacts — a coverage run was flooding `make dev` with page reloads.
	server: {
		watch: { ignored: ['**/coverage/**', '**/test-results/**', '**/build/**'] }
	},
	test: {
		expect: { requireAssertions: true },
		coverage: {
			provider: 'v8',
			reporter: ['text-summary', 'lcov'],
			reportsDirectory: 'coverage',
			include: ['src/**/*.{ts,svelte}'],
			// +layout.svelte is framework boilerplate; index.ts is a re-export barrel;
			// gemini.ts is the untestable network seam (oracle.ts re-validates its output).
			exclude: [
				'src/**/*.d.ts',
				'src/lib/index.ts',
				'src/routes/+layout.svelte',
				'src/lib/server/oracle/gemini.ts'
			],
			// CI coverage floors (test-plan.md §coverage). Globs gate per module — the engine
			// is the referee and carries the strictest bar. Raise these as modules land;
			// never lower them. Enforced by `make test` (CI) and the pre-push hook.
			thresholds: {
				lines: 85,
				branches: 80,
				functions: 85,
				statements: 85,
				'src/lib/server/engine/engine.ts': { lines: 100, branches: 95 },
				'src/lib/server/engine/queries.ts': { lines: 100, branches: 95 },
				'src/lib/server/engine/actions.ts': { lines: 90, branches: 85 },
				'src/lib/server/oracle/oracle.ts': { lines: 90, branches: 85 },
				'src/routes/api/action/+server.ts': { lines: 90, branches: 85 },
				'src/routes/api/new-game/+server.ts': { lines: 90, branches: 85 },
				'src/lib/components/**': { lines: 80, branches: 70 },
				'src/routes/+page.svelte': { lines: 80, branches: 70 }
			}
		},
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['tests/**/*.{test,spec}.{js,ts}'],
					exclude: ['tests/**/*.svelte.{test,spec}.{js,ts}']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					include: ['tests/**/*.svelte.{test,spec}.{js,ts}'],
					setupFiles: ['./vitest-setup-client.ts'],
					browser: {
						enabled: true,
						headless: true,
						// reducedMotion so RuneGrid skips its GSAP entrance — cards render at their
						// static resting state instead of being caught mid-animation in headless CI
						// (the animated path is covered by the Playwright e2e suite).
						provider: playwright({ contextOptions: { reducedMotion: 'reduce' } }),
						instances: [
							{
								browser: 'chromium',
								// Desktop viewport, not the mobile-ish default, so the 6-col board fits.
								viewport: { width: 1280, height: 800 }
							}
						]
					}
				}
			}
		]
	}
});
