.PHONY: install dev format format-check lint typecheck test build preview e2e perf secret-scan deploy clean ai-checks voice-clips

install:
	pnpm install
	npx playwright install

dev:
	pnpm run dev

format:
	pnpm run format

format-check:
	pnpm run format --check

lint:
	pnpm run lint

typecheck:
	pnpm run check

test:
	pnpm run test:coverage

build:
	pnpm run build

# Serve the real production build (hashed assets, preload headers) — the error
# class `make dev` can never surface, because vite dev skips the asset pipeline.
preview: build
	pnpm run preview

e2e:
	pnpm run test:e2e

perf:
	pnpm exec lhci autorun
	node scripts/lighthouse-scores.mjs

secret-scan:
	npx secretlint

# Regenerate Sköll's prebuilt voice clips (R8). Needs GEMINI_API_KEY (.env); local-only, never CI —
# the clips ship as committed static assets. --force redoes all; bare run fills only what's missing.
voice-clips:
	node scripts/skoll-voice.mjs --force

deploy:
	./deploy.sh

clean:
	rm -rf build node_modules .svelte-kit

ai-checks: format lint typecheck test build
