# Save the Sun — Build Spec

Behavior contract for the AI building the game. Rune data in `rune-board.md`. Player-facing copy in `ux-copy.md`.

## Story

It's the eve of the longest day — midsummer, when the sun should climb highest and rule the bright half of the year. But the dawn must be earned. Through the one short night before it, the coven makes the solstice offering to **Sól**, the sun goddess — one true rune, cast correctly before the dark breaks, and she rises to crown the longest day. But **Sköll**, the wolf who hunts the sun, is racing you for that same rune. Cast it first and the offering is made: the sun climbs and the long days come. Let Sköll steal it first and he swallows the dawn — the longest day never breaks, and the year falls to dark.

Mechanically this is a two-player race to identify the same secret rune. Roles:
- **You** — the witch making the offering (the human player). "Witch" is the gender-neutral coven role — any member, any gender.
- **Sköll** — the rival racing you (the AI opponent, Role 2).
- **The Oracle** — the seer who reads your questions and answers truthfully to its echoed interpretation (Role 1).

## Players

- 1 human vs 1 AI opponent (Sköll, an LLM agent playing through the same action interface as the human).
- Both race the same secret rune. Human moves first. First to cast it correctly wins.

## Board & Tracking

- 24 runes, fully visible all game with their traits shown (`rune-board.md`). The secret is which one is the target.
- Queryable traits: **element** (6 values, 4 runes each), **power** (1–6, 4 runes each), **fill** (light ○ / dark ●, 12 runes each), **color** (6 values, 4 runes each). Player-facing copy calls the color axis **hue**; engine/data structures keep `color`.
- Every rune is a unique trait combination.
- The glyph is shown at cast.
- Tracking is a list of the 24 runes, crossed off by hand. The player owns all deduction: they read the board, decide which runes a clue rules out, and cross them manually. That mapping is the game.
- **Crossing-off is the player's private aid, not an engine constraint.** The player may cast any rune at any time, including one they've already crossed off; the engine never validates a Cast against the player's crossings. Casting a crossed rune is legal play, not an error.

## Core Loop (strict alternation, human first)

One action per turn, chosen by the player:

- **Ask** — a free-text yes/no question to the Oracle: a group ("is it a water rune?"), a range ("fewer than 3 power?"), fill ("is it a light rune?"), hue ("is it gold?"), or a single rune ("is it Sowilo?", which eliminates that one). The Oracle echoes its interpretation, the engine answers the interpreted query truthfully, the player crosses runes off by hand. Turn ends.
- **Cast** — a separate action: name one rune. Correct wins. Wrong wastes the turn.

Winning happens only through Cast; asking is always information. The game runs until someone casts correctly.

## Oracle (Gemini, Role 1)

- Translates the player's natural language into a structured engine query, then voices the engine's answer in character.
- The engine owns all truth; the Oracle voices it truthfully for the structured query it produced.
- Echoes its interpretation before the answer. The echo is the player's warning: if the Ask resolves, the interpreted query stands, even when it differs from what the player meant.
- One query type per Ask: element, power, fill/light, hue, or one rune name. Ranges and comparisons are allowed for power ("fewer than 3?", "at least 2?"). Refuses mixed-type questions, secret reveals, and instruction overrides. Refused Asks do not consume the turn; a resolved Ask does.
- Gemini Flash / Flash-Lite. Answer voicing may be templated. Lines in `ux-copy.md`.

## Opponent — Sköll (Gemini plays; engine referees, Role 2)

- **Gemini decides Sköll's moves and reactions, responding to his earned-only state via validated tool calls.** The engine referees: it owns the secret, candidate state, legality, truth, and win/cast checks, and validates every call before resolving it. Sköll can misplay but can never cheat or see the secret. (Authoritative detail: the PRD's "Architecture — where decisions live.")
- Keeps its private rune list in the engine and casts from information it earns; he sees the secret never, only what he deduces through play.
- **Respond, not learn.** No memory across rounds, no player profile — every decision is read fresh from the current state. Sköll's fallibility is intended; an unpredictable reasoner beats an inferable script.
- **A bare LLM call, not an agent.** Sköll reasons in natural language and acts only through the game's tools — including crossing off his own cards, the way the human does. He plays at roughly a 12-year-old human level (encoded in PRD R5): one clue at a time, no superhuman pattern recognition. He's handed the board as JSON in fixed on-screen order and told not to reorder it — reason, don't compute.
- **Deterministic floor.** A weighted-random policy (PRD R5) plays Sköll's move only when Gemini errors, times out, or emits an illegal call — never as a quality filter. It keeps a live demo from hard-failing.

