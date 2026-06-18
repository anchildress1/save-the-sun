# 🏗️ Architecture

How Save the Sun is wired: a Svelte 5 browser, SvelteKit routes, a deterministic in-memory server core, and the Gemini API. The engine owns the secret and referees every turn; Gemini only ever interprets language, plays Sköll, and voices the Oracle.

- Design intent: [`prd.md`](prd.md)
- Mechanics: [`game-spec.md`](game-spec.md)
- Voice contract: [`v2-voice-requirements.md`](v2-voice-requirements.md)

---

## System overview

The browser drives three surfaces (the board page, the push-to-talk recorder, the medallion). All game truth lives server-side, per session, in memory. Gemini sits behind the routes — the browser never holds the key.

```mermaid
flowchart TB
    accTitle: Save the Sun system overview
    accDescr: The browser talks to SvelteKit routes, which call the in-memory server core and the Gemini API. The engine referees the round; Gemini interprets Asks, plays Sköll, transcribes push-to-talk audio, and voices the Oracle and Sköll.

    subgraph Browser["Browser"]
        Page["+page.svelte<br/>board, controls, view-state"]
        Rec["recorder.ts<br/>push-to-talk WAV"]
        Medallion["EclipseMedallion<br/>hold to speak"]
        Del["delivery.ts<br/>shared TTS speaker"]
    end

    subgraph Routes["SvelteKit routes"]
        Action["POST /api/action<br/>Ask / Cast / React / Advance"]
        NewGame["POST /api/new-game"]
        Transcribe["POST /api/voice/transcribe"]
        TTS["POST /api/voice/tts"]
        Debug["GET /api/debug"]
        DebugPage["GET /debug"]
    end

    subgraph Core["Server core (in memory, per session)"]
        Engine["engine/ — engine + session + actions<br/>secret, board seed, round id, lock"]
        Sköll["Sköll — skoll/ floor + gemini<br/>the wolf's move"]
        Oracle["oracle/ — interpret the Ask"]
        Log["debug/log.ts<br/>per-session event stream"]
    end

    Gemini["Gemini API<br/>Oracle — gemini-3.5-flash · Sköll — gemini-3.1-flash-lite<br/>transcribe — gemini-3.5-flash · TTS — gemini-3.1-flash-tts-preview"]

    Page --> Action
    Page --> NewGame
    Medallion --> Rec
    Rec --> Transcribe
    Transcribe -.text.-> Page
    Page --> Del
    Del --> TTS
    DebugPage --> Debug

    Action --> Engine
    Action --> Sköll
    Action --> Oracle
    NewGame --> Engine
    Transcribe --> Gemini
    TTS --> Gemini
    Sköll --> Gemini
    Oracle --> Gemini

    Engine --> Log
    Sköll --> Log
    Oracle --> Log
    Debug --> Log
```

- **Engine** holds the secret and judges casts. Gemini never sees the secret.
- **Sköll** runs his own deduction; the deterministic floor catches a failed or illegal Gemini call.
- **Log** is the public `/debug` stream — the on-stage proof the engine owns truth. The Gemini API key never enters it.

---

## Turn / Advance flow

A human Ask is one POST. Sköll's own move is a **separate** `Advance` POST the client fires afterward, so the human's answer paints first and the wolf moves under a live pill. Everything touching shared state runs under `withSessionLock`, serializing per-session mutation so a duplicate tab or retry can't interleave.

```mermaid
sequenceDiagram
    accTitle: Turn and Advance flow
    accDescr: A human Ask is one POST that the Oracle interprets and Sköll reacts to under a per-session lock. Sköll's own move is a separate Advance POST the client fires afterward.

    participant Page as +page.svelte
    participant Action as POST /api/action
    participant Lock as withSessionLock
    participant Oracle as oracle (interpret)
    participant Sköll as Sköll (react / move)
    participant Engine as engine (referee)

    Note over Page,Engine: 1 — the human's Ask
    Page->>Action: POST { type: Ask, question }
    Action->>Lock: serialize this session
    Lock->>Oracle: interpret free text into one query
    Oracle-->>Lock: query or refusal
    Lock->>Sköll: react to the Ask (Scry / Hex / Pass)
    Sköll-->>Lock: reaction
    Lock->>Engine: answer truthfully, hand turn to Sköll
    Engine-->>Action: state (turn now Sköll's)
    Action-->>Page: { oracle, skollVsYou, state }

    Note over Page,Engine: 2 — Sköll's turn is its own request
    Page->>Action: POST { type: Advance }
    Action->>Lock: serialize this session
    Lock->>Sköll: takeSköllTurn (Gemini, floor on failure)
    Sköll-->>Lock: ask or cast
    Lock->>Engine: apply the move, judge a cast
    Engine-->>Action: state
    Action-->>Page: { skoll, state }
    Page->>Page: render the wolf's move
```

