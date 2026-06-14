# Things to Do

- [ ] Voice rearchitecture — Live monolith → layered TTS delivery (Live demoted to an opt-in mic adapter). Plan + phases P1–P5 in [`architecture.md`](architecture.md#migration-plan--live-monolith--layered-delivery).

- [x] Fix bug that page order refreshes on reload, even though game state remains _(S8.5: crossings + the voiced Oracle line persist across a reload, keyed by rune id; the board order itself now also holds — `boardSeed` is minted per round and stable across refreshes)_
- [x] Optimize image download and caching on the server to load faster
- [x] Ensure DEV is allowed for embed to CloudRun
- [x] Add in OG and SEO
- [x] Keep spent Scry/Hex visible but disabled; Pass remains manual
- [x] Prevent board from shuffle on reload when session doesn't change _(`boardSeed` is held per round in `session.ts` — stable across a refresh, reminted with the round; e2e asserts order stability on reload)_
- [x] Fine-tune Sköll prompt to allow for wins between 7.5-9 turns with randomizer. Keep metrics output as corpus. _(floor tuned via hunch-weighted asking + cast-at-≤2; self-play sim `scripts/skoll-sim.mjs` drives the floor through a real engine, asserts mean win in [7.5,9] (≈7.93), corpus at `docs/skoll-metrics-corpus.md`; live Gemini wolf validated locally at ≈7.79)_
- [x] Add session scoping to the /debug screen
- [x] Add architecture diagrams _(`docs/architecture.md` — system, turn/Advance, voice tool-call loop, session lifecycle; linked from README + AGENTS)_
- [x] Change "Your Move" pill color on opponent turn
- [x] Asking a new question while Sköll's question hangs auto-passes his question and answers the new one _(no need to say "pass" — the ask path resolves his hanging question as a Pass, then dispatches her new Ask; scry/hex still need her word twice)_
