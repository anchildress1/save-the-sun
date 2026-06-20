# Save the Sun—UX Copy & Voice

Every player-facing string, plus the voice rules that govern them. Diegetic (in-world) voice only—the dev.to submission post is a separate, judge-facing register and is out of scope here. Mechanics in `game-spec.md`, rune data in `rune-board.md`.

Production notes: the Oracle's answers may be templated (engine fills `{trait}`/`{value}`). Sköll's player-facing **text** line is his templated Ask—now also voiced in his own voice through the shared server TTS route (a game move, R10). Taunts and cast lines were cut from the v1 board (see §2); they return as the deferred **ambience** library (§2 — audio-only flavor, no caption). No emoji anywhere; no exclamation in any diegetic line except the single allowlisted one in Sköll's winning-cast bucket.

---

# Part I—Brand Voice

Mythic-but-playful: **mythic gravity with a dry wink.** The world believes in itself completely; that conviction is what makes the lightness land. Every line should feel carved before the player arrived—short, weighty, firelit—but warm enough to keep a first-timer leaning in rather than reaching for a wiki.

## We Are / We Are Not
Voice is constant. It does not soften because the player is new or sharpen because they're losing.

| We Are | We Are Not |
|--------|------------|
| **Mythic**—ritual weight, old language | **Cosplay**—no "thou/thee/forsooth," no renaissance-faire clichés |
| **Wry**—a dry wink under the gravity; grave, not grim | **Jokey**—no memes, puns, winking from outside the fiction |
| **Spare**—few words, each load-bearing; firelit, not floodlit | **Terse to the point of cold**—spare still breathes; never robotic |
| **Truthful**—the Oracle never lies about the sign it read | **Coy**—no fake suspense, no withholding an owed answer |
| **Predatory (Sköll only)**—hunger, patience, teeth | **Cruel**—taunts the play, never demeans the player |
| **Reverent (Oracle/Sól only)**—the sun is worth the rite | **Preachy**—reverence shown through ritual, never lectured |

## Cast Voice Charter
The most important table here. Each speaker owns a fixed position on the dials. **Rule of thumb:** if a line could be spoken by either the Oracle or Sköll without changing who said it, rewrite until the speaker is unmistakable.

| Speaker | Register | Warmth | Playfulness | Length | Owns |
|---|---|---|---|---|---|
| **Oracle** | Reverent, ceremonial | Warm-neutral (an instrument, not a friend) | Low—a rare dry note | 1 sentence, sometimes 2 | Echoes, answers, refusals |
| **Sköll** | Predatory, sardonic | Cold | High—the playful budget lives here | 1 short line | Taunts, his casts, reactions |
| **Sól / Dawn** | Reverent, luminous | High | None—pure weight | 1–2 sentences, rare | Victory only |
| **The Rite (system)** | Plain-mythic, quiet | Neutral | Low | Label-length | Buttons, states, onboarding |

## Personality
- **Archetype:** the Keeper of the Rite (Oracle) vs. the Hunter (Sköll). The world itself is the Sage at the Fire—knows more than it says, says only what's needed.
- **Core values in voice:** truth over suspense, weight over volume, conviction over explanation, the dawn is earned.

## Terminology (use the world-noun, never the engine word)
| Use | Not |
|---|---|
| the rune / the true rune | the answer, the solution |
| Ask / Cast | guess, query, submit |
| the Oracle / Sköll / Sól | the AI, the bot, the opponent, victory |
| power | marks, dots, pips, number |
| light / dark | empty/full, filled/unfilled |
| element / power / light / hue | fill, dot-number, number, marks, trait, axis |
| the longest day | the round, the match |
| sign | data point, attribute |
| Scry / Hex | "card," "power-up"—they're one-use reactions, not cards; always by name |

## Never
Emoji in diegetic copy. Exclamation marks in Oracle/Sól lines (Sköll earns one, rarely). Modern idiom ("level up," "pro tip," "let's go"). "Correct!/Wrong!", "Good luck!", "Nice try!", "Game over," "Invalid action," "Play again," "?"-only CTAs. Fake ambiguity, flattery, "interesting choice."