- A refusal (negation, mixed-type, secret-seeking) never opens a window, spends the turn, or rouses Sköll.
- `Advance` carries no payload and is a no-op if it isn't Sköll's turn — a stray one is harmless.
- A failed `Advance` leaves the turn with Sköll and surfaces a retry; it never clobbers the human's earned answer.

---

## Voice — input (push-to-talk) and output (delivery)

Voice is two decoupled layers. **Output** is mic-independent: every game move is composed server-side and voiced through one TTS route and a shared speaker, so the board speaks whether or not the mic is on. **Input** is push-to-talk: hold the medallion (or hold `Space`) to record an Ask, release to send. There is no real-time session — one held recording per Ask, turn-based like the text box. The board buttons and the text box play fully without the mic.

### Output — delivery

Every game move (R10) is composed server-side, allow-listed (`src/lib/server/voice/lines.ts`), and voiced through one `deliver()` seam (`src/lib/voice/delivery.ts`): written to its panel or frame **always**, and played through the shared TTS speaker **when audio is on**. One `POST /api/voice/tts` route serves both characters via a `voice` param, each line wrapped in its speaker's director's-notes (`synthPrompt`) so the model voices it in character — Sköll a deep gravelly growl, the Oracle a brisk reverent weight.

```mermaid
sequenceDiagram
    accTitle: Voice output as delivery
    accDescr: Every game move is composed into a server-owned line, delivered to the panel as text always and to the shared TTS speaker as audio when audio is on. Both the Oracle and Sköll ride the one route.

    participant Move as Game move (engine outcome)
    participant Line as lines.ts (compose + allow-list)
    participant Del as deliver() (shared speaker)
    participant TTS as POST /api/voice/tts
    participant Panel as Answer panel / Sköll frame

    Move->>Line: compose the server-owned line
    Line->>Panel: text - always
    Line->>Del: audio - when audio is on
    Del->>TTS: synth in the speaker's voice (cached)
    TTS-->>Del: PCM chunks
    Del-->>Panel: plays alongside the written line
```

- **Server-owned, two paths, no client text.** The route voices either a known line ID recomposed from the engine's truth (`lines.ts` allow-list — engine outcomes, refusals, guards; cached), **or** a Gemini-authored line stashed server-side and fetched by an opaque per-session id (`storeVoiceLine`/`getVoiceLine`). Either way the words come from the server, never the wire, so it can't be spammed for free TTS.
- **Live authoring, guarded.** The Oracle's clean answer is dramatized by Gemini per Ask (`composeOracleFlair`), and the end screen speaks a fresh in-character line — the Oracle's blessing on a win, Sköll's gloat on a loss (`composeEndingFlair`). Authoring is bounded + timed-out with a deterministic fallback, and an answer flair that doesn't open with the engine's own Yes/No is discarded — the Oracle never lies, even in flair.
- **Both voices, one route.** The Oracle's answers, refusals, reaction resolutions, cast outcomes, and the win blessing are hers; **Sköll's Ask, his winning cast, and the loss gloat are his** — so the player hears who took the day.
- **Mic-independent + recoverable.** Output rides this seam regardless of the mic; the output-mute control (below) silences it without touching the captions. The last voiced line is recorded per session, so a dropped action's response can recover and re-voice the real result instead of a false silent line.
- **Deferred** (`ttd.md`): the audio-only ambience taunt layer (`ux-copy.md` section 2).

### Input — push-to-talk (optional)

Holding the medallion (or `Space`) records a short utterance; releasing sends it to `POST /api/voice/transcribe`, which transcribes it server-side via Gemini and returns the text. The page then runs that text through the **exact same Ask pipeline as the text box** — interpret → engine → delivery — so a spoken Ask and a typed Ask are identical past transcription. The mic opens once (one permission prompt); the board and text box never depend on it.

