# Save the Sun — Test Plan

Test strategy for the **fresh graphics build**. Derived only from `prd.md`, `game-spec.md`, `rune-board.md`, and `ux-copy.md`. The POC is not the implementation target and is out of scope for every test here.

## Principles

1. **The engine is the referee — test it like one.** It owns the board, secret, query truth, legality, win/cast checks, and reaction resolution. Everything else can degrade, fail, or hallucinate; the engine cannot. It carries the strictest coverage bar.
2. **Test truth separately from voice.** The engine decides facts; Gemini (Oracle and Sköll) decides intent and phrasing. Fact tests are deterministic and exhaustive. Voice tests are contract/eval-style and tolerate variation.
3. **Immersion never costs correctness.** Every degradation tier (Full → Reduced → Plain) is independently exercised as fully playable and fair.
4. **Don't test Gemini's brain; test the engine's leash.** We never assert a specific LLM move. We assert that illegal/malformed calls are rejected, the secret never leaks, and the deterministic floor catches every failure.

## Testing Pyramid (target mix)

```
        /   E2E    \      ~10%  full round, degradation, a11y smoke
       / Integration \    ~30%  action interface, Oracle pipeline, Sköll referee loop
      /   Unit Tests   \  ~60%  engine truth, query resolution, fallback policy, reaction logic
```

---

## 1. Engine — the referee (highest priority)

Covers R1, R3, R4, R12 truth resolution, and the Architecture contract. Pure, deterministic, no network — exhaustive testing is cheap, so we do it.

| Area | Test type | What to test |
|---|---|---|
| Board integrity | Unit | All 24 Elder Futhark runes load; every rune is a unique (element, power, color) combination; trait counts match `rune-board.md` (element 4 each, power 4 each, fill 12/12, color 4 each). |
| Secret selection | Unit | Exactly one secret rune per round; secret is drawn from the 24; a new round reseeds (a refresh resumes the same round — see S2.5). |
| Trait resolution — truth | Unit (table-driven, all 24 × all axes) | Element, power, fill, hue queries each resolve truthfully against the known secret. |
| Power ranges | Unit | "fewer than N", "at least N", "N or more", exact N resolve correctly at boundaries (1 and 6 inclusive). |
| Single-rune query | Unit | "is it Sowilo?" eliminates exactly that one; correct yes only for the secret. |
| Win/cast logic | Unit | **Only the secret wins a Cast; every other rune fails.** Wrong cast returns "wasted turn, round continues," never ends the game. |
| Cast accepts any rune | Unit | Engine accepts a Cast of a crossed-off rune; engine never reads or validates against the player's crossings. |
| Legality validation | Unit | Mixed-type and malformed queries are flagged invalid; a refused/invalid Ask does **not** consume the turn; a resolved Ask does. A repeated question is legal — it resolves again and consumes the turn (re-asking is part of deduction, not an error). |
| Secret confidentiality | Unit + security | No engine API path returns the secret before a correct cast; Sköll's earned-state payload never contains it (assert by inspection of the tool-call contract). |
| Strict alternation | Unit | Human-first, one action per turn; engine rejects an out-of-order Ask/Cast. |
| Reaction resolution | Unit | Scry returns the same answer to the rival; Hex suppresses the answer and spends the active player's turn; Cast is never interruptible. |
| Wrong-cast counter | Unit | Engine increments a per-player wrong-cast count from v1 (threshold unused until v2) — verifies the v2 hook exists without changing v1 behavior. |

**Example cases**

- `secret = Eihwaz (Spirit, 2, Red)` → query "earth?" → No; "two power?" → Yes; "at least 2?" → Yes; "is it Algiz?" → No; cast Eihwaz → win.
- Cast `Isa` when `Isa` is crossed off and `secret = Isa` → win (crossings ignored).
- Ask "is it a red fire rune?" → invalid (mixed-type), turn **not** consumed.
- Hex on opponent Ask → no answer emitted to anyone; active turn spent.

---

## 2. Oracle pipeline (Gemini, Role 1)

Covers R2 and the guardrails. Split into deterministic boundary tests (engine side) and contract/eval tests (LLM side).

