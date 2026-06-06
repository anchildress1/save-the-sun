# Save the Sun — Design Spec

Design intent for the game. Mechanics in [`game-spec.md`](game-spec.md), rune data in [`rune-board.md`](rune-board.md), voice and copy in [`ux-copy.md`](ux-copy.md). UI built in Claude Design; mood layer built by hand around it.

Lineage: [*Carbon Trace*](https://dev.to/anchildress1/forged-between-coal-and-code-phi) is the immersion craft; [*Unearthed*](https://dev.to/anchildress1/unearthed-the-coal-mine-behind-every-light-switch-234m) is the proof a dry dataset can be made to *feel*. Both degraded gracefully and both shipped at Lighthouse a11y ≈ 1.0. This inherits that standard.

---

## Problem

Deduction games are mechanically satisfying but emotionally inert — they feel like solving a spreadsheet. The solstice theme deserves more than an attribute grid. The design problem is to keep a clean, fair deduction race intact while making the player *feel* the longest night close toward dawn. The deduction grid is our spreadsheet; the night→dawn mood is our Ticker — the layer that turns data into feeling. Without it, the game is a competent puzzle no one remembers.

## Vision

A two-player race to name one hidden rune before Sköll, the wolf who hunts the sun, names it first — wrapped in an immersive night-to-dawn ritual, not presented as a logic grid. The deduction stays rigorous and deterministic; the world around it breathes, darkens under Sköll's presence, and brightens as the player narrows in.

"Movement card game" means the experience moves and breathes — kinetic, mood-driven immersion — not a card-manipulation mechanic. The 24 runes render as a grid of rune cards because it's a game and should look like one, but cross-off is their only *deduction* action — casting uses a separate armed mode (see UI Direction). The grid form is deliberate over a sorted table: patterns don't jump out, which keeps the deduction honest, and a card grid suits the mood layer better than a spreadsheet would.

## Goals

1. A complete, winnable round ships playable — engine, Oracle, human loop, win-on-cast, and a functioning Sköll, deployed to a public URL.
2. The round feels like a night, not a quiz — a first-time player describes the mood and the race before they describe the mechanics.
3. Immersion never costs correctness — with all mood graphics and audio off or failed, the game is fully playable and fair on the plain grid.
4. Deduction is honestly solvable — every round is winnable through legal Asks alone, and the Oracle never lies.
5. It reads as authored, not generated — the Oracle / Sköll / Sól voice holds the "mythic gravity with a dry wink" bar end to end.

## Non-Goals

1. **Multiplayer / human-vs-human.** Sköll is the only opponent.
2. **Accounts, persistence, leaderboards, matchmaking.** Single-session play; a refresh starts a new night.
3. **Adaptive Sköll difficulty or profiling.** Sköll responds only to the current round state. There is no cross-round learning, player profile, or rubber-banding; the deterministic policy is a fallback floor, not the opponent.
4. **Any literal card mechanic** — deck, hand, draw, discard, or drag-to-cast. Runes are cards visually; the only action is cross-off. Scry/Hex are one-use reactions, not cards.
5. **Original recorded voiceover.** Audio is ambient beds, not authored narration.
6. **Mobile-first polish.** Desktop web is the target surface; small screens get a "best on desktop" notice rather than a responsive reflow.
7. **Localization.** English-only build; the world-noun consistency in `ux-copy.md` is for voice, not translation.

## Players & Audience

- **You** — the witch making the offering (human player). "Witch" is the gender-neutral coven role.
- **Sköll** — the rival racing you (AI opponent).
- **The Oracle** — the seer who reads your questions and answers truthfully to its echoed interpretation.

Audience: the jam judge / dev.to reader who plays a round or two and needs to *feel* the concept fast; the casual deduction player who knows Clue/Wordle/Guess Who; and the accessibility-dependent player, for whom the plain grid is the full experience.

## Experience Pillars

### Mood spine — tide and stingers
This layer is the **v2** target. v1 ships the graphics rune grid and the playable race; the atmospheric mood below is what v2 adds on top. Mood runs on two synchronized layers, the way *Carbon Trace* ran ambient beds under one-shot narration. Mood and voice intensity follow the dials already set in `ux-copy.md` (the Cast Voice Charter and the night-progress chrome) — this doesn't redefine them.

- **Continuous tide (the night→dawn arc).** Keyed to the night-progress chrome in `ux-copy.md`: *"The dark holds" → "The dark thins" → "Dawn is close,"* driven by elapsed turns. Ambient bed, background luminance, and Sköll's presence shift continuously along it. Sköll closing in darkens the tide; the player narrowing brightens it.
- **Event stingers (discrete one-shots) over the tide.** Short spikes on specific beats — a resolved Ask, a Sköll taunt, a Cast arming, a wrong cast, the win or loss — that resolve back into the tide without disturbing it.
- **Characters embody the arc.** Sköll is a visible character — the hunting wolf whose presence darkens the tide — paired with Sól, the dawn the brightening resolves toward (she appears fully only at victory, per `ux-copy.md`). The arc belongs to them, not to abstract weather.

### Degradation — the safety net
The experience composes in tiers, each fully playable:

1. **Full** — tide + stingers + ambient audio.
2. **Reduced** — `prefers-reduced-motion`, or WebGL/audio unavailable: tide and stingers cut to instant state changes, audio muted, grid static. Game unaffected.
3. **Plain** — the graphics grid with no mood layer. This is v1; the mood tiers above are v2 and attach to it. Audio is muted by default and unmuted by an in-world control — nothing essential depends on sound.

A mood feature that can't degrade cleanly to the tier below it doesn't ship.

### Voice as an instrument
Mood is carried as much by language as by graphics. The Oracle's reverence, Sköll's escalating hunger, and Sól's single luminous victory line are part of the immersion layer, not decoration. Sköll's escalation taunts are the audible form of the tide darkening.

## UI Direction

Built as high-fidelity DOM components orchestrated by GSAP — not Canvas/WebGL. Claude Design sets the visual direction. The grid uses CSS `mix-blend-mode` and radial gradients for its lighting engine, avoiding the performance tax of constant WebGL or heavy SVG filters on steady-state elements. Transient SVG filters (`feDisplacementMap`) are reserved for hero moments like the Cast stinger. The rendering uses native focusable elements so it naturally supports keyboard play and the v1.5 screen-reader layer without needing a separate shadow DOM.

- **Header:** title "Save the Sun" + tagline "A rite for the longest day," the night-progress indicator, and a turn pill ("Your move." / "Sköll moves.").
- **Rune grid (left / main):** 24 rune cards, 6×4. Each card shows the glyph, a color swatch, name + meaning, the **power** value as pips — count = power, fill = light/dark (hollow ○ = light, solid ● = dark) — with its numeral, the element symbol + name, and the color name. Cards cross off in place; a crossed card dims with a restore affordance. The color name and element name always accompany their icons, and light/dark rides the pip fill plus the card's accessible label — color is a game trait, so nothing is conveyed by color alone.
- **Right column:** the Rite transcript (You / Oracle / Sköll, with interpretation echoes) → the Reactions panel (Scry · Hex) → the "Ask the Oracle — one sign at a time" free-text input with suggestion chips → the "Cast the rune" button.
- **Casting flow.** "Cast the rune" arms **Cast mode**. While armed, the grid stops crossing off and a card tap (or keyboard select) instead *chooses the target* — the chosen rune highlights and the chrome reads "Cast?". "Name it" commits the cast; "Not yet" cancels back to normal mode with no turn spent. Outside Cast mode, a card tap only crosses off. So a card carries two scoped behaviors — cross-off normally, select-target while armed — and they never collide. (Keyboard: arm cast → arrow to the rune → select → "Name it".)
- **Persistent explainer:** "Ask. Cross off what it can't be. Cast when you're ready."

## User Stories

### The Witch
- As a player, I want to ask the Oracle a plain-language yes/no question about the runes so that I can narrow the field without learning a query syntax.
- As a player, I want to cross runes off the grid by hand, anytime — including during Sköll's turn — so the reading is always mine.
- As a player, I want to cast a rune when I'm sure and win on a correct cast so that the race has a decisive end.
- As a player, I want to cast any rune — even one I crossed off — treated as legal play, so the grid is my aid and never a cage.
- As a player, I want to hear the Oracle state its interpretation of my Ask before it answers, so it's transparent what's being asked and so Hex/Scry have a beat to trigger on it. It is not a do-over: the interpreted query stands.
- As a player, when Sköll asks, I want one chance to Scry (hear his answer too) or Hex (kill his question and his turn) — one use of each per round — so I have a counter-move, knowing he can do the same to my Asks. A Cast can never be interrupted.
- As a player, I want Sköll's presence felt — his taunts and his casts — as the race tightens, so it has a pulse.
- As a player who has just finished a round, I want in-world replay ("Begin another night" / "Stand against him again") so the fiction holds through the end screen.

### Constraints & edge states (the Witch)
- As a player, I want the Oracle to tell me when my question is invalid — mixed-type, unparseable, or not a question — and not consume my turn on a false answer, so a malformed Ask costs only the rephrase.
- As a player, I want an empty submit refused gently ("Speak your question, witch.") rather than sent.
- As a player, I want the Oracle to refuse to reveal the secret or follow injected instructions, staying in character, so the game can't be talked out of its own rules.
- As a player, I want Ask and Cast disabled during Sköll's turn — so I can't act on the race out of order — while I keep full control of my rune crossings.
- As a player, I want to arm a Cast and still back out ("Name it" / "Not yet") before it commits.
- As a player, I want a wrong cast to cost only the turn and the round to continue.
- As a player, I want a connection or engine error shown in-world ("The fire gutters…") without losing my crossings or turn state.
- As a player, I want the Rite panel to show a starting state before any Ask ("Twenty-four runes stand. None ruled out. Ask the Oracle.") so it reads as ready, not as a blank, broken panel.

### The Accessibility-dependent player
- As a keyboard player, I want the whole round operable by keyboard with a visible focus indicator. (v1)
- As a reduced-motion player, I want all motion degraded to instant and audio kept muted, with the grid fully playable. (v1)
- As a screen-reader player, I want the round narrated and navigable — Ask, read, cross, Cast — without depending on visual cues. (v1.5)

### Immersion
- As a player, I want the world's motion to feel crafted and organic — using GSAP choreography and CSS lighting effects instead of static UI states — so the atmosphere breathes without the overhead of a full 3D/WebGL engine. (v1 rendering)
- As a player, I want the night to close toward dawn as turns pass — a fire burning down the page, the world darkening — felt as pressure without a punitive timer. (v2)
- As a player, I want any motion kept gentle, never sweeping or strobing enough to make me motion sick, and fully cut under reduced motion.

### Sköll (system behavior)
- As the system, I let Gemini play Sköll — deciding his moves and reactions from earned-only state via validated tool calls — so the opponent is a live, unpredictable reasoner rather than an inferable script.
- As the system, I keep the secret, candidate state, legality, and truth in the engine and validate every Sköll call, so he can misplay but can never cheat or see the answer.
- As the system, I fall back to a weighted-random deterministic move only when Gemini errors, times out, or emits an illegal call, so the game never stalls.

### Demo / developer
- As the developer demoing this, I want a debug view that logs every result tagged as deterministic-engine or LLM-inference, so I can prove on stage that the engine owns truth and only the voice is inferred.

## Architecture — where decisions live

**Gemini plays Sköll. The engine referees.** Sköll's moves and reactions are Gemini's decisions, made by responding to the current state each turn — not a script. We don't want Sköll to *learn*; we want him to *respond*: no memory across rounds, no profile of the player, every decision read fresh from the state in front of him. Two reasons this beats a deterministic opponent: a deterministic Sköll is *inferable* — a player could predict his every move and play him like a puzzle — and a deterministic Sköll reduces Gemini to flavor text, which is indefensible in a Gemini jam. Letting Gemini decide makes him unpredictable, and **his capacity to misjudge a move is the point** — a fallible reasoning opponent is more alive than a perfect script.

The engine is the referee and the single source of truth. It owns the board, the secret, candidate state, legality, truth resolution, and win/cast checks, and it **never hands Gemini the secret**. Sköll decides from **earned information only** — his own candidate list, answers to his own asks, anything he scries — and every tool call he emits is validated for legality before the engine resolves it. Gemini can play badly; it cannot cheat or see the answer.

**Deterministic fallback — the floor.** A weighted-random policy (R5) stands behind Gemini and fires *only* when Gemini fails: an error, a timeout, or an illegal/malformed call. It is not a quality filter — a legal-but-suboptimal Gemini move stands. The floor exists so a live demo can't hard-fail.

Gemini's other role is the **Oracle** (unchanged): it interprets the *human's* free-text Ask into one structured query and voices the engine's truthful answer. So inference drives both sides' *intent* — the human's via the Oracle, Sköll's via his own bare LLM call — while the engine owns every *fact*. The debug view (R8) shows Gemini's reasoning beside the engine's truth and flags any turn the fallback fired; that contrast is the demo.

## Requirements

Three milestones: **v1** ships for the jam (June 21); **v1.5** is the fast follow; **v2** is the immersion build. The engine, Oracle, and Sköll are written fresh for the graphics build.

### v1 — the jam build

**R1. Deterministic engine** over `rune-board.md`. Truthful trait resolution; single source of truth for board, query, win, and cast. **Exactly one secret rune per round, and only that rune wins a Cast** — every other Cast fails. (Runes and their unique combinations are already defined; the engine consumes them.)

**R2. Oracle pipeline.** Free-text → public interpretation echo → one structured query → truthful answer, voiced in character. Mixed-type, secret-seeking, and override Asks are refused with the matching `ux-copy.md` line and never return a false answer. The echo is transparency now and the reaction trigger later (R12) — not a do-over.

**R3. Ask & Cast as two distinct actions.** The engine validates only the Cast and accepts any rune, crossed or not. Cross-off is a private aid available **anytime, including Sköll's turn**; during Sköll's turn only Ask and Cast are disabled. **Cast target selection:** "Cast the rune" arms Cast mode; while armed, a card tap / keyboard-select chooses the target (not a cross-off), "Name it" commits, "Not yet" cancels with no turn spent (see UI Direction → Casting flow).

**R4. Human loop + win on correct Cast** — strict alternation, human first; a wrong Cast wastes the turn.

**R5. Sköll — Gemini plays, engine referees, deterministic floor.** Gemini decides Sköll's move and reactions each turn, responding to his earned-only state through validated tool calls; the engine resolves them and owns all truth (see Architecture). He keeps his own candidate sheet by crossing off cards via a tool — the same way the human does, and just as imperfectly — casts at his own judgment, and may misplay; a wrong cast just wastes his turn, and that fallibility is intended. He never sees the secret; illegal or malformed calls are rejected by the engine.

Persona & reasoning (acceptance criteria):
- **Prompt him as a human player, never as an AI.** The system prompt casts Gemini as a *person* playing the rite and reasoning it through — not a model solving a puzzle. Sköll is a **bare LLM call reasoning in natural language** — not an agent and not code-driven; he acts only through the game's function-calling tools (ask, cross-off, cast, and the reactions) and reasons everything else in words. No probability math, no entropy calculations, no exhaustive enumeration, no superhuman pattern-spotting.
- **Deduce at roughly a 12-year-old's level — encoded explicitly, not left as an adjective:**
  - Reason one clue at a time and cross off what that clue plainly rules out; do **not** perform full multi-trait cross-product elimination or hold all four axes in mind at once.
  - Work from the visible board and your own cross-offs, not a perfect internal model; you may overlook eliminations you were entitled to make.
  - Choose questions that feel useful — a trait not yet asked, a group you suspect — not the information-optimal split; an occasional redundant question is fine.
  - Cast when you feel sure enough (e.g., down to a couple of candidates), accepting you might be wrong — not only at mathematical certainty.
  - Honest mistakes (a missed elimination, a hasty cast) are expected and allowed, not bugs.
- **Sköll crosses off his own cards via a tool** (cross-off / restore), exactly as the human crosses the board. This **is** his working memory: his deductions are tool actions, traceable in the debug view (R8), and imperfect by design.
- **He sees the board as a human sees it.** Pass the board as structured JSON **in the fixed on-screen order**, and tell him explicitly **not to reorder or sort it**. The point is to reason over the board as presented — we want REASONING, not computation over a sorted set.

Deterministic fallback (acceptance criteria — this is the floor that fires **only** on Gemini error, timeout, or illegal call; never as a quality filter on a legal move. Build the fallback as weighted-random, do **not** build argmax/optimal selection):
- Build the candidate question set from only legal, well-formed queries about still-live candidates; exclude any query already asked and any that does not split the live set (all-yes or all-no).
- Score each remaining query by split quality — closeness to an even yes/no split of the live candidates. Closer to a 50/50 split scores higher. Suggested weight: `1 / (1 + |yes − n/2|)`, where `yes` is how many live candidates answer yes and `n` is the live count.
- Select the query by **weighted-random sampling** over those scores. The best-splitting question is the most likely, but every legal splitting question keeps a real, non-zero chance. Do not take the maximum.
- Difficulty = how peaked the weighting is: Medium uses moderate peaking (clearly beatable); a harder mode would peak toward optimal, an easier mode would flatten toward uniform.
- Cast when exactly one candidate remains. If no splitting question exists before that point, cast the best remaining candidate.
- All candidate state, legality, and truth resolution stay in the deterministic engine; Gemini only voices the chosen action.

**R6. Graphics presentation.** The rune grid is rendered using high-fidelity DOM elements orchestrated by GSAP, with CSS `mix-blend-mode` and radial gradients for lighting. SVG filters (`feTurbulence` / `feDisplacementMap`) are reserved exclusively for transient "hero" moments (like the Cast transition) to preserve steady-state performance. An accessible DOM layer sits natively on top for text and controls. Claude Design sets the visual direction.

**R7. First-run intro** — a skippable coach-mark tour over the live board, plus the title screen.

**R8. Debug view** — a log output tagging each result deterministic vs LLM-inference, for the demo.

**R9. Accessibility basics (screen reader deferred to v1.5).** v1 must cover keyboard operability with visible focus, semantic labels for controls, no information by color alone (the color name accompanies every swatch; element carries text and light/dark is carried by the pip fill and the accessible label), WCAG 2.1 AA contrast including the dark palette, `prefers-reduced-motion` cutting motion to instant and keeping audio muted while responding to live changes, operability at 200% zoom, and a Lighthouse a11y pass in CI. Full screen-reader narration/navigation is v1.5.

**R10. Best-on-desktop notice** on small screens — no responsive reflow.

**R11. End screen** — win/lose lines and in-world replay.

**R12. Scry & Hex reactions.** One use each per player, per round; both trigger on an **Ask**, never a Cast (the win check is sacred). On the active player's Ask, the rival gets one interrupt window: **Scry** (also hear the answer) or **Hex** (kill the question — no answer, the turn is spent). The player chooses via the interrupt prompt; Sköll's reaction is one of Gemini's responses (engine-refereed, deterministic-fallback per R5). The R2 interpretation echo is what a reaction triggers on. (Pulled into v1 because real-time reaction is core to a responding opponent.)

### v1.5 — fast follow

- **Screen-reader narration & navigation** — the Rite transcript and every Oracle answer/refusal announce via `aria-live="polite"`; each rune card exposes its full trait set and crossed state; turn changes announce.
- **Splash screen.**
- **Sköll escalation taunts** wired to candidate-count.

### v2 — the immersion build

- **Night→dawn mood** — the continuous tide (a fire burning down the page, the world darkening along the turn arc) plus event stingers, with Sköll and Sól embodied as characters. Degrades per the degradation contract; nothing essential depends on it.
- **Ambient audio bed** — looped, crossfading, pausable; muted by default; ambient only (no voiced lines).
- **Cast win animation** — the glyph carves into stone, with the luminous Sól victory beat; honors reduced motion.
- **Voice interaction with Gemini** — speak the Ask aloud and hear the Oracle/Sköll voiced (TTS), over the same action interface.
- **Wrong-cast penalty (locked: capped wrong casts).** v1 already costs you the turn on a wrong cast; v2 *adds* a cap — each player gets ≈2 wrong casts, and exceeding it forfeits the ability to cast (you can only lose from there). This is a per-player counter in the engine; **strict alternation is unaffected, so no turn-injection state machine is needed.** (Rejected: "Sköll gains a turn," which would have broken alternation; no turn timer.) Cheap to drop in later — the engine may track the wrong-cast count from v1 so v2 is purely a threshold.
