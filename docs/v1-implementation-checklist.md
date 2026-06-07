# Save the Sun — v1 Implementation Checklist (Story Order)

Build order for the **fresh graphics v1 jam build**. Derived from `prd.md`, `game-spec.md`, `rune-board.md`, `ux-copy.md`, `test-plan.md`, `test-checklist.md`. The `Save the Sun POC/` directory is reference-only and out of scope.

This is a **sequencing + implementation** doc, not a capacity plan. No points, no days, no velocity. Stories are ordered top-to-bottom: an AI (or human) builds them in this order because each one leans on the one before it. Each story lands its own test suite (`test-plan.md` §11 build-order rule) before the next begins.

**Sprint Goal:** Ship one complete, winnable round to a public URL by **June 21, 2026** — engine owns truth, Oracle voices it, Sköll opposes it, and the whole thing stays fair and playable on the plain accessible grid with every mood layer off.

**Build spine** (`game-spec.md`): engine → Oracle → human loop → win/cast → reactions → opponent. UI, a11y, and the demo scaffolding interleave where each becomes testable.

Legend for test tags matches `test-checklist.md`: [U] unit · [I] integration · [C] component · [E] e2e · [A] a11y · [S] statistical/property · [Sec] security · [Eval] scored eval · [V] visual.

---

## S0 — Service skeleton & shared action interface

*First because everything routes through one action interface (`game-spec.md` Architecture). Depends on: nothing.*

- [x] Single Cloud Run service scaffold (frontend + backend + engine in-process; Gemini called outbound only)
- [x] One shared action interface (Ask / Cast / cross-off / react) is the single entry point — the human UI calls it (S2); the Gemini opponent will in S6 — no second path
- [x] 24 runes loaded from `src/config/runes.json` (the machine-readable copy of `rune-board.md`); on-screen order is a per-round seeded shuffle, not the sorted data order

**Done when:** the service deploys, serves the board in a stable per-round (seeded) order, and the action interface stub is the only entry point for game actions.

---

## S1 — R1 Deterministic engine (the referee)

*The single source of truth. Strictest coverage bar in the project. Depends on: S0.*

- [x] Load all 24 Elder Futhark runes; assert every rune is a unique (element, power, color) combo
- [x] Trait counts enforced: element 4 each · power 4 each · fill 12/12 · color 4 each
- [x] Secret selection: exactly one secret rune per round; a new round reseeds (a refresh resumes the same round — see S2.5)
- [x] Truthful trait resolution for all axes — element, power, fill (light/dark), hue
- [x] Power ranges: "fewer than N", "at least N", "N or more", exact N — correct at boundaries (1 and 6 inclusive)
- [x] Single-rune query eliminates exactly that rune; yes only for the secret
- [x] Win/cast: only the secret wins; every other cast fails → "wasted turn, round continues," never ends the game
- [x] Cast accepts **any** rune, crossed or not — engine never reads the player's crossings
- [x] Legality: mixed-type / malformed queries flagged invalid (a repeated question is legal play — the Oracle answers the same truth again; re-asking is never disallowed)
- [x] Turn accounting: a refused/invalid Ask does **not** consume the turn; a resolved Ask does
- [x] Strict alternation, human-first; out-of-order Ask/Cast rejected
- [x] Secret confidentiality: no engine path returns the secret before a correct cast
- [x] Per-player wrong-cast counter increments from v1 (threshold unused until v2 — hook only)

**Tests to land:** [U] board integrity, secret selection, trait resolution (table-driven all 24 × all axes), power boundaries, single-rune, win/cast, crossed-rune cast, legality, turn accounting, alternation, wrong-cast counter · [Sec] secret never returned pre-cast.

**Done when:** engine hits its CI floor (line 100% / branch 95%) and the round-solvability property test passes across all seeds.

---

## S2 — R2 Oracle pipeline

*Turns free text into one engine query and voices the truthful answer. Depends on: S1.*

