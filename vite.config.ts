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
			exclude: ['src/**/*.d.ts', 'src/lib/index.ts'],
			// Per-module CI floors (test-plan.md §coverage). The engine is the referee —
			// strictest bar in the project. Raise these as modules land; never lower them.
			thresholds: {
				'src/lib/server/engine/engine.ts': { lines: 100, branches: 95 },
				'src/lib/server/engine/queries.ts': { lines: 100, branches: 95 }
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
