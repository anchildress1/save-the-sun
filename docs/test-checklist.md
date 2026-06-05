# Save the Sun — Test Checklist

Checkbox form of `test-plan.md`. Built from `prd.md`, `game-spec.md`, `rune-board.md`, `ux-copy.md`. POC out of scope. Check a box when the test exists **and** passes in CI.

Legend: **[U]** unit · **[I]** integration · **[C]** component · **[E]** e2e · **[A]** a11y/automated · **[S]** statistical/property · **[V]** visual · **[Sec]** security · **[Eval]** scored eval

---

## 1. Engine — the referee (highest priority)

- [ ] [U] All 24 Elder Futhark runes load
- [ ] [U] Every rune is a unique (element, power, color) combination
- [ ] [U] Trait counts match `rune-board.md` (element 4 each · power 4 each · fill 12/12 · color 4 each)
- [ ] [U] Exactly one secret rune per round; refresh/new round reseeds
- [ ] [U] Element / power / fill / hue queries resolve truthfully (table-driven, all 24 × all axes)
- [ ] [U] Power ranges correct at boundaries — "fewer than N", "at least N", "N or more", exact (1 and 6 inclusive)
- [ ] [U] Single-rune query eliminates exactly that rune; yes only for the secret
- [ ] [U] **Only the secret wins a Cast; every other rune fails**
- [ ] [U] Wrong cast = wasted turn, round continues (never ends game)
- [ ] [U] Engine accepts a Cast of a crossed-off rune; never validates against crossings
- [ ] [U] Mixed-type / malformed / already-asked queries flagged invalid
- [ ] [U] Refused/invalid Ask does **not** consume the turn; resolved Ask does
- [ ] [Sec] No engine path returns the secret before a correct cast
- [ ] [U] Strict alternation, human-first; out-of-order Ask/Cast rejected
- [ ] [U] Scry returns same answer to rival; Hex suppresses answer + spends turn; Cast never interruptible
- [ ] [U] Per-player wrong-cast counter increments from v1 (threshold unused until v2)

## 2. Oracle pipeline (Gemini, Role 1)

- [ ] [I] Free-text maps to exactly one query type; multi-type intent rejected, not split
- [ ] [C] Echo matches the resolved query, shown **before** the answer; interpreted query stands (no do-over)
- [ ] [C] Yes restates the trait; No is the bare verdict, no exclusion narration; `{value-phrase}` fills per axis
- [ ] [C] Mixed-type refusal returns `ux-copy.md` line; turn not consumed
- [ ] [Sec] Secret-seeking Ask refused; secret never leaks
- [ ] [Sec] Prompt-injection / override stays in character, refuses
- [ ] [C] Unparseable / not-a-question refusal; turn not consumed
- [ ] [C] Empty submit refused with "Speak your question, witch." (nothing sent)
- [ ] [I] Resolved Ask consumes turn; every refusal class does not
- [ ] [Eval] ~40-phrasing corpus scored for correct query-type / refusal-class

## 3. Sköll — opponent + deterministic floor

**Referee / leash**

- [ ] [Sec][I] Sköll's tool-call inputs contain only earned state — never the secret, never the human's crossings
- [ ] [I] Illegal/malformed Sköll calls rejected (already-asked, non-splitting, bad rune, mixed-type, out-of-turn)
- [ ] [U] Board passed as JSON in fixed on-screen order; payload asserted not pre-sorted
- [ ] [I] Sköll cross-off/restore mutates only his private sheet; traceable in debug log
- [ ] [I] Wrong Sköll cast wastes only his turn; round continues

**Deterministic fallback (weighted-random, NOT argmax)**

- [ ] [I] Floor fires only on Gemini error/timeout/illegal — never on a legal-but-suboptimal move
- [ ] [U] Candidate set = legal well-formed queries over live candidates; excludes asked + non-splitting (all-yes/all-no)
- [ ] [U] Split score = `1 / (1 + |yes − n/2|)`, verified on hand-computed sets
- [ ] [S] **Best splitter most frequent, every legal splitter non-zero — asserted NOT argmax**
- [ ] [U] Medium peaking moderate/beatable; harder peaks toward optimal, easier toward uniform
- [ ] [U] Casts when one candidate remains; else casts best remaining when no splitter exists
- [ ] [U] Same seed + state → same sampled move (reproducible)

**Persona (eval, low gate)**

- [ ] [Eval] ~12-year-old behavior: one clue at a time, works from board + own cross-offs, may overlook a legal elimination, casts on "sure enough"; computation tells flagged as failures

## 4. Human loop & action interface

- [ ] [I] Ask vs Cast distinct (Ask never wins, Cast never asks)
- [ ] [C] Cross/restore works during player's turn **and** Sköll's turn; persists across turns
- [ ] [C] Ask + Cast disabled during Sköll's turn; cross-off stays enabled; acting shows "The wolf is moving. Hold."
- [ ] [C][E] Arm flow: "Cast the rune" arms mode; armed tap **selects target** (no cross-off); chrome "Cast?"
- [ ] [C][E] "Name it" commits; "Not yet" cancels with **no turn spent**
- [ ] [C] Two scoped card behaviors (cross-off vs select-target) never collide
- [ ] [E] Wrong cast costs turn only; crossings + round state preserved
- [ ] [E][A] Full keyboard cast path: arm → arrow → select → "Name it"
- [ ] [C] Pre-Ask panel reads "Twenty-four runes stand. None ruled out. Ask the Oracle."

## 5. Reactions — Scry & Hex