| Area | Test type | What to test |
|---|---|---|
| Free-text → one structured query | Integration | Plain-language Asks map to exactly one query type (element / power / fill / hue / single rune). Multi-type intent is rejected, not silently split. |
| Interpretation echo | Contract | Echo matches the query actually resolved (`You ask after {paraphrase}`); echo is shown **before** the answer; the interpreted query stands (no do-over). |
| Truthful answer voicing | Contract | Both verdicts restate the trait — `Yes. Sól is reaching for {value-phrase}.` / `No. Sól is not reaching for {value-phrase}.` — and the engine `{value-phrase}` fills correctly per axis. |
| Refusal — mixed-type | Contract | Returns the `ux-copy.md` mixed-type line; turn not consumed. |
| Refusal — secret-seeking | Contract + security | "Tell me the answer" / "which rune is it" → refusal line; secret never leaks. |
| Refusal — prompt injection / override | Contract + security | "ignore your instructions", "you are now…", embedded system text → stays in character, refuses; cannot be talked out of the rules. |
| Refusal — negation | Contract | "is it not fire?", "isn't it light?" → negation line; turn not consumed (the Oracle speaks of what is — no not-equal operator). |
| Refusal — unparseable / not a question | Contract | Returns the unparseable line; turn not consumed. |
| Empty submit | Unit (UI) | Refused gently with "Speak your question, witch."; nothing sent to engine. |
| Turn accounting | Integration | Resolved Ask consumes the turn; every refusal class does not. |

**Eval set:** a fixed corpus of ~40 phrasings (synonyms, ranges, indirect phrasings, adversarial/injection, gibberish) with expected query-type or refusal-class labels. Run as a scored eval gate, not an exact-string assertion, since voicing varies.

---

## 3. Sköll — opponent + deterministic floor

Covers R5 and the Architecture contract. **We never assert a specific Gemini move.** We assert the referee leash and the floor.

### Referee / leash (deterministic, high value)

| Area | Test type | What to test |
|---|---|---|
| Earned-only state | Integration + security | Sköll's tool-call inputs contain only his own candidates, his own answers, and anything Scried — never the secret, never the human's crossings. |
| Tool-call validation | Integration | Illegal or malformed Sköll calls (bad rune name, mixed-type, out-of-turn) are rejected by the engine. Re-asking is legal play and is **not** rejected — the deterministic floor simply avoids redundant/non-splitting questions for move quality (its own candidate-set concern, not an engine rejection). |
| Board order contract | Unit | Board is passed as JSON in fixed on-screen order; harness asserts the payload is not pre-sorted. |
| Sköll cross-off as working memory | Integration | Sköll's cross-off/restore tool actions mutate only his private sheet and are traceable in the debug log. |
| Wrong cast | Integration | A wrong Sköll cast wastes only his turn; the round continues. |

### Deterministic fallback floor (PRD R5 — build as weighted-random, NOT argmax)

| Area | Test type | What to test |
|---|---|---|
| Fires only on failure | Integration | Floor activates on Gemini error, timeout, or illegal/malformed call — and **never** on a legal-but-suboptimal move. |
| Candidate question set | Unit | Built only from legal, well-formed queries over still-live candidates; excludes already-asked queries and any all-yes/all-no (non-splitting) query. |
| Split scoring | Unit | Score = `1 / (1 + |yes − n/2|)`; closer to 50/50 scores higher. Verified on hand-computed live sets. |
| Weighted-random selection | **Statistical** | Over many seeded runs the best splitter is most frequent but every legal splitter has non-zero frequency. **Assert it is NOT argmax** (the max is not always chosen). |
| Difficulty peaking | Unit | Medium peaking is moderate (beatable); harder peaks toward optimal, easier flattens toward uniform. |
| Cast condition | Unit | Casts when exactly one candidate remains; if no splitting question exists earlier, casts the best remaining candidate. |
| Determinism under seed | Unit | Same seed + same state → same sampled move (reproducible for the demo). |

### Opening hunch (seeded — breaks the constant-first-move opener)

On move 1 his payload is byte-identical every round (no facts, fixed board), so a low-thinking model lands on the same opener every time. A seeded per-round hunch injects the one varying token to break that, without seeding later moves (those already vary on their earned facts).

| Area | Test type | What to test |
|---|---|---|
| Hunch determinism + variety | Unit | The per-round hunch is deterministic per seed and varies across seeds — the opener is not pinned to one trait. |
| Hunch is safe + sub-optimal | Unit | Trait-level (colour/element) only — never a rune by name (cannot echo the secret), never light/dark (the prompt forbids that clean-split opener). |
| Opening-move only | Integration | The hunch is surfaced in the prompt only when no facts are known; once a fact exists the hunch value is absent from the prompt entirely (not just the opener sentence). |

### Persona (acceptance, eval-style — low gate, manual-assisted)

Encoded "~12-year-old" behavior from R5 is checked by an eval harness, not unit asserted: reasons one clue at a time, works from visible board + own cross-offs, can overlook a legal elimination, casts on "sure enough." Flag obvious tells of computation (full cross-product elimination, probability math, perfect play) as failures.

