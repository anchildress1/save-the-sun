<h1 align="center">☀️ Save the Sun</h1>

<p align="center"><em>A deduction race against Sköll, the wolf who hunts the sun — name the hidden rune before he does.</em></p>

<p align="center">
  Built for the DEV 2026 June Solstice Challenge.<br/>
  Canonical design spec lives under <a href="./docs/"><code>docs/</code></a>; see <a href="AGENTS.md"><code>AGENTS.md</code></a> for AI agent rules.
</p>

<p align="center">
  <img alt="CI GHA Status" src="https://img.shields.io/github/actions/workflow/status/anchildress1/save-the-sun/.github%2Fworkflows%2Fci.yml?style=for-the-badge&logo=github&label=CI" />
  <img alt="CodeQL GHA Status" src="https://img.shields.io/github/actions/workflow/status/anchildress1/save-the-sun/.github%2Fworkflows%2Fcodeql.yml?style=for-the-badge&logo=github&label=CodeQL" />
  <br/>
  <img alt="Sonar Quality Gate" src="https://img.shields.io/sonar/quality_gate/anchildress1_save-the-sun?server=https%3A%2F%2Fsonarcloud.io&style=for-the-badge" />
  <img alt="Sonar Coverage" src="https://img.shields.io/sonar/coverage/anchildress1_save-the-sun?server=https%3A%2F%2Fsonarcloud.io&style=for-the-badge&color=limegreen" />
  <img alt="Lighthouse accessibility score 100, enforced pre-push" src="https://img.shields.io/badge/Lighthouse_a11y-100-limegreen?style=for-the-badge&logo=lighthouse" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/anchildress1/save-the-sun/main/docs/assets/social-banner.webp" alt="A rune stone blazing with golden light at sunrise while Sköll, the great wolf, watches from a dark ridge." />
</p>

## Table of Contents

