// Sköll self-play sim — drives a real GameEngine across a seed sweep, prints the pacing metrics, and
// writes them to the committed corpus.
//
//   node scripts/skoll-sim.mjs [games]          floor only (default 1000) — the CI-measurable proxy
//   node scripts/skoll-sim.mjs --live [games]    ALSO run the live Gemini wolf (default 10), local only
//
// The floor is the only part of Sköll that runs without a Gemini key, so it is the CI-measurable proxy
// for his win pacing. `--live` additionally drives the REAL `decideSkollMove` brain (gemini-3.5-flash)
// through the same loop, counting every API call and recording each run as proof — it needs a
// GEMINI_API_KEY (read from .env) and the network, so it never runs in CI. A floor-only run preserves
// the existing live section so re-running the floor never wipes the recorded live evidence.
//
// The repo's TS modules use the SvelteKit `$lib` alias and a bare JSON import that only Vite resolves.
// This script teaches plain Node both, via module resolve/load hooks, so the sim runs with no extra
// tooling or dependencies — node + the source files, nothing else.

import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
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

const { simulateFloor, playFloorGame, median, BOARD_SIZE } = await import(
	pathToFileURL(path.join(LIB, 'server', 'skoll', 'sim.ts')).href
);

const TARGET = { lo: 7.5, hi: 9 };
const LIVE_MARKER_START = '<!-- LIVE:START -->';
const LIVE_MARKER_END = '<!-- LIVE:END -->';
const corpusPath = path.join(ROOT, 'docs', 'skoll-metrics-corpus.md');

// --- arg parsing ---------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const live = argv.includes('--live');
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
const floorInWindow = floor.meanTurns >= TARGET.lo && floor.meanTurns <= TARGET.hi;

console.log(`Sköll floor self-play — ${floorGames} seeded games over a ${BOARD_SIZE}-rune board\n`);
console.log(`  win rate     ${(floor.winRate * 100).toFixed(1)}%`);
console.log(`  mean turns   ${floor.meanTurns.toFixed(2)}  (target ${TARGET.lo}–${TARGET.hi})`);
console.log(`  median turns ${floor.medianTurns}`);
console.log(`  range        ${floor.minTurns}–${floor.maxTurns}`);
console.log(`  pacing       ${floorInWindow ? 'WITHIN target window' : 'OUT OF target window'}\n`);

// --- live sweep (opt-in, real Gemini, local only) ------------------------------------------------
let liveSection;
if (live) {
	const liveGames = parsePositive(gamesArg, 10);
	if (!process.env.GEMINI_API_KEY) {
		console.error('--live needs GEMINI_API_KEY (set it in .env); refusing to fake the numbers');
		process.exit(1);
	}
	liveSection = await runLive(liveGames);
} else {
	liveSection = preserveLiveSection();
}

const corpus = renderCorpus(floor, floorGames, floorInWindow, liveSection);
await writeFile(corpusPath, corpus, 'utf8');
console.log(`corpus written → ${path.relative(ROOT, corpusPath)}`);

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
		`Live Gemini wolf — ${games} real games (seeds 1–${games}); every move is one Gemini decision\n`
	);
	const runs = [];
	let totalDecisions = 0;
	let totalFloored = 0;
	for (let seed = 1; seed <= games; seed++) {
		// One decideSkollMove invocation per Sköll move (the SDK may retry a decision internally, so
		// this is a decision count, not a raw network-call count). A decision that throws or returns an
		// illegal move floors inside takeSkollTurn — r.floorMoves catches that so a degraded run can't
		// masquerade as live evidence.
		const r = await playFloorGame(
			seed,
			new GameEngine(seed),
			freshSkollState(seed),
			decideSkollMove
		);
		const decisions = r.turns;
		totalDecisions += decisions;
		totalFloored += r.floorMoves;
		runs.push({ ...r, decisions });
		console.log(
			`  seed ${String(seed).padStart(2)} → ${r.won ? 'win ' : 'LOSS'} in ${String(r.turns).padStart(2)} turns (${decisions} decisions${r.floorMoves ? `, ${r.floorMoves} floored` : ''})  [secret: ${r.secret}]`
		);
	}

	// The live section's whole claim is "real Gemini, every move." A move that fell back to the floor
	// (API down, quota, malformed/illegal output) breaks that claim, so refuse to record it as proof.
	if (totalFloored > 0) {
		console.error(
			`\n--live floored ${totalFloored} move(s): Gemini failed or returned an illegal move. ` +
				`Refusing to record floor play as live evidence — re-run when the API is healthy.`
		);
		process.exit(1);
	}

	const wins = runs.filter((r) => r.won);
	const turns = wins.map((r) => r.turns).sort((a, b) => a - b);
	const mean = turns.length ? turns.reduce((a, t) => a + t, 0) / turns.length : 0;
	const inWindow = mean >= TARGET.lo && mean <= TARGET.hi;
	console.log(
		`\n  live: ${wins.length}/${games} wins, mean ${mean.toFixed(2)} turns, ${totalDecisions} Gemini decisions — ${inWindow ? 'WITHIN' : 'OUT OF'} window\n`
	);

	return renderLive({
		runs,
		games,
		wins: wins.length,
		mean,
		median: median(turns),
		totalDecisions,
		inWindow
	});
}

