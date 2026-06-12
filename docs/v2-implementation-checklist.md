# Save the Sun — v2 Implementation Checklist (Voice Story Order) 🎫

> Implementation units for AI agents. Source of truth: `voice-interaction-spec.md`. Refs = requirement IDs there.
> Config constants: Oracle voice `Gacrux` (verified on Live 2026-06-11 — `Kore` fallback not needed), Sköll voice `Algieba`, TTS model `gemini-3.1-flash-tts-preview`, silence timeout 8000ms.

---

## Phase 1 — Oracle talks 🌅

### S1 — Ephemeral token endpoint (R2)

Add endpoint to existing Cloud Run server: mint Live API ephemeral token using Gemini key from Google Secret Manager.

- [x] `POST /api/voice/token` returns short-lived ephemeral token per Live API spec
- [x] Long-lived key never in any response, log, or client bundle
- [x] Deploys with existing server; no new infra
- [x] Rate-limit the endpoint (basic abuse guard)

### S2 — Live session client (R1)

Client module owning the Live API WebSocket lifecycle: connect with ephemeral token, stream mic PCM (16-bit/16kHz) in, play audio (24kHz) out.

- [x] `voiceSession.wake()` / `voiceSession.sleep()` API consumed by UI (landed with S3's medallion)
- [x] Barge-in: player speech interrupts Oracle playback immediately
- [x] Emits events: `listening`, `hearing`, `thinking`, `speaking`, `asleep`, `error`, `transcript(in|out)`
- [x] On socket drop/error: emit `error`, revert to asleep, non-blocking notice; game continues on buttons
- [x] System instruction: Oracle persona (measured, ritual cadence, knows the answer before you ask)
- [x] Wake hardening (landed with S3): `waking` state/event covers the tap→listening stretch (tap cancels), token mint + Live connect carry 10s timeouts so a hung endpoint fails the wake instead of stranding it
- Depends: S1

### S3 — Eclipse medallion component (R6)

Medallion at top of Oracle panel = voice toggle + state display. Static art, animated glow layers only.

- [x] Tap toggles wake/sleep via S2 API
- [x] States driven by S2 events: asleep (partial eclipse + etched mic glyph), listening (corona breathing), hearing (corona flares with mic amplitude, rim runes ignite), thinking (rune ring orbits), oracle-speaking (corona pulses, pure animation — no output level feed by agreement), sköll-speaking (ember red + wolf eyes open at disc edge; state prop ready, driven by S13)
- [x] State never communicated by color alone (sköll = color + eyes shape)
- [x] `prefers-reduced-motion`: static glow intensities, no pulse/orbit
- [x] ARIA labels per state; medallion is a labeled button (+ polite live-region announcements)
- [x] New asset: voice medallion level strip (12 frames @128px, 43K — spec + regeneration in `ui-image-resources.md`); the disc renders it per state with flare-indexed and ping-pong playback. Rim runes reuse existing rune glyph assets via CSS transforms ✓
- Depends: S2 (event contract; can build against mocked events)

### S4 — Permission + device failure (R1)

- [ ] Mic permission denied → medallion enters permanent inert eclipsed state, one quiet notice, never re-prompts that session
- [ ] No mic device → same path
- [ ] Button game fully unaffected in both cases
- Depends: S2, S3

### S5 — Silence timeout (R7)

- [ ] 5000ms of no recognizable player speech → stop mic streaming, session idles, medallion → asleep; no audio nudge
- [ ] Clock starts only after Oracle/Sköll playback ends; their speech never counts toward it
- [ ] Medallion tap resumes
- Depends: S2, S3

### S6 — Wake invitation (R1)

- [ ] First wake per game: Oracle speaks in-character invitation naming speakable actions (ask, hex, scry, pass, cast the rune)
- [ ] Subsequent wakes: silent resume to listening
- Depends: S2

## Phase 2 — Oracle acts ⚡

### S7 — Engine tool calls (R3)

Declare five functions on the Live session: `ask`, `hex`, `scry`, `pass`, `cast_rune`. Tool call → same engine function the button calls → `toolResponse` with result → Oracle voices outcome.

- [ ] Voice and button paths produce identical engine state (assert in tests)
- [ ] Typed question while session awake → existing Ask flow → Oracle speaks the answer (input path never changes behavior)
- [ ] No voice-only actions exist
- Depends: S2

### S8 — Destructive action confirmation (R4)

- [ ] `hex` and `cast_rune` tool calls gate behind spoken confirmation exchange; execute only on affirmative
- [ ] Decline or silence through timeout → no execution
- [ ] Post-cast retraction attempts → Oracle refuses in character; system instruction includes irreversibility doctrine ("the rune is cast; what is written in fire does not unwrite")
- [ ] Client-side gate is authoritative—model cannot execute unconfirmed destructive calls even if it tries
- Depends: S7

### S9 — Cast lockout (R5)

- [ ] During Cast execution: voice commands rejected with in-character Oracle line; Cast completes regardless
- [ ] Barge-in stops Oracle audio only—never cancels a committed engine action
- Depends: S7

### S10 — Transcripts to text (R10)

- [ ] Oracle output transcript renders in existing Answer panel as she speaks
- [ ] Input transcript (what she heard) visible to player
- [ ] Works with output muted (S12)
- Depends: S2

### S11 — Output mute (R11)

- [ ] Single speaker toggle silences Oracle + Sköll audio; text/captions unaffected; mic streaming unaffected
- [ ] State persists for the session
- Depends: S2

## Phase 3 — The wolf 🐺

### S12 — Sköll script + generation pipeline (R8)

- [x] Script content: spoken taunt library drafted in `ux-copy.md` §2 — trigger buckets (expanded beyond the original six) with 1–3 variants each, pending Ashley's approval. The machine-readable script file lands with the build script below.
- [ ] Build script: each line → Gemini TTS (`Algieba`, `gemini-3.1-flash-tts-preview`, director's-notes style prompt) → audio file + caption text in app assets
- [ ] One command regenerates the full library
- [ ] Retry logic for the TTS model's occasional 500s

### S13 — Director module (R8, R9)

- [ ] Watches S2 input transcripts; taunt/address detection routes to wolf (keyword list v1; revisit if misses)
- [ ] Game events (hex resolved, rune cast, win, lose) trigger matching bucket
- [ ] Random variant selection, no immediate repeats
- [ ] One speaker at a time: Sköll waits for Oracle to finish; never overlaps
- [ ] During Sköll playback: pause mic streaming to Oracle session; resume after
- [ ] Clip start latency from trigger < 500ms
- [ ] Captions render during playback (caption text from S12 assets)
- [ ] Medallion → sköll-speaking state during playback
- Depends: S2, S3, S12

---

## Order 🧭

S1 → S2 → {S3, S6, S7} → {S4, S5, S10, S11} → S8 → S9 → S12 → S13.
Phases 1+2 ship together minimum. S12 script content is drafted (`ux-copy.md` §2); approval + the generation pipeline remain.

🤖 *Drafted with AI assistance; decisions by Ashley.* ☀️
