.PHONY: install dev format format-check lint typecheck test build e2e perf secret-scan clean ai-checks

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
	pnpm run test:unit

build:
	pnpm run build

e2e:
	pnpm run test:e2e

perf:
	npx lhci autorun

secret-scan:
	npx secretlint

clean:
	rm -rf build node_modules .svelte-kit

ai-checks: format lint typecheck test build
