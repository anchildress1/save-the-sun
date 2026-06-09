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
- [x] [C] Echo matches the resolved query, shown **before** the answer; interpreted query stands (no do-over) _(the rival's-Ask echo surface lit up in S6 — Sköll's Ask renders `skoll-echo` before its post-reaction answer; the human's own Ask shows no echo by design)_
- [x] [C] Both verdicts restate the trait (Yes "is reaching for", No "is not reaching for"); `{value-phrase}` fills per axis
- [x] [C] Mixed-type refusal returns `ux-copy.md` line; turn not consumed
- [x] [Sec] Secret-seeking Ask refused; secret never leaks
- [x] [Sec] Prompt-injection / override stays in character, refuses
- [x] [C] Negated Ask ("is it not fire?") refused with the negation line; turn not consumed
- [x] [C] Unparseable / not-a-question refusal; turn not consumed
- [x] [C] Empty submit refused with "Speak your question, witch." (nothing sent)
- [x] [I] Resolved Ask consumes turn; every refusal class does not
- [x] [Eval] ~40-phrasing corpus scored for correct query-type / refusal-class _(live Gemini — manual/offline, intentionally out of deterministic CI; phrases in `oracle-eval-corpus.md`)_
- [x] [Eval] "Is the power white/black?" reads as the **fill** axis (white→Light, black→Dark via the power pips); a bare "is it black?" stays the Black hue _(verified live against gemini-3.5-flash; in `oracle-eval-corpus.md`)_

## 3. Sköll — opponent + deterministic floor

**Referee / leash**

- [x] [Sec][I] Sköll's tool-call inputs contain only earned state — never the secret, never the human's crossings _(payload built from his state, not the engine — secret structurally unreachable)_
- [x] [I] Illegal/malformed Sköll calls rejected (bad rune, malformed query) → floor; re-asking is legal play (not rejected) — the floor avoids redundant/non-splitting questions for move quality
- [x] [U] Board passed as JSON in fixed (canonical) order; payload asserted not pre-sorted
- [x] [I] Sköll cross-off mutates only his private sheet; traceable in debug log _(restore unwired — he only accumulates)_
- [x] [I] Wrong Sköll cast wastes only his turn; round continues

**Deterministic fallback (weighted-random, NOT argmax)**

- [x] [I] Floor fires only on Gemini error/timeout/illegal — never on a legal-but-suboptimal move
- [x] [U] Candidate set = legal well-formed queries over live candidates; excludes asked + non-splitting (all-yes/all-no)
- [x] [U] Split score = `1 / (1 + |yes − n/2|)`, verified on hand-computed sets
- [x] [S] **Best splitter most frequent, every legal splitter non-zero — asserted NOT argmax**
- [x] [U] Medium peaking — the score curve is the only peaking (no difficulty hardening in v1)
- [x] [U] Casts when one candidate remains; else casts best remaining when no splitter exists
- [x] [U] Same seed + state → same sampled move (reproducible)

**Opening hunch (seeded — varies the otherwise-constant first move)**

- [x] [U] Per-round hunch is deterministic per seed and varies across seeds — the opener is not pinned to one trait
- [x] [U] Hunch is trait-level (colour/element) — never a rune by name (can't echo the secret), never light/dark (the prompt forbids that clean-split opener)
- [x] [I] Hunch is surfaced to Gemini **only** on the opening move (no facts yet); once a fact exists the hunch value is absent from the prompt entirely (not just the sentence)

**Persona (eval, low gate)**

- [ ] [Eval] ~12-year-old behavior: one clue at a time, works from board + own cross-offs, may overlook a legal elimination, casts on "sure enough"; computation tells flagged as failures _(live-LLM eval, not a CI gate — deferred with the Oracle's eval harness)_

## 4. Human loop & action interface

- [x] [I] Ask vs Cast distinct (Ask never wins, Cast never asks)
- [x] [C] Cross/restore works during player's turn **and** Sköll's turn; persists across turns
- [x] [C] Ask + Cast disabled during Sköll's turn; cross-off stays enabled; acting shows "The wolf is moving. Hold."
- [x] [C][E] Arm flow: "Cast the rune" arms mode; armed tap **selects target** (no cross-off); chrome "Cast?"
- [x] [C][E] "Name it" commits; "Not yet" cancels with **no turn spent**
- [x] [C] Two scoped card behaviors (cross-off vs select-target) never collide
- [x] [E] Wrong cast costs turn only; crossings + round state preserved
- [x] [E][A] Full keyboard cast path: arm → select → "Name it" _(the cards are native buttons navigated by Tab/activated by Enter/Space — no arrow roving; `a11y.e2e`)_
- [x] [C] Oracle panel opens **blank** — voices a response only (answer/refusal/resolution), no idle filler

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
- [ ] [C] Human prompt "Sköll asks. Answer it?" → Scry / Hex / Let it pass _(→ v2: the visible prompt heading is cut pending a reaction-UI redesign; v1 shows only the buttons under an SR-only group label)_
- [x] [I] Sköll's reaction is refereed Gemini response with deterministic-floor fallback _(both directions live: the human reacts to his Ask, and Sköll (Gemini, floor = Pass) reacts to hers — Hex before any answer, Scry as his earned fact)_

## 6. UI / graphics presentation

- [x] [V] Rune grid renders as DOM components orchestrated by GSAP; 24 cards 6×4 _(functional 6×4 render is [C]-covered in `RuneGrid.svelte.test` + [E] in `board.e2e`; high-fidelity art assets + visual-regression baselines split to v1.5)_
- [x] [C] Each card shows glyph, swatch, name + meaning, power as a row of pips (count = power, no numeral), element symbol + name, color name (rune id not shown; light/dark encoded by pip color — white light / black dark; pip count + fill spoken in the accessible name as "{n} light/dark power", never as visible text)
- [x] [A] Color name + element name accompany icons — nothing by color alone
- [x] [C] Card dims in place when crossed; restore affordance works
- [x] [C] Header: title, tagline, night-progress; turn pill ("Your move." / "Sköll moves.") sits at the top of the Oracle panel, beside the controls it gates _(moved off the header in S7)_
- [x] [C] Round resolved: header swaps the moon → risen sun on a human win, holds the moon on a Sköll win, with the short resolution tag; the outcome pill flips and the Oracle panel carries the full resolution line
- [ ] [V] Visual regression snapshots for grid + crossed/armed states _(→ v1.5 with the separate graphics layer; v1 captures state screenshots as e2e artifacts only — no pixel-diff baselines)_

## 6.5 Title screen & first-run onboarding (R7 / S7)

- [x] [C] Title screen: title, tagline, primary "Light the fire.", secondary "How the rite works"
- [x] [C][E] First-run onboarding steps 1–5 copy (stakes · Ask · read & cross · Cast · Scry & Hex), one concept per step, board visible behind each coach-mark
- [x] [C][E] Step 1 ("the stakes") is a centered intro — no board highlight; steps 2–4 spotlight the Ask, then the board ("read & cross"), then the Cast; an anchorless step falls back to a centered popover
- [x] [C][E] Skip path exits cleanly mid-tour; the final step "Take up the runes." dismisses
- [x] [C][E] First-run gate: shown once, dismissal remembered (localStorage), not re-shown for a returning player — survives a real reload
- [x] [C][E] Persistent "How the rite works" (header) reopens the tour directly, skipping the title
- [x] [C][A] Modal focus management: focus moves into the dialog on open, Tab is trapped (wraps both ends), Escape exits — the board/header behind stays untabbable while open
- [x] [E] Board e2e seeds the onboarded flag so the first-run overlay never blocks board interaction

## 6.7 Asset delivery pipeline (v2 future work)

- [ ] [V][manual] Cleanup: all generated image assets align to one stable stylized art direction before new format variants ship
- [ ] [C][E] AVIF/WebP fallbacks load for large stone, banner, chalk, rune, element, color, and fill assets; PNG/JPEG fallback remains available
- [ ] [E] Responsive image variants are requested when the same art renders at materially different sizes
- [ ] [CI] Bundle-size budget fails when first-load image weight or total client assets exceed the v2 budget

## 7. Accessibility (v1; screen reader = v1.5)

- [x] [E][A] Whole round operable by keyboard (ask, cross, arm, select, cast, react) with a visible focus indicator; Tab is never trapped on the grid _(`a11y.e2e`)_
- [x] [A] Controls have accessible names/roles (axe-clean on every surface: board, crossed/armed, title, tour, reaction prompt, both end screens) _(`a11y.e2e`)_
- [x] [A] WCAG 2.1 AA contrast across light **and** dark palettes (axe `wcag21aa` color-contrast — both rune palettes are on the board at once) _(`a11y.e2e`)_
- [x] [A][manual] No information by color alone
- [x] [C][E] `prefers-reduced-motion` → motion instant (entrance + end-screen rise cut), no audio to unmute (v1 ships none), still reflects live state _(`reducedMotion.svelte.test`, `degradation.e2e`)_
- [x] [E] At 200% zoom the effective width falls below the 1280px floor → the best-on-desktop notice shows (no reflow, per the width rules) — the same below-minimum path as §9; full in-game operability at 200% zoom waits on v2 responsive (1024px) support
- [ ] [A][CI] Lighthouse a11y ≥ 0.95 (target ≈ 1.0) _(not added — the global no-lhci-in-GHA rule stands; the in-CI a11y gate is the axe sweep above, run in the existing e2e step and failing the build on any violation. `lhci autorun` stays local via `make perf`.)_
- [ ] _(v1.5, not gated)_ Screen-reader: `aria-live="polite"`, per-card traits, turn-change announcements

## 8. Degradation tiers

- [x] [E] Plain (v1): full round winnable on static grid
- [x] [E] Reduced: reduced-motion → instant changes, muted (no audio in v1), static, game unaffected + fair (a full round is winnable with motion cut) _(`degradation.e2e`; WebGL is not a v1 layer — GSAP DOM motion is the only mood, so reduced-motion is the reduced tier)_
- [ ] [E] Full (v2, when built): tide + stingers + audio (muted by default); mood off mid-round leaves game fully playable
- [x] [S] Fairness invariant: with all mood off/failed, every round winnable through legal Asks alone

## 9. Error handling & edge states

- [x] [I][E] Connection/engine error shown in-world ("The Oracle falls silent…") **without losing crossings or turn state**
- [x] [C] Empty submit refused with "Speak your question, witch."
- [x] [E] Below the 1280px minimum: best-on-desktop notice — no responsive reflow (1024px support is v2) _(e2e at 1024px asserts the notice shows and the rite is hidden; 1440px asserts the reverse)_
- [x] [I] Invalid Ask costs only the rephrase, never a false answer
- [x] [S] Every seeded round winnable through legal Asks; Oracle never lies (fuzz across secrets/seeds)

## 10. Debug view (S8)

- [x] [I] Engine fact vs LLM inference cleanly separated: a verdict is the ENGINE's (`owner: Engine, kind: deterministic`), never the actor's; a human Ask splits into her `input`, the Oracle's `llm` reading, and the engine's `deterministic` verdict
- [x] [I] A floored Sköll move is `kind: deterministic` + `level: warn` (not a message string)
- [x] [U] Per-session event stream: seq, bounded trim, session isolation; lifecycle-linked — reset on a new round (reseeded with the new secret) **and** evicted with the session
- [x] [U][I] `DEBUG_LOG` verbose / demo / off — demo strips `sensitive` (the secret + raw model I/O), off disables; default verbose in dev / demo on deploy (the public `/debug` view is the demo); filtered server-side (`/api/debug` + page load)
- [x] [I][U] Raw Gemini I/O captured (verbose) as a sensitive event, **per session** (AsyncLocalStorage — no cross-session bleed), via a cycle-safe snapshot so neither the API nor the load 500s
- [x] [I] Sköll's move event shows the cross-offs made **this** turn (the delta), consistent with the pre-move reasoning
- [x] [C] Cards coloured by **owner** (Human / Oracle / Sköll — incl. his raw Gemini calls — / Engine), badged by **kind** (`input` / `llm` / `deterministic`; Sköll's gemini move = llm, floor = deterministic), chipped by **part** (Ask / Cast / React / Round)

## 10.5 View resume on reload (S8.5)

- [x] [U] Per-round token: stable across a refresh (same round), regenerated on a new round, isolated per session, evicted with the engine; opaque (uuid-shaped) and not the secret seed
- [x] [U] Load + `POST /api/new-game` surface the token; stable while `boardSeed` reshuffles, fresh after a reset, and the response carries no secret-bearing field
- [x] [U] `viewState` round-trip + round-scoping: a read for a different round returns null; empty round id no-ops; malformed/corrupt records and `localStorage` throws degrade to null, never throw
- [x] [C] Crossings restore onto the matching runes on a resumed round; a stale-round record never restores onto a fresh secret
- [x] [C] Voiced Oracle line restores on load; a blank stored line never overwrites a server-derived one
- [x] [C] RuneGrid seeds restored crossings once (no re-seed after a user edit, no report-back), and reports the full crossed-id set up on every cross/restore
- [x] [C] A new game re-keys the persisted view to the new round and drops the old crossings; a new-game response missing the token fails loud, never mis-keys
- [x] [C] Sköll's transient stall line is **not** persisted — storage keeps the last good line so a reload (which re-drives his move) resumes a coherent view, not a dead end
- [x] [C] Storage-read failure (private mode) degrades to no restore — board renders, play stays live
- [x] [E] Cross a rune + earn a voiced line, then a real reload restores both over the resumed round; the crossing rides through the board reshuffle (keyed by rune id)
- [ ] [I] Automated cross-check that the restored marks + line agree with the **debug log** for the same round _(→ v2: the debug log runs as a separate unlinked stream; v1 proves view ↔ round agreement, the log ↔ view cross-check is a manual demo observation until then)_

## 11. Voice / copy conformance (lint + eval, not coverage-gated)

- [ ] [A] No emoji in diegetic copy; no exclamation in any diegetic line (Sköll's cast line — the old winning-cast exclamation allowlist — was cut)
- [ ] [A] Banned arcade/idiom strings absent ("Correct!/Wrong!", "Play again", "Game over", "?"-only CTAs)
- [ ] [A] World-noun terminology enforced (rune, Ask/Cast, power, light/dark, hue, Scry/Hex — never "card")
- [ ] [Eval] Sampled Oracle vs Sköll lines attributable to correct speaker
- [x] [C] Sköll's box shows only his templated Ask (no taunts, no cast lines); blank when he isn't asking

---

## Enforced coverage gates (CI — PR fails below floor)

- [x] **Engine** — line **100%** / branch **95%**
- [x] **Deterministic fallback policy** — line **95%** / branch **90%**
- [x] **Action interface** — line **90%** / branch **85%**
- [x] **Oracle pipeline** — line **90%** / branch **85%**
- [x] **Reactions** — line **95%** / branch **90%**
- [x] **UI / interaction** — line **80%** / branch **70%**
- [ ] **Graphics render layer** — line **60%** _(→ v1.5: graphics is a separate layer; not a v1 gate. Functional render is covered under the components gate at 80/70)_
- [x] **Project overall** — line **85%** / branch **80%**

## Enforced non-coverage gates (CI)

- [ ] Lighthouse accessibility ≥ 0.95 (target ≈ 1.0) _(not gated in GHA — no lhci per the global rule; the axe e2e sweep is the in-CI a11y gate. lhci stays local via `make perf`.)_
- [x] Round-solvability property test passes across all seeds
- [x] Secret-leak security assertion (engine API + Sköll payload)
- [ ] Voice/terminology lint — zero diegetic violations

## High-risk gaps — do not skip

- [x] Weighted-random vs argmax statistical test present and passing (§3)
- [x] Turn-accounting-on-refusal covered for **every** refusal class (§2)
- [x] Crossed-rune cast legality covered (§1)
- [x] Cast sacredness: reactions never offered on a Cast (§5)
- [x] Degradation **fairness** (solvable), not just renders (§8) _(covered by the in-CI solvability/fairness property test — §8 "Fairness invariant" + the round-solvability gate; v1 is Plain-tier, so "all mood off" is the only state)_
- [x] Secret never present in Sköll's payload (§3)

## Build-order alignment

- [x] Engine suite lands with engine
- [x] Oracle suite lands with Oracle
- [x] Human-loop + win/cast suites land with that module
- [x] Reactions suite lands with reactions
- [x] Opponent (Gemini + floor) suite lands with opponent
- [x] Integration + E2E follow once action interface is stable
- [x] a11y + degradation E2E gate the v1 jam build (June 21) _(axe sweep + keyboard round + reduced-motion/degradation run in the CI e2e step; `a11y.e2e`, `degradation.e2e`)_
