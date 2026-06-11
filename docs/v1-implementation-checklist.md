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

**Refinement (S8 branch):** the board encodes light/dark as the color of the power pips (white = Light, black = Dark), so "Is the power white?" / "Is the power black?" now read as the **fill** axis — white always means Light (never a hue), and black means Dark only when it describes the power/pips, so a bare "is it black?" stays the Black hue. Prompt-only change to the interpret seam; the deterministic grammar is unchanged. Verified live; phrasings in `oracle-eval-corpus.md`.

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
- [x] Oracle panel opens **blank** — it voices a response only (an answer, refusal, or resolution), never idle filler _(revised: the original "Twenty-four runes stand…" pre-Ask line was cut — the box is blank until the Oracle has something to say)_
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
- [x] Header: title "Save the Sun", tagline "A rite for the longest day.", night-progress indicator, turn pill ("Your move." / "Sköll moves.")
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
- [x] Human-side prompt on Sköll's Ask: Scry / Hex / Let it pass (`ux-copy.md` §3) — the "Sköll asks. Answer it?" heading is now SR-only (the buttons' `aria-label`); its visible copy is deferred to a v2 reaction-UI redesign

**Implementation (S5):** the engine owns the reaction *state* — one Scry + one Hex per player, plus the **interrupt window** (the asker whose *pending* Ask the rival may answer). The window is opened around a pending Ask via `openReactionWindow`, **before** the Ask is answered — not as a side effect of a resolved one — so a Hex lands before any answer is produced, never after it has been handed back (the kill is real, not retroactive). A resolved Cast closes the window, so a Cast is structurally never interruptible (the win check stays sacred); a reaction or a decline closes it, so at most one reaction lands per window — once Hex silences a question there is no answer left for Scry. The reaction *policy* lives in `reactions.ts` (`resolveReaction`): Pass lets the Ask stand and spends nothing (and only the **rival** may decline — the asker can't slam their own window shut); Scry/Hex need an open window owned by the rival and an unspent charge, then spend it and resolve (`shareAnswer` → resolve the Ask and hand the answer to the reactor too; `killAnswer` → never ask, the question dies before any answer). The human-side prompt is `ReactionPrompt.svelte` (held reactions only, so a spent one simply vanishes). The **live trigger is S6**: Sköll has no Ask yet, so `openReactionWindow` and the prompt — like the Sköll turn pill — are built and tested but lit up when the Gemini opponent Asks through the same interface (it opens the window on Sköll's intended Ask, resolves the reaction, then asks-and-delivers on Pass/Scry or spends his turn unanswered on Hex).

**Tests to land:** [I] one-use-each, trigger-on-Ask-only (never Cast), interrupt window, Scry effect, Hex effect · [C] human prompt copy · [U] reaction resolution in engine.

**Done when:** reactions hit their CI floor (line 95% / branch 90%) and the cast-sacredness guard (reactions never offered on a Cast) is tested.

---

## S6 — R5 Sköll: Gemini opponent + deterministic floor

*Last in the spine — needs the whole engine + action interface + reactions to play through. Depends on: S1–S5.*

**Gemini-driven Sköll (engine referees):**

- [x] Sköll is a bare LLM call reasoning in natural language, acting only through the game's function-calling tools (ask, cross-off, cast, react) — not an agent, not code-driven
- [x] Prompt him as a *person* playing the rite, never as an AI; ~12-year-old deduction encoded explicitly (one clue at a time, no cross-product elimination, no probability math, no perfect play)
- [x] Sköll sees board as JSON in **fixed order**, told not to reorder/sort it
- [x] Earned-only state: his payload contains only his own answers and his own sheet — **never** the secret, never the human's crossings
- [x] Every tool call validated for legality before the engine resolves it; illegal/malformed calls rejected (→ floor)
- [x] Sköll's cross-off mutates only his private sheet; traceable in the debug log
- [x] Wrong Sköll cast wastes only his turn; round continues

**Deterministic floor (weighted-random, NOT argmax):**

