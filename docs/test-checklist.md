# Save the Sun — Test Checklist

Checkbox form of `test-plan.md`. Built from `prd.md`, `game-spec.md`, `rune-board.md`, `ux-copy.md`. POC out of scope. Check a box when the test exists **and** passes in CI.

Legend: **[U]** unit · **[I]** integration · **[C]** component · **[E]** e2e · **[A]** a11y/automated · **[S]** statistical/property · **[V]** visual · **[Sec]** security · **[Eval]** scored eval

---

## 1. Engine — the referee (highest priority)

- [x] [U] All 24 Elder Futhark runes load
- [x] [U] Every rune is a unique (element, power, color) combination
- [x] [U] Trait counts match `rune-board.md` (element 4 each · power 4 each · fill 12/12 · color 4 each)
- [x] [U] Exactly one secret rune per round; a new round reseeds (a refresh resumes the same round — see S2.5)
- [x] [U] Element / power / fill / hue queries resolve truthfully (table-driven, all 24 × all axes)
- [x] [U] Power ranges correct at boundaries — "fewer than N", "at least N", "N or more", exact (1 and 6 inclusive)
- [x] [U] Single-rune query eliminates exactly that rune; yes only for the secret
- [x] [U] **Only the secret wins a Cast; every other rune fails**
- [x] [U] Wrong cast = wasted turn, round continues (never ends game)
- [x] [U] Engine accepts a Cast of a crossed-off rune; never validates against crossings
- [x] [U] Mixed-type / malformed queries flagged invalid; a repeated question is allowed (resolves again, not an error)
- [x] [U] Refused/invalid Ask does **not** consume the turn; resolved Ask does
- [x] [Sec] No engine path returns the secret before a correct cast
- [x] [U] Strict alternation, human-first; out-of-order Ask/Cast rejected
- [x] [U] Scry returns same answer to rival; Hex suppresses answer + spends turn; Cast never interruptible _(S5)_
- [x] [U] Per-player wrong-cast counter increments from v1 (threshold unused until v2)

## 2. Oracle pipeline (Gemini, Role 1)

- [x] [I] Free-text maps to exactly one query type; multi-type intent rejected, not split _(the free-text→query mapping is eval-gated — see the `[Eval]` row; structural mixed-type rejection is CI-proven in `queries`)_
- [ ] [C] Echo matches the resolved query, shown **before** the answer; interpreted query stands (no do-over) _(echo string is produced + tested in `oracle.test` [I]; no UI renders it yet — the echo is the rival's-Ask surface, S5/S6)_
- [x] [C] Both verdicts restate the trait (Yes "is reaching for", No "is not reaching for"); `{value-phrase}` fills per axis
- [x] [C] Mixed-type refusal returns `ux-copy.md` line; turn not consumed
- [x] [Sec] Secret-seeking Ask refused; secret never leaks
- [x] [Sec] Prompt-injection / override stays in character, refuses
- [x] [C] Negated Ask ("is it not fire?") refused with the negation line; turn not consumed
- [x] [C] Unparseable / not-a-question refusal; turn not consumed
- [x] [C] Empty submit refused with "Speak your question, witch." (nothing sent)
- [x] [I] Resolved Ask consumes turn; every refusal class does not
- [x] [Eval] ~40-phrasing corpus scored for correct query-type / refusal-class _(live Gemini — manual/offline, intentionally out of deterministic CI; phrases in `oracle-eval-corpus.md`)_

## 3. Sköll — opponent + deterministic floor

**Referee / leash**

- [ ] [Sec][I] Sköll's tool-call inputs contain only earned state — never the secret, never the human's crossings
- [ ] [I] Illegal/malformed Sköll calls rejected (bad rune, mixed-type, out-of-turn); re-asking is legal play (not rejected) — the floor avoids redundant/non-splitting questions for move quality
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

- [x] [I] Ask vs Cast distinct (Ask never wins, Cast never asks)
- [x] [C] Cross/restore works during player's turn **and** Sköll's turn; persists across turns
- [x] [C] Ask + Cast disabled during Sköll's turn; cross-off stays enabled; acting shows "The wolf is moving. Hold."
- [x] [C][E] Arm flow: "Cast the rune" arms mode; armed tap **selects target** (no cross-off); chrome "Cast?"
- [x] [C][E] "Name it" commits; "Not yet" cancels with **no turn spent**
- [x] [C] Two scoped card behaviors (cross-off vs select-target) never collide
- [x] [E] Wrong cast costs turn only; crossings + round state preserved
- [ ] [E][A] Full keyboard cast path: arm → arrow → select → "Name it" _(S10 a11y)_
- [x] [C] Pre-Ask panel reads "Twenty-four runes stand. None ruled out. Ask the Oracle."

## 4.5 Round lifecycle & session isolation (S2.5)

- [x] [U] Parallel sessions isolated — one session's round never moves another's (engine + `api/action` endpoint)
- [x] [U] A refresh resumes the same round (same secret); resume is isolated per session
- [x] [U] `POST /api/new-game` resets **only** the calling session to a fresh active round + new board seed
- [x] [U] Session registry LRU-capped — never grows past the cap; an idle round is evicted, a touched (active) one survives
- [x] [U] Session cookie reused when present, generated when absent, regenerated when empty; `secure` outside dev

## 5. Reactions — Scry & Hex

- [x] [I] Each reaction once per player per round; spent reaction unavailable after (no "spent" copy)
- [x] [I] Offered on an Ask's window; **never** on a Cast _(cast-sacredness structural — a Cast leaves no window; the rival's-Ask echo surface lights up in S6)_
- [x] [I] At most one reaction per interrupt window; Hex leaves no answer for Scry
- [x] [I] Scry → rival also receives private answer
- [x] [I] Hex → question dies, no answer to anyone _(kill + no-answer tested in S5; the asker's turn-spend on a hexed Ask lands with S6's hexed-Ask orchestration — the window now precedes the answer, so the Ask is never resolved on a Hex)_
- [x] [C] Human prompt "Sköll asks. Answer it?" → Scry / Hex / Let it pass per `ux-copy.md`
- [ ] [I] Sköll's reaction is refereed Gemini response with deterministic-floor fallback _(S6 — Sköll's live Ask/reaction)_

