# Things to Do

- [x] Fix bug that page order refreshes on reload, even though game state remains _(S8.5: crossings + the voiced Oracle line persist across a reload, keyed by rune id; the board order itself now also holds — `boardSeed` is minted per round and stable across refreshes)_
- [x] Optimize image download and caching on the server to load faster
- [x] Ensure DEV is allowed for embed to CloudRun
- [x] Add in OG and SEO
- [x] Keep spent Scry/Hex visible but disabled; Pass remains manual
- [x] Prevent board from shuffle on reload when session doesn't change _(`boardSeed` is held per round in `session.ts` — stable across a refresh, reminted with the round; e2e asserts order stability on reload)_
- [x] Fine-tune Sköll prompt to allow for wins between 7.5-9 turns with randomizer. Keep metrics output as corpus. _(floor tuned via hunch-weighted asking + cast-at-≤2; self-play sim `scripts/skoll-sim.mjs` drives the floor through a real engine, asserts mean win in [7.5,9] (≈7.93), corpus at `docs/skoll-metrics-corpus.md`; live Gemini wolf validated locally at ≈7.79)_
- [ ] Add session scoping to the /debug screen
- [x] Add architecture diagrams _(`docs/architecture.md` — system, turn/Advance, voice tool-call loop, session lifecycle; linked from README + AGENTS)_
- [ ] Fix reload bug where page resets and interrupts state of the wolf's turn. We never get the update, so what happens?
- [ ] Change "Your Move" pill color on opponent turn
- [ ] Asking a new question auto-passes the turn.