// Reuse the existing recorded live section on a floor-only run so re-running the floor never erases
// the live evidence. Falls back to a placeholder if the corpus has none yet.
function preserveLiveSection() {
	if (existsSync(corpusPath)) {
		const text = readFileSync(corpusPath, 'utf8');
		const a = text.indexOf(LIVE_MARKER_START);
		// Search the end marker AFTER the start so duplicated/misordered markers can't slice backwards.
		const b = a === -1 ? -1 : text.indexOf(LIVE_MARKER_END, a + LIVE_MARKER_START.length);
		if (a !== -1 && b > a) return text.slice(a + LIVE_MARKER_START.length, b).trim();
	}
	return '## Live wolf testing\n\n_No live run recorded yet. Run `node scripts/skoll-sim.mjs --live` locally (needs a key)._';
}

function renderLive({ runs, games, wins, mean, median, totalDecisions, inWindow }) {
	const rows = runs
		.map(
			(r) =>
				`| ${r.seed} | ${r.secret} | ${r.turns} | ${r.won ? 'win ✅' : 'loss ❌'} | ${r.decisions} |`
		)
		.join('\n');
	const turnsList = runs.filter((r) => r.won).map((r) => r.turns);
	const min = turnsList.length ? Math.min(...turnsList) : 0;
	const max = turnsList.length ? Math.max(...turnsList) : 0;
	return `## Live wolf testing (local, real Gemini)

The deterministic floor above is the CI proxy. This section is the **real thing**: the live Gemini wolf
(\`gemini-3.5-flash\`, the actual \`decideSkollMove\` brain) driven through the *same* engine loop as the
floor, one Gemini decision per move. Run locally with a \`GEMINI_API_KEY\` — never in CI, which has no key.
Regenerate with \`node scripts/skoll-sim.mjs --live [games]\`.

**How it was tested.** For each seed 1–${games}: a fresh \`GameEngine\` and \`freshSkollState\` (production
path), the human seat passes, and Sköll plays every move via \`decideSkollMove\` against the live API. The
engine resolves each Ask/Cast truthfully and reports the win. **Every Sköll move is one Gemini decision**
(the SDK may retry a decision internally, so this counts decisions, not raw network calls). A decision
that throws or returns an illegal move would fall back to the floor — the run is **rejected** if any move
floors, so every move recorded here is a real Gemini decision.

**The bar.** A run is a *win* only when Sköll casts the true rune (the engine's verdict, never the
model's claim). Pacing target: **mean turns-to-win in ${TARGET.lo}–${TARGET.hi}** — beatable by a
competent human, still a real threat. Turns-to-win counts Sköll's own moves (Asks + the winning Cast).

| metric | value |
| --- | --- |
| live games (seeds 1–${games}) | ${games} |
| wins | ${wins}/${games} (${((wins / games) * 100).toFixed(1)}%) |
| **total Gemini decisions** | **${totalDecisions}** |
| mean decisions / game | ${(totalDecisions / games).toFixed(1)} |
| mean turns-to-win | **${mean.toFixed(2)}** |
| median turns-to-win | ${median} |
| min / max turns | ${min} / ${max} |
| within ${TARGET.lo}–${TARGET.hi} window | ${inWindow ? 'yes ✅' : 'no ❌'} |

### Per-run results (proof)

| seed | secret | turns-to-win | result | gemini decisions |
| --- | --- | --- | --- | --- |
${rows}`;
}

function renderCorpus(m, gameCount, inWindow, liveSection) {
	const peak = Math.max(...m.distribution.map((d) => d.count), 1);
	const rows = m.distribution
		.map(({ turns, count }) => {
			const pct = ((count / m.wins) * 100).toFixed(1);
			const bar = '█'.repeat(Math.max(1, Math.round((count / peak) * 30)));
			return `| ${turns} | ${count} | ${pct}% | ${bar} |`;
		})
		.join('\n');

	return `# Sköll Metrics Corpus 🐺

> Floor stats: \`node scripts/skoll-sim.mjs\`. Live stats: \`node scripts/skoll-sim.mjs --live\` (local,
> needs a key). Do not hand-edit — re-run the script to refresh.

Self-play of Sköll's **deterministic floor** (his seeded fallback move) driven move-by-move through a
real \`GameEngine\` until he casts the secret. The floor is the only part of Sköll that runs without a
Gemini key, so it is the measurable proxy for his win pacing. **Turns-to-win counts Sköll's own moves**
(his Asks plus the winning Cast), not the engine's alternation flips.

The pacing target: Sköll's own wins average **${TARGET.lo}–${TARGET.hi} turns** — slow enough that a
competent human can beat him, fast enough that he's a real threat.

## Aggregate (floor)

| metric | value |
| --- | --- |
| games (seeds) | ${gameCount} |
| board size | ${BOARD_SIZE} runes |
| win rate | ${(m.winRate * 100).toFixed(1)}% |
| mean turns-to-win | **${m.meanTurns.toFixed(2)}** |
| median turns-to-win | ${m.medianTurns} |
| min / max turns | ${m.minTurns} / ${m.maxTurns} |
| target window | ${TARGET.lo}–${TARGET.hi} |
| within window | ${inWindow ? 'yes ✅' : 'no ❌'} |

## Turns-to-win distribution (floor)

| turns | games | share | |
| --- | --- | --- | --- |
${rows}

${LIVE_MARKER_START}
${liveSection}
${LIVE_MARKER_END}
`;
}