## Anti-patterns → fixes
- "I think it might be a fire rune?" → "It is not a fire rune." *(Oracle never speculates.)*
- "Great question! Let me check that for you." → "You ask after fire. — No. Sól is not reaching for a fire rune." *(no service-desk voice.)*
- "You lost! Sköll got there first. Try again?" → "Sköll names the rune. The sun does not rise. The longest day never breaks." *(no arcade tone at the heaviest beat.)*
- Sköll: "Ha! You're terrible at this!" → "You hesitate. I do not." *(punch at the play, not the person.)*

---

# Part II—Copy by Surface

## 1. Oracle

### Spoken moves (voice, S7)

A voiced action calls the same engine function as its button, and the Oracle voices the same line the panel shows. When a spoken move isn't on offer, nothing executes; the engine truth below reaches the model as the tool result, voiced in her register (these never show in the panel — no move was made):

| Trigger | Line |
|---|---|
| Any move while another move is resolving | "The rite is moving. Hold." |
| Any voiced command while a cast resolves (S9 — outranks every other line) | "The cast is sacred. Hold." |
| Ask or Cast while Sköll's question hangs | "His question hangs — scry, hex, or pass." |
| Ask or Cast on Sköll's turn | "The wolf is moving. Hold." |
| Scry / Hex / Pass with no hanging question | "Sköll asks nothing to scry, hex, or pass." |
| Scry when the night's one scry is already spent | "Your scrying is spent for the night." |
| Hex when the night's one hex is already spent | "Your hex is spent for the night." |
| Any move after the round resolves | "The longest day is decided — begin anew." |
| Cast of a rune not on the board | "No rune named {name} lies on the board." |

A cast is sacred (R5): once the rune is named to the engine — by board or by voice — nothing spoken interrupts it. Every voiced command through that window earns the lockout line and dispatches nothing; barge-in cuts the Oracle's audio only, never a committed engine action.

### Destructive confirmation (voice, S8)

A spoken scry, hex, or cast carries the model's `confidence` (0–1) in how it read her words. Sure of it (above 0.5), the move executes on the first call. Unsure, the rite answers with a confirmation question instead (the tool result, voiced in her register — never shown in the panel), and only the player's spoken affirmation lets the second call through. Decline or silence lets it lie. Scry and hex gate because each is the night's single use; the cast stakes the round. Only the pass is free. The cast question is per rune; naming a different rune asks again.

| Trigger | Line |
|---|---|
| Scry, first call | "Lean into the dark?" |
| Hex, first call | "Seal his lips?" |
| Cast, first call (per rune — the question names the target) | "Stake the round on {Rune}?" |

The questions are short by design: the exchanges recur, and a spoken preamble every time wears thin. The irreversibility doctrine lives in the persona and the retraction refusal below, not in the question.

Retraction is refused in character — the persona carries the doctrine verbatim: *"What is written in fire does not unwrite. The rune stands."*

### Transcripts (voice, S10)

Everything spoken is also written (R10). Her speech captions live into the Answer panel — the caption is whatever she actually says, so confirmations and guard answers reach the player in text through her voice even though the page prints no panel line for them.

The **input** transcript (what the mic heard) is **not** shown in the rite UI — it read as stray debug text under the Answer frame. It belongs in `/debug` instead; routing it there is tracked in `ttd.md`.

### Interpretation echo (public, before the answer)
Pattern: **`You ask after {paraphrase}.`**—then a held beat, then the answer.

The echo is what the **rival** sees when you Ask—your answer stays private to you (and a Scry-er). You only see the echo on the **rival's** Ask, where it opens the Scry/Hex window; you never get his answer (unless you Scry). The asker themselves sees the answer, which already restates the trait, so the echo is not shown back to them.

Slash-separated echo lines below are parser paraphrase examples, not rotation pools. Use the single paraphrase that matches the interpreted query.

| Question type | Echo |
|---|---|
| Element group | "You ask after the fire-runes." / "You ask whether water claims it." |
| Power exact | "You ask after three power." |
| Power range | "You ask whether fewer than three power." / "You ask whether two or more." |
| Light/dark | "You ask whether it is light." / "You ask whether it is dark." |
| Hue | "You ask whether gold." |
| Single rune | "You ask after Sowilo by name." |