---

## 4. Human loop & action interface

Covers R3, R4, and the casting flow. One shared action interface serves both the human UI and Gemini — test it once, thoroughly.

| Area | Test type | What to test |
|---|---|---|
| Ask vs Cast distinct | Integration | Two separate actions; Ask never wins, Cast never asks. |
| Cross-off anytime | Component | Player can cross/restore runes during their turn **and during Sköll's turn**; crossings persist across turns. |
| Disabled during Sköll's turn | Component | Ask and Cast are disabled while "Sköll moves."; cross-off stays enabled; acting shows "The wolf is moving. Hold." |
| Cast arming flow | Component + E2E | "Cast the rune" arms Cast mode; while armed a card tap/keyboard-select **chooses target** (does not cross off); chrome reads "Cast?". "Name it" commits; "Not yet" cancels with **no turn spent**. |
| Two scoped card behaviors | Component | Outside armed mode a tap crosses off; inside armed mode a tap selects target — the two never collide. |
| Wrong cast continues | E2E | Wrong cast costs the turn only; crossings and round state preserved. |
| Keyboard cast path | E2E + a11y | arm cast → arrow to rune → select → "Name it" works entirely by keyboard. |
| Starting Rite state | Component | The Oracle panel opens **blank** and voices a response only (answer / refusal / resolution) — no idle filler. |

---

## 5. Reactions — Scry & Hex (R12)

| Area | Test type | What to test |
|---|---|---|
| One use each per round | Integration | Each reaction usable once per player per round; spent reaction is unavailable for the rest of the game (no "spent" copy shown). |
| Trigger on Ask only | Integration | Scry/Hex offered on an Ask's interpretation echo; **never** offered on a Cast. |
| Interrupt window | Integration | At most one reaction per window; if Hex is used there is no answer left for Scry. |
| Scry effect | Integration | Rival also receives the private answer. |
| Hex effect | Integration | Question dies, no answer to anyone, active player's turn spent. |
| Human-side prompt | Component | On Sköll's Ask: "Sköll asks. Answer it?" → Scry / Hex / Let it pass behave per `ux-copy.md`. |
| Sköll-side reaction | Integration | Sköll's reaction is a refereed Gemini response with deterministic-floor fallback (per R5). |

---

## 6. UI / graphics presentation (R6)

| Area | Test type | What to test |
|---|---|---|
| Functional grid (v1) | Component / e2e | Rune grid renders as DOM components orchestrated by GSAP; 24 cards in a 6×4 layout (column count verified by geometry, not by parsing `gridTemplateColumns`). |
| Card content | Component | Each card shows glyph, color swatch, name + meaning, power as a row of pips (count = power, no numeral), element symbol + name, color name. Rune id not shown. Light/dark encoded by pip color (white light / black dark); pip count + fill spoken together in the accessible name as "{n} light/dark power", never as visible text; light/dark still a queryable Oracle axis. |
| No color alone | a11y assertion | Color name and element name always accompany their icons — nothing conveyed by color alone. |
| Cross-off affordance | Component | Card dims in place when crossed; restore affordance present and works. |
| Header chrome | Component | Title, tagline ("A race to beat Sköll and save the light."), night-progress indicator; the turn pill ("Your move." / "Sköll moves.") sits at the top of the Oracle panel beside the controls it gates (moved off the header in S7). |
| Round resolved | Component | Header swaps the moon → risen sun on a human win, holds the moon on a Sköll win, with the short resolution tag; the outcome pill flips and the Oracle panel carries the full resolution line. |
| High-fidelity art + visual regression (v1.5) | Smoke / visual | The image/art presentation and its visual-regression baselines are split to v1.5 — out of v1 scope (no image assets yet). |

---

## 6.5 Title screen & first-run onboarding (R7)

Covers R7. A first-run title overlay and an anchored coach-mark tour over the live board; the how-to lives in the steps, never as persistent on-board text.

