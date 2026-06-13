# Sköll Metrics Corpus 🐺

> Floor stats: `node scripts/skoll-sim.mjs`. Live stats: `node scripts/skoll-sim.mjs --live` (local,
> needs a key). Do not hand-edit — re-run the script to refresh.

Self-play of Sköll's **deterministic floor** (his seeded fallback move) driven move-by-move through a
real `GameEngine` until he casts the secret. The floor is the only part of Sköll that runs without a
Gemini key, so it is the measurable proxy for his win pacing. **Turns-to-win counts Sköll's own moves**
(his Asks plus the winning Cast), not the engine's alternation flips.

The pacing target: Sköll's own wins average **7.5–9 turns** — slow enough that a
competent human can beat him, fast enough that he's a real threat.

## Aggregate (floor)

| metric | value |
| --- | --- |
| games (seeds) | 1000 |
| board size | 24 runes |
| win rate | 100.0% |
| mean turns-to-win | **8.37** |
| median turns-to-win | 8 |
| min / max turns | 2 / 20 |
| target window | 7.5–9 |
| within window | yes ✅ |

## Turns-to-win distribution (floor)

| turns | games | share | |
| --- | --- | --- | --- |
| 2 | 23 | 2.3% | ██████ |
| 3 | 34 | 3.4% | █████████ |
| 4 | 73 | 7.3% | ███████████████████ |
| 5 | 92 | 9.2% | ████████████████████████ |
| 6 | 101 | 10.1% | ██████████████████████████ |
| 7 | 117 | 11.7% | ██████████████████████████████ |
| 8 | 100 | 10.0% | ██████████████████████████ |
| 9 | 110 | 11.0% | ████████████████████████████ |
| 10 | 79 | 7.9% | ████████████████████ |
| 11 | 70 | 7.0% | ██████████████████ |
| 12 | 67 | 6.7% | █████████████████ |
| 13 | 62 | 6.2% | ████████████████ |
| 14 | 30 | 3.0% | ████████ |
| 15 | 19 | 1.9% | █████ |
| 16 | 16 | 1.6% | ████ |
| 17 | 4 | 0.4% | █ |
| 19 | 2 | 0.2% | █ |
| 20 | 1 | 0.1% | █ |

<!-- LIVE:START -->
## Live wolf testing (local, real Gemini calls)

The deterministic floor above is the CI proxy. This section is the **real thing**: the live Gemini wolf
(`gemini-3.5-flash`, the actual `decideSkollMove` brain) driven through the *same* engine loop as the
floor, one real API call per move. Run locally with a `GEMINI_API_KEY` — never in CI, which has no key.
Regenerate with `node scripts/skoll-sim.mjs --live [games]`.

**How it was tested.** For each seed 1–10: a fresh `GameEngine` and `freshSkollState` (production
path), the human seat passes, and Sköll plays every move via `decideSkollMove` against the live API
(falling back to the floor only if a call throws). The engine resolves each Ask/Cast truthfully and
reports the win. **Every Sköll move is one Gemini call**, counted per run below.

**The bar.** A run is a *win* only when Sköll casts the true rune (the engine's verdict, never the
model's claim). Pacing target: **mean turns-to-win in 7.5–9** — beatable by a
competent human, still a real threat. Turns-to-win counts Sköll's own moves (Asks + the winning Cast).

| metric | value |
| --- | --- |
| live games (seeds 1–10) | 10 |
| wins | 10/10 (100.0%) |
| **total live Gemini calls** | **77** |
| mean calls / game | 7.7 |
| mean turns-to-win | **7.70** |
| median turns-to-win | 7 |
| min / max turns | 5 / 12 |
| within 7.5–9 window | yes ✅ |

### Per-run results (proof)

| seed | secret | turns-to-win | result | gemini calls |
| --- | --- | --- | --- | --- |
| 1 | Mannaz | 11 | win ✅ | 11 |
| 2 | Isa | 12 | win ✅ | 12 |
| 3 | Isa | 11 | win ✅ | 11 |
| 4 | Ingwaz | 5 | win ✅ | 5 |
| 5 | Laguz | 7 | win ✅ | 7 |
| 6 | Perthro | 7 | win ✅ | 7 |
| 7 | Sowilo | 6 | win ✅ | 6 |
| 8 | Wunjo | 6 | win ✅ | 6 |
| 9 | Fehu | 6 | win ✅ | 6 |
| 10 | Perthro | 6 | win ✅ | 6 |
<!-- LIVE:END -->