- [About](#about)
- [Play](#play)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Security](#security)
- [How to Contribute](#how-to-contribute)
- [What's Next](#whats-next)
- [License](#license)
- [Acknowledgements](#acknowledgements)
- [Author](#author)

---

## About

It's the eve of the longest day, and the dawn must be earned. Twenty-four runes stand; one is the solstice offering. You question the Oracle in plain English, cross runes off by hand, and cast your answer before Sköll names it first. The deduction is rigorous and deterministic — every round is provably winnable through legal Asks alone, and the Oracle never lies — but it's wrapped in a night-to-dawn ritual instead of a logic grid. The night visibly advances as turns pass; the moon sets; dawn gathers at the edge of the world.

And it's spoken. Ask aloud — hold the medallion and say your question — or type it; either way the Oracle answers in her own voice, dramatized live, while Sköll answers from the dark in his. Every spoken line is also written, so nothing is lost with the sound off.

Design intent: [`docs/prd.md`](docs/prd.md) · mechanics: [`docs/game-spec.md`](docs/game-spec.md) · voice & copy: [`docs/ux-copy.md`](docs/ux-copy.md) · voice architecture: [`docs/architecture.md`](docs/architecture.md#voice--input-push-to-talk-and-output-delivery).

---

## Play

- **Live:** [savethesun.anchildress1.dev](https://savethesun.anchildress1.dev/)
- Desktop-first; the embedded board plays down to 750px wide. Below that, the rite asks for a wider sky.

---

## Features

| Feature            | What it does                                                                                                                                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free-text Asks     | Type a yes/no question — group, range, light/dark, hue, or a single rune. Gemini interprets it, echoes its reading, and the engine answers truthfully. Refusals (negation, mixed types, secret-fishing) don't cost the turn.                                                                   |
| Two voices         | Every game move is spoken — the Oracle in her voice, Sköll in his — through Gemini TTS, and written as captions so the sound-off game is identical. Her verdicts are dramatized live (never canned), guarded so a restyle can't flip the answer; the win/loss endings are spoken in character. |
| Talk to the Oracle | Push-to-talk: hold the medallion (or the backtick key), speak your Ask, release. The recording is transcribed server-side and runs the exact same pipeline as the text box — and you can answer Sköll's question (Scry / Hex / Pass) by voice too.                                             |
| The Cast           | Naming the rune is a separate, armed action — deliberate, sacred, and uninterruptible. Right wins the round; wrong wastes only the turn.                                                                                                                                                       |
| Sköll              | The wolf runs his own deduction over the same board and races you to the rune. His asks are visible; his reasoning isn't.                                                                                                                                                                      |
| Scry & Hex         | One-use reactions to his Ask: Scry steals his answer, Hex silences the Oracle and wastes his turn. He holds the same charges against you.                                                                                                                                                      |
| The night advances | Every turn slides the painted moon toward the horizon while dawn gathers at the header's edge. Win and the sun rises; lose and the night never breaks.                                                                                                                                         |
| Resume on reload   | A refresh resumes the same round — same secret, same board order, same crossings, same voiced Oracle line. In-memory only; no accounts, no database.                                                                                                                                           |
| Accessibility      | Whole round playable by keyboard, axe-clean across surfaces (WCAG 2.1 AA), screen-reader narration via status regions, reduced-motion respected.                                                                                                                                               |
| Honest degradation | With all mood graphics and audio failed or off, the game remains fully playable and fair on the plain grid.                                                                                                                                                                                    |

---

## Tech Stack

- **App:** [SvelteKit 2](https://svelte.dev/docs/kit) / Svelte 5 (runes), TypeScript, Node.js ≥ 26, ESM
- **AI:** [Gemini API](https://ai.google.dev/) (`@google/genai`) in four roles:
  - **Oracle** — interprets free-text Asks and dramatizes her verdicts: `gemini-3.5-flash` (full Flash — she must read language exactly)
  - **Sköll** — plays the wolf: `gemini-3.1-flash-lite` (the lite tier on purpose — he plays looser, like a clever twelve-year-old)
  - **Speech-to-text** — transcribes push-to-talk Asks: `gemini-3.5-flash`
  - **Text-to-speech** — voices both characters through one route, a `voice` param apart: `gemini-3.1-flash-tts-preview`
- **Tests:** Vitest (unit + browser-mode component), Playwright e2e, `@axe-core/playwright`, Lighthouse CI (pre-push)
- **Quality:** ESLint, Prettier, svelte-check, commitlint (conventional + RAI), secretlint, Lefthook hooks
- **CI/CD:** GitHub Actions (CI, CodeQL, Release Please), SonarCloud, Docker → Google Cloud Run

---

## Architecture

```mermaid
flowchart LR
    accTitle: Save the Sun architecture
    accDescr: The browser plays against a SvelteKit server on Cloud Run. A deterministic in-memory engine referees the round; the Gemini API interprets Asks, plays Sköll, transcribes push-to-talk audio, and voices both characters. The browser never holds the key.

    subgraph Browser["Browser — Svelte 5"]
        Board["Rune board + Oracle panel"]
        Mic["Medallion — push-to-talk"]
        Spk["Delivery speaker (captions always)"]
    end

    subgraph Server["SvelteKit SSR — Cloud Run"]
        Routes["Routes: /api/action · /api/new-game · /api/state · /api/voice/transcribe · /api/voice/tts"]
        E["Game engine — per-session referee, in memory"]
    end

    G["Gemini API"]

    Board -->|"Ask / Cast / React / Advance"| Routes
    Mic -->|"held WAV → transcribe"| Routes
    Routes -->|"resolve turn, judge cast"| E
    E -->|"truthful yes/no — never the secret"| Routes
    Routes -->|"interpret Ask · play Sköll · transcribe · voice a line"| G
    Routes -->|"server-owned line → PCM"| Spk
```

The engine holds the secret rune and referees every turn; Gemini only ever interprets language, plays the wolf, transcribes speech, and voices server-owned lines — it is never trusted with the answer. The board order, round token, secret, and the recoverable last-voiced line all live server-side per session: a reload resumes, a dropped response recovers, a new game reshuffles.

Deeper diagrams — turn flow, the push-to-talk + delivery voice loop, and the session lifecycle — live in [`docs/architecture.md`](docs/architecture.md).

---

## Project Structure

```
src/
  lib/
    components/        # RuneGrid, RuneCard, EclipseMedallion, Onboarding, EndScreen, ReactionPrompt
    voice/             # client voice: delivery speaker, push-to-talk recorder, audio, line descriptors
    server/
      engine/          # deterministic referee: state, queries, reactions, session + voice-line store
      oracle/          # Gemini-backed Oracle — interprets a free-text Ask, dramatizes the verdict
      skoll/           # the wolf: his deduction floor, his asks, his Gemini prompt
      voice/           # server voice: TTS synth, transcription, the server-owned line allow-list
    assets-webp/       # banners, rune art, UI chrome
    styles/            # theme tokens (midnight navy + ritual gold)
  routes/
    +page.svelte       # the rite: header, board, Oracle panel, medallion
    api/action/        # one POST for Ask / Cast / React / Advance
    api/new-game/      # fresh secret, fresh layout
    api/state/         # authoritative snapshot for resume + dropped-response recovery
    api/voice/         # transcribe (push-to-talk → text) · tts (server-owned line → PCM)
docs/                  # design spec, mechanics, rune data, voice & copy, architecture, test plan
tests/                 # unit + component (vitest browser) + e2e (playwright, axe)
```

---

## Getting Started

```bash
git clone git@github.com:anchildress1/save-the-sun.git
cd save-the-sun
make install                 # pnpm install + playwright browsers
cp .env.example .env         # then add your GEMINI_API_KEY
# Heads up: saving a server-side file restarts the SSR module (Vite HMR), which clears the
# in-memory game state — the round's secret re-rolls and /debug resets. Restart for a clean
# round, or just reload, after a server edit. Client-only edits hot-reload normally.
make dev                     # vite dev server
```

- `make preview` — serve the real production build (the asset pipeline `make dev` skips)
- `make test` — unit + component suite with coverage
- `make e2e` — Playwright end-to-end (builds and serves the prod bundle first)
- `make ai-checks` — format, lint, typecheck, test, build; the full validation gate

---

## Configuration

| Variable         | Required | What it does                                                                                                |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY` | Yes      | Server-side only — powers the Oracle and Sköll. Get one at [AI Studio](https://aistudio.google.com/apikey). |

Local secrets live in `.env` (gitignored). Deployed, the key rides Google Secret Manager via [`deploy.sh`](deploy.sh).

---

## Security

- The secret rune never enters gameplay responses, the client bundle, or the public board seed — the engine alone holds and judges the answer, and Gemini prompts are secret-free by construction (the model interprets language and plays the wolf). The always-on `/debug` stream is the one deliberate exception: it names the secret because following the engine's truth live is its whole point — a spoiler surface by design.
- `GEMINI_API_KEY` is server-side only: `.env` locally, Secret Manager on Cloud Run. It can never enter the `/debug` stream — every logged string is masked at the sink, and tests assert it.
- The TTS route voices **only server-owned lines** — known line IDs recomposed server-side from the engine's truth, or Gemini-authored lines looked up by an opaque per-session id (never the client's wire text) — and is rate-limited per session and globally, so it can't be turned into a free text-to-speech endpoint. The transcribe route takes audio only; the key never leaves the server.
- Sessions are an `httpOnly`, `secure`, `sameSite=lax` cookie holding an opaque UUID — no user data, no accounts, nothing durable.
- `secretlint` runs in the pre-commit hook; CodeQL runs in CI.

---

## How to Contribute

- Branch off `main`; PRs only — nothing lands direct.
- Conventional Commits enforced by commitlint (with the RAI plugin — AI-assisted commits carry attribution footers).
- Lefthook runs format, lint, and secret-scan pre-commit; Lighthouse a11y/perf gates pre-push.
- `make ai-checks` green before you push. Treat warnings as errors, because the linters do.

---

## What's Next

- **V3 — ambience & sound:** a hunt-mood audio bed under the late game and short one-shot stings (cast, cross-off, win/loss) on a concurrent bus over the voices, plus Sköll's taunt-bucket clips bound to the night's mood. Spec: [`docs/v3-ambient-and-sfx.md`](docs/v3-ambient-and-sfx.md).
- **Guided first turn:** after onboarding, walk a new player through one real turn live — ask, read, cross, cast — beyond the coach-mark tour.

---

## License

[Polyform Shield 1.0.0](LICENSE) — read it, run it, learn from it, fork it for fun. The one thing you can't do is take the wolf and sell him against us; "shield" means exactly what it sounds like. Not an OSI license, on purpose.

---

## Acknowledgements

- The [DEV](https://dev.to/) June Solstice Challenge, for the deadline-shaped motivation.
- [Gemini](https://ai.google.dev/) plays both the Oracle and the wolf without ever being trusted with the referee's job.
- The Elder Futhark, for 24 runes with better lore than any invented alphabet.
- Footer icons: [simple-icons](https://simpleicons.org/), [Font Awesome Free](https://fontawesome.com/) (CC BY 4.0), [Feather](https://feathericons.com/).

---

## Author

**Ashley Childress**

[![anchildress1.dev](https://img.shields.io/badge/anchildress1.dev-3ca8a6?style=for-the-badge)](https://anchildress1.dev) [![GitHub](https://img.shields.io/badge/GitHub-anchildress1-181717?style=for-the-badge&logo=github)](https://github.com/anchildress1) [![dev.to](https://img.shields.io/badge/dev.to-anchildress1-0A0A0A?style=for-the-badge&logo=devdotto)](https://dev.to/anchildress1) [![LinkedIn](https://img.shields.io/badge/LinkedIn-anchildress1-0A66C2?style=for-the-badge)](https://linkedin.com/in/anchildress1)