- [x] Fires **only** on Gemini error / timeout / illegal-or-malformed call — never as a quality filter on a legal-but-suboptimal move
- [x] Candidate set = legal, well-formed queries over still-live candidates; excludes already-asked and any non-splitting (all-yes/all-no) query
- [x] Split score = `1 / (1 + |yes − n/2|)`
- [x] Selection = weighted-random sampling over scores — best splitter most likely, every legal splitter non-zero. **Do not take the max.**
- [x] Medium difficulty = moderate peaking (the score curve is the only peaking; no hardening)
- [x] Casts when exactly one candidate remains; if no splitter exists earlier, casts the best remaining candidate
- [x] Same seed + same state → same sampled move (reproducible for the demo)

**Tests landed:** [Sec][I] earned-only payload, no secret · [I] tool-call validation, cross-off tracing, wrong-cast · [U] board-order-not-presorted, candidate set, split score, cast condition, determinism-under-seed · [S] **non-argmax** statistical test. [Eval] (~12-year-old persona, computation tells) stays a live-LLM eval, not a CI gate — deferred with the Oracle's eval harness.

**Implementation (S6):** Sköll plays through the same `handleAction`/engine path as the human — no second path. `takeSkollTurn` (`skoll/skoll.ts`) builds an **earned-only** payload (public board in canonical order + his own truthful answers + his crossed sheet — the builder takes his *state*, not the engine, so the secret is structurally unreachable), hands it to the Gemini brain (`skoll/gemini.ts`, prompted as a person, coverage-excluded like the Oracle's seam), and **validates the returned tool call** before the engine resolves it. Any error / timeout / illegal-or-malformed call drops to the **deterministic floor** (`skoll/floor.ts`): live candidates from his facts, split-score, weighted-random sample — argmax is forbidden, gated by the `[S]` statistical test. A Cast resolves at once (a wrong one wastes only his turn); an Ask reuses the S5 seam — it **opens the reaction window and parks the query**, so the human's Scry/Hex/Pass resolves *before* any answer (Hex kills it unanswered). The **reverse direction (R12)** is wired too: on the human's Ask, Sköll (Gemini, floor = Pass) gets the same interrupt window — a Hex kills her question before its answer, a Scry hands him her truth as an earned fact. His memory is per-session, lifecycle-linked to the engine (reset on a new round, evicted with it). **Out of scope:** cross-off **restore** (he only accumulates), the escalation-taunt tier (P2), and surfacing his *Scry-on-you* as a visible line — a Scry stays covert (his own following move overwrites any notice), so the player feels it only in how he plays.

**Opener variety + reaction presence (S6 follow-up):** his *opening* Ask was repetitive — on move 1 his payload is byte-identical every round (no facts, fixed board), so a low-thinking model lands on the same first trait every time (the "always gold" tell). `SkollState` now carries a **seeded per-round hunch** (a trait-level color/element phrase drawn from the crypto seed — varies per round, reproducible, never a rune by name so it can't echo the secret, never light/dark since that clean split is the optimal opener the prompt forbids). It is surfaced to Gemini **only on the opening move** and is kept out of the stringified payload otherwise, so it can't bias him once he reasons from earned facts. Later moves already vary on their own facts, so they get no nudge. Separately, his reaction-consideration gate was raised (**`REACTION_CHANCE` 0.5 → 0.65**) so he shows up to Scry/Hex on ~⅔ of the human's Asks rather than half. _(The opener's live feel — does Gemini actually follow the hunch — stays the deferred persona eval, not a CI gate.)_

**Tests landed (follow-up):** [U] hunch determinism + cross-seed variety + trait-level (never a rune name, never light/dark) · [I] hunch surfaced only on the opening move and absent from the prompt once a fact exists · reaction-gate straddle tests unchanged across the new threshold.

**Done when:** Sköll plays a full round through the same interface as the human, the floor catches every injected failure, and the fallback-policy CI floor (line 95% / branch 90%) is met. ✅ The non-argmax statistical test is in CI (`test-checklist.md` high-risk gaps).

---

## S7 — R7 Title screen + first-run onboarding

*Needs a live board to coach-mark over. Depends on: S4.*

- [x] Title screen: title, tagline, primary CTA "Light the fire.", secondary "How the rite works"
- [x] First-run onboarding, one concept per step, dismissable, board visible behind (`ux-copy.md` §5 steps 1–5, incl. Scry & Hex)
- [x] Skippable coach-mark tour over the live board; final button "Take up the runes."
- [x] How-to-play guidance ("Ask. Cross off what it can't be. Cast when you're ready.") lives here in the popovers — not as a persistent on-board explainer

**Implementation (S7):** `Onboarding.svelte` overlays the live board (`+page.svelte`). The **title** phase is a centered card (title, tagline, "Light the fire." → straight to play, "How the rite works" → tour). The **tour** is a real coach-mark walk of the five §5 concepts. Step 1 ("the stakes") is a scene-setting centered intro over the dimmed page — no anchor, so the board stays unhighlighted. Steps 2–5 spotlight the region each describes (the Ask, then the board at "read & cross," then the Cast, then the Scry/Hex reactions panel) by anchoring to a `data-coach` hook on the page — a gold ring whose oversized box-shadow dims everything else — with the popover positioned beside the lit region (a transparent catcher keeps the board inert mid-tour). A step with no anchor falls back to a centered popover; each anchored step re-measures on the next frame so the opening anchored step never sticks on a stale (pre-layout) rect. Each step has a Skip; the last reads "Take up the runes." A persistent "How the rite works" button in the header reopens the tour directly (the page passes `start='tour'`). First-run is gated on a `localStorage` flag (`save-the-sun:onboarded`) set on any exit — a refresh resumes the same round (S2.5), so the title must not nag the returning player; storage failures (private mode) degrade to showing it, never to breaking play. Both dialogs are `aria-modal` with a focus trap — focus enters on open, Tab cycles inside (wrapping both ends), Escape exits — so the board and header behind them stay untabbable while the overlay is up.

**Chrome cleanup landed alongside S7:** the turn pill moved off the header to the top of the Oracle panel (beside the Ask/Cast controls it gates), "How the rite works" became a header button next to "Begin another night," and the redundant "Cast a Rune" label above the Cast button was dropped.

**Tests landed:** [C] title chrome, step copy, skip path, first-run gate + returning-player skip, header re-entry, modal focus trap (focus-in, Tab wrap, Escape) (`Onboarding.svelte.test`, `page.svelte.test`). [E] first-run over the live board, dismissal persisting across a real reload, full tour, and header re-entry (`board.e2e`); the board e2e seeds the onboarded flag so the overlay never blocks board interaction.

**Done when:** a first-time player can read the stakes, Ask, cross, and Cast concepts before the board, and skip cleanly.

---

## S8 — R8 Debug view (the demo)

*The on-stage proof that the engine owns truth. Depends on: S1, S2, S6.*

- [x] Every result logged tagged **deterministic-engine** vs **LLM-inference**
- [x] Any turn the deterministic floor fired is flagged
- [x] Engine truth shown beside Gemini's reasoning — the demo contrast holds
- [x] Surface Gemini's **reasoning output for Sköll's move** when available — the chain of deduction that led to his Ask/Cast — so the debug view shows *how* he reached the guess, not just the chosen tool call. (Needs the move seam to capture the model's reasoning/thinking trace; if the API returns none, show the earned-only payload it reasoned from as the fallback.)

**Implementation (S8):** a per-session **chronological event log** (`src/lib/server/debug/log.ts`). Each `DebugEvent` carries **three orthogonal facts**, each set explicitly at the source so the view never re-derives them: **owner** (who produced it → the card's color), **kind** (`input` raw player text · `llm` model inference · `deterministic` engine truth → the badge), and **part** (the turn phase → the chip). Lifecycle-linked to the round through `session.ts` (reset on a new round, evicted with the session), bounded, written from the one place every move resolves — the `api/action` route. The view's axis is **engine fact vs LLM inference**, and the key invariant is that **a verdict is the ENGINE's** (`owner: Engine, kind: deterministic`), never borrowed from the actor whose turn it was — an answer or a cast result is the referee's truth, not the asker's. A human **Ask** splits into three events: her raw question (`owner: Human, kind: input`), the Oracle's reading of it (`owner: Oracle, kind: llm`), and the engine's answer (`owner: Engine, kind: deterministic`). A human/Sköll **Cast** logs the caster's input then the engine's verdict. A Sköll move logs his action + `reasoning` + `source` (`owner: Sköll`; `kind: llm` when Gemini decided, `kind: deterministic` + `warn` on the floor fallback) + this-turn cross-offs, and his **Ask**'s engine verdict lands once the human reacts (no parked decision — the reasoning already sits on his move event). His Scry/Hex/Pass on the human's Ask is `owner: Sköll, part: React`. The shown reasoning is the grounded `summarizePayload` (earned facts + sheet, or the opening hunch) — **not** a model thought-trace: `includeThoughts` was tried and reverted (on MINIMAL thinking + structured JSON the trace is off-persona noise). Instead the **raw Gemini request/response** is teed from the move/reaction seams into a **per-session sink** (`captureGemini`, scoped by an `AsyncLocalStorage` the route opens — no cross-session bleed) and drained onto the log as `sensitive` events owned by **Sköll** (it IS his move/reaction call), `kind: llm`; the snapshot is a cycle-safe sanitizer (strips functions, breaks cycles, marker on throw) so neither `json()` nor the load serializer 500s. The round's **secret** opens the log as a `sensitive` `owner: Engine, part: Round` event. The view paints the card border + name by **owner** from the game's own rune-gem palette (green Human · gold Oracle · blue Sköll · purple Engine; red is held back for warn/error so a severity badge never reads as an owner), badges the **kind** (quiet outline `input` · gold `llm` · green `deterministic`), and chips the **part** (Ask / Cast / React / Round). Severity stays a separate badge.

**Exposure is env-gated** by `DEBUG_LOG` (`verbose` | `demo` | `off`): verbose shows everything incl. the secret + raw Gemini I/O; demo strips `sensitive` (screen-shareable); off disables the view. Default **verbose in dev, demo on deploy** when unset — the public `/debug` view is the demo, so a deploy shows the engine-vs-LLM stream by default while demo keeps the secret + raw model I/O off the wire (set `DEBUG_LOG=off` to disable it). The filter runs server-side (`filterForLevel`) in `GET /api/debug` and the `/debug` load, so sensitive events never reach the wire below verbose. The view (`/debug`) is one chronological stream, newest first, polled live for screen-sharing; unlinked from the game.

**Tests landed:** [I] secret as a sensitive `Engine`/`Round` event, a human Ask split into her `input` + the Oracle's `llm` reading + the engine's `deterministic` verdict, human/Sköll cast input + verdict, his move owner/kind/source/cross-offs, floored move flagged `deterministic` + `warn`, engine-verdict on a hexed Ask, his React logged, per-session raw Gemini I/O drained as a sensitive Sköll `llm` event (`action/server.test`) · [U] event store seq/trim/isolation/reset, `debugLevel` env + dev/prod defaults, `filterForLevel` strip/off, the **per-session** Gemini sink (isolation, no-context no-op, cycle/function sanitizer, marker-on-throw), `summarizePayload` (`debug/log.test`, `skoll.test`) · [I] `/api/debug` + `/debug` load level-filtering — verbose/demo/off (`api/debug/server.test`) · [C] an engine verdict renders as a deterministic Engine card, cards colored by owner + badged by kind (LLM vs deterministic), message + JSON detail, sensitive badge, newest-first, no-overflow, empty + off states (`debug/page.svelte.test`). _(The live model's behavior stays the deferred persona eval; the raw-I/O events are the diagnostic that replaces trusting a thought-trace.)_

**Done when:** the debug view can be screen-shared during the demo and visibly separates fact from inference for every turn.

---

## S8.5 — Resume the view on reload (view ↔ round ↔ log consistency)

*Closes the gap S8 surfaced. Depends on: S2.5 (session resume), S3 (crossings + transcript), S8 (the debug log the view should match).*

**The mismatch:** a refresh resumes the round server-side (same secret, same turn — S2.5) and the debug log keeps the full history (S8), but the **client** play state is not persisted, so the visible game resets to its opening — crossings gone, the Rite transcript back to "Twenty-four runes stand…" — while the turn pill / night-progress (hydrated from the engine) still read mid-round. The view *looks* reset though nothing reset; the debug stream and the board now disagree, with no event explaining why. This story makes the view resume so all three agree.

- [x] Persist the human's **crossings** (rune **ids**, not positions) for the round; restore them on load so the board shows the same marks after a reload
- [x] Persist the **Rite transcript** (the voiced Oracle line shown in the panel — the panel is single-line, so this is the one `answer` it currently throws away, not a multi-entry history); restore it on load instead of resetting to blank
- [x] Restore layered **on top of** the server-hydrated engine state (turn pill, round status, night-progress, pending reaction) — the engine stays the source of truth; the view history is presentation only (a blank stored line never overwrites a server-derived one, e.g. a resumed won round's victory line)
- [x] **Scope to the current round/session:** a new round (new secret via `/api/new-game` or a new session) clears the persisted view state — never restore stale crossings/transcript onto a fresh secret (the round token is stamped into the single record; a read for a different round returns nothing)
- [x] **Board reshuffle stays** (`boardSeed` is display-only and still reseeds on refresh — see `boardseed-display-only-dont-persist`); because crossings are keyed by rune **id**, they survive the reshuffle and land on the right runes in the new order
- [x] Storage via `localStorage` keyed by the per-round token; storage failure (private mode) degrades to the current reset-on-reload behavior, never to broken play
- [ ] Consistency check: an **automated** assertion that, after a mid-round reload, the board marks + voiced line match what the **debug log** shows for the same round _(deferred to v2 — the debug log runs as a separate stream unlinked from the game; v1 proves view ↔ round agreement via the [C]/[E] suites, the log ↔ view cross-check stays a manual demo observation. Unchecked to match `test-checklist.md` §10.5 — a manual demo observation is not the automated assertion this box specifies.)_

**Implementation (S8.5):** the client owns the restore; the only server addition is a stable per-round **token**. `session.ts` mints an opaque `crypto.randomUUID()` per round (in `roundIds`, lifecycle-linked to the engine — reset on a new round, evicted with the session), exposed via the load and `/api/new-game` as `roundId`. It is independent of the secret seed, so surfacing it can never leak the answer (the seed → secret path stays server-only). The client (`src/lib/viewState.ts`) keeps a single `localStorage` record `{ roundId, crossings, answer }`: a read for a different round finds a stale token and returns null, so a new secret never wears old marks, and a new round overwrites the one key. `+page.svelte` restores it in `onMount` over the server-hydrated engine state, mirrors the grid's crossings (RuneGrid gained `restoreCrossed` to seed once + `onCrossChange` to report edits), and persists via a gated `$effect` — gated on a post-restore flag (so the empty pre-restore state can't clobber a save) and on `!skollStalled` (so a transient wolf-stall error line, whose retry state isn't persisted and which `onMount` re-drives anyway, never resumes as a dead end). `boardSeed` still reshuffles on every load; crossings keyed by id ride through it. No engine change — the engine already resumes; this restores only the *presentation* the client previously discarded.

**Tests landed:** [U] round-token lifecycle — stable across refresh, regenerated on a new round, isolated + evicted per session (`session.test`); load + `/api/new-game` surface the token, stable while `boardSeed` varies, fresh on reset, no secret-bearing field (`page.server.test`, `new-game/server.test`); `viewState` round-trip, round-scoping, malformed-record + storage-throw degradation (`viewState.svelte.test`). [C] crossings seed-once + change-report (`RuneGrid.svelte.test`); crossings restore, voiced-line restore, a blank line never clobbers a resumed won round's victory line, stale-round ignored, cross persisted, new-game re-keys + drops stale marks, storage-throw degrades, stall keeps the last good line, missing-token new-game fails loud (`page.svelte.test`). [E] cross + Ask + real reload restores both over the resumed round (`board.e2e`).

**Done when:** a mid-round reload restores the visible crossings + voiced line to match the resumed round, with no silent reset. (The automated view ↔ debug-log cross-check is deferred to v2 — see the unchecked box above; in v1 the log agreement is verified by manual demo observation.)

---

## S9 — R11 End screen + in-world replay

*Closes the loop. Depends on: S3 (win/cast), S6 (loss path).*

- [x] Victory sequence (`ux-copy.md` §4): "The rune is true." → "Sól crests the rim of the world." → Sól's only line → CTA "Begin another night" _(single CTA; the "Leave the fire." secondary was cut)_
- [x] Defeat sequence: Sköll's winning cast → "Sköll takes the sun…" → CTA "Stand against him again" _(single CTA; the "Leave the fire." secondary was cut)_
- [x] Replay starts a fresh round (new secret reseed)

**Landed early with the round-end header:** the moon → risen sun swap, the short victory/defeat header tags, the outcome turn pill, and the full resolution line in the Oracle panel.

**Implementation (S9):** `EndScreen.svelte` is the closing rite — a full-bleed cinematic overlay (`z-index` above the board) that mounts the moment the round resolves (`showEndScreen = roundOver` on `+page.svelte`). It owns the splash per outcome (`dawn-splash` on a human win, `defeat-splash` on a Sköll win) and stages the rite as a centered, descending verse over a local halo (no full scrim): a big gold lead line, an ornamental divider, then the quieter consequence — the win's three-line Sól sequence (lead → verse → blessing), the loss's lead + coda. Motion is decorative — `prefers-reduced-motion` shows the whole rite at once. It is an `aria-modal` dialog **named by its lead line** (`aria-labelledby="end-screen-lead"` → "The rune is true." / "Sköll takes the sun."), with focus opening on the primary CTA and a focus trap, since cross-off behind it is never turn-gated. **Replay** ("Begin another night" / "Stand against him again") reuses `newGame` (new secret reseed) and is the **only** closing action — the secondary **"Leave the fire."** CTA (its return-to-title `leaveFire` path) was later cut, so the end screen offers replay alone. The page folds away its **own** header "Begin another night" while the overlay is up, so the replay surface is single (no duplicate accessible name). The earlier header treatment (sun-swap, outcome pill, panel resolution line) stays — the end screen layers the §4 sequence and CTAs on top.

**Tests landed:** [C] victory/defeat line copy + order, the single replay CTA + its label/wiring (`onReplay`), no "Leave the fire." escape hatch, splash-by-outcome, `aria-modal` dialog named by the lead line + focus opening on the replay CTA + focus trap (Tab traps on the lone CTA), no-arcade-tone/no-exclamation voice guard (`EndScreen.svelte.test`) · [C/I] outcome-gated render (none while live), single replay surface on a win, end screen raised by a winning cast and on a resumed won/lost round, replay → `new-game` + dismiss, only the replay CTA on the end screen (`page.svelte.test`).

**Done when:** both endings render their exact in-world lines and replay restarts a fair new round — no "Play again," no arcade tone.

---

## S10 — R9 Accessibility basics + R10 best-on-desktop notice

*The lineage bar is Lighthouse a11y ≈ 1.0; this inherits it. Screen-reader narration is v1.5. Depends on: S4, S3, S5.*

- [x] Whole round operable by keyboard (Ask, cross, arm, select, cast, react) with a **visible focus indicator**
- [x] Controls have accessible names/roles (axe-clean)
- [x] WCAG 2.1 AA contrast across **both** light and dark rune palettes
- [x] No information by color alone (cross-check S4)
- [x] `prefers-reduced-motion` → motion instant, audio muted, still reflects live state changes
- [x] At 200% zoom the 1536px desktop target still has a 768px effective width → the compact embedded board remains playable above the **750px** floor
- [x] Best-on-desktop notice below the **750px** minimum; the rite renders in a compact embedded layout at 750px+
- [x] Degradation: Plain (v1) round fully winnable on the static grid, audio muted by default; Reduced tier (reduced-motion) stays unaffected and fair

**Implementation (S10):** the a11y surface was built in over S3–S9 (`sr-only` field labels, `:focus-visible` rings on every control via the `--focus-ring` token, `aria-label`s on the rune-card buttons that carry power + light/dark in the accessible name, no-color-alone trait text, the global `prefers-reduced-motion` cut in `theme.css` plus the GSAP-skip in `RuneGrid`/`EndScreen`). S10 **proves** it rather than adding to it: an axe sweep (`@axe-core/playwright`, `wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa`) over every surface — the live board, the crossed + armed states (both rune palettes on screen at once), the first-run title, the coach-mark tour, the reaction prompt, and both end screens — comes back with zero violations; a keyboard suite plays the whole round (arm → select → name it, ask, cross, Hex) with no pointer and asserts the focus ring + untrapped Tab order; reduced-motion is checked at the component level (the end-screen verse and the board entrance are present at full opacity at once) and end-to-end (a full round is winnable with motion cut). v1 ships **no** audio and **no** WebGL, so "audio muted by default" is structural (nothing to unmute) and reduced-motion is the only reduced tier.

**Tests landed:** [E][A] keyboard round + full keyboard cast path, visible focus ring, untrapped Tab order (`a11y.e2e`) · [A] axe names/roles + contrast + color-independence across all surfaces (`a11y.e2e`) · [C] reduced-motion motion-instant + still-live (`reducedMotion.svelte.test`) · [E] Reduced-tier round winnable + fair, no audio element (`degradation.e2e`) · [E] 750px embed floor / best-on-desktop notice below 750 (`board.e2e`). [S] fairness invariant is the in-CI round-solvability property test (engine).

**Done when:** the a11y suites are green in CI. _(The literal Lighthouse-a11y CI gate is **not** wired: the global no-lhci-in-GHA rule stands, so the in-CI a11y gate is the axe sweep — run in the existing e2e step, failing the build on any violation. `lhci autorun` stays available locally via `make perf` for the ≥ 0.95 score check.)_

---

## S11 — Voice / copy conformance + error states

*Cross-cutting lint, runs once the strings exist. Depends on: S2–S9.*

- [x] No emoji in diegetic copy; no exclamation in any diegetic line (Sköll's cast line — the old winning-cast exclamation allowlist — was cut)
- [x] Banned arcade/idiom strings absent ("Correct!/Wrong!", "Play again", "Game over", "?"-only CTAs)
- [x] World-noun terminology enforced (rune, Ask/Cast, power, light/dark, hue, Scry/Hex — never "card")
- [x] Sköll vs Oracle lines attributable to the correct speaker — his only on-board line (his Ask) speaks in his own first-person predatory voice ("I scent a fire rune on her."), so the speaker is unmistakable and unit-guarded (`ux-copy.md` §2; the live-LLM speaker **eval** is the S12 deliverable)
- [x] Connection/engine error shown in-world ("The Oracle falls silent…") **without** losing crossings or turn state _(the error path swaps only the voiced line — crossings live in `RuneGrid`, turn state is engine-hydrated — and the dedicated preservation [I] test guards it: a failed Ask dispatch leaves the crossing and the turn pill untouched, `page.svelte.test`)_

**Implementation (S11):** a conformance pass over every diegetic string, bringing the built copy into line with the refreshed `ux-copy.md` voice (the "first implementation" had drifted). Fixed: the tagline (`A rite for the longest day.` in `Onboarding.svelte` + `+page.svelte`), the mixed-type refusal (`element`, not `fire`, in `oracle.ts`), the connection-error line (`Draw breath, and ask again.` in both `oracle.ts` and the page's `RITE`), Sköll's Hex line (`Your question dies in the dark.`), and the over-long best-on-desktop notice (trimmed to spec). Added the **missing §3 Scry framing** — the human-Scry result now leads with `You lean into the dark and listen. His answer is yours too.` before the overheard answer, instead of surfacing the bare answer with no voice. Restored the onboarding tour to the fuller, more mythic `ux-copy.md` §5 copy and reordered it to **Cast before Scry & Hex** (matching §5 and the S7 note). Wired the §3 reaction **tooltips** (`title`) onto the Scry/Hex affordances. **Sköll's on-board Ask** is voiced in his own first-person predatory register per the Cast Voice Charter (`skollAskEcho`, `skoll/skoll.ts`; `ux-copy.md` §2): "I scent a fire rune on her." / "A gold rune. Mine." / "Light or dark — I taste a dark one." / "Sowilo. I name it in the dark." / "Three power. I can smell it." — power 1–6 spoken as a word, not the Oracle's digit grammar, so the two speakers never collide; the internal Gemini payload keeps `valuePhrase` for model-facing facts. Every per-surface copy assertion (`oracle.test`, `Onboarding.svelte.test`, `page.svelte.test`, `page.server.test`, `api/action/server.test`, `board.e2e`) was updated to the corrected strings, and `skollAskEcho` gained `[U]` coverage across every axis + all five power ops + a no-`asks after`/no-exclamation guard (`skoll.test`).

**Tests to land:** [A] string + terminology lint · [Eval] speaker-distinctness · [I] error-state preserves crossings/turn. _(The error-state preservation [I] test landed in `page.svelte.test`. Still deferred to the S12 gate: the consolidated automated voice/terminology **lint** and the live-LLM speaker-distinctness **eval** — the strings conform and the per-surface copy assertions hold, but those two proofs are intentionally not built here.)_

**Done when:** the voice/terminology lint reports zero diegetic violations in CI. _(Open — the strings now conform, but the automated CI lint that proves it stays the S12 deliverable.)_

---

## S12 — CI gates lock (the v1 ship gate)

*Final gate before June 21. Depends on: all above.*

- [x] Coverage floors pass: Engine 100/95 · Fallback 95/90 · Action interface 90/85 · Oracle 90/85 · Reactions 95/90 · UI 80/70 · Project overall 85/80 (Graphics 60 moved to v1.5 with the image layer)
- [x] Lighthouse a11y ≥ 0.95 enforced as an lhci `error` assertion in the pre-push gauntlet _(lhci is deliberately kept out of GHA CI; the gate runs on every push instead)_
- [x] Round-solvability property test passes across all seeds (no unwinnable rounds; Oracle never lies)
- [x] Secret-leak security assertion passes (engine API + Sköll payload)
- [ ] Voice/terminology lint passes (zero violations) _(open — the per-surface copy assertions hold across the suite, but the consolidated automated lint is not built; matches the S11 "Done when")_
- [x] High-risk gaps confirmed covered: non-argmax test · turn-accounting on **every** refusal class · crossed-rune cast · cast sacredness · degradation fairness · secret never in Sköll's payload
- [x] Public social cards and author footer ship in SSR HTML, with the card image resolving from the served build _(`meta.e2e`)_
- [x] Local WOFF2 fonts and the optimized button-border WebP preload as immutable assets; the shared `.btn` frame uses the hashed border and no Google Fonts stylesheet _(`meta.e2e`)_
- [x] Deployed, playable, public URL confirmed live

**Done when:** every gate is green and the public build plays a full fair round end to end.

---

## Deferred — do not start before v1 ships

**v1.5 (fast follow), in order:**

1. Gemini voice interaction
2. ~~Screen-reader narration & navigation — `aria-live="polite"` on the Rite transcript and every Oracle answer/refusal; per-card full trait + crossed-state exposure; turn-change announcements~~
3. ~~Graphic elements in UI~~
4. ~~Splash screen~~
5. Sköll escalation taunts wired to candidate-count

**v2 (immersion build), in order:**

1. Night→dawn mood — continuous tide + event stingers, Sköll and Sól embodied; degrades per the contract, nothing essential depends on it
2. Ambient audio bed — looped, crossfading, pausable, muted by default, ambient only
3. Cast win animation — glyph carves into stone + luminous Sól beat; honors reduced motion
4. Voice interaction with Gemini — speak the Ask, hear the Oracle/Sköll (TTS)
5. Wrong-cast penalty — cap ≈2 wrong casts per player (threshold on the v1 counter; alternation unaffected)
6. ~~Small-desktop support down to 750px — compact embedded board at 750px+, best-on-desktop notice below that floor~~
7. Asset delivery pipeline — generate AVIF/WebP fallbacks for large stone, banner, chalk, and rune assets; ship responsive variants where the UI has multiple display sizes; keep a checked bundle-size budget so deploy cost and first-load weight do not creep back up
   - [ ] Cleanup: align all generated image assets to one stable stylized art direction before adding more format variants
   - [ ] Generate AVIF/WebP fallbacks for large stone, banner, chalk, rune, element, color, and fill assets
   - [ ] Ship responsive image variants anywhere the same art renders at materially different sizes
   - [ ] Add an enforced bundle-size budget for first-load image weight and total client assets

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