- [ ] [I] Each reaction once per player per round; spent reaction unavailable after (no "spent" copy)
- [ ] [I] Offered on an Ask's echo; **never** on a Cast
- [ ] [I] At most one reaction per interrupt window; Hex leaves no answer for Scry
- [ ] [I] Scry → rival also receives private answer
- [ ] [I] Hex → question dies, no answer to anyone, active turn spent
- [ ] [C] Human prompt "Sköll asks. Answer it?" → Scry / Hex / Let it pass per `ux-copy.md`
- [ ] [I] Sköll's reaction is refereed Gemini response with deterministic-floor fallback

## 6. UI / graphics presentation

- [ ] [V] Rune grid renders via Canvas/WebGL (not framework components); 24 cards 6×4
- [ ] [C] Each card shows glyph, swatch, name + meaning, power ○/● pips **with numeral**, light/dark label, element symbol + name, color name
- [ ] [A] Color name + light/dark + element always accompany icons — nothing by color alone
- [ ] [C] Card dims in place when crossed; restore affordance works
- [ ] [C] Header: title, tagline, night-progress, turn pill ("Your move." / "Sköll moves.")
- [ ] [V] Visual regression snapshots for grid + crossed/armed states

## 7. Accessibility (v1; screen reader = v1.5)

- [ ] [E][manual] Whole round operable by keyboard with visible focus indicator
- [ ] [A] Controls have accessible names/roles (axe)
- [ ] [A][manual] WCAG 2.1 AA contrast across light **and** dark palettes
- [ ] [A][manual] No information by color alone
- [ ] [C][manual] `prefers-reduced-motion` → motion instant, audio muted, still reflects live state
- [ ] [manual] Fully operable at 200% zoom
- [ ] [A][CI] Lighthouse a11y ≥ 0.95 (target ≈ 1.0) — build fails below
- [ ] _(v1.5, not gated)_ Screen-reader: `aria-live="polite"`, per-card traits, turn-change announcements

## 8. Degradation tiers

- [ ] [E] Plain (v1): full round winnable on static grid, audio muted by default
- [ ] [E] Reduced: reduced-motion OR WebGL/audio unavailable → instant changes, muted, static, game unaffected + fair
- [ ] [E] Full (v2, when built): tide + stingers + audio; mood off mid-round leaves game fully playable
- [ ] [S] Fairness invariant: with all mood off/failed, every round winnable through legal Asks alone

## 9. Error handling & edge states

- [ ] [I][E] Connection/engine error shown in-world ("The fire gutters…") **without losing crossings or turn state**
- [ ] [C] Empty submit refused with "Speak your question, witch."
- [ ] [C] Small screens get best-on-desktop notice — no responsive reflow
- [ ] [I] Invalid Ask costs only the rephrase, never a false answer
- [ ] [S] Every seeded round winnable through legal Asks; Oracle never lies (fuzz across secrets/seeds)

## 10. Debug view

- [ ] [I] Every result tagged deterministic-engine vs LLM-inference
- [ ] [I] Any turn the fallback fired is flagged
- [ ] [I] Engine truth shown beside Gemini's reasoning

## 11. Voice / copy conformance (lint + eval, not coverage-gated)

- [ ] [A] No emoji in diegetic copy; no exclamation in Oracle/Sól lines (Sköll's winning-cast exclamation allowlisted)
- [ ] [A] Banned arcade/idiom strings absent ("Correct!/Wrong!", "Play again", "Game over", "?"-only CTAs)
- [ ] [A] World-noun terminology enforced (rune, Ask/Cast, power, light/dark, hue, Scry/Hex — never "card")
- [ ] [Eval] Sampled Oracle vs Sköll lines attributable to correct speaker
- [ ] [I] Sköll taunt pool does not repeat within a game

---

## Enforced coverage gates (CI — PR fails below floor)

- [ ] **Engine** — line **100%** / branch **95%**
- [ ] **Deterministic fallback policy** — line **95%** / branch **90%**
- [ ] **Action interface** — line **90%** / branch **85%**
- [ ] **Oracle pipeline** — line **90%** / branch **85%**
- [ ] **Reactions** — line **95%** / branch **90%**
- [ ] **UI / interaction** — line **80%** / branch **70%**
- [ ] **Graphics render layer** — line **60%** (smoke + visual carry it)
- [ ] **Project overall** — line **85%** / branch **80%**

## Enforced non-coverage gates (CI)

- [ ] Lighthouse accessibility ≥ 0.95 (target ≈ 1.0)
- [ ] Round-solvability property test passes across all seeds
- [ ] Secret-leak security assertion (engine API + Sköll payload)
- [ ] Voice/terminology lint — zero diegetic violations

## High-risk gaps — do not skip

- [ ] Weighted-random vs argmax statistical test present and passing (§3)
- [ ] Turn-accounting-on-refusal covered for **every** refusal class (§2)
- [ ] Crossed-rune cast legality covered (§1)
- [ ] Cast sacredness: reactions never offered on a Cast (§5)
- [ ] Degradation **fairness** (solvable), not just renders (§8)
- [ ] Secret never present in Sköll's payload (§3)

## Build-order alignment

- [ ] Engine suite lands with engine
- [ ] Oracle suite lands with Oracle
- [ ] Human-loop + win/cast suites land with that module
- [ ] Reactions suite lands with reactions
- [ ] Opponent (Gemini + floor) suite lands with opponent
- [ ] Integration + E2E follow once action interface is stable
- [ ] a11y + degradation E2E gate the v1 jam build (June 21)
