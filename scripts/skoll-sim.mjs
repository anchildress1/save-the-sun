// Sköll self-play measurement — drives a real GameEngine across a seed sweep and prints the stats.
//
//   node scripts/skoll-sim.mjs [games]               floor only (default 1000), no key needed
//   node scripts/skoll-sim.mjs --live [games] --trace  live Gemini wolf, needs a GEMINI_API_KEY
//
// A read-only tool: the write-up lives in the curated docs/skoll-metrics-corpus.md (the twelve-year-old
// thesis + the trace evidence). This script just produces the numbers — run it to see/refresh them.
// `--live` drives the REAL `decideSkollMove` brain through the same loop; `--trace` prints each game's
// turn-by-turn log (the evidence the corpus quotes).
//
// The repo's TS modules use the SvelteKit `$lib` alias and a bare JSON import that only Vite resolves.
// This script teaches plain Node both, via module resolve/load hooks, so the sim runs with no extra
// tooling or dependencies — node + the source files, nothing else.

import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'src', 'lib');

function resolveAlias(rest) {
	const base = path.join(LIB, rest);
	for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
		if (existsSync(candidate)) return candidate;
	}
	return base;
}

// Load .env into process.env so the $env shim can hand the live brain its key (local runs only).
function loadDotEnv() {
	try {
		for (const raw of readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
			const line = raw.replace(/^\s*export\s+/, '').trim();
			if (!line || line.startsWith('#')) continue;
			const eq = line.indexOf('=');
			if (eq === -1) continue;
			const key = line.slice(0, eq).trim();
			if (!/^[A-Z0-9_]+$/.test(key) || process.env[key] !== undefined) continue;
			let val = line.slice(eq + 1).trim();
			// Strip a wrapping quote pair; on an unquoted value, drop a trailing ` # comment` (a `#`
			// inside quotes is part of the value, so only the unquoted branch trims it).
			if (/^(['"]).*\1$/.test(val)) val = val.slice(1, -1);
			else val = val.replace(/\s+#.*$/, '');
			process.env[key] = val;
		}
	} catch {
		/* no .env — floor runs need none; the live path will fail loudly on a missing key */
	}
}
loadDotEnv();

// SvelteKit virtual modules the dependency chain touches. Vite supplies these; plain Node needs a
// stub. `$env/dynamic/private` hands the live brain the real key from process.env (loaded above).
const SHIMS = {
	'$app/environment': 'export const dev = false; export const browser = false;\n',
	'$env/dynamic/private': 'export const env = { GEMINI_API_KEY: process.env.GEMINI_API_KEY };\n'
};

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier in SHIMS) return { url: `shim:${specifier}`, shortCircuit: true };
		if (specifier === '$lib' || specifier.startsWith('$lib/')) {
			const rest = specifier === '$lib' ? '' : specifier.slice('$lib/'.length);
			return nextResolve(pathToFileURL(resolveAlias(rest)).href, context);
		}
		// Relative TS imports are written extensionless (Vite resolves them); add the .ts Node needs.
		if (specifier.startsWith('.') && context.parentURL && !context.parentURL.startsWith('shim:')) {
			const target = new URL(specifier, context.parentURL);
			if (!existsSync(fileURLToPath(target))) {
				for (const ext of ['.ts', '/index.ts']) {
					if (existsSync(fileURLToPath(new URL(specifier + ext, context.parentURL)))) {
						return nextResolve(specifier + ext, context);
					}
				}
			}
		}
		return nextResolve(specifier, context);
	},
	load(url, context, nextLoad) {
		if (url.startsWith('shim:'))
			return { format: 'module', shortCircuit: true, source: SHIMS[url.slice('shim:'.length)] };
		// board.ts imports runes.json without an attribute — Vite injects it; Node needs it explicit.
		if (url.endsWith('.json')) context.importAttributes = { type: 'json' };
		return nextLoad(url, context);
	}
});

const { simulateFloor, playFloorGame, withQuietConsole, median, skollSeedFor, BOARD_SIZE } =
	await import(pathToFileURL(path.join(LIB, 'server', 'skoll', 'sim.ts')).href);

// --- arg parsing ---------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const live = argv.includes('--live');
const trace = argv.includes('--trace'); // print each live game's turn-by-turn log
const gamesArg = argv.find((a) => !a.startsWith('--'));

function parsePositive(arg, fallback) {
	if (arg === undefined) return fallback;
	const n = Number(arg);
	if (!Number.isInteger(n) || n < 1) {
		console.error(`games must be a positive integer, got "${arg}"`);
		process.exit(1);
	}
	return n;
}

// --- floor sweep (always) ------------------------------------------------------------------------
// With --live the positional arg sizes the LIVE run, so the floor keeps its full default sweep.
const floorGames = parsePositive(live ? undefined : gamesArg, 1000);
const floor = await simulateFloor(floorGames);

console.log(`Sköll floor self-play — ${floorGames} seeded games over a ${BOARD_SIZE}-rune board\n`);
console.log(`  win rate     ${(floor.winRate * 100).toFixed(1)}%`);
console.log(`  mean turns   ${floor.meanTurns.toFixed(2)}`);
console.log(`  median turns ${floor.medianTurns}`);
console.log(`  range        ${floor.minTurns}–${floor.maxTurns}`);
// A min-max solver cracks 24 runes in ~5; the floor's hunch-weighting runs slower on purpose.
console.log(`  (a solver would average ~5 — slower is the point)\n`);