- [x] Free-text → exactly one structured query type (element / power / fill / hue / single rune); multi-type intent **rejected**, never silently split
- [x] Interpretation echo **produced** before the answer — `You ask after {paraphrase}.` (Gemini paraphrase, fixed frame); the interpreted query stands (no do-over). Displayed on the rival's Ask in S5/S6, not the human's own — your Ask shows the answer, which restates the trait.
- [x] Answer voicing: both verdicts restate the trait — `Yes. Sól is reaching for {value-phrase}.` / `No. Sól is not reaching for {value-phrase}.`
- [x] `{value-phrase}` fills correctly per axis (`ux-copy.md` §1)
- [x] Refusals wired to exact `ux-copy.md` lines: mixed-type, secret-seeking, prompt-injection/override, negation, unparseable, empty submit
- [x] Every refusal class does **not** consume the turn; a resolved Ask does

**Implementation (S2):** Gemini reads free text into one structured query (or a refusal class) via the `@google/genai` SDK — model `gemini-3.5-flash`, thinking pinned to **MINIMAL** for speed, structured-JSON output. There is no negation operator — a negated Ask ("is it not fire?") is refused (the Oracle speaks of what is). The LLM is the `interpret` seam (`src/lib/server/oracle/gemini.ts`, excluded from coverage); the deterministic core (`oracle.ts`) re-validates that interpretation against the engine's own query grammar (a hallucinated query can never reach the engine), resolves it through `engine.ask`, and voices the answer. Key in `.env` as `GEMINI_API_KEY`.

**Tests to land:** [I] one-query mapping, turn accounting · [C] echo placement, answer voicing, each refusal class (covered at the data-contract level — no Oracle Svelte component in v1) · [Sec] secret-seeking + prompt-injection refused, no leak.

> [Eval] The ~40-phrasing corpus scores the **live** Gemini classifier, so it needs a key and the network — it is a manual/offline check, deliberately out of the deterministic CI suite. CI proves the mapping + voicing + refusal logic; the eval proves Gemini's reading. Run it before the demo.

**Done when:** Oracle hits its CI floor (line 90% / branch 85%) and the secret-leak security assertion holds through the Oracle path.

---

## S2.5 — Session Isolation & API Wiring

*Bridges the gap between the server-side engine and the client UI. Depends on: S1, S2.*

- [x] Implement `sessionId` extraction or generation (assigned in `src/hooks.server.ts` → `locals.sessionId`; the page-load reset and `api/action` both read it, so the id lives in the one seam that runs before both rather than duplicated in `+server.ts`)
- [x] Refactor `src/lib/server/engine/session.ts` to map `sessionId` to isolated `GameEngine` instances
- [x] Eliminate shared global engine state to prevent race conditions during concurrent plays
- [x] Update `session.test.ts` to assert isolation between parallel sessions

**Tests to land:** [U] parallel session isolation.

**Done when:** the `api/action` endpoint correctly maintains multiple independent engine sessions simultaneously.

---

## S3 — R3/R4 Human loop, Ask vs Cast, win on correct cast

*The playable core, text-only is fine here — graphics arrive in S4. Depends on: S1, S2.*

- [x] Ask and Cast are two distinct actions (Ask never wins, Cast never asks)
- [x] Cross-off is a private aid: cross/restore anytime, **including Sköll's turn**; persists across turns
- [x] During Sköll's turn: Ask + Cast disabled, cross-off stays enabled; acting shows "The wolf is moving. Hold."
- [x] Cast arming flow: "Cast the rune" arms Cast mode; while armed a card select **chooses target** (no cross-off), chrome reads "Cast?"; "Name it" commits; "Not yet" cancels with **no turn spent**
- [x] Two scoped card behaviors (cross-off normally, select-target while armed) never collide
- [x] Wrong cast costs the turn only; crossings + round state preserved
- [x] Pre-Ask panel reads "Twenty-four runes stand. None ruled out. Ask the Oracle." (not blank)
- [x] Win on correct cast resolves the round

**Implementation (S3):** every `api/action` response carries a `state` snapshot (`activePlayer`, `status`, `winner`) read from the engine **after** the route's pre-Sköll shim (`actions.ts` → `gameState`). The page drives the turn pill, the Ask/Cast disabling, and the round-over lock from it; cross-off lives in `RuneGrid` and is never turn-gated. In v1 the shim hands play back to the human every turn, so `activePlayer` reads `Human` in real play — the `Sköll` branch (pill flip, Ask/Cast disabled, "The wolf is moving. Hold.") is the same machinery S6 lights up when the shim is removed, exercised today via mocked responses. A resolved round flips the turn pill to the victory line ("The rune is true.") and locks Ask/Cast, leaving "Begin another night" as the next step — the full S9 victory sequence (Sól's line, defeat, choreography) builds on this minimal win state. Initial turn/round state is **hydrated from the page load** (`+page.server.ts` returns `gameState`), not guessed, so a resumed round — including one already won (S2.5 resume) — renders true on refresh instead of flipping on the first action.

