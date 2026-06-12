# Voice Interaction Spec 🎙️

> Save the Sun — talk to the Oracle, hear the wolf answer.
> Status: Draft v1 · 2026-06-10

---

## Problem Statement 🌑

The game's core loop—Ask, Hex, Scry, Pass, Cast—runs entirely on buttons and a text box. For a game framed as a spoken rite with an Oracle, typing questions into a form undercuts the fiction. Players should speak to the Oracle and be spoken to, with the wolf reacting from the dark, while every existing button keeps working exactly as it does today.

## Goals 🎯

1. A player can complete a full game turn hands-free after one initial tap (mic button), using voice for Ask, Hex, Scry, Pass, and Cast the Rune.
2. The Oracle responds in real time with natural interruption—the player can talk over her and she yields.
3. Sköll reacts audibly to player taunts and game events with no perceptible playback delay.
4. The display always shows an unambiguous listening state; the mic never listens without the player knowing.
5. Voice and buttons are equivalent inputs—identical engine behavior regardless of input path.

## Non-Goals 🚫

- **Wake word.** The session starts from the mic button; the game does not listen for "hey Oracle."
- **Voice during the Cast animation.** Cast is uninterruptible by game rule; voice input during a Cast is rejected, not queued for the Cast itself.
- **Additional voiced characters.** Two voices: the Oracle and Sköll. Sól does not speak.
- **Speech-driven navigation.** Menus, settings, and splash screens remain click-only.
- **Multilingual support.** English only for v1.

## Decisions Locked 🔒

| Decision | Choice |
|---|---|
| Oracle voice channel | Gemini Live API, one session, client-to-server WebSocket |
| Oracle voice | `Gacrux` (mature) — swappable, single config value |
| Sköll voice channel | Pre-generated Gemini TTS clip library, played locally |
| Sköll voice | `Algieba` (smooth) — swappable, regenerate library to change |
| TTS model | `gemini-3.1-flash-tts-preview` |
| Auth | Ephemeral tokens minted by the existing Cloud Run server; API key stays in Google Secret Manager and never reaches the browser |
| Mic activation | The eclipse medallion is the control: tap to wake, tap to sleep. A small mic glyph is etched into the medallion while asleep for discoverability. One tap satisfies the browser gesture requirement for mic + audio |
| Voiced answers | While the session is awake, the Oracle speaks her answers regardless of input path—typed questions get voiced replies |
| Captions | All spoken content also lands as text (Answer panel for the Oracle, captions for Sköll) |
| Output mute | One speaker toggle silences both characters; captions carry the content |
| Silence timeout | 5 seconds of no recognizable speech → mic sleeps silently, UI falls back to buttons until tapped again |
| Action safety | Scry and Pass execute immediately; Hex and Cast the Rune require spoken confirmation through the Oracle |
| Turn parity | Voice intents call the same engine functions as the buttons; buttons never disappear |

## User Stories 🗣️

- As a player, I want to ask the Oracle my question aloud so that the rite feels like a rite instead of a form.
- As a player, I want to say "cast the rune" and have the Oracle confirm before committing, so that a misheard word never ends my game.
- As a player, I want to interrupt the Oracle mid-sentence so that conversation feels natural rather than turn-based narration.
- As a player, I want to taunt Sköll and hear him answer immediately so that the antagonist feels present.
- As a player, I want to see at a glance whether the game is listening so that I am never recorded unknowingly.
- As a player who prefers buttons, I want every action to remain clickable so that voice is an option, not a requirement.
- As a player who cannot hear (or has the sound off), I want everything spoken to appear as text so that the voice feature excludes no one.
- As a player who denied mic permission, I want the game to accept that decision quietly so that I am not nagged every session.

## Requirements 📋

### Must-Have (P0) ⚡

**R1 — Live Oracle session.**
The client opens a Gemini Live API session (audio in, audio out, voice `Gacrux`) when the player taps the medallion.