// --- live sweep (opt-in, real Gemini, local only) ------------------------------------------------
if (live) {
	const liveGames = parsePositive(gamesArg, 10);
	if (!process.env.GEMINI_API_KEY) {
		console.error('--live needs GEMINI_API_KEY (set it in .env); refusing to fake the numbers');
		process.exit(1);
	}
	await runLive(liveGames);
}

console.log('Numbers only — the write-up is curated in docs/skoll-metrics-corpus.md.');

// -------------------------------------------------------------------------------------------------

async function runLive(games) {
	const { decideSkollMove } = await import(
		pathToFileURL(path.join(LIB, 'server', 'skoll', 'gemini.ts')).href
	);
	const { GameEngine } = await import(
		pathToFileURL(path.join(LIB, 'server', 'engine', 'engine.ts')).href
	);
	const { freshSkollState } = await import(
		pathToFileURL(path.join(LIB, 'server', 'skoll', 'skoll.ts')).href
	);

	console.log(
		`Live Gemini wolf — ${games} real games (seeds 1–${games}), real Gemini every move\n`
	);
	const runs = [];
	// One clean row per game. Columns: turns-to-win, the Gemini decisions that drove the narrowing, the
	// lone-survivor guard casts that closed it, and any failure floors. Headers spaced to match the rows.
	console.log('  seed   result   turns   gemini   guard   floor   secret');
	console.log('  ────   ──────   ─────   ──────   ─────   ─────   ──────');
	for (let seed = 1; seed <= games; seed++) {
		// One decideSkollMove invocation per Sköll move (the SDK may retry a decision internally, so this
		// is a decision count, not a raw network-call count). A decision that throws or returns an illegal
		// move floors inside takeSkollTurn — r.floorMoves catches that so a degraded run can't masquerade
		// as live evidence. Each game is wrapped to silence the guard/failure console noise so the rows
		// below read clean; the counts (guard/floor) carry that signal instead.
		// Engine seed = `seed` (so the secret + per-run label stay reproducible); Sköll gets an
		// independent decorrelated seed, mirroring production's two separate randomSeed() calls so the
		// opening hunch handed to Gemini isn't coupled to selectSecret(seed).
		const r = await withQuietConsole(() =>
			playFloorGame(
				seed,
				new GameEngine(seed),
				freshSkollState(skollSeedFor(seed)),
				decideSkollMove
			)
		);
		// A guard-forced cast is the deterministic floor naming the lone survivor after Gemini's own play
		// cornered the board — real live play, but not a Gemini *decision*, so it's excluded from the count.
		const decisions = r.turns - r.guardMoves;
		runs.push({ ...r, decisions });
		const cell = (n, w) => String(n).padStart(w);
		console.log(
			`  ${cell(seed, 4)}   ${(r.won ? 'win' : 'LOSS').padEnd(6)}   ${cell(r.turns, 5)}   ${cell(decisions, 6)}   ${cell(r.guardMoves, 5)}   ${cell(r.floorMoves, 5)}   ${r.secret}`
		);
		if (trace) {
			for (const line of r.trace) console.log(`           ${line}`);
			console.log('');
		}
	}

	// A game with a floored move (Gemini threw / returned an illegal move) is contaminated evidence, so
	// it's EXCLUDED from the recorded stats — floor play never masquerades as Gemini. But one transient
	// hiccup must not throw the whole run away: the clean games still count, and only an all-floored run
	// (nothing clean to record) is a hard failure.
	const clean = runs.filter((r) => r.floorMoves === 0);
	const excluded = runs.filter((r) => r.floorMoves > 0);
	if (clean.length === 0) {
		console.error(
			'\n--live: every game floored — Gemini failed throughout. Nothing clean to record; re-run when the API is healthy.'
		);
		process.exit(1);
	}
	if (excluded.length > 0) {
		console.log(
			`\n  excluded ${excluded.length} contaminated game(s) — Gemini floored mid-game (seed ${excluded.map((r) => r.seed).join(', ')}); the ${clean.length} clean games below stand.`
		);
	}

	const wins = clean.filter((r) => r.won);
	const turns = wins.map((r) => r.turns).sort((a, b) => a - b);
	const mean = turns.length ? turns.reduce((a, t) => a + t, 0) / turns.length : 0;
	const range = turns.length ? `${turns[0]}–${turns.at(-1)}` : '—';
	const fast = turns.filter((t) => t <= 5).length; // the lucky early-read tail
	const cleanDecisions = clean.reduce((a, r) => a + r.decisions, 0);
	const cleanGuarded = clean.reduce((a, r) => a + r.guardMoves, 0);
	console.log(
		`\n  ${wins.length}/${clean.length} clean wins · mean ${mean.toFixed(2)} · median ${median(turns)} turns (range ${range})`
	);
	console.log(
		`  ${cleanDecisions} gemini decisions · ${cleanGuarded} guard casts · ${fast} lucky ≤5-turn reads\n`
	);
}