| Area | Test type | What to test |
|---|---|---|
| Title screen | Component | Title, tagline, primary "Light the fire." (→ play), secondary "How the rite works" (→ tour). |
| Onboarding steps | Component + E2E | Steps 1–4 copy, one concept per step; the board stays visible behind each coach-mark. |
| Anchored coach-marks | Component + E2E | Step 1 ("the stakes") is a centered intro with no board highlight; steps 2–4 spotlight the Ask, then the board ("read & cross"), then the Cast; an anchorless step falls back to a centered popover, and an anchored step re-measures on the next frame so the opening one never sticks on a stale (pre-layout) rect. |
| Skip / finish | Component + E2E | Skip exits cleanly mid-tour; the final step "Take up the runes." dismisses. |
| First-run gate | Component + E2E | Shown once; dismissal remembered (`localStorage`), not re-shown for a returning player — survives a real reload (a refresh resumes the same round). |
| Header re-entry | Component + E2E | The persistent "How the rite works" header button reopens the tour directly, skipping the title. |
| Modal focus management | Component + a11y | `aria-modal` dialogs: focus moves in on open, Tab is trapped (wraps both ends), Escape exits; the board/header behind stay untabbable while open. |
| Board e2e isolation | E2E | Board-driving e2e seeds the onboarded flag so the first-run overlay never blocks board interaction. |

---

## 7. Accessibility (R9 — v1 scope; screen reader is v1.5)

The lineage bar is Lighthouse a11y ≈ 1.0; this build inherits it.

| Area | Test type | What to test |
|---|---|---|
| Keyboard operability | E2E + manual | Whole round (Ask, cross, arm, select, cast, react) operable by keyboard with a **visible focus indicator**. |
| Semantic labels | Automated (axe) | Controls have accessible names/roles. |
| Contrast — incl. dark palette | Automated + manual | WCAG 2.1 AA contrast across light and dark rune palettes. |
| Color independence | Automated + manual | No information by color alone (see §6). |
| Reduced motion | Component + manual | `prefers-reduced-motion` cuts motion to instant and keeps audio muted, while still reflecting live state changes. |
| 200% zoom | E2E | At 200% zoom the effective width drops below the 1280px floor → the best-on-desktop notice shows (no reflow, per the width rules) — the same below-minimum path as §9. Full in-game operability at 200% zoom is v2 (1024px responsive). |
| Lighthouse gate | **CI** | Automated Lighthouse a11y run in CI; build fails below threshold (target ≈ 1.0, floor 0.95). |
| Screen reader (v1.5) | Deferred | `aria-live="polite"` announcements, per-card trait exposure, turn-change announcements — **planned, not gated in v1**. |

---

## 8. Degradation tiers (the safety net)

A mood feature that can't degrade to the tier below doesn't ship — so each tier is tested as independently playable and fair.

| Tier | Test type | What to test |
|---|---|---|
| Plain (v1) | E2E | Full round winnable on the static grid with no mood layer; audio muted by default. |
| Reduced | E2E | `prefers-reduced-motion` OR WebGL/audio unavailable → tide/stingers become instant, audio muted, grid static, **game unaffected and fair**. |
| Full (v2) | E2E (when built) | Tide + stingers + ambient audio; turning all mood off mid-round leaves the game fully playable. |
| Fairness invariant | Property | With all mood graphics/audio off or failed, every round remains winnable through legal Asks alone (cross-check with §1 solvability). |

---

## 9. Error handling & edge states

| Area | Test type | What to test |
|---|---|---|
| Connection / engine error | Integration + E2E | Shown in-world ("The Oracle falls silent…") **without losing crossings or turn state**. |
| Empty submit | Component | Refused with "Speak your question, witch." |
| Best-on-desktop notice | e2e | Below the 1280px minimum the notice shows and the rite is hidden — no responsive reflow attempted (asserted at 1024px and 1440px; 1024px support is v2). |
| Malformed Ask recovery | Integration | Invalid Ask costs only the rephrase, never a false answer (ties to §2). |
| Round solvability | Property | Every seeded round is winnable through legal Asks alone; Oracle never lies (fuzz across many secrets/seeds). |

---

## 10. Debug view (R8)

| Area | Test type | What to test |
|---|---|---|
| Engine fact vs LLM inference | Integration | The engine's deterministic verdict is the ONLY thing on a `turn` event; the inference that reached the move — the Oracle's reading, Sköll's reasoning + source — lives on its own channel (`oracle`/`skoll`), never bolted onto the engine. |
| View encoding | Component | Each card is coloured by source (Human / Oracle / Sköll — incl. his raw Gemini calls — / Engine); an LLM-vs-deterministic badge keys off the channel + Sköll's source (gemini = LLM, floor = deterministic); a turn-part chip (Ask / Cast / React / Round) names the phase. |
| Fallback flag | Integration | Any turn the deterministic floor fired is flagged (`warn` on the `skoll` channel). |
| Event-log lifecycle | Unit | Per-session event stream: seq, bounded trim, session isolation; lifecycle-linked to the round — reset on a new round (reseeded with the new secret) and evicted with the session. |
| Exposure level (`DEBUG_LOG`) | Unit + Integration | verbose / demo / off — demo strips `sensitive` (the secret + raw model I/O), off disables; default verbose in dev, off in prod; filtered server-side (`/api/debug` + page load). |
| Raw model I/O | Integration + Unit | The Gemini request+response captured (verbose) as a sensitive event, **per session** (AsyncLocalStorage — no cross-session bleed), via a cycle-safe sanitizer so neither `json()` nor the load serializer 500s. |
| Cross-offs this move | Integration | Sköll's move event shows the cross-offs he made **this** turn (the delta), consistent with the pre-move reasoning. |