### Answers (private to the asker; plus a Scry-er when the Scry reaction is in play)
Templated. **Both verdicts restate the trait**—`Yes. Sól is reaching for {value-phrase}.` when her rune has it, `No. Sól is not reaching for {value-phrase}.` when it doesn't. Verdict and clause always agree, so a negated Ask never double-negates. The engine fills `{value-phrase}`.

**Pattern:** Yes → `Yes. Sól is reaching for {value-phrase}.` · No → `No. Sól is not reaching for {value-phrase}.`

| Asked | Answer—Yes | Answer—No |
|---|---|---|
| Element ("earth?") | "Yes. Sól is reaching for an earth rune." | "No. Sól is not reaching for an earth rune." |
| Power, exact ("three power?") | "Yes. Sól is reaching for a rune of three power." | "No. Sól is not reaching for a rune of three power." |
| Power, range ("fewer than three?") | "Yes. Sól is reaching for a rune of fewer than three power." | "No. Sól is not reaching for a rune of fewer than three power." |
| Light / dark ("light?") | "Yes. Sól is reaching for a light rune." | "No. Sól is not reaching for a light rune." |
| Hue ("gold?") | "Yes. Sól is reaching for a gold rune." | "No. Sól is not reaching for a gold rune." |
| Single rune ("Sowilo?") | "Yes. Sól is reaching for Sowilo." | "No. Sól is not reaching for Sowilo." |

`{value-phrase}` by axis: element → "a/an {element} rune"; power → "a rune of {n} power" (ranges: "fewer than {n} power" / "{n} or more power"); light/dark → "a {light/dark} rune"; hue → "a/an {color} rune"; single rune → "{Rune}". Element and hue read lowercase in the phrase ("an earth rune," "a gold rune").

**Negation is not asked.** The Oracle speaks of what *is*, never what is not, so a negated Ask ("is it not fire?", "isn't it light?", "anything but gold?") is refused—there is no not-equal operator. The witch asks plainly and reads the verdict; a `No` already tells them what Sól is not reaching for.

> Voice-guard: never "I think," "maybe," "it seems," and no mood-only answers ("Gray bleeds into the dark"). State the verdict (Yes/No) and the trait clause—what Sól is or is not reaching for—and nothing more; never hedge or invent a reason.

### Refusals
| Trigger | Line |
|---|---|
| Mixed-type ("is it a red fire rune?") | "I read one sign at a time, not two." |
| Asks for the secret | "That is Sól's to keep until you name it." |
| Prompt poking / override | "I answer the longest day, not you." |
| Negated Ask ("is it not fire?") | "I speak of what is, not what is not." |
| Unparseable / not a question | "That is no sign I can read." |
| Empty submit | "Speak your question, witch." |

## 2. Sköll

Sköll's on-board surface carries **only his Ask**—the inference the human Scries, Hexes, or lets pass. No taunts, no cast lines: his box shows his Ask when he Asks and is blank otherwise. His casts read from the engine (the turn pill flips; a winning cast raises the end screen, which owns the defeat text — the Oracle panel keeps its last voiced line, the WHY of the loss); the wolf's pressure is felt in how he plays, not in chatter.

### His Ask (the only Sköll line shown)
He asks in **his own voice**—first-person, predatory, sardonic (the Cast Voice Charter, Part I)—**not** the Oracle's third-person paraphrase. The line still names the sign he hunts, so the human knows what they're choosing to Scry, Hex, or let pass.

| Axis | Line |
|---|---|
| Element | "I scent a fire rune on her." |
| Hue | "A gold rune. Mine." |
| Light / dark | "Light or dark — I taste a dark one." |
| Single rune | "Sowilo. I name it in the dark." |
| Power exact | "Three power. I can smell it." |
| Power range | "Fewer than three power. I can smell it." / "Three power or more. I can smell it." |

Power is spoken as a word (1–6), not the Oracle's digit grammar—the registers are deliberately distinct so the speaker is unmistakable.

_Cut from the v1 UI (flavor, not inference): the idle/turn taunts, the escalation tier (was P2), and the public cast lines ("I name it. {Rune}." / "The hunt ends. {Rune}.")._ The cut applies to his on-board **text** surface only—the spoken taunt library below revives these for the voice layer.

