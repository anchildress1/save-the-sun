# Save the Sun—UX Copy & Voice

Every player-facing string, plus the voice rules that govern them. Diegetic (in-world) voice only—the dev.to submission post is a separate, judge-facing register and is out of scope here. Mechanics in `game-spec.md`, rune data in `rune-board.md`.

Production notes: the Oracle's answers may be templated (engine fills `{trait}`/`{value}`). Sköll's only player-facing line is his templated Ask—taunts and cast lines were cut from v1 (see §2). No emoji anywhere; no exclamation in any diegetic line.

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
| Mixed-type ("is it a red fire rune?") | "I read one sign at a time. Ask of element, or power, or light, or hue — not two at once." |
| Asks for the secret | "That is Sól's to keep until you name it. I will not say." |
| Prompt poking / override | "I answer the longest day, not you. Ask of the runes." |
| Negated Ask ("is it not fire?") | "I speak of what is, not what is not. Ask it plainly." |
| Unparseable / not a question | "I cannot read that sign. Ask of element, power, light, or hue." |
| Empty submit | "Speak your question, witch." |

## 2. Sköll

Sköll's on-board surface carries **only his Ask**—the inference the human Scries, Hexes, or lets pass. No taunts, no cast lines: his box shows his Ask when he Asks and is blank otherwise. His casts read from the engine (the turn pill flips, the Oracle panel voices the resolution); the wolf's pressure is felt in how he plays, not in chatter.

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

_Cut from the v1 UI (flavor, not inference): the idle/turn taunts, the escalation tier (was P2), and the public cast lines ("I name it. {Rune}." / "The hunt ends. {Rune}.")._

## 3. Reactions—Scry & Hex

One-use reactions, **not cards**—no deck, no hand. Both trigger on an **Ask**; a Cast is sacred and cannot be interrupted. A spent reaction is gone for the game—no "spent" copy.

### Tooltips
| Reaction | Tooltip |
|---|---|
| **Scry** | "When your rival asks, hear the answer too." |
| **Hex** | "When your rival asks, seal the Oracle's lips — no answer comes, and his turn is wasted." |

### You use a reaction (on Sköll's Ask)
**Interrupt prompt:** buttons **"Scry"** · **"Hex"** · **"Let it pass"**. The **"Sköll asks. Answer it?"** heading is **not displayed** in v1—it survives only as the buttons' accessibility group label (`aria-label`); the visible reaction-prompt copy is deferred to a v2 reaction-UI redesign.
- **You Scry:** "You lean into the dark and listen. His answer is yours too."
- **You Hex:** "You close the Oracle's lips. His question dies unanswered — his turn with it."
- **You let it pass:** "You hold your hand. Let him have his answer."

### Sköll uses a reaction (on your Ask)

Voiced in the **Oracle text**, in the rite's own voice (third person—never his first-person gloat).

- **Sköll Scries** (hears your answer): the Oracle speaks your answer (you still get it), then notes he overheard—**"{answer} Sköll listened at the threshold — the answer is his too."**
- **Sköll Hexes** (silences your Ask): the question died, so the Oracle text replaces the answer—**"Sköll closes the Oracle's lips. Your question dies in the dark."**

## 4. Win / Lose

### Victory—your correct Cast (glyph carves into stone)
1. On the cast landing: **"The rune is true."**
2. As the glyph carves: **"Sól crests the rim of the world."**
3. Sól (her only appearance): **"The offering is made. The longest day breaks — and the light is yours to keep."**
4. CTA: **"Begin another night"** _(the only closing action—the secondary "Leave the fire." was cut)_

### Defeat—Sköll casts first
1. The loss resolves: **"Sköll takes the sun. The longest day never breaks. The year falls to dark."** _(Sköll's cast carries no line of its own—the resolution is the Oracle panel's; see §2.)_
2. CTA: **"Stand against him again"** _(the only closing action—the secondary "Leave the fire." was cut)_

Sól speaks only at victory—the goddess's rarity is the power.

## 5. Title & Onboarding

### Title screen
- **Title:** Save the Sun
- **Tagline:** *"A rite for the longest day."*
- **Primary CTA:** **"Light the fire."**
- **Secondary:** **"How the rite works"** (opens onboarding)

### First-run onboarding (one concept per step, dismissable, board visible behind)
- **Step 1—the stakes:** "Tonight the coven makes one offering to Sól. Name her true rune before Sköll does, and the longest day breaks. Fail, and the wolf swallows the dawn."
- **Step 2—Ask:** "Ask the Oracle yes/no questions about the runes — their element, power, light, hue, or one rune by name. She answers the sign she reads. One question a turn."
- **Step 3—read & cross:** "Twenty-four runes stand in the open. Cross off what each answer rules out. The crossing is yours — the board never does it for you. That reading is the whole game."
- **Step 4—Cast:** "When you're sure, cast a rune. Cast true and dawn is yours. Cast wrong and the turn is gone. Sköll is racing you for the same rune."
- **Step 5—Scry & Hex:** "Sköll asks the Oracle too. When he does, you may answer back once — Scry to overhear her reply, or Hex to silence her and kill his question. One Scry and one Hex a night; a Cast is sacred, never interrupted."
- **Final button:** **"Take up the runes."**

## 6. Chrome & States

### Core action buttons
| Action | Label |
|---|---|
| Ask | **"Ask the Oracle"** |
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

### Empty & error states (stay at the fire)
| State | Copy |
|---|---|
| Board, before any Ask | "Twenty-four runes stand. None ruled out. Ask the Oracle." |
| Connection / engine error | "The Oracle falls silent — the rite can't reach Sól. Draw breath, and ask again." |
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
- **Traits:** count = "power"; fill = "light/dark" (○ light, ● dark); axes = element, power, light, hue.
- **Address:** Sköll says "witch" = gender-neutral coven role; Oracle addresses no one.
- **Reactions:** Scry + Hex are one-use reactions (not cards) that trigger on an Ask; Cast is sacred. Spent reactions vanish (no copy).
- **Casting a crossed-off rune is legal**—crossing is the player's private aid, never validated.
- **Sól** speaks only at victory. Replay CTAs in-world ("Begin another night" / "Stand against him again"), never "Play again."
- No alternates, no neutral/system filler—single in-world choices throughout.