```mermaid
sequenceDiagram
    accTitle: Voice input - push-to-talk to a transcribed Ask
    accDescr: Holding the medallion or Space records a WAV; release posts it to the transcribe route, which returns text; the page runs that text through the same Ask pipeline as the typed box.

    participant Medallion as EclipseMedallion / Space
    participant Rec as recorder.ts (WAV)
    participant STT as POST /api/voice/transcribe
    participant Page as +page.svelte (submitAsk)
    participant Action as POST /api/action

    Medallion->>Rec: hold = startRecording
    Medallion->>Rec: release = stopRecording -> WAV
    Rec->>STT: { wavBase64 }
    STT-->>Page: { text }
    Page->>Action: Ask (same dispatch as the typed box)
    Action-->>Page: oracle answer -> delivery
```

- **Server-side key, allow-listed surface.** The browser sends only audio; `GEMINI_API_KEY` stays server-side (masked at the debug sink). The transcribe route is rate-limited per session and globally, like the TTS route.
- **Ask, plus the reaction.** A held reply produces an Ask — or, when Sköll's question hangs, a scry/hex/pass classified server-side (`reaction` mode of the transcribe route), run through the same `performReact` dispatch the buttons use. A mishear is safe: an `unclear` reply asks again and a spent scry/hex is refused, never a silent pass. Cast stays on the board button (with its own confirmation).
- **Turn-based.** A held recording is one request/response — no socket, no silence timeout, no barge-in. `Space` is the talk key everywhere except inside a text field (where it types); buttons keep Enter for keyboard activation.
- A denied or absent mic seals the medallion into the inert `denied` state (one quiet notice, never re-prompted); the button + text game is untouched.

### Controls

- **Eclipse medallion** — the push-to-talk control (hold to record, release to ask — pointer or `Space`) and the living indicator: idle when ready, a flaring corona while recording, the rune ring orbiting while the utterance is transcribed, and the corona pulsing while a line plays. **When Sköll speaks the disc deepens toward total eclipse with an ember rim** — the sun devoured — so the speaker reads by brightness and shape, never color alone. Reduced motion swaps the pulses for static glow intensities. Each state carries an ARIA label and a polite live-region announcement.
- **Output mute** — a separate toggle that silences both voices while their captions keep arriving in the panel. Set-and-forget, persists for the session (R11), independent of the mic: muting is not sleeping.

## Session & state lifecycle

`hooks.server.ts` sets one `sts_session` cookie per browser (httpOnly). That `sessionId` keys an LRU-capped registry in `session.ts` holding the engine, Sköll's memory, the round id, the board seed, and the debug log — all lifecycle-linked. A reload resumes; a new game resets.

```mermaid
flowchart TB
    accTitle: Session and state lifecycle
    accDescr: A session cookie set by hooks.server.ts keys an LRU-capped per-session registry holding the engine, Sköll memory, round id, board seed, and debug log. New-game resets them; the client persists view-state keyed by round id.

    Cookie["sts_session cookie<br/>set by hooks.server.ts (httpOnly)"]

    subgraph Registry["Per-session registry — session.ts (LRU, MAX_SESSIONS)"]
        Engine["GameEngine<br/>secret seed"]
        SköllMem["Sköll memory<br/>facts, crossed, pendingAsk"]
        RoundId["roundId<br/>opaque, per round"]
        BoardSeed["boardSeed<br/>public board order"]
        DLog["debug log<br/>per-session events"]
    end

    ClientStore["Client view-state<br/>crossings, voiced line, voiceInvited<br/>keyed by roundId"]

    Cookie -->|sessionId| Registry

    NewGame["POST /api/new-game"] -->|resetEngine| Registry
    NewGame -->|fresh roundId + boardSeed| ClientStore

    RoundId -.keys.-> ClientStore
    Reload["page reload"] -->|same roundId| ClientStore
    Reload -->|same sessionId| Registry

    Evict["LRU eviction / new round"] -->|drops| SköllMem
    Evict -->|drops| RoundId
    Evict -->|drops| BoardSeed
    Evict -->|resets| DLog
```

- **`roundId`** is opaque and independent of the secret seed, so exposing it can't leak the answer. It's stable across a refresh (same round) and reminted on a new round, so persisted crossings never restore onto a fresh secret.
- **`boardSeed`** fixes the on-screen board order for the round's life — a reload doesn't reshuffle. Independent of the secret seed.
- The registry is LRU-capped at `MAX_SESSIONS`; evicting a session drops its Sköll memory, round id, board seed, and log together.
- All state is in-memory: no accounts, no database.