## Reactions — Scry & Hex

> **Core (v1).** Pulled into v1 because real-time reaction is how a responding Sköll plays — the interrupt window is where Gemini's judgment shows. These are one-use **reactions**, not cards: there is no deck, hand, or draw. (Priority is set by the PRD's v1/v1.5/v2 milestones, which supersede the P0/P1/P2 list below.)

One charge of each per player per game. **Both reactions trigger on an Ask; a Cast resolves uninterrupted (the win check is sacred — nothing can touch a guess).** Resolution order:

1. Active player submits an Ask (text) or declares a Cast (named rune).
2. The Oracle announces its interpretation of the Ask (public); a Cast shows the named rune (public).
3. **Interrupt window (Asks only)** — the rival may use at most one reaction in response to the Ask:
   - **Scry** (formerly Eavesdrop) — the rival also sees the answer about to be returned.
   - **Hex** (formerly Hang-Up) — cancels the Ask before its answer: no answer is returned and the active player's turn is wasted. Triggers only on an Ask.
4. The engine resolves: an Ask returns its yes/no answer (private to the active player, plus a Scry-er) — unless Hexed, in which case no answer is returned; a Cast runs its win check, always uninterrupted.

Both reactions fight over the same Ask: Scry steals the information, Hex denies it. Only one may be used per interrupt window. If Hex is used, no answer exists for anyone to Scry. Neither can be used on a Cast. A spent reaction is gone for the rest of the game.

## Visibility

- Own rune list / crossings: private. The engine validates wins.
- Opponent's casts: public (the cast is seen).
- Opponent's questions: only the Oracle's interpretation is shown; the answer stays private unless Scried.

## Architecture

- Deterministic engine = referee and single source of truth: board, secret, query resolution, win/cast logic, reaction resolution, and validation of every Sköll tool call. Gemini decides Sköll's moves/reactions; the engine never exposes the secret to it.
- All actions route through one shared action interface used by both the human UI and the Gemini-driven opponent. Gemini function-calling tools, in-process.
- Build order: engine → Oracle → human loop → win/cast → reactions → opponent (Gemini Sköll + deterministic floor).
- Single Cloud Run service (frontend + backend + engine; Gemini called outbound).

## Requirements

> Priority is authoritative in the PRD's **v1 / v1.5 / v2** milestones. The P0/P1/P2 list below predates that split — where they disagree, the PRD wins. Notable moves: Scry/Hex and the Gemini-driven Sköll are **v1**; the deterministic policy is the **fallback floor**, not the opponent.

### P0
- Engine: 24-rune board, truthful trait resolution, unique-combination guarantee.
- Free-text input → Oracle → structured query → engine answer to the interpreted query, with interpretation echo.
- Ask and Cast as two distinct player actions. Player crosses runes off a 24-rune list by hand; the engine validates the Cast (accepting a cast of any rune, crossed or not).
- Human play loop, win on correct Cast.
- Oracle guardrails: one query type per Ask, secret stays hidden, instruction overrides refused.
- Opponent: Gemini plays Sköll through the action interface with its own sheet; engine referees and validates; weighted-random deterministic floor on Gemini failure.
- Scry & Hex reactions (one-use each, on an Ask; Cast is sacred).
- Deployed, playable web app.

### P1
- Weighted-random deterministic policy (the Sköll fallback floor; PRD R5).

### P2
- Sköll escalation taunts — wire to candidate-count when time allows.
- Cast win animation (glyph carves into stone; PRD v2).
- Opponent early-cast behavior (cast before fully narrowed). Low priority — a wrong early cast wastes a turn only.

## Constraints

- Solo developer. Submission due June 21, 2026, 11:59 PM PDT (June Solstice Game Jam, dev.to).
