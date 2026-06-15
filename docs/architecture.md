# 🏗️ Architecture

How Save the Sun is wired: a Svelte 5 browser, SvelteKit routes, a deterministic in-memory server core, and the Gemini API. The engine owns the secret and referees every turn; Gemini only ever interprets language, plays Sköll, and voices the Oracle.

- Design intent: [`prd.md`](prd.md)
- Mechanics: [`game-spec.md`](game-spec.md)
- Voice contract: [`v2-voice-requirements.md`](v2-voice-requirements.md)

---

## System overview

The browser drives three surfaces (the board page, the voice session, the medallion). All game truth lives server-side, per session, in memory. Gemini sits behind the routes — never the browser, except the Live socket (opened with a single-use ephemeral token).

```mermaid
flowchart TB
    accTitle: Save the Sun system overview
    accDescr: The browser talks to SvelteKit routes, which call the in-memory server core and the Gemini API. The engine referees the round; Gemini interprets Asks, plays Sköll, and voices the Oracle.

    subgraph Browser["Browser"]
        Page["+page.svelte<br/>board, controls, view-state"]
        Voice["voiceSession.ts<br/>Live mic + tool loop"]
        Medallion["EclipseMedallion<br/>wake / sleep"]
    end

    subgraph Routes["SvelteKit routes"]
        Action["POST /api/action<br/>Ask / Cast / React / Advance"]
        NewGame["POST /api/new-game"]
        Token["POST /api/voice/token"]
        VDebug["POST /api/voice/debug"]
        Debug["GET /api/debug"]
        DebugPage["GET /debug"]
    end

    subgraph Core["Server core (in memory, per session)"]
        Engine["engine/ — engine + session + actions<br/>secret, board seed, round id, lock"]
        Sköll["Sköll — skoll/ floor + gemini<br/>the wolf's move"]
        Oracle["oracle/ — interpret the Ask"]
        Log["debug/log.ts<br/>per-session event stream"]
    end

    Gemini["Gemini API<br/>Live voice — gemini-3.1-flash-live-preview<br/>oracle + Sköll — gemini-3.5-flash"]

    Page --> Action
    Page --> NewGame
    Medallion --> Voice
    Voice --> Token
    Voice --> VDebug
    Voice -.tool calls.-> Page
    DebugPage --> Debug

    Action --> Engine
    Action --> Sköll
    Action --> Oracle
    NewGame --> Engine
    Token --> Gemini
    Sköll --> Gemini
    Oracle --> Gemini
    Voice -.Live socket.-> Gemini

    Engine --> Log
    Sköll --> Log
    Oracle --> Log
    VDebug --> Log
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

## Voice — input (the Live mic) and output (delivery)

Voice is two decoupled layers. **Output** is mic-independent: every game move is composed server-side and voiced through one TTS route and a shared speaker, so the board speaks whether or not the mic is on. **Input** is the optional Live mic, reached through the medallion. The board buttons and the text box play fully without either.

### Output — delivery

Every game move (R10) is composed server-side, allow-listed (`src/lib/server/voice/lines.ts`), and voiced through one `deliver()` seam (`src/lib/voice/delivery.ts`): written to its panel or frame **always**, and played through the shared TTS speaker **when audio is on**. One `POST /api/voice/tts` route serves both characters via a `voice` param, each line wrapped in its speaker\'s director\'s-notes (`synthPrompt`) so the model voices it in character — Sköll a deep gravelly growl, the Oracle a brisk reverent weight.

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

- **Server-owned, allow-listed.** The route voices only known line IDs (engine outcomes, the pre-engine refusals and guards), never arbitrary client text, so it can\'t be spammed for free TTS. The finite templated lines are cached.
- **Both voices, one route.** The Oracle\'s answers, refusals, reaction resolutions, and cast outcomes are hers; **Sköll\'s Ask and the loss outcome are his**. A win speaks in the Oracle\'s voice (the victory coda), a loss in Sköll\'s (the night-everlasting verse), so the player hears who took the day.
- **Mic-independent.** Output rides this seam regardless of the mic; the output-mute control (below) silences it without touching the captions.
- **Deferred** (`ttd.md`): Sköll\'s winning cast voiced (the dynamic `{Rune}`, once it rides the `Advance` wire) and the audio-only ambience taunt layer (`ux-copy.md` section 2).

### Input — the Live mic (optional)

A medallion wake mints a single-use token, connects the Gemini Live session, and hands the model declared tools. When the model calls one, the page executor runs it through the **same engine dispatch as the buttons**, then voices the result line back. The board and text box never depend on this being alive.

```mermaid
sequenceDiagram
    accTitle: Voice input - Live session and tool-call loop
    accDescr: A medallion wake mints a token, connects the Gemini Live session, and the model calls game tools that the page executor runs through the same engine dispatch as the buttons, then voices the result.

    participant Medallion as EclipseMedallion
    participant Voice as voiceSession.ts
    participant Token as POST /api/voice/token
    participant Live as Gemini Live
    participant Exec as executeVoiceTool (page)
    participant Action as POST /api/action

    Medallion->>Voice: wake()
    Voice->>Token: mint ephemeral token (single use)
    Token-->>Voice: token
    Voice->>Live: connect (LIVE_MODEL, persona, tools)
    Live-->>Voice: setupComplete - listening

    Note over Voice,Action: model calls a tool
    Live->>Voice: toolCall ask / scry / hex / pass / cast_rune
    Voice->>Exec: executeVoiceTool(call)

    alt scry / hex / cast_rune - confident reading (confidence > 0.5)
        Note right of Exec: gate steps aside - the move executes on the first call
    else unsure - S8 confirmation gate
        Exec-->>Voice: confirmation question (arm, await spoken reply)
        Note right of Exec: confirming call executes only after the player speaks
    end

    Note right of Exec: S9 cast lockout outranks every guard while a cast is in flight

    Exec->>Action: same engine dispatch as the buttons
    Action-->>Exec: outcome state
    Exec-->>Voice: outcome line
    Voice->>Live: sendToolResponse(outcome)
    Live-->>Voice: voices the result
```

- The browser only ever holds the **ephemeral** token; the real `GEMINI_API_KEY` stays server-side, masked at the debug sink.
- **S8 gate** - `scry`, `hex`, `cast_rune` are destructive (a one-night charge or the whole round). The model scores each call with a `confidence` (0-1) for how surely it read her words; above `0.5` the executor skips the gate and the move lands on the first call (no confirmation echo). At or below it - or with no confidence at all - the first call only arms a confirmation and asks again. Client-authoritative: while the gate holds, nothing reaches the engine until the player has spoken since arming.
- **S9 lockout** - while a cast is in flight (`casting`), the executor seals: the lockout outranks every guard and the gate.
- A denied or absent mic seals the session into the terminal `eclipsed` state and is never re-prompted; the button game is never affected.

### Controls

- **Eclipse medallion** - the click on/off voice control (tap to wake the mic, tap to sleep) and the living indicator. All animation is the Oracle alive: the corona breathes while listening, flares with the player\'s voice while hearing, and pulses while she speaks. **When Sköll speaks the disc deepens toward total eclipse with an ember rim** - the sun devoured - so the speaker reads by brightness and shape, never color alone. Reduced motion swaps the pulses for static glow intensities. Each state carries an ARIA label and a polite live-region announcement.
- **Output mute** - a separate toggle that silences both voices while their captions keep arriving in the panel. Set-and-forget, persists for the session (R11), independent of the mic: muting is not sleeping.

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
