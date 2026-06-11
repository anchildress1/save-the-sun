.PHONY: install dev format format-check lint typecheck test build preview e2e perf secret-scan deploy clean ai-checks

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

secret-scan:
	npx secretlint

deploy:
	./deploy.sh

clean:
	rm -rf build node_modules .svelte-kit

ai-checks: format lint typecheck test build
