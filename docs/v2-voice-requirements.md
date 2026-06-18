# Voice Interaction Spec 🎙️

> Save the Sun — talk to the Oracle, hear the wolf answer.
> Status: Shipped · architecture in [`architecture.md`](./architecture.md#voice--input-push-to-talk-and-output-delivery).

Voice is **two decoupled layers**:

- **Output (voice-as-delivery)** is mic-independent. Every game move is composed server-side and voiced through one TTS route (`POST /api/voice/tts`) and a shared client speaker — **text always, audio when on** — so the board speaks with or without a mic.
- **Input (push-to-talk)** is optional. Hold the eclipse medallion (or the `` ` `` backtick key; Space/Enter operate the medallion only while it is focused) to record an utterance, release to send it to `POST /api/voice/transcribe`, which returns text that runs the **same pipeline as the typed box**. There is no real-time session — one held recording per move, turn-based.

The spoken path covers the **Ask**, the **reaction to Sköll's hanging question** (scry/hex/pass, classified server-side), and the **cast** (name the rune aloud — hands-free "cast {rune}" or after arming by hand — matched server-side against the board).

---

## Problem Statement 🌑

The core loop — Ask, Hex, Scry, Pass, Cast — runs on buttons and a text box. For a game framed as a spoken rite with an Oracle, typing into a form undercuts the fiction. Players should speak to the Oracle and be spoken to, with the wolf answering from the dark — while every button keeps working exactly as it does today.

## Goals 🎯

1. A player can complete a full turn hands-free after one tap (the medallion) — Ask, Scry, Hex, Pass, and Cast all reachable by voice.
2. The display always shows an unambiguous recording state; the mic never listens without the player knowing.
3. Voice and buttons are equivalent inputs — identical engine behavior regardless of path.
4. Every game move is written, so the feature excludes no one.

## Non-Goals 🚫

- **Wake word.** Recording starts from a deliberate hold; the game never listens for "hey Oracle."
- **Real-time session / barge-in.** No socket, no streaming mic. Voice is turn-based push-to-talk; there is no talking over the Oracle.
- **A spoken confirmation step.** Safety comes from the mechanics, not a verbal "are you sure" — a spoken cast commits only on an exact board-rune match, and a mishear is refused, never staked.
- **Additional voiced characters.** Two voices: the Oracle and Sköll. Sól does not speak (her line rides the Oracle's).
- **Speech-driven navigation.** Menus, settings, and splash screens stay click-only.
- **Multilingual.** English only.

## Decisions Locked 🔒

| Decision | Choice |
|---|---|
| Voice delivery | One server TTS route (`POST /api/voice/tts`, a `voice` param) feeding one shared client speaker (`deliver()`); no real-time session |
| Oracle voice | `Gacrux` — swappable, single config value (`ORACLE_VOICE`) |
| Sköll voice | `Algieba` — swappable, single config value (`SKOLL_VOICE`) |
| Models | Oracle interpret + dramatized verdict + transcription: `gemini-3.5-flash`; Sköll: `gemini-3.1-flash-lite`; TTS: `gemini-3.1-flash-tts-preview` |
| What the route voices | **Server-owned lines only.** Either a known line ID recomposed from the engine's truth (`lines.ts` allow-list), or a Gemini-authored line stashed server-side and fetched by an opaque per-session id — never the client's wire text |
| Auth | `GEMINI_API_KEY` stays in Google Secret Manager, server-side only; it never reaches the browser and no client tokens are minted |
| Input | Push-to-talk: a held recording (WAV) → `POST /api/voice/transcribe` → text → the same Ask/React pipeline as the buttons |
| Captions | All spoken content also lands as text (Answer panel for the Oracle, his frame for Sköll) |
| Output mute | One toggle (a master gain) silences both characters; captions and the state machine are untouched; persists for the session |
| Cast safety | A spoken cast commits only on an exact board-rune match; the deliberate arm (or "cast {rune}") stands in for a confirm; a mishear or off-board word is refused, never staked |
| Turn parity | Voice intents call the exact same engine dispatch as the buttons; buttons never disappear |

## User Stories 🗣️

- As a player, I want to ask the Oracle aloud so that the rite feels like a rite, not a form.
- As a player, I want to answer Sköll's question (Scry/Hex/Pass) and name my cast by voice so a full turn is hands-free.
- As a player, I want a misheard word to be refused, not staked, so a slip never ends my game.
- As a player, I want to see at a glance whether the game is recording so I'm never captured unknowingly.
- As a player who prefers buttons, I want every action to stay clickable so voice is an option, not a requirement.
- As a player who can't hear (or has the sound off), I want everything spoken to also appear as text.
- As a player who denied the mic, I want that decision accepted quietly — no repeated prompts.

## The spoken surface 🔊

Every **game move** is composed server-side and voiced through the one `deliver()` seam — written to its panel/frame always, played through the shared TTS speaker when audio is on. The route admits **only server-owned lines**, by two paths:

- **Recomposed from the engine's truth** (`lines.ts` allow-list, cached): the Oracle's deterministic answer and refusals, the Scry/Hex/Pass resolutions, the cast outcomes, Sköll's Ask, and his winning cast — each composed from the parked query/rune so the route never voices arbitrary client text.
- **Gemini-authored, fetched by id** (`storeVoiceLine`/`getVoiceLine`): the Oracle's **dramatized verdict** on a clean answer (`composeOracleFlair`), and the **end-screen line** — her blessing on a win, Sköll's gloat on a loss (`composeEndingFlair`). The words live server-side; the wire carries only an opaque id.

Each line is wrapped in its speaker's **director's-notes** (`synthPrompt`) so the one TTS model voices both in character — Sköll a deep gravelly growl, the Oracle a brisk reverent weight.

**Guards:**
- **Never a lie.** A dramatized answer that doesn't open with the engine's own "Yes"/"No" is discarded; the deterministic line voices instead. Authoring is bounded + timed-out, so a slow/failed call always falls back.
- **One speaker.** The Oracle and Sköll share the one delivery speaker, serialized through `deliver()` — they never overlap.
- **Recoverable.** The last voiced line is recorded per session, so a dropped action's response can recover and re-voice the real result instead of a false silent line.

## Input — push-to-talk 🎤

Holding the medallion (or `` ` ``) records a short utterance; releasing sends it to `POST /api/voice/transcribe`, which transcribes it server-side and returns text. The page runs that text through the **exact same pipeline as the text box** — so a spoken Ask and a typed Ask are identical past transcription.

- The mic opens once (one permission prompt) and the track is released between holds.
- A held reply while Sköll's question hangs is classified into **scry / hex / pass** (`reaction` mode) and run through the same `performReact` dispatch the buttons use. An `unclear` reply asks again; a spent charge is refused — never a silent pass.
- A spoken **cast** is classified against the canonical board names; it commits only on an explicit cast intent + an exact board-rune match. A mishear or off-board word is refused, never staked.
- Mic permission denied or no device → the medallion settles into a permanently inert eclipsed state, one quiet notice, and never re-prompts that session. The button game is untouched.

## The eclipse medallion 🌑

The medallion at the top of the Oracle panel is both the push-to-talk control and the living state indicator. Static art, animated light only.

- **Idle** — disc unveiled, ready (a small mic glyph etched for discoverability).
- **Recording** — corona flares with the player's voice while the hold is down.
- **Thinking** — the rune ring orbits while the utterance is transcribed.
- **Oracle speaking** — corona pulses with her line.
- **Sköll speaking** — the glow shifts gold→ember **and** the disc deepens toward total eclipse with an ember rim — the sun devoured — so the speaker reads by brightness and shape, never color alone.
- `prefers-reduced-motion` swaps every pulse/orbit for a static glow intensity.
- Each state carries an ARIA label and a polite live-region announcement; the medallion and the mute toggle sit in one labeled `role="group"` and are keyboard-operable.

## Every game move is written (R10) ✍️

Voice never solely carries game information. An Ask and its answer, a reaction, a cast and its outcome, a win or loss — each renders as text regardless of audio. The test is *information, not who speaks*: if a line tells you what happened in the rite, it is written; if it only sets mood, it may be heard and not seen. (What the Oracle *heard* — the input transcript — is teed to `/debug`, not the rite UI.)

## Output mute 🔇

One toggle silences both characters' audio; captions, text, and mic behavior are unaffected — a master gain on the shared speaker attenuates to silence without dropping the queue, so caption timing is byte-for-byte identical. The preference persists for the session (`sessionStorage`).

## Success Metrics 📈

- **Hands-free turn completion:** a full turn (ask → action → resolution) completes by voice alone after the initial tap.
- **Intent accuracy:** no destructive misfire — a misheard cast/reaction is refused, never staked.
- **Fallback integrity:** with voice fully off or failed, the game is 100% playable by buttons.
- **Latency:** start of Oracle audio within a turn-based budget (see measured below).

### Measured — local dev, real Gemini (2026-06-18) 📏

Numbers from `vite dev` against the live Gemini API on a local network — **not** the deployed Cloud Run (which adds region + cold-start latency). Live-deploy numbers still need the deployed URL.

- **TTS audio-start** (first PCM chunk): **~0.65 s uncached, ~3 ms cached.**
- **Full Ask compute** (`/api/action`: interpret → sometimes Sköll's reaction → sometimes the Oracle's flair): **~2.0–3.0 s** worst case; typically two serial Gemini calls. The flair adds ~0.6–0.9 s and times out to the deterministic line, so it never stalls. (Sköll's reaction only calls Gemini ~65% of the time and only while he still holds a charge.)
- **interpret-only** (a refused Ask, one Gemini call): **~0.9–1.2 s.**
- **Fallback integrity:** ✅ proven by the suite — the board renders and plays its moves with audio off/failed.
- **Intent accuracy / hands-free completion:** covered by the spoken-path suites (transcribe → classify → dispatch).

## Deferred 🔭

- **Ambience layer (V3).** The taunt buckets (`ux-copy.md` §2 — splash open, idle, hunt mood) as **audio-only** prebuilt clips on a concurrent bus — no captions, since they carry no game state. Needs taunt detection (a spoken input). Spec: [`v3-ambient-and-sfx.md`](v3-ambient-and-sfx.md).
- **Sound-effects layer (V3).** Short non-vocal one-shots (cast, cross-off, win/loss stings) over the voices.

---

🤖 *Drafted with AI assistance; decisions by Ashley.* ☀️
