# Things to Do

- [x] Fix bug that page order refreshes on reload, even though game state remains _(S8.5: crossings + the voiced Oracle line persist across a reload, keyed by rune id; the visible board-order reshuffle that rides along is display-only and intended — `boardseed-display-only-dont-persist`)_
- [x] Optimize image download and caching on the server to load faster
- [x] Ensure DEV is allowed for embed to CloudRun
- [x] Add in OG and SEO
- [x] Keep spent Scry/Hex visible but disabled; Pass remains manual
- [ ] Prevent board from shuffle on reload when session doesn't change
- [ ] Fine-tune Sköll prompt to allow for wins between 7.5-9 turns with randomizer. Keep metrics output as corpus.