- [x] Given the medallion is tapped from asleep, when the session opens, then the medallion enters the listening state and mic audio streams to the session.
- [x] On first wake of a game, the Oracle speaks an in-character invitation that names the speakable actions ("Ask, or bid me hex, scry, pass, or cast the rune")—this is the voice tutorial; no UI chrome teaches it.
- [x] Given the Oracle is speaking, when the player speaks over her, then her audio stops (barge-in) and the new utterance is processed.
- [x] Given the session drops (network), then the UI falls back to button mode with a non-blocking notice—the game never stalls on voice failure.
- [x] Given mic permission is denied or no mic device exists, then the medallion settles into a permanently eclipsed, inert state (or hides), a single quiet notice explains voice is unavailable, and the button game is untouched. No repeated permission prompts.

**R2 — Ephemeral token endpoint.**
The existing Cloud Run server gains one endpoint that mints short-lived Live API tokens using the Gemini key from Google Secret Manager.

- [x] The browser never receives or stores the long-lived API key.
- [x] Tokens are scoped and short-lived per the Live API ephemeral token spec.
- [x] Deploys with the existing server—no new infrastructure.

**R3 — Engine actions as tool calls.**
Ask, Hex, Scry, Pass, and Cast the Rune are exposed to the Oracle session as function declarations. A tool call from the model invokes the same engine function the corresponding button invokes.

- [x] Given the player says "I pass," when the model emits the `pass` tool call, then the engine executes it and the Oracle acknowledges in voice.
- [x] Given the player asks a question—spoken or typed—while the session is awake, then it routes through the existing Ask flow and the Oracle speaks the answer. Input path never changes her behavior.
- [x] Voice-initiated and button-initiated actions produce identical engine state. No action exists in voice that lacks a button equivalent.

**R4 — Confirmation for destructive actions.**
Hex and Cast the Rune require a spoken confirmation exchange before the engine executes.

- [x] Given the player says "cast Sowilo," then the Oracle asks for confirmation and executes only on an affirmative reply.
- [x] Given the player declines or stays silent through the timeout, then nothing executes.
- [x] Given a rune is cast, when the player attempts to retract it by voice, then the Oracle refuses in character—the cast is committed and irreversible. Her system instruction covers this ("the rune is cast; what is written in fire does not unwrite").

**R5 — Cast is uninterruptible.**
Per game rules, Hex targets an Ask and a Cast cannot be interrupted.

- [x] Given a Cast is executing, when voice commands arrive, then they are rejected with an in-character Oracle line; the Cast completes regardless.
- [x] Barge-in interrupts the Oracle's speech only—never a committed engine action.

**R6 — Eclipse medallion: control + indicator.**
A medallion at the top of the Oracle panel is both the voice toggle and the state display. Static art, animated light: the artwork never deforms; only glow layers animate.

- [x] Tapping the medallion wakes or sleeps the voice session. It is the only voice control besides the output mute.
- [x] **Asleep / mic off**: Sköll's shadow bites into the disc—partial eclipse, small mic glyph etched in. Default state.
- [x] **Waking** *(added during S3)*: corona faintly kindling—the stretch between the tap and listening (permission prompt, token, connect). A tap here cancels the wake.
- [x] **Listening**: disc unveiled, gold corona glow breathing slowly.
- [x] **Hearing speech**: corona flares with the player's voice; rune glyphs around the rim ignite.
- [x] **Oracle thinking**: rune ring orbits slowly.
- [x] **Oracle speaking**: corona pulses with her voice. *(pure animation, no output level feed — by agreement, S3)*
- [x] **Sköll speaking**: glow shifts gold to ember red AND the wolf's eyes open at the disc edge—state is never communicated by color alone. *(state shipped in S3; driven by the S13 director)*
- [x] All glow animation respects `prefers-reduced-motion`: static glow intensities replace pulsing.
- [x] Medallion states carry ARIA labels announcing listening/asleep/speaking.
- [x] Asset: one new eclipse-medallion image in the established pipeline (dark Norse folk-art, aged gold, transparent background). Ring uses existing rune glyph assets via CSS transforms. Add to `ui-image-resources.md`.

**R7 — Silence timeout.**
- [x] Given 5 seconds pass with no recognizable speech, then mic audio stops streaming, the session idles, and the medallion returns to the asleep state—silently, no verbal nudge.
- [x] The 5-second clock starts only after the Oracle (or Sköll) finishes speaking—their speech never counts as the player's silence.
- [x] Tapping the medallion resumes listening.

