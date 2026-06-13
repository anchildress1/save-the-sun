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
        Skoll["Sköll — skoll/ floor + gemini<br/>the wolf's move"]
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
    Action --> Skoll
    Action --> Oracle
    NewGame --> Engine
    Token --> Gemini
    Skoll --> Gemini
    Oracle --> Gemini
    Voice -.Live socket.-> Gemini

    Engine --> Log
    Skoll --> Log
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
    participant Skoll as Sköll (react / move)
    participant Engine as engine (referee)

    Note over Page,Engine: 1 — the human's Ask
    Page->>Action: POST { type: Ask, question }
    Action->>Lock: serialize this session
    Lock->>Oracle: interpret free text into one query
    Oracle-->>Lock: query or refusal
    Lock->>Skoll: react to the Ask (Scry / Hex / Pass)
    Skoll-->>Lock: reaction
    Lock->>Engine: answer truthfully, hand turn to Sköll
    Engine-->>Action: state (turn now Sköll's)
    Action-->>Page: { oracle, skollVsYou, state }

    Note over Page,Engine: 2 — Sköll's turn is its own request
    Page->>Action: POST { type: Advance }
    Action->>Lock: serialize this session
    Lock->>Skoll: takeSkollTurn (Gemini, floor on failure)
    Skoll-->>Lock: ask or cast
    Lock->>Engine: apply the move, judge a cast
    Engine-->>Action: state
    Action-->>Page: { skoll, state }
    Page->>Page: render the wolf's move
```

- A refusal (negation, mixed-type, secret-seeking) never opens a window, spends the turn, or rouses Sköll.
- `Advance` carries no payload and is a no-op if it isn't Sköll's turn — a stray one is harmless.
- A failed `Advance` leaves the turn with Sköll and surfaces a retry; it never clobbers the human's earned answer.

---

## Voice Live-session + tool-call loop

A medallion wake mints a single-use token, connects the Gemini Live session, and hands the model declared tools. When the model calls one, the page executor runs it through the **same engine dispatch as the buttons**, then voices the result line back through the socket.

```mermaid
sequenceDiagram
    accTitle: Voice Live session and tool-call loop
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
    Live-->>Voice: setupComplete — listening

    Note over Voice,Action: model calls a tool
    Live->>Voice: toolCall ask / scry / hex / pass / cast_rune
    Voice->>Exec: executeVoiceTool(call)

    alt scry / hex / cast_rune — S8 two-phase gate
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
- **S8 gate** — `scry`, `hex`, `cast_rune` are destructive (a one-night charge or the whole round), so the first call only arms a confirmation and asks again. Client-authoritative: nothing reaches the engine until the player has spoken since arming.
- **S9 lockout** — while a cast is in flight (`casting`), the executor seals: the lockout outranks every guard and the gate.
- The button game never depends on the voice module being alive; a denied or absent mic seals the session into the terminal `eclipsed` state and is never re-prompted.

---

## Session & state lifecycle

`hooks.server.ts` sets one `sts_session` cookie per browser (httpOnly). That `sessionId` keys an LRU-capped registry in `session.ts` holding the engine, Sköll's memory, the round id, the board seed, and the debug log — all lifecycle-linked. A reload resumes; a new game resets.

```mermaid
flowchart TB
    accTitle: Session and state lifecycle
    accDescr: A session cookie set by hooks.server.ts keys an LRU-capped per-session registry holding the engine, Sköll memory, round id, board seed, and debug log. New-game resets them; the client persists view-state keyed by round id.

    Cookie["sts_session cookie<br/>set by hooks.server.ts (httpOnly)"]

    subgraph Registry["Per-session registry — session.ts (LRU, MAX_SESSIONS)"]
        Engine["GameEngine<br/>secret seed"]
        SkollMem["Sköll memory<br/>facts, crossed, pendingAsk"]
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

    Evict["LRU eviction / new round"] -->|drops| SkollMem
    Evict -->|drops| RoundId
    Evict -->|drops| BoardSeed
    Evict -->|resets| DLog
```

- **`roundId`** is opaque and independent of the secret seed, so exposing it can't leak the answer. It's stable across a refresh (same round) and reminted on a new round, so persisted crossings never restore onto a fresh secret.
- **`boardSeed`** fixes the on-screen board order for the round's life — a reload doesn't reshuffle. Independent of the secret seed.
- The registry is LRU-capped at `MAX_SESSIONS`; evicting a session drops its Sköll memory, round id, board seed, and log together.
- All state is in-memory: no accounts, no database.