### Sköll script—ambience library (deferred)

> These are **ambience**, not game moves: atmosphere that sets the hunt's mood. By the revised R10 they are **audio-only** (no caption) — they carry no game state. His actual game-move lines (his Ask, his winning cast) are voiced through the shared TTS route and written; see "His Ask" above. This library is **deferred** — the lines are approved and tightened (2026-06-14, ~3–7 words), the clip pipeline is future work (`ttd.md`).

Library rules (for when it lands):

- **Spoken only**, audio-only — prebuilt clips played as-is, nothing printed (these are exempt from R10 captioning).
- One line per trigger, drawn from the bucket; **no line repeats within a night.**
- Voice holds to the charter: predatory, sardonic, cold—he taunts the play, never the player. "Witch" is his only address. The single exclamation lives in the winning-cast bucket (a *game-move* line, voiced via TTS) and nowhere else.
- **Triggers by context** — splash open (night-opens), an idle-on-your-turn timer (idle), hunt progression (far/closing/near), reactions (wrong cast, Hexed Ask), end screen (defeat exit). The taunt-address bucket needs a spoken input → returns with the mic (P5).

**The night opens (splash / round open)**

- "The night ends in my jaws."
- "I have hunted her for ages."
- "The sun knows how this ends."

**The hunt, far (his field still wide)**

- "The scent is thin. It thickens."
- "A wide field. I have run wider."
- "Every answer trims the dark."

**The hunt, closing**

- "Fewer places left to hide."
- "The trail warms underfoot."
- "I taste which one. Almost."

**The hunt, near (one or two left)**

- "Two left. I need one."
- "Close enough to hear her burn."
- "One answer, and dawn is mine."

**The witch casts wrong**

- "Wrong rune. The night thanks you."
- "All that crossing, for that."
- "Spend your turns. I hunt."

**His Ask is Hexed**

- "Silence her. My nose works."
- "Clever. It saves you once."
- "Kill the question. The trail remains."

**The witch wins (defeat exit — one line, rare)**

- "Keep your dawn, witch. Another year comes."

_The defeat line plays after Sól's victory sequence resolves — never over her beats. Her rarity stays the power; his exit is an aside, not a scene._

**The witch hesitates (idle on your turn)**

- "You hesitate. I do not."
- "Count them again, slower."
- "The fire burns while you stare."

**The witch taunts him (routed by detection — needs the mic)**

- "Bold words from prey."
- "Save your breath for dawn."
- "Louder ones have burned."

**His winning cast** — _a game move (names a `{Rune}`): voiced via TTS like his Ask, and written; not part of this ambience library_

- "I name it. {Rune}."
- "The hunt ends. {Rune}."
- "{Rune}! And the dawn dies with it." _(the one allowed exclamation)_

## 3. Reactions—Scry & Hex

One-use reactions, **not cards**—no deck, no hand. Both trigger on an **Ask**; a Cast is sacred and cannot be interrupted. A spent reaction stays visible but disabled for the game—no visible "spent" copy.

### Tooltips
| Reaction | Tooltip |
|---|---|
| **Scry** | "When your rival asks, hear the answer too." |
| **Hex** | "When your rival asks, seal the Oracle's lips — no answer comes, and his turn is wasted." |
| **Pass** | "When your rival asks, let the question stand." |

### You use a reaction (on Sköll's Ask)
**Interrupt prompt:** buttons **"Scry"** · **"Hex"** · **"Pass"**. The **"Sköll asks. Answer it?"** heading is **not displayed** in v1—it survives only as the buttons' accessibility group label (`aria-label`); the visible reaction-prompt copy is deferred to a v2 reaction-UI redesign.
- **You Scry:** "You lean into the dark; his answer is yours."
- **You Hex:** "You close the Oracle's lips; his turn dies with the question."
- **You pass:** "You stay your hand; Sköll gets his answer." _(the Oracle answers his question — Sköll only receives it)_

### Sköll uses a reaction (on your Ask)

Voiced in the **Oracle text**, in the rite's own voice (third person—never his first-person gloat).