**R8 — Sköll clip library.**
A build-time script generates Sköll's audio with Gemini TTS (voice `Algieba`, director's-notes style prompt) from a script file grouped by trigger bucket (working set drafted in `ux-copy.md` §2). One to three variants per trigger.

- [ ] Clips ship as static assets; runtime playback only, zero per-game generation calls.
- [ ] Given the player taunts the wolf (detected from the Oracle session's input transcripts by a small director module), then a clip from the taunt bucket plays with no perceptible delay.
- [ ] Regenerating the library is one script run after editing his script file.

**R9 — Mic discipline during Sköll playback.**
- [ ] Given a Sköll clip is playing, then mic audio streaming to the Oracle session is paused, and the Oracle does not respond to his lines.
- [ ] One speaker at a time: the director module never plays Sköll over the Oracle; he waits for her line to finish.

**R10 — Everything spoken is also written.**
Voice is an enhancement layer, never the sole carrier of game information.

- [ ] The Oracle's spoken answers render as text in the existing Answer panel (the Live session emits output transcripts for free).
- [ ] What the Oracle *heard* (input transcript) is visible, so a mishear is caught before it matters.
- [ ] Sköll's clips display captions—his script is prebaked, so caption text ships with the clips.

**R11 — Output mute.**
- [ ] One speaker toggle silences both characters' audio; captions and text continue. Mic behavior is unaffected.

### Nice-to-Have (P1) ✨

- **Confirmation phrasing variety.** Multiple in-character confirmation prompts so repeated casts do not sound canned.
- **Audio ducking.** Background music lowers while either character speaks.

### Future Considerations (P2) 🔭

- **Game-state Sköll lines.** A handful of clips referencing the current game (specific runes) generated at game start behind the splash screen. Architecture keeps the clip player source-agnostic so a generated clip plays the same as a shipped one.
- **Oracle voice persona depth.** Affective dialog and proactive audio options exist on Live; revisit once core flow is stable.

## Success Metrics 📈

- **Hands-free turn completion**: a full turn (ask → action → resolution) completes by voice alone after the initial tap, demonstrated reliably in demo conditions.
- **Intent accuracy**: misfired engine actions (wrong action executed from speech) are rare enough that confirmation prompts catch effectively all of them—zero unconfirmed destructive misfires.
- **Sköll reaction latency**: taunt-to-clip-start under 500 ms.
- **Oracle response latency**: end of player speech to start of Oracle audio under ~1.5 s typical.
- **Fallback integrity**: with voice fully disabled or failed, the game is 100% playable by buttons.

## Open Questions ❓

- ~~**Gacrux on Live** (engineering)~~ **Resolved 2026-06-11 (S2):** Gacrux verified working on `gemini-3.1-flash-live-preview` against the real API (audio + transcripts returned). No Kore fallback needed; the voice is the single `ORACLE_VOICE` constant in `src/lib/voice/config.ts`.
- ~~**Sköll script** (Ashley)~~ **Drafted 2026-06-11:** spoken taunt library lives in `ux-copy.md` §2 (trigger buckets + variants), pending approval. R8 generation unblocks on approval.
- **Taunt detection rules** (engineering): keyword list vs. lightweight intent check on transcripts for routing to the wolf. Resolve during implementation.
- **Live session limits** (engineering): confirm session duration limits and whether session resumption is needed for long games. Resolve during implementation.

## Timeline Considerations 🗓️

Suggested phasing:

1. **Phase 1 — Oracle talks.** Token endpoint, Live session, mic button, medallion listening/speaking/asleep states, 8s timeout. No tool calls yet—conversation only.
2. **Phase 2 — Oracle acts.** Tool call wiring for all five actions, confirmation flow, Cast/Hex rule enforcement, transcript display.
3. **Phase 3 — The wolf.** Sköll script, clip generation pipeline, director module, mic discipline, ember medallion state.

Phases 1 and 2 ship together at minimum; Phase 3 can trail without blocking a voice demo.

---

🤖 *Drafted with AI assistance; decisions by Ashley.* ☀️