**Tests to land:** [I] Ask/Cast distinct · [C] cross-off anytime, disabled-during-Sköll, arming flow, two-behavior isolation, starting Rite state · [E] wrong-cast continues.

**Done when:** a full human-only round (no Sköll yet) is winnable end-to-end through the action interface; action-interface CI floor (line 90% / branch 85%) met.

---

## S4 — R6 Graphics presentation + accessible DOM layer

*The Plain tier — the v1 surface. Built as high-fidelity DOM components orchestrated by GSAP, with a native focusable layer for controls (`prd.md` UI Direction). Depends on: S3.*

- [x] Rune grid rendered as DOM components orchestrated by GSAP; 24 cards, 6×4, in a per-round seeded shuffle (stable within a round, not the sorted data order). The seed is a server-generated Web Crypto uint32 — display-only and public (shared with Sköll for the same layout); the secret rune is the engine's own and is never derived from it _(functional accessible DOM grid, 6×4 layout, seeded shuffle, and seed security are built and tested; image/art elements split to v1.5 — see Deferred)_
- [x] Each card shows: glyph, color swatch, name + meaning, power as a row of pips (count = power, no numeral), element symbol + name, color name (rune id not shown; light/dark encoded by pip color — white light / black dark; pip count + fill spoken together in the accessible name as "{n} light/dark power", never as visible text; light/dark still a queryable Oracle axis)
- [x] Nothing conveyed by color alone — color name and element name always accompany their icons
- [x] Card dims in place when crossed; restore affordance present and works
- [x] Header: title "Save the Sun", tagline "A race to beat Sköll and save the light," night-progress indicator, turn pill ("Your move." / "Sköll moves.")
- [x] Right column order: Rite transcript → Reactions panel (Scry · Hex) → Ask input → "Cast the rune" (no suggestion chips — pre-filled questions would do the player's deduction)
- [x] Native focusable DOM elements carry the controls so rendering never blocks keyboard play

**Implementation (S4):** the rune grid (`RuneGrid` + `RuneCard`), header chrome, and right column were built across S0–S3; S4 lands the night-progress chrome and the component / a11y test suite — the functional accessible DOM layer is complete. **Image/art elements (the high-fidelity graphics presentation) and their `[V]` visual-regression baselines are split to v1.5** ("Graphic elements in UI" / "Splash screen" in Deferred), so they are out of v1 scope. The **night-progress indicator** is keyed to consumed turns owned by the engine — a `turns` counter incremented on a resolved Ask or Cast (the shim's courtesy `passTurn` does not count), exposed through `GameState.turns` and hydrated on load, so the phase (holds 0–2 / thins 3–5 / dawn 6+) survives a refresh and stays correct once Sköll spends turns too (S6). Suggestion chips were cut: a chip that pre-writes a question does the player's deduction for them, and the deduction is the game.

**Tests to land:** [V] grid renders (6×4 layout + crossed/armed state artifacts) · [C] card content, cross-off affordance, header chrome (incl. night-progress) · [A] no-color-alone assertion.

**Done when:** the grid is fully playable by mouse and keyboard with the DOM grid rendered, controls live; UI CI floor (line 80% / branch 70%) met. (Graphics smoke / line-60% gate moved to v1.5 with the image layer.)

---

## S5 — R12 Scry & Hex reactions

*Real-time reaction is core to a responding opponent — pulled into v1. Depends on: S3 (action interface), S4 (reactions panel UI).*

- [x] One charge of each per player per round; spent reaction vanishes (no "spent" copy)
- [x] Both trigger on an **Ask** only; a Cast resolves uninterrupted (the win check is sacred)
- [x] Interrupt window: at most one reaction per window; if Hex is used there is no answer left to Scry
- [x] Scry → rival also receives the private answer
- [x] Hex → question dies, no answer to anyone, active player's turn spent
- [x] Human-side prompt on Sköll's Ask: "Sköll asks. Answer it?" → Scry / Hex / Let it pass (`ux-copy.md` §3)

**Implementation (S5):** the engine owns the reaction *state* — one Scry + one Hex per player, plus the **interrupt window** (the asker whose *pending* Ask the rival may answer). The window is opened around a pending Ask via `openReactionWindow`, **before** the Ask is answered — not as a side effect of a resolved one — so a Hex lands before any answer is produced, never after it has been handed back (the kill is real, not retroactive). A resolved Cast closes the window, so a Cast is structurally never interruptible (the win check stays sacred); a reaction or a decline closes it, so at most one reaction lands per window — once Hex silences a question there is no answer left for Scry. The reaction *policy* lives in `reactions.ts` (`resolveReaction`): Pass lets the Ask stand and spends nothing (and only the **rival** may decline — the asker can't slam their own window shut); Scry/Hex need an open window owned by the rival and an unspent charge, then spend it and resolve (`shareAnswer` → resolve the Ask and hand the answer to the reactor too; `killAnswer` → never ask, the question dies before any answer). The human-side prompt is `ReactionPrompt.svelte` (held reactions only, so a spent one simply vanishes). The **live trigger is S6**: Sköll has no Ask yet, so `openReactionWindow` and the prompt — like the Sköll turn pill — are built and tested but lit up when the Gemini opponent Asks through the same interface (it opens the window on Sköll's intended Ask, resolves the reaction, then asks-and-delivers on Pass/Scry or spends his turn unanswered on Hex).

**Tests to land:** [I] one-use-each, trigger-on-Ask-only (never Cast), interrupt window, Scry effect, Hex effect · [C] human prompt copy · [U] reaction resolution in engine.

**Done when:** reactions hit their CI floor (line 95% / branch 90%) and the cast-sacredness guard (reactions never offered on a Cast) is tested.

---

## S6 — R5 Sköll: Gemini opponent + deterministic floor

*Last in the spine — needs the whole engine + action interface + reactions to play through. Depends on: S1–S5.*

**Gemini-driven Sköll (engine referees):**

- [ ] Sköll is a bare LLM call reasoning in natural language, acting only through the game's function-calling tools (ask, cross-off/restore, cast, reactions) — not an agent, not code-driven
- [ ] Prompt him as a *person* playing the rite, never as an AI; ~12-year-old deduction encoded explicitly (one clue at a time, no cross-product elimination, no probability math, no perfect play)
- [ ] Sköll sees board as JSON in **fixed on-screen order**, told not to reorder/sort it
- [ ] Earned-only state: his payload contains only his own candidates, his own answers, and anything Scried — **never** the secret, never the human's crossings
- [ ] Every tool call validated for legality before the engine resolves it; illegal/malformed calls rejected
- [ ] Sköll's cross-off/restore mutates only his private sheet; traceable in the debug log
- [ ] Wrong Sköll cast wastes only his turn; round continues

**Deterministic floor (weighted-random, NOT argmax):**

- [ ] Fires **only** on Gemini error / timeout / illegal-or-malformed call — never as a quality filter on a legal-but-suboptimal move
- [ ] Candidate set = legal, well-formed queries over still-live candidates; excludes already-asked and any non-splitting (all-yes/all-no) query
- [ ] Split score = `1 / (1 + |yes − n/2|)`
- [ ] Selection = weighted-random sampling over scores — best splitter most likely, every legal splitter non-zero. **Do not take the max.**
- [ ] Medium difficulty = moderate peaking (clearly beatable)
- [ ] Casts when exactly one candidate remains; if no splitter exists earlier, casts the best remaining candidate
- [ ] Same seed + same state → same sampled move (reproducible for the demo)

**Tests to land:** [Sec][I] earned-only payload, no secret · [I] tool-call validation, cross-off tracing, wrong-cast · [U] board-order-not-presorted, candidate set, split score, cast condition, determinism-under-seed · [S] **non-argmax** statistical test · [Eval] ~12-year-old persona, computation tells flagged.

**Done when:** Sköll plays a full round through the same interface as the human, the floor catches every injected failure, and the fallback-policy CI floor (line 95% / branch 90%) is met. **The non-argmax statistical test is non-negotiable** (`test-checklist.md` high-risk gaps).

---

## S7 — R7 Title screen + first-run onboarding

*Needs a live board to coach-mark over. Depends on: S4.*

- [ ] Title screen: title, tagline, primary CTA "Light the fire.", secondary "How the rite works"
- [ ] First-run onboarding, one concept per step, dismissable, board visible behind (`ux-copy.md` §5 steps 1–4)
- [ ] Skippable coach-mark tour over the live board; final button "Take up the runes."
- [ ] How-to-play guidance ("Ask. Cross off what it can't be. Cast when you're ready.") lives here in the popovers — not as a persistent on-board explainer

**Tests to land:** [C] title chrome, onboarding step copy, skip path.

**Done when:** a first-time player can read the stakes, Ask, cross, and Cast concepts before the board, and skip cleanly.

---

## S8 — R8 Debug view (the demo)

*The on-stage proof that the engine owns truth. Depends on: S1, S2, S6.*

- [ ] Every result logged tagged **deterministic-engine** vs **LLM-inference**
- [ ] Any turn the deterministic floor fired is flagged
- [ ] Engine truth shown beside Gemini's reasoning — the demo contrast holds

**Tests to land:** [I] result tagging, fallback flag, truth-vs-reasoning.

**Done when:** the debug view can be screen-shared during the demo and visibly separates fact from inference for every turn.

---

## S9 — R11 End screen + in-world replay

*Closes the loop. Depends on: S3 (win/cast), S6 (loss path).*

- [ ] Victory sequence (`ux-copy.md` §4): "The rune is true." → "Sól crests the rim of the world." → Sól's only line → CTAs "Begin another night" / "Leave the fire."
- [ ] Defeat sequence: Sköll's winning cast → "Sköll takes the sun…" → CTAs "Stand against him again" / "Leave the fire."
- [x] Replay starts a fresh round (new secret reseed)

**Partial (landed early with the round-end header):** the moon → risen sun swap, the short victory/defeat header tags, the outcome turn pill, and the full resolution line in the Oracle panel are built and tested. **Still open:** Sól's only victory line, the "Leave the fire." / "Stand against him again" CTAs, and the S6 defeat choreography.

**Tests to land:** [C] win/lose copy, replay reseeds.

**Done when:** both endings render their exact in-world lines and replay restarts a fair new round — no "Play again," no arcade tone.

---

## S10 — R9 Accessibility basics + R10 best-on-desktop notice

*The lineage bar is Lighthouse a11y ≈ 1.0; this inherits it. Screen-reader narration is v1.5. Depends on: S4, S3, S5.*

- [ ] Whole round operable by keyboard (Ask, cross, arm, select, cast, react) with a **visible focus indicator**
- [ ] Controls have accessible names/roles (axe-clean)
- [ ] WCAG 2.1 AA contrast across **both** light and dark rune palettes
- [ ] No information by color alone (cross-check S4)
- [ ] `prefers-reduced-motion` → motion instant, audio muted, still reflects live state changes
- [ ] Fully operable at 200% zoom
- [x] Best-on-desktop notice below the **1280px** minimum — **no** responsive reflow attempted (1024px support is v2)
- [ ] Degradation: Plain (v1) round fully winnable on the static grid, audio muted by default; Reduced tier (reduced-motion OR WebGL/audio unavailable) stays unaffected and fair

**Tests to land:** [E][manual] keyboard round + full keyboard cast path · [A] axe names/roles, contrast, color-independence · [C] reduced-motion · [manual] 200% zoom · [E] Plain + Reduced degradation, [S] fairness invariant · [C] best-on-desktop notice.

**Done when:** the Lighthouse a11y CI gate passes (≥ 0.95, target ≈ 1.0) and the build fails below it.

---

## S11 — Voice / copy conformance + error states

*Cross-cutting lint, runs once the strings exist. Depends on: S2–S9.*

- [ ] No emoji in diegetic copy; no exclamation in Oracle/Sól lines (Sköll's single winning-cast exclamation allowlisted)
- [ ] Banned arcade/idiom strings absent ("Correct!/Wrong!", "Play again", "Game over", "?"-only CTAs)
- [ ] World-noun terminology enforced (rune, Ask/Cast, power, light/dark, hue, Scry/Hex — never "card")
- [ ] Sköll vs Oracle lines attributable to the correct speaker; Sköll taunt pool does not repeat within a game
- [ ] Connection/engine error shown in-world ("The Oracle falls silent…") **without** losing crossings or turn state

**Tests to land:** [A] string + terminology lint · [Eval] speaker-distinctness · [I] no-repeat taunts, error-state preserves crossings/turn.

**Done when:** the voice/terminology lint reports zero diegetic violations in CI.

---

## S12 — CI gates lock (the v1 ship gate)

*Final gate before June 21. Depends on: all above.*

- [ ] Coverage floors pass: Engine 100/95 · Fallback 95/90 · Action interface 90/85 · Oracle 90/85 · Reactions 95/90 · UI 80/70 · Project overall 85/80 (Graphics 60 moved to v1.5 with the image layer)
- [ ] Lighthouse a11y ≥ 0.95 in CI
- [ ] Round-solvability property test passes across all seeds (no unwinnable rounds; Oracle never lies)
- [ ] Secret-leak security assertion passes (engine API + Sköll payload)
- [ ] Voice/terminology lint passes (zero violations)
- [ ] High-risk gaps confirmed covered: non-argmax test · turn-accounting on **every** refusal class · crossed-rune cast · cast sacredness · degradation fairness · secret never in Sköll's payload
- [ ] Deployed, playable, public URL confirmed live

**Done when:** every gate is green and the public build plays a full fair round end to end.

---

## Deferred — do not start before v1 ships

**v1.5 (fast follow), in order:**

1. Screen-reader narration & navigation — `aria-live="polite"` on the Rite transcript and every Oracle answer/refusal; per-card full trait + crossed-state exposure; turn-change announcements
2. Graphic elements in UI
3. Splash screen
4. Sköll escalation taunts wired to candidate-count

**v2 (immersion build), in order:**

1. Night→dawn mood — continuous tide + event stingers, Sköll and Sól embodied; degrades per the contract, nothing essential depends on it
2. Ambient audio bed — looped, crossfading, pausable, muted by default, ambient only
3. Cast win animation — glyph carves into stone + luminous Sól beat; honors reduced motion
4. Voice interaction with Gemini — speak the Ask, hear the Oracle/Sköll (TTS)
5. Wrong-cast penalty — cap ≈2 wrong casts per player (threshold on the v1 counter; alternation unaffected)
6. Small-desktop support down to 1024px — a responsive board below the v1 1280px floor (v1 just shows the best-on-desktop notice there)

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Gemini latency/failure mid-demo | Round stalls on stage | Deterministic floor (S6) fires on every failure path; verify it before the demo |
| Accidentally building argmax/optimal Sköll | Inferable, unfun opponent; defeats the "responding not learning" thesis | Non-argmax statistical test (S6) is a hard gate; weighted-random only |
| Secret leaks into Sköll's payload via a convenience refactor | Unfair round, broken core invariant | Earned-only payload assertion (S6) kept in CI |
| Cast sacredness regressed by a reaction guard gap | Win check interruptible — core invariant breaks | Cast-never-interruptible test (S5) + high-risk-gap checklist |
| Turn accounting regresses when a refusal class is added | Malformed Ask silently burns a turn | Turn-accounting-on-refusal covered for **every** class (S2) |
| Degradation "renders" mistaken for "fair" | Unwinnable round with mood off | Fairness invariant solvability test, not just render smoke (S10) |
| June 21 deploy surprises | Miss the jam deadline | Deploy hello-world early (S0); keep the public URL green throughout |

---

## Global Definition of Done (every story)

- [ ] Module's own test suite lands **with** the module (`test-plan.md` build-order rule)
- [ ] Module meets or exceeds its CI coverage floor
- [ ] Player-facing strings pass the voice/terminology lint
- [ ] Engine remains the single source of truth — no truth logic leaks into UI or Gemini
- [ ] Degrades cleanly to the tier below, or it doesn't ship

## Key Dates

| Date | Event |
|------|-------|
| June 21, 2026, 11:59 PM PDT | v1 jam submission due (June Solstice Game Jam, dev.to) |