## 6. UI / graphics presentation

- [x] [V] Rune grid renders as DOM components orchestrated by GSAP; 24 cards 6×4 _(functional 6×4 render is [C]-covered in `RuneGrid.svelte.test` + [E] in `board.e2e`; high-fidelity art assets + visual-regression baselines split to v1.5)_
- [x] [C] Each card shows glyph, swatch, name + meaning, power as a row of pips (count = power, no numeral), element symbol + name, color name (rune id not shown; light/dark encoded by pip color — white light / black dark; pip count + fill spoken in the accessible name as "{n} light/dark power", never as visible text)
- [x] [A] Color name + element name accompany icons — nothing by color alone
- [x] [C] Card dims in place when crossed; restore affordance works
- [x] [C] Header: title, tagline, night-progress, turn pill ("Your move." / "Sköll moves.")
- [x] [C] Round resolved: header swaps the moon → risen sun on a human win, holds the moon on a Sköll win, with the short resolution tag; the outcome pill flips and the Oracle panel carries the full resolution line
- [ ] [V] Visual regression snapshots for grid + crossed/armed states _(→ v1.5 with the separate graphics layer; v1 captures state screenshots as e2e artifacts only — no pixel-diff baselines)_

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

- [ ] [I][E] Connection/engine error shown in-world ("The Oracle falls silent…") **without losing crossings or turn state**
- [x] [C] Empty submit refused with "Speak your question, witch."
- [x] [E] Below the 1280px minimum: best-on-desktop notice — no responsive reflow (1024px support is v2) _(e2e at 1024px asserts the notice shows and the rite is hidden; 1440px asserts the reverse)_
- [x] [I] Invalid Ask costs only the rephrase, never a false answer
- [x] [S] Every seeded round winnable through legal Asks; Oracle never lies (fuzz across secrets/seeds)

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

- [x] **Engine** — line **100%** / branch **95%**
- [ ] **Deterministic fallback policy** — line **95%** / branch **90%**
- [x] **Action interface** — line **90%** / branch **85%**
- [x] **Oracle pipeline** — line **90%** / branch **85%**
- [x] **Reactions** — line **95%** / branch **90%**
- [x] **UI / interaction** — line **80%** / branch **70%**
- [ ] **Graphics render layer** — line **60%** _(→ v1.5: graphics is a separate layer; not a v1 gate. Functional render is covered under the components gate at 80/70)_
- [x] **Project overall** — line **85%** / branch **80%**

## Enforced non-coverage gates (CI)

- [ ] Lighthouse accessibility ≥ 0.95 (target ≈ 1.0)
- [x] Round-solvability property test passes across all seeds
- [ ] Secret-leak security assertion (engine API + Sköll payload)
- [ ] Voice/terminology lint — zero diegetic violations

## High-risk gaps — do not skip

- [ ] Weighted-random vs argmax statistical test present and passing (§3)
- [x] Turn-accounting-on-refusal covered for **every** refusal class (§2)
- [x] Crossed-rune cast legality covered (§1)
- [x] Cast sacredness: reactions never offered on a Cast (§5)
- [ ] Degradation **fairness** (solvable), not just renders (§8)
- [ ] Secret never present in Sköll's payload (§3)

## Build-order alignment

- [x] Engine suite lands with engine
- [x] Oracle suite lands with Oracle
- [x] Human-loop + win/cast suites land with that module
- [x] Reactions suite lands with reactions
- [ ] Opponent (Gemini + floor) suite lands with opponent
- [ ] Integration + E2E follow once action interface is stable
- [ ] a11y + degradation E2E gate the v1 jam build (June 21)
