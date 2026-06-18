# Save the Sun — v2 Voice Implementation 🎫

> What shipped, mapped to the code. Spec: [`v2-voice-requirements.md`](v2-voice-requirements.md) · architecture: [`architecture.md`](architecture.md#voice--input-push-to-talk-and-output-delivery).
> Models: Oracle interpret + dramatized verdict + transcription `gemini-3.5-flash`; Sköll `gemini-3.1-flash-lite`; TTS `gemini-3.1-flash-tts-preview`. Voices: Oracle `Gacrux`, Sköll `Algieba` (`src/lib/voice/config.ts`).

Voice is two decoupled layers: **output** is mic-independent TTS delivery (every game move voiced through one route + one speaker, text always / audio when on); **input** is push-to-talk (a held recording transcribed and run through the same engine dispatch as the buttons). No real-time session.

---

## Output — voice-as-delivery 🔊

Every game move is composed server-side and voiced through the one `deliver()` seam (`src/lib/voice/delivery.ts`) and one TTS route (`POST /api/voice/tts`, a `voice` param). The route admits **only server-owned lines** — never the client's wire text.

- [x] **Recomposed-from-truth lines** (`src/lib/server/voice/lines.ts` allow-list, cached): Oracle `answer` / `refusal`; Scry/Hex/Pass `react` resolutions (`reactionLines.ts`, scry carries the overheard answer); `cast` outcomes (`castLines.ts`, wrong-cast names a board-validated rune); Sköll's `skoll-ask` (from the parked `query`) and `skoll-cast` (from the rune on the `Advance` wire)
- [x] **Gemini-authored lines, fetched by id** (`storeVoiceLine`/`getVoiceLine` in `session.ts`): the Oracle's dramatized verdict on a clean answer (`composeOracleFlair`) and the end-screen line — her blessing on a win, Sköll's gloat on a loss (`composeEndingFlair`). The wire carries an opaque id; the words live server-side
- [x] **Never a lie:** a dramatized answer that doesn't open with the engine's own "Yes"/"No" is discarded → the deterministic line voices; authoring is bounded + timed-out with that fallback
- [x] **Director's-notes per voice** (`synthPrompt`): Sköll a deep gravelly growl, the Oracle a brisk reverent weight — one TTS model, two registers
- [x] **One speaker, serialized:** the Oracle and Sköll chain through `deliver()`, never overlapping; the medallion mirrors the active speaker from delivery events
- [x] **Recoverable:** the last voiced line is recorded per session, so a dropped action's response recovers and re-voices the real result instead of a false silent line
- [x] **Written always (R10):** every voiced game move also renders as text (Answer panel for the Oracle, his frame for Sköll); the end screen's fixed lead/verse/coda stay on-screen text

## Input — push-to-talk 🎤

- [x] Hold the medallion (or `` ` ``) to record a WAV; release → `POST /api/voice/transcribe` → text → the **same Ask pipeline as the text box** (`src/lib/voice/recorder.ts`, `src/lib/server/voice/transcribe.ts`)
- [x] A held reply while Sköll's question hangs is classified into scry/hex/pass (`reaction` mode) and run through the same `performReact` dispatch the buttons use; an `unclear` reply asks again, a spent charge is refused — never a silent pass
- [x] A spoken cast is classified against the canonical board names; commits only on an explicit cast intent + exact board-rune match — a mishear or off-board word refused, never staked
- [x] Mic permission denied / no device → the medallion settles into a permanent inert eclipsed state, one quiet notice, never re-prompts that session; the button game is untouched
- [x] The mic opens once (one permission prompt) and the track is released between holds

## The eclipse medallion 🌑

Push-to-talk control + living state indicator (`src/lib/components/EclipseMedallion.svelte`). Static art, animated light only.

- [x] States: idle (mic glyph etched), recording (corona flares), thinking (rune ring orbits), Oracle-speaking (steady gold corona), Sköll-speaking (ember + the disc deepens toward total eclipse with an ember rim — read by brightness/shape, never color alone). The indicator switches voices on the delivery queue — driven by which clip is sounding, not enqueue — so Sköll's ember shows only once his clip plays
- [x] `prefers-reduced-motion` → static glow intensities; ARIA label + polite live-region announcement per state
- [x] The medallion + the output-mute toggle sit in one labeled `role="group"`, both keyboard-operable

## Output mute 🔇

- [x] One toggle silences both characters via a master gain on the shared speaker — audio still decodes/drains, so captions and the state machine are byte-for-byte unaffected; mic behavior untouched (`src/lib/voice/outputMute.ts`)
- [x] Preference persists for the session (`sessionStorage`), distinct from the per-round view state

## Deferred (V3) 🔭

- [ ] Audio-only ambience taunt layer (prebuilt clips, no caption — carries no game state) + taunt detection; sound-effects one-shot bus. Spec: [`v3-ambient-and-sfx.md`](v3-ambient-and-sfx.md), tracked in [`ttd.md`](ttd.md)

🤖 *Drafted with AI assistance; decisions by Ashley.* ☀️
