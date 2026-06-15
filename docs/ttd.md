# Things to Do

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
- [ ] Align the badges on the debug view to add Answer for Oracle.
- [ ] Sort debug view in reverse chronological order
- [ ] Undo the 'don't think' Skoll logic
- [ ] Oracle spoken flair — dynamic/dramatized TTS lines; drop the preset allow-list for a server-authored-line gate (so she can surprise without the endpoint becoming free arbitrary-text TTS)
- [ ] Sköll ambience layer (deferred) — the taunt library in `ux-copy.md` §2 (splash open, idle, hunt mood, reactions, defeat exit) as **audio-only** prebuilt clips (no caption, per revised R10). Lines approved + tightened; clip pipeline + context triggers are future work. The taunt-address bucket needs a spoken input (the mic).
- [ ] Voice Sköll's winning cast — a game move (names `{Rune}`), currently text-only. Voice it the same way as his Ask: carry the cast rune on the `Advance` wire, add a `skoll-cast` line descriptor (server recomposes from the rune), deliver via the TTS seam; caption it (R10).
- [ ] Voice the full end-screen sequence — today the win/loss splash voices one beat (`outcome` descriptor: win coda, loss verse). The other beats (lead/verse for the win, lead/coda for the loss) stay text. Voice the staged sequence if the single beat feels thin; Sól still has no own voice (her line rides the Oracle's).