- **Sköll Scries** (hears your answer): the Oracle speaks your answer (you still get it), then notes he overheard—**"{answer} Sköll listened at the threshold — the answer is his too."**
- **Sköll Hexes** (silences your Ask): the question died, so the Oracle text replaces the answer—**"Sköll silences the Oracle; your question dies."**

## 4. Win / Lose

### Wrong Cast
**"{Rune} is not the one. The night holds."** _(repeat the named rune; no generic "the rune" fallback.)_

### Victory—your correct Cast (glyph carves into stone)
1. On the cast landing: **"The rune is true."**
2. As the glyph carves: **"Sól crests the rim of the world."**
3. Sól (her only appearance): **"The offering is made. The longest day breaks — and the light is yours to keep."**
4. CTA: **"Begin another night"** _(the only closing action—the secondary "Leave the fire." was cut)_

### Defeat—Sköll casts first
1. The loss resolves on the end screen in three falling beats: lead **"Sköll takes the sun."**, verse **"The longest day never breaks. The night is everlasting."**, coda **"Sól waits in the dark — only the true rune can win her back."** _(She does not return on her own — the replay is the rescue. Sköll's cast carries no line of its own; the Oracle panel deliberately keeps its last voiced answer—and his Scry note when he overheard it—so the WHY of the loss stays readable. Never doubled into the panel; see §2.)_
2. CTA: **"Stand against him again"** _(the only closing action—the secondary "Leave the fire." was cut)_

Sól speaks only at victory—the goddess's rarity is the power.

## 5. Title & Onboarding

### Title screen
- **Title:** Save the Sun
- **Tagline:** *"A rite for the longest day."*
- **Primary CTA:** **"Light the fire."**
- **Secondary:** **"How the rite works"** (opens onboarding)

### First-run onboarding (one concept per step, dismissable, board visible behind)
Plain, clear, mechanic-first — flavor stays light so the rules read at a glance. Order: the goal, then the board, then the actions (Ask → Scry & Hex → Cast), and voice last since it does the same as all of them.

Read in order: each card builds on the last, so none repeats the count or the win/lose stakes, and none scolds.

- **Step 1—The Goal:** "One rune on the board is Sól's — her true rune. Cast it before Sköll does: name it first and the sun is saved; if he names it first, the night is his."
- **Step 2—The Board:** "Twenty-four runes, no two alike — each with its own element, color, and a power from 1 to 6. Watch the power's pips, too; they carry a tell of their own." *(Light/dark — the clean 50/50 split — is deliberately NOT named here; the pip shade is the player's to discover, so onboarding never hands over the strongest question.)*
- **Step 3—Ask:** "Ask the Oracle one yes/no question about a trait — an element, a power, a color, or a rune by name. Her answer is always true. Cross off whatever it rules out; the board leaves that to you." *(Light/dark omitted from the list for the same reason — askable, but discovered.)*
- **Step 4—Scry & Hex:** "Sköll hunts the same rune, and he questions the Oracle too. You hold one Scry and one Hex for the whole game — Scry to overhear her reply to him, or Hex to cut his question short."
- **Step 5—Cast:** "When the board's down to one, cast it — tap Cast, then the rune. Get it right and the day is yours; get it wrong and your turn's gone, so be certain before you name it."
- **Step 6—Speak:** "Rather not type? Hold the medallion (or press the backtick key), speak, then let go. Your voice does all of it — ask, Scry, Hex, and cast."
- **Final button:** **"Find her rune."**

## 6. Chrome & States

### Core action buttons
| Action | Label |
|---|---|
| Ask | **"Ask"** (visible; accessible name stays "Ask the Oracle") |
| Cast | **"Cast the rune"** |
| Reactions | **"Scry"** · **"Hex"** (named, never "use reaction") |
| Confirm a cast | **"Name it"** |
| Back out of a cast | **"Not yet"** |

### Deduction explainer (first-run onboarding / coach-mark popovers, §5)
> **"Ask. Cross off what it can't be. Cast when you're ready."**

Delivered through the onboarding popovers (R7), not as persistent on-board text.

### Persistent chrome
| Element | Copy |
|---|---|
| Whose turn—you | **"Your move."** |
| Whose turn—Sköll | **"Sköll moves."** |
| Night's progress (cosmetic, by elapsed turns—no timer mechanic) | early: **"The night lies deep and unbroken."** → mid: **"Gray bleeds into the dark."** → late: **"Dawn gathers at the edge of the world."** |
| Round resolved—header tag beside the celestial body (full resolution line lives in the Oracle panel, §4) | human win (moon → risen sun): **"Sól crests the rim of the world."** · Sköll win (moon holds): **"Sköll takes the sun."** |
| Cast armed (player believes one remains) | **"Cast?"** |

### Eclipse medallion (push-to-talk control)

The medallion is the push-to-talk control: **hold** it (Space or Enter when it's focused, or the `` ` `` key from anywhere — never page-wide Space, which activates whatever control has focus) to record an Ask, release to send. Its accessible name carries the state plus the hold affordance; the announcement column is the polite live-region line for each transition. Visual states live in `v2-voice-requirements.md` R6.

Hovering or focusing the disc (while live, not sealed) reveals a small hint — **"Hold to speak, or hold `` ` ``"** — so the page-wide backtick key is discoverable, not buried. The hint is also the button's `aria-describedby`, so it is read on focus, not only seen on hover.

| State | Button label | Announced |
|---|---|---|
| Idle (ready — hold to speak) | **"Hold to speak to the Oracle."** | "Ready to hear you." |
| Recording (held) | **"Listening — release to ask."** | "Listening." |
| Thinking (transcribing + asking) | **"The Oracle considers your words."** | "The Oracle considers." |
| Oracle speaking | **"The Oracle speaks."** | "The Oracle speaks." |
| Sköll speaking | **"Sköll speaks."** | "Sköll speaks." |
| Denied (mic denied or absent — sealed for the session, inert) | **"The voice is sealed. The rite continues by hand."** | "The voice is sealed." |

A denied or absent mic shows one quiet notice by the medallion (never in the Oracle's answer frame) and is final for the session (R1) — the medallion seals into the inert `denied` state and never re-prompts:

| Failure | Notice |
|---|---|
| Mic denied / no device | "The fire cannot hear you. The rite continues by hand." |

### Output mute (voice control)

A second control beside the medallion: a toggle button (`aria-pressed`) that silences both voices while their words keep arriving in the panel. Independent of the mic. The preference persists for the session (R11).

| State | Button label (accessible name) |
|---|---|
| Audible (tap mutes) | **"Silence the voices. Their words still appear in writing."** |
| Muted (tap unmutes) | **"Let the voices be heard."** |

Muted is signaled by shape, never color alone: the speaker glyph loses its sound waves and gains a strike.

### Empty & error states (stay at the fire)
| State | Copy |
|---|---|
| Board, before any Ask | "Twenty-four runes stand. None ruled out. Ask the Oracle." |
| Connection / engine error | "The Oracle falls silent — the rite can't reach Sól." |
| Action while it's Sköll's move | "The wolf is moving. Hold." |
| Below the desktop minimum (750px)—best-on-desktop notice (R10) | "The rite needs a wider sky. Return on a desktop to take up the runes." |

---

## Localization Notes
- "the longest day," "the short night," "quarry," "sign," "rune," "cast," "power," "light/dark" are load-bearing world-nouns—translate for meaning and weight, not literally; keep them consistent everywhere.
- Avoid English-only idiom in player copy.
- Em dashes / the held beat are a deliberate rhythm device—preserve a pause (a line break works if the dash doesn't).
- Sköll's menace must read as *competitive*, not abusive, in every language—flag for translator review.

## Locked decisions (2026-06-04)
- **Frame:** the longest day (headline) won through the one short night (nuance).
- **Traits:** count = "power"; fill = "light/dark" (○ light, ● dark); axes = element, power, light, color.
- **Address:** Sköll says "witch" = gender-neutral coven role; Oracle addresses no one.
- **Reactions:** Scry + Hex are one-use reactions (not cards) that trigger on an Ask; Cast is sacred. Spent reactions remain visible but disabled (no visible spent copy).
- **Casting a crossed-off rune is legal**—crossing is the player's private aid, never validated.
- **Sól** speaks only at victory. Replay CTAs in-world ("Begin another night" / "Stand against him again"), never "Play again."
- No alternates, no neutral/system filler—single in-world choices throughout.
