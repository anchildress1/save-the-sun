# Voice Interaction Spec 🎙️

> Save the Sun — talk to the Oracle, hear the wolf answer.
> Status: Draft v1 · 2026-06-10
>
> **Voice has two layers** — see [`architecture.md`](./architecture.md#voice--input-push-to-talk-and-output-delivery). **Output** is mic-independent: every game move is composed server-side and voiced through one shared TTS route (the Oracle and Sköll, a `voice` param) — text always, audio when on — so the board speaks with or without the mic. **Input** is **push-to-talk**: hold the eclipse medallion (or the `` ` `` backtick key anywhere; Space/Enter operate the medallion only while it is focused, since page-wide Space belongs to whatever control has focus) to record an Ask, release to send it to the transcribe route, which returns text that runs the same Ask pipeline as the typed box. There is no real-time Live session: the spoken path covers the **Ask**, the **reaction to Sköll's hanging question** (scry/hex/pass, classified server-side), and the **cast** (name the rune aloud — hands-free "cast {rune}" or after arming by hand — matched server-side against the board), turn-based, so the real-time mic requirements below are **superseded** — **R1** (Live session) → push-to-talk capture; **R2** (Live-token endpoint) → server transcribe route; **R7** (silence timeout), **R4/R5** (spoken confirm / cast lockout), and **Goal 2** (barge-in) no longer apply (no socket; spoken scry/hex/pass execute like their buttons — no confirmation gate, a mishear refused not staked — and a spoken cast commits only on an exact board-rune match, the deliberate arm standing in for a confirm); **R9**'s one-speaker holds trivially (one delivery speaker, turn-based). The delivery-agnostic requirements stand: R3 parity, R6 medallion (now hold-to-record), R10 every-game-move-written, R11 output mute.

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
| Sköll voice channel | Shared server TTS route (a `voice` param) for his game moves; prebuilt clips reserved for the deferred ambience layer |
| Sköll voice | `Algieba` — swappable, single config value (`SKOLL_VOICE`) |
| TTS model | `gemini-3.1-flash-tts-preview` |
| Auth | Ephemeral tokens minted by the existing Cloud Run server; API key stays in Google Secret Manager and never reaches the browser |
| Mic activation | The eclipse medallion is the control: tap to wake, tap to sleep. A small mic glyph is etched into the medallion while asleep for discoverability. One tap satisfies the browser gesture requirement for mic + audio |
| Voiced answers | Every game move is voiced through the shared TTS delivery route—text always, audio when on—with or without the mic; typed and spoken questions alike get voiced replies |
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
- [x] On first wake of a game, the Oracle speaks a short in-character greeting ("I wake with the fire.")—kept brief so the open mic can't trip a barge-in on her own audio mid-line.
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
Scry, Hex, and Cast the Rune require a spoken confirmation exchange before the engine executes. *(Scry joined the gate 2026-06-12: it spends the night's single use, same stake as the hex.)*

- [x] Given the player says "cast Sowilo," then the Oracle asks for confirmation and executes only on an affirmative reply.
- [x] Given the player says "scry his question," then the Oracle asks for confirmation and executes only on an affirmative reply — scry and hex are each one of one for the night.
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
- [x] **Sköll speaking**: glow shifts gold to ember red AND the disc deepens toward total eclipse with an ember rim—the sun devoured—so the speaker reads by brightness and shape, never color alone.
- [x] All glow animation respects `prefers-reduced-motion`: static glow intensities replace pulsing.
- [x] Medallion states carry ARIA labels announcing listening/asleep/speaking.
- [x] Asset: one new eclipse-medallion image in the established pipeline (dark Norse folk-art, aged gold, transparent background). Ring uses existing rune glyph assets via CSS transforms. Add to `ui-image-resources.md`.

**R7 — Silence timeout.**
- [x] Given 5 seconds pass with no recognizable speech, then mic audio stops streaming, the session idles, and the medallion returns to the asleep state—silently, no verbal nudge.
- [x] The 5-second clock starts only after the Oracle (or Sköll) finishes speaking—their speech never counts as the player's silence.
- [x] Tapping the medallion resumes listening.

**R8 — Sköll's voice.** *(revised 2026-06-14 — split into game-move voice + ambience.)*
His voice is `Algieba` (distinct from the Oracle's `Gacrux`). His lines split by kind:

- [x] **Game moves via the shared TTS route** (landed, P2): his **Ask** is voiced in his voice through the same server TTS path as the Oracle — `lines.ts` recomposes his line server-side from the engine's parked `query` (`skoll-ask` descriptor → `skollAskEcho`), so the route still voices only a server-owned line; `tts.ts` takes a `voice` (cache keyed by voice + text). Each line is wrapped in its speaker's **director's-notes** (`synthPrompt`) so the one TTS model voices both in character — Sköll a deep gravelly growl, the Oracle a brisk reverent weight; a bare line reads flat. Written on his frame (R10). His winning cast follows the same way once the rune rides the wire — deferred.
- [ ] **Ambience as prebuilt clips** (deferred): the taunt buckets (`ux-copy.md` §2 — splash open, idle, hunt mood) ship later as static clips played as-is, **audio-only** (no caption, per the revised R10 — ambience carries no game state). Build-time generation, runtime playback only, zero per-game calls. The taunt-address bucket needs a spoken input → returns with the mic (P5).

**R9 — One speaker; mic discipline.**
- [x] One speaker at a time: Sköll never speaks over the Oracle. Both voices ride the **same** delivery speaker, serialized through `deliver()`.
- [x] Given a Sköll line is playing, mic audio to an Oracle Live session is no longer relevant — Live was retired. Push-to-talk records only while held, then sends a finished utterance for transcription; playback is delivery-only.

**R10 — Every game move is written.** *(revised 2026-06-14.)*
Voice never solely carries game information. Every **game move** — an Ask and its answer, a reaction (Scry/Hex/Pass), a cast and its outcome, a win or loss — renders as text regardless of audio. **Ambience is exempt**: atmospheric Sköll voice (the splash open, idle waiting, the closing-hunt mood) carries no game state, so it is **audio-only flavor and does not caption**. The test is *information, not who speaks*: if a line tells you what happened in the rite, it is written; if it only sets mood, it may be heard and not seen.

- [x] The Oracle's spoken answers/refusals render as text in the Answer panel (each is a game move).
- [x] What the Oracle *heard* (input transcript) is teed to the `/debug` stream, not the rite UI — the answer panel carries the spoken result, and the S8 confirm gate guards a mishear before any destructive action commits.
- [x] Sköll's Ask — the inference the player must Scry/Hex/Pass — is written on his frame (`skoll-echo`) and voiced in his voice (P2); his winning cast names the `{Rune}` in text.
- [x] The reaction resolutions (§3), cast outcomes (§4), and the end-screen outcome are written and voiced — `react` / `cast` / `outcome` line descriptors composed server-side. The end screen voices one beat of its splash copy: a **win in the Oracle's voice** (the victory coda), a **loss in Sköll's** (the night-everlasting verse). Sól keeps no separate voice — her line is voiced by the Oracle.
- [ ] The deferred **ambience** layer (the taunt library) is audio-only by the exemption — no caption, since it carries no game state (`ttd.md`).

**R11 — Output mute.**
- [x] One speaker toggle silences both characters' audio; captions and text continue. Mic behavior is unaffected. (S11: a master gain on the Oracle `Speaker` attenuates to silence without dropping the queue, so captions, mic streaming, and the state machine are untouched. The preference persists for the session in `sessionStorage` and is the shared seam S13's wolf player consults.)

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

### Measured — local dev, real Gemini (2026-06-18) 📏

Numbers from `vite dev` against the live Gemini API on a local network — **not** the deployed Cloud Run (which adds region + cold-start latency). Live-deploy numbers still need the deployed URL.

- **TTS audio-start** (first PCM chunk = start of audio): **~0.65 s uncached, ~3 ms cached.** Oracle target (1.5 s) met; Sköll's 500 ms is just missed on a cold synth, met on a cache hit. *(Sköll's <500 ms was specced for prebuilt taunt clips — the deferred ambience layer — not the shared TTS route.)*
- **Full Ask compute** (`/api/action`: interpret → Sköll reaction → Oracle flair, three serial Gemini calls): **~2.0–3.0 s.** Over the ~1.5 s "Oracle response" target — but that target was specced for the **retired Live API**; push-to-talk is turn-based, so it's a soft bar. The flair call (ttd:17) adds ~0.6–0.9 s; it times out to the deterministic template, so it never stalls.
- **interpret-only** (a refused Ask, one Gemini call): **~0.9–1.2 s.**
- **Fallback integrity**: ✅ proven by the suite — the board renders and plays its moves with audio off/failed (delivery is a no-op without a speaker).
- **Intent accuracy / hands-free completion**: covered by the spoken-path suites (transcribe → classify → dispatch); the destructive-confirm gate (S8) holds the zero-unconfirmed-misfire bar.

## Open Questions ❓

- ~~**Gacrux on Live** (engineering)~~ **Resolved 2026-06-11 (S2):** Gacrux verified working on `gemini-3.1-flash-live-preview` against the real API (audio + transcripts returned). No Kore fallback needed; the voice is the single `ORACLE_VOICE` constant in `src/lib/voice/config.ts`.
- ~~**Sköll script** (Ashley)~~ **Approved + tightened 2026-06-14:** his *game-move* lines (the Ask, later his cast) voice through the shared TTS route; the taunt buckets (`ux-copy.md` §2) are reserved for the deferred audio-only ambience layer.
- ~~**Sköll voice** (Ashley)~~ **Picked by ear 2026-06-14:** `Algieba` over `Charon`; both voices shaped by per-speaker director's-notes (`synthPrompt`) and pace-tuned.
- **Taunt detection rules** (engineering): keyword list vs. lightweight intent check on transcripts for routing to the wolf. Deferred with the audio-only ambience layer (needs a spoken input).
- **Live session limits** (engineering): confirm session duration limits and whether session resumption is needed for long games. Resolve during implementation.

## Timeline Considerations 🗓️

Suggested phasing:

1. **Phase 1 — Oracle talks.** Token endpoint, Live session, mic button, medallion listening/speaking/asleep states, 8s timeout. No tool calls yet—conversation only.
2. **Phase 2 — Oracle acts.** Tool call wiring for all five actions, confirmation flow, Cast/Hex rule enforcement, transcript display.
3. **Phase 3 — The wolf.** Sköll's game-move voice through the shared TTS route, the ember/eclipse medallion state; the audio-only ambience layer (prebuilt clips, taunt detection) trails.

Phases 1 and 2 ship together at minimum; Phase 3 can trail without blocking a voice demo.

---

🤖 *Drafted with AI assistance; decisions by Ashley.* ☀️
