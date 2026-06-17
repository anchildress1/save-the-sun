# Sköll: does he play like a twelve-year-old? 🐺

The engine guarantees Sköll *can* win — that was never the question. The question is whether he plays
like a sharp, impatient **twelve-year-old** chasing the sun, or like a puzzle-solver in a wolf costume.
This is the evidence, move by move.

> Reproduce: `node scripts/skoll-sim.mjs` (the deterministic floor, no key needed) ·
> `node scripts/skoll-sim.mjs --live --trace` (the live Gemini wolf, needs a `GEMINI_API_KEY`).
> Turns-to-win counts his own moves — his Asks plus the winning Cast.

## The tells

Every line below is lifted straight from a live `--trace` run.

**He opens on a hunch, never the clean split.** A solver opens on light/dark — the 12-of-24 cut that
halves the board for free. Sköll never does. He bets on a colour he likes and takes what he gets:

```
#1 "A red rune. Mine." → no  (20 left)
```

**He chases whims — no system.** Colour, element, power, rune, in whatever order catches his eye that
turn. An optimizer asks the single most informative question every time; Sköll asks what pulls at him:

```
#1 "A blue rune. Mine."            → no   (20 left)
#2 "I scent a sun rune on her."    → no   (17 left)
#3 "Four power. I can smell it."   → no   (14 left)
#4 "More than three power…"        → yes  (7 left)
#6 "A gold rune. Mine."            → no   (4 left)
```

**He pounces and misses.** With a couple of runes left he *guesses* one instead of asking which — and
eats the wrong cast, the way a kid who can't wait does:

```
#6 cast Laguz → wrong
#7 cast Isa   → WIN
```

**When he's fast, it's luck — not skill.** An early "yes" on a small group collapses the board and he
whoops home in four. A solver never needs the luck; Sköll lives on it:

```
#1 "A black rune. Mine."          → no   (20 left)
#2 "I scent a sun rune on her."   → yes  (4 left)   ← lucky read: 20 → 4 in one question
#3 "More than three power…"       → no   (1 left)
#4 cast Sowilo → WIN
```

**He talks like a kid, not a search algorithm.** "I can smell it." "Mine." "I name it in the dark."
First-person hunger — never "the entropy-maximizing query is…"

## The model choice *is* the thesis

He runs on **`gemini-3.1-flash-lite`, on purpose — not full Flash.** Full Flash optimized: it cracked
the board in ~5 questions and ignored every persona cue we gave it. We dropped to the weaker model
*specifically to make him play down to a kid.* The thesis is baked into the model selection, and the
deterministic floor below encodes the same hunch-weighting without any model at all.

## The numbers are evidence of *not* optimizing

A min-max solver binary-searches 24 runes in five or six moves — **every game**, metronomically. Two
things say Sköll is not that machine.

**It's the spread, not the average.** His wins sprawl across the whole range — lucky four-turn blowouts
next to stubborn eleven-turn slogs. A solver clusters tight; a kid bounces all over.

### Deterministic floor — 1,000 seeded games (reproducible, no key)

The floor is his seeded fallback, driven move-by-move through a real `GameEngine`. Its hunch-weighting
leaves information on the table by design, so it averages **8.26 turns — far slower than a solver's ~5.**

| metric | value |
| --- | --- |
| games (seeds) | 1000 |
| win rate | 100.0% |
| mean turns-to-win | **8.26** |
| median turns-to-win | 8 |
| min / max turns | 2 / 19 |

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

### Live Gemini wolf — 35 games (local, real API)

Same engine loop, but every move is a real `gemini-3.1-flash-lite` decision. He's a touch sharper than
the floor, but never finds a solver's rhythm:

| metric | value |
| --- | --- |
| games | 35 |
| win rate | 100.0% |
| mean turns-to-win | 6.7 |
| median turns-to-win | 7 |
| min / max turns | 3 / 11 |
| lucky early reads (≤5 turns) | ~1 game in 3 |

About a third of rounds, a lucky early "yes" closes the hunt in four or five. The rest are deliberate
seven-to-nine-turn slogs of colour-then-power-then-rune hunches. Erratic, gut-driven, and happy to
guess wrong — a twelve-year-old, not a machine. That spread *is* the result.

#### The actual games (⚡ = a lucky ≤5-turn early read)

Two `--live` runs of the same wolf, copied straight from the logs. Same seed can play differently —
the model isn't deterministic, which is the point.

**Run A — 25 games**

| seed | secret | turns | | seed | secret | turns | | seed | secret | turns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Mannaz | 8 | | 10 | Perthro | 8 | | 19 | Dagaz | 5 ⚡ |
| 2 | Isa | 7 | | 11 | Perthro | 6 | | 20 | Hagalaz | 11 |
| 3 | Isa | 8 | | 12 | Thurisaz | 6 | | 21 | Ehwaz | 3 ⚡ |
| 4 | Ingwaz | 8 | | 13 | Eihwaz | 7 | | 22 | Algiz | 7 |
| 5 | Laguz | 9 | | 14 | Ehwaz | 10 | | 23 | Kenaz | 5 ⚡ |
| 6 | Perthro | 6 | | 15 | Uruz | 6 | | 24 | Tiwaz | 7 |
| 7 | Sowilo | 4 ⚡ | | 16 | Mannaz | 7 | | 25 | Algiz | 5 ⚡ |
| 8 | Wunjo | 5 ⚡ | | 17 | Laguz | 6 | | | | |
| 9 | Fehu | 9 | | 18 | Raido | 5 ⚡ | | | | |

Run A: mean **6.72**, median 7, range 3–11; 7 of 25 were ⚡ lucky reads.

**Run B — 10 games**

| seed | secret | turns | | seed | secret | turns |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Mannaz | 8 | | 6 | Perthro | 5 ⚡ |
| 2 | Isa | 8 | | 7 | Sowilo | 4 ⚡ |
| 3 | Isa | 8 | | 8 | Wunjo | 5 ⚡ |
| 4 | Ingwaz | 9 | | 9 | Fehu | 7 |
| 5 | Laguz | 5 ⚡ | | 10 | Perthro | 8 |

Run B: mean **6.70**, median 7.5, range 4–9; 4 of 10 were ⚡ lucky reads.
