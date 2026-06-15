# Save the Sun — v2 Implementation Checklist (Voice Story Order) 🎫

> Implementation units for AI agents. Source of truth: `v2-voice-requirements.md`. Refs = requirement IDs there.
> Config constants: Oracle voice `Gacrux` (verified on Live 2026-06-11 — `Kore` fallback not needed), Sköll voice `Algieba`, TTS model `gemini-3.1-flash-tts-preview`, silence timeout 5000ms.
>
> **Two voice layers** — see [`architecture.md`](./architecture.md#voice--input-the-live-mic-and-output-delivery). Stories S1–S11 are the shipped record of the **Live mic** input path (the medallion wakes/sleeps it). On top sits **mic-independent TTS delivery** for output: **every game move now voices** through one shared TTS route — Oracle answers/refusals, Sköll's Ask, the Scry/Hex/Pass resolutions, the cast outcomes, and the win/loss — text always, audio when on, with or without the mic (see [Spoken surface](#spoken-surface--voice-as-delivery) below). The prebuilt-clip S12/S13 were tried then reverted in favor of that route; the audio-only ambience layer is deferred.

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
- [x] States driven by S2 events: asleep (partial eclipse + etched mic glyph), listening (corona breathing), hearing (corona flares with mic amplitude, rim runes ignite), thinking (rune ring orbits), oracle-speaking (corona pulses, pure animation — no output level feed by agreement), sköll-speaking (ember red + the disc deepens toward total eclipse with an ember rim — the sun devoured)
- [x] State never communicated by color alone (sköll = ember color + the deepening eclipse, a brightness/shape signal)
- [x] `prefers-reduced-motion`: static glow intensities, no pulse/orbit
- [x] ARIA labels per state; medallion is a labeled button (+ polite live-region announcements)
- [x] New asset: voice medallion level strip (12 frames @128px, 43K — spec + regeneration in `ui-image-resources.md`); the disc renders it per state with flare-indexed and ping-pong playback. Rim runes reuse existing rune glyph assets via CSS transforms ✓
- Depends: S2 (event contract; can build against mocked events)

### S4 — Permission + device failure (R1)

- [x] Mic permission denied → medallion enters permanent inert eclipsed state, one quiet notice, never re-prompts that session
- [x] No mic device → same path
- [x] Button game fully unaffected in both cases
- Depends: S2, S3

### S5 — Silence timeout (R7)

- [x] 5000ms of no recognizable player speech → stop mic streaming, session idles, medallion → asleep; no audio nudge ("recognizable" = server input transcripts, never local RMS — a fan or a cough must not hold the session awake)
- [x] Clock starts only after Oracle playback ends; her speech never counts toward it (clock pauses through thinking + speaking, restarts when playback drains)
- [x] Medallion tap resumes (a fresh `wake()` — silence-idle is a full sleep, so each resume mints a new rate-limited token by design)
- Depends: S2, S3

### S6 — Wake invitation (R1)

- [x] First wake per game: Oracle speaks a short in-character greeting ("I wake with the fire.") — fixed line (`ux-copy.md` §1) sent as one stage-direction turn on `wake({ invitation: true })`; the wake waits in thinking, so the S5 clock stays paused until her playback drains. Kept brief so the open mic can't barge-in on her own audio mid-line
- [x] Subsequent wakes: silent resume to listening — delivery persists per round in the client view state (`voiceInvited`), so a mid-round reload never re-invites; a new game re-arms it
- Depends: S2

## Phase 2 — Oracle acts ⚡

### S7 — Engine tool calls (R3)

Declare five functions on the Live session: `ask`, `hex`, `scry`, `pass`, `cast_rune`. Tool call → same engine function the button calls → `toolResponse` with result → Oracle voices outcome.

- [x] Voice and button paths produce identical engine state (assert in tests) — the page-registered executor reuses the exact button dispatch paths (`performAsk`/`performReact`/`performCast`); parity asserted on the wire payloads, and the tool result is the same line the panel shows
- [x] Typed question while session awake → existing Ask flow → Oracle speaks the answer (input path never changes behavior) — the answer rides a stage-direction turn (`voiceSession.direct`), dropped by the session unless idle; her persona now acts through the tools instead of deflecting to the board (the S6 conflict)
- [x] No voice-only actions exist — a spoken move the board would not offer (closed reaction window, not your turn, round decided, unknown rune) answers with an engine-truth guard line and dispatches nothing
- Depends: S2

### S8 — Destructive action confirmation (R4)

- [x] `hex` and `cast_rune` tool calls gate behind spoken confirmation exchange; execute only on affirmative — two-phase gate in the page executor: the first call arms it and returns the confirmation question as the tool result (lines in `ux-copy.md` §1); the matching second call executes. Cast confirmation is per rune — naming a different rune re-arms. *(2026-06-12: `scry` joined the gate — it spends the night's single use; only the pass stays free)*
- [x] Decline or silence through timeout → no execution — the gate disarms when her second turn passes without the call (decline), on any tool call that isn't the clean matching confirm (other tools, guard lines, unknown runes), on any board move, and whenever the session sleeps (silence timeout is a full sleep, S5)
- [x] Post-cast retraction attempts → Oracle refuses in character; system instruction includes irreversibility doctrine ("the rune is cast; what is written in fire does not unwrite")
- [x] Client-side gate is authoritative—model cannot execute unconfirmed destructive calls even if it tries — the confirming call is refused unless an input transcript arrived since arming, so a double-call in one breath only re-asks
- Depends: S7

### S9 — Cast lockout (R5)

- [x] During Cast execution: voice commands rejected with in-character Oracle line; Cast completes regardless — a `casting` flag wraps the cast's engine round-trip (board- and voice-made alike); the executor answers every voiced command in that window with the lockout line (`ux-copy.md` §1, "The cast is sacred. Hold."), checked ahead of every guard and the S8 gate, and nothing can abort the dispatch
- [x] Barge-in stops Oracle audio only—never cancels a committed engine action — landed with S7 at the session (`interrupted` only stops the speaker; `toolCallCancellation` drops the answer, never the action); S9 pins it at the page too: barge-in events mid-cast leave the round-trip to complete
- Depends: S7

### S10 — Transcripts to text (R10)

- [x] Oracle output transcript renders in existing Answer panel as she speaks — fragments accumulate per turn into `answer` (so her last spoken line persists with the round view like any voiced line); turn boundaries ride the state events, and a barge-in starts a fresh caption — with no truncation signal, a cut caption may hold words never spoken, so it must never be extended
- [x] Input transcript (what she heard) captured from the session's `in` transcript events — the UI line under the Answer frame was removed (it read as stray debug text); the transcript belongs in `/debug` instead, tracked in `ttd.md`
- [x] Verify with output muted once S11 lands — S10's text surfaces render from the session's `transcript` events, not speaker playback; S11 mutes via a master gain (audio still decodes and drains), so the caption stream is provably independent of audible output
- Depends: S2

### S11 — Output mute (R11)

- [x] Single speaker toggle silences Oracle + Sköll audio; text/captions unaffected; mic streaming unaffected — the toggle drives a master gain in the Oracle `Speaker` (audio still decodes/drains, so caption turn-timing is byte-for-byte identical to unmuted); the shared preference (`outputMute.ts`) is the seam S13's wolf player reads the same way
- [x] State persists for the session — `sessionStorage` (`save-the-sun:muted`), survives a reload, resets with the tab; distinct from the per-round view in `viewState.ts`
- [x] Keyboard nav wired in for oracle controls — the medallion + mute toggle sit in one `role="group"` ("Oracle voice controls"); both are native buttons (Tab moves, Enter/Space fire), each with a focus-visible ring; the mute toggle is an `aria-pressed` toggle button
- Depends: S2

## Phase 3 — The wolf 🐺

### S12 — Sköll script + generation pipeline (R8) — _superseded: split into TTS game moves + deferred ambience_

The original S12 (a prebuilt clip library) was built then **reverted**. Two reasons: his **game-move** lines (the Ask, the winning cast) are *dynamic* — exactly what the shared TTS route handles — and the rest of the script is **ambience** (splash/idle/hunt mood) that the revised R10 makes audio-only, not a captioned game move.

- [x] Script content: taunt library in `ux-copy.md` §2 — tightened 2026-06-14 to short, two-beat lines. Reserved for the **ambience** layer (future).
- [ ] Ambience clip pipeline (prebuilt TTS, played as-is, no caption) — **deferred**; tracked in `ttd.md`. (`Algieba` voice picked over `Charon` by ear on a sample.)

### S13 — Director module (R8, R9) — _superseded by TTS game-move voicing_

His **Ask** is now voiced through the shared TTS route in his voice, not a clip director.

- [x] His Ask (a game move) is voiced + written — `skoll-ask` line descriptor (`lines.ts`) recomposes his line server-side from the parked `query` via `skollAskEcho`; `tts.ts` voices it in `SKOLL_VOICE`; the page delivers it through the same `deliver()` seam as the Oracle. If the Live mic is awake, the page waits for the Oracle to settle, holds mic forwarding, voices him, then resumes. Written on his frame (`skoll-echo`, R10).
- [x] One speaker at a time — structural: Oracle + Sköll share the one TTS delivery seam, so his line serializes after hers, never overlapping (R9).
- [~] His winning cast (a game move naming `{Rune}`) — **deferred**: voice it the same way once the rune rides the `Advance` wire, with a caption (`ttd.md`).
- [~] Taunt/address detection → wolf, idle/hunt ambience triggers — **deferred** with the ambience layer (taunt needs a spoken input; idle is a client timer).
- [x] Mic discipline during Sköll playback — his line lives on the delivery speaker, so the page waits for her Live line to drain (`voiceSession.whenSettled`), holds the mic (`hold()` pauses forwarding **and** the R7 clock), plays his line, then `resume()`s. No token mint, no reconnect; the loss outcome (his voice) rides the same path.
- Depends: S2, S12

---

## Spoken surface — voice-as-delivery 🔊

Every **game move** (R10) is composed server-side, allow-listed (`src/lib/server/voice/lines.ts`), and voiced through the one `deliver()` seam — text always, audio when on. One TTS route serves both voices (a `voice` param), and each line is wrapped in its speaker's director's-notes (`synthPrompt`) so the model voices it in character. Mic-independent: the board voices its moves with or without the Live mic.

- [x] Oracle answers + refusals — `answer` / `refusal` descriptors
- [x] Sköll's Ask — `skoll-ask`, his voice, recomposed server-side from the parked `query`
- [x] Reaction resolutions (Scry / Hex / Pass, both sides) — `react` descriptor, shared `reactionLines.ts`; the scry lines carry the overheard answer. Voiced in the Oracle's voice
- [x] Cast outcomes (true / wrong / falters) — `cast` descriptor, shared `castLines.ts`; the wrong-cast names a board-validated rune. Oracle's voice
- [x] End-screen outcome — `outcome` descriptor, shared `outcomeLines.ts`: a **win in the Oracle's voice** (victory coda), a **loss in Sköll's** (night-everlasting verse)
- [x] Director's-notes per voice — Sköll a deep gravelly growl, the Oracle a brisk reverent weight; tuned by ear 2026-06-14
- [x] Serialized delivery — lines chain on the one shared speaker, so two never interleave (her answer, then his Ask)
- [ ] Deferred (`ttd.md`): Sköll's winning cast (dynamic `{Rune}`), the audio-only ambience taunt layer, voicing the full Sól victory sequence (only one beat is voiced today)

## Order 🧭

S1 → S2 → {S3, S6, S7} → {S4, S5, S10, S11} → S8 → S9 → S12 → S13.
The voice surface settled into two decoupled layers (see [`architecture.md`](./architecture.md#voice--input-the-live-mic-and-output-delivery)): the **Live mic** for input (the medallion wakes/sleeps it) and **mic-independent TTS delivery** for output (every game move voiced, the Oracle and Sköll on one shared route). The prebuilt-clip S12/S13 were reverted in favor of that route; the audio-only ambience layer is deferred (`ttd.md`).

🤖 *Drafted with AI assistance; decisions by Ashley.* ☀️
