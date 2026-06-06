import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		expect: { requireAssertions: true },
		coverage: {
			provider: 'v8',
			reporter: ['text-summary', 'lcov'],
			reportsDirectory: 'coverage',
			include: ['src/**/*.{ts,svelte}'],
			// +layout.svelte is framework boilerplate (favicon + theme import + <slot>) with
			// no logic to test; index.ts is a re-export barrel.
			exclude: ['src/**/*.d.ts', 'src/lib/index.ts', 'src/routes/+layout.svelte'],
			// CI coverage floors (test-plan.md §coverage). Globs gate per module; raise
			// these as modules land, never lower them. Enforced by `make test` (CI) and the
			// pre-push hook.
			thresholds: {
				lines: 85,
				branches: 80,
				functions: 85,
				statements: 85,
				'src/lib/components/**': { lines: 80, branches: 70 },
				'src/routes/+page.svelte': { lines: 80, branches: 70 },
				'src/lib/server/engine/actions.ts': { lines: 90, branches: 85 },
				'src/routes/api/action/+server.ts': { lines: 90, branches: 85 }
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
						provider: playwright(),
						instances: [{ browser: 'chromium' }]
					}
				}
			}
		]
	}
});
