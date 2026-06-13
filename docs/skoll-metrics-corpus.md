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
| mean turns-to-win | **8.26** |
| median turns-to-win | 8 |
| min / max turns | 2 / 19 |
| target window | 7.5–9 |
| within window | yes ✅ |

## Turns-to-win distribution (floor)

| turns | games | share | |
| --- | --- | --- | --- |
| 2 | 26 | 2.6% | ███████ |
| 3 | 45 | 4.5% | ████████████ |
| 4 | 74 | 7.4% | ███████████████████ |
| 5 | 91 | 9.1% | ████████████████████████ |
| 6 | 104 | 10.4% | ███████████████████████████ |
| 7 | 115 | 11.5% | ██████████████████████████████ |
| 8 | 99 | 9.9% | ██████████████████████████ |
| 9 | 91 | 9.1% | ████████████████████████ |
| 10 | 95 | 9.5% | █████████████████████████ |
| 11 | 72 | 7.2% | ███████████████████ |
| 12 | 66 | 6.6% | █████████████████ |
| 13 | 46 | 4.6% | ████████████ |
| 14 | 37 | 3.7% | ██████████ |
| 15 | 13 | 1.3% | ███ |
| 16 | 13 | 1.3% | ███ |
| 17 | 7 | 0.7% | ██ |
| 18 | 5 | 0.5% | █ |
| 19 | 1 | 0.1% | █ |

<!-- LIVE:START -->
## Live wolf testing (local, real Gemini)

The deterministic floor above is the CI proxy. This section is the **real thing**: the live Gemini wolf
(`gemini-3.5-flash`, the actual `decideSkollMove` brain) driven through the *same* engine loop as the
floor, one Gemini decision per move. Run locally with a `GEMINI_API_KEY` — never in CI, which has no key.
Regenerate with `node scripts/skoll-sim.mjs --live [games]`.

> ⚠️ **Recorded before the seed-decoupling fix.** This run reused one seed for the engine and Sköll; the
> runner now seeds Sköll independently (mirroring production), so these turns/decisions will change on the
> next `--live` regeneration. The per-seed secrets are unaffected (`selectSecret(seed)`).

**How it was tested.** For each seed 1–10: a fresh `GameEngine` and `freshSkollState` (production
path), the human seat passes, and Sköll plays every move via `decideSkollMove` against the live API. The
engine resolves each Ask/Cast truthfully and reports the win. **Every Sköll move is one Gemini decision**
(the SDK may retry a decision internally, so this counts decisions, not raw network calls). A decision
that throws or returns an illegal move would fall back to the floor — the run is **rejected** if any move
floors, so every move recorded here is a real Gemini decision.

**The bar.** A run is a *win* only when Sköll casts the true rune (the engine's verdict, never the
model's claim). Pacing target: **mean turns-to-win in 7.5–9** — beatable by a
competent human, still a real threat. Turns-to-win counts Sköll's own moves (Asks + the winning Cast).

| metric | value |
| --- | --- |
| live games (seeds 1–10) | 10 |
| wins | 10/10 (100.0%) |
| **total Gemini decisions** | **77** |
| mean decisions / game | 7.7 |
| mean turns-to-win | **7.70** |
| median turns-to-win | 6.5 |
| min / max turns | 5 / 12 |
| within 7.5–9 window | yes ✅ |

### Per-run results (proof)

| seed | secret | turns-to-win | result | gemini decisions |
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