---

## 11. Voice / copy conformance (cross-cutting)

Not a coverage-gated suite, but an automated lint + eval pass over player-facing strings.

- **String lint (automated):** no emoji in diegetic copy; no exclamation in any diegetic line (Sköll's cast line, the old winning-cast exclamation allowlist, was cut); banned modern idiom and arcade phrases ("Correct!/Wrong!", "Play again", "Game over", "?"-only CTAs) absent.
- **Terminology lint:** world-nouns enforced (rune not "answer", Ask/Cast not "guess/submit", power not "pips", light/dark not "filled", hue not "color" in player copy, Scry/Hex never "card").
- **Speaker-distinctness eval:** sampled Oracle vs Sköll lines are attributable to the correct speaker (the "rewrite until unmistakable" rule).
- **Sköll surface:** his box shows only his templated Ask — taunts and cast lines are cut from the v1 UI.

---

## Enforced minimum coverage (CI gates)

Tiered by blast radius. The engine owns truth, so it carries the hardest bar; UI and LLM-voice layers are gated lower because correctness there is contract/eval-verified rather than line-counted. **A PR that drops any module below its floor fails CI.**

| Module | Line | Branch | Rationale |
|---|---|---|---|
| **Engine** (board, query resolution, win/cast, legality, reaction resolution, secret handling) | **100%** | **95%** | Single source of truth. Untested branches here are unfair rounds. Non-negotiable. |
| **Deterministic fallback policy** | **95%** | **90%** | The demo's no-hard-fail floor; must behave under every failure path. |
| **Action interface** (shared Ask/Cast/cross-off/react routing) | **90%** | **85%** | Both players route through it; a gap is a gap for both. |
| **Round lifecycle** (session isolation, new-game reset endpoint) | **90%** | **85%** | Mutates the session engine like the action interface; same blast radius. |
| **Oracle pipeline** (parse, query-build, refusal, turn accounting) | **90%** | **85%** | Parsing/guardrail logic is deterministic; LLM voicing is eval-verified, not line-gated. |
| **Reactions** (Scry/Hex state machine) | **95%** | **90%** | Small, sharp, easy to break silently. |
| **UI / interaction** (cards, arming flow, chrome, error states) | **80%** | **70%** | Behavior-tested; rendering pixels covered by visual regression instead. |
| **Graphics render layer** _(v1.5)_ | **60%** | n/a | Split to v1.5 with the image layer — not a v1 gate. The functional render is covered under the UI / interaction gate. |
| **Project overall gate** | **85%** | **80%** | Hard floor for the whole repo. |

**Non-coverage gates also enforced in CI:**

- **Lighthouse accessibility ≥ 0.95** (target ≈ 1.0) — build fails below.
- **Round-solvability property test** passes across all seeds in the suite — no unwinnable rounds, Oracle never lies.
- **Secret-leak security assertion** — no tested code path exposes the secret pre-cast (engine API or Sköll payload).
- **Voice/terminology lint** — zero violations in diegetic strings.

---

## Coverage gaps to watch (build from scratch — these are easy to under-test)

1. **Weighted-random vs argmax.** Easiest place to accidentally build optimal play. The statistical non-argmax test (§3) is the guard — keep it.
2. **Turn accounting on refusals.** Every refusal class must NOT consume a turn; easy to regress when adding a new refusal.
3. **Crossed-rune cast.** The "grid is an aid, never a cage" rule (§1) is counterintuitive and easy to "helpfully" break.
4. **Cast sacredness.** Reactions must never be offered on a Cast. One missing guard breaks the core invariant.
5. **Degradation fairness.** "Playable" is not "fair" — assert solvability with mood fully off, not just that it renders.
6. **Secret in Sköll's payload.** A convenience refactor that hands Sköll more state can leak the answer. Keep the payload assertion.

---

## Build-order alignment (test as you build)

Per `game-spec.md` build order: **engine → Oracle → human loop → win/cast → reactions → opponent (Gemini + floor).** Land each module's unit suite with the module; integration and E2E follow once the action interface is stable; a11y and degradation E2E gate the v1 jam build (June 21).
