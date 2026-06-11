# Changelog

## 1.0.0 (2026-06-11)


### Features

* add rune card visual assets ([#15](https://github.com/anchildress1/save-the-sun/issues/15)) ([64573c7](https://github.com/anchildress1/save-the-sun/commit/64573c71624b77928414f02756796e520fcb922d))
* advance the night — final v1 polish ([#29](https://github.com/anchildress1/save-the-sun/issues/29)) ([7c1fff9](https://github.com/anchildress1/save-the-sun/commit/7c1fff9a3901706f07025ad00d8dcf33fdc0950b))
* **board:** rebalance rune board to v7 with independent traits ([#7](https://github.com/anchildress1/save-the-sun/issues/7)) ([dd2616d](https://github.com/anchildress1/save-the-sun/commit/dd2616dc6b8ffc5199dcf82347507bc748354a04))
* dockerize and wire Cloud Run deploy ([#11](https://github.com/anchildress1/save-the-sun/issues/11)) ([2898f75](https://github.com/anchildress1/save-the-sun/commit/2898f75d782af891a09c7da76da12676efb9252d))
* S1 deterministic engine + rune-board UI ([#2](https://github.com/anchildress1/save-the-sun/issues/2)) ([310ffe9](https://github.com/anchildress1/save-the-sun/commit/310ffe9020b23c4ddf53f11668b7a15300ed6ece))
* S10 accessibility basics + UI normalization & polish ([#22](https://github.com/anchildress1/save-the-sun/issues/22)) ([2a907c6](https://github.com/anchildress1/save-the-sun/commit/2a907c67b380ec44a9549e4f2b42329e57b00fa8))
* S11 — Sköll & Oracle voice copy conformance ([#23](https://github.com/anchildress1/save-the-sun/issues/23)) ([3377403](https://github.com/anchildress1/save-the-sun/commit/33774035c2b58749199304609e6563ba9542f0c9))
* S2 Oracle pipeline ([#3](https://github.com/anchildress1/save-the-sun/issues/3)) ([2d4fe87](https://github.com/anchildress1/save-the-sun/commit/2d4fe87c56da7324dfa40db6ec89174f649fd820))
* S2.5 session isolation + new-game flow ([#4](https://github.com/anchildress1/save-the-sun/issues/4)) ([c225bd9](https://github.com/anchildress1/save-the-sun/commit/c225bd93324ffe1fd6fd62bbd8cec4b0f193872b))
* S3 human loop, Ask vs Cast, win on correct cast ([#5](https://github.com/anchildress1/save-the-sun/issues/5)) ([ebec1ea](https://github.com/anchildress1/save-the-sun/commit/ebec1ea5ea9ebfb22dd70ce05b4a8fbf6d30ca92))
* S4 — night-progress chrome, round-end display, best-on-desktop notice ([#8](https://github.com/anchildress1/save-the-sun/issues/8)) ([2ae005c](https://github.com/anchildress1/save-the-sun/commit/2ae005c1cc28ee1fc1a3a7945c5dee77a05e834f))
* S5 — Scry & Hex reactions ([#9](https://github.com/anchildress1/save-the-sun/issues/9)) ([63b6e6d](https://github.com/anchildress1/save-the-sun/commit/63b6e6dc0777528cce21b891e1ed25d891ddbfcc))
* S6 — Sköll: Gemini opponent + deterministic floor ([#10](https://github.com/anchildress1/save-the-sun/issues/10)) ([9610f8d](https://github.com/anchildress1/save-the-sun/commit/9610f8d8b26ef3e04692d9165e28c3e7266e1cd6))
* S7 — Title screen + first-run coach-mark onboarding ([#12](https://github.com/anchildress1/save-the-sun/issues/12)) ([c46f1b6](https://github.com/anchildress1/save-the-sun/commit/c46f1b6fd078e0c5fd79759328434792691d4626))
* S8 — debug view (env-gated event stream) + Oracle white/black fill ([#14](https://github.com/anchildress1/save-the-sun/issues/14)) ([ccfeabc](https://github.com/anchildress1/save-the-sun/commit/ccfeabc51a165788f4e40b2ec8dd203e34ce34ae))
* S8.5 — resume the view on reload (+ Oracle panel UI fixes) ([#20](https://github.com/anchildress1/save-the-sun/issues/20)) ([610c20b](https://github.com/anchildress1/save-the-sun/commit/610c20bce63bd7392b3efda4138f1ccf3ab0ea4b))
* solid S0 board — POC visual match, action-interface wiring, DOM+GSAP docs ([#1](https://github.com/anchildress1/save-the-sun/issues/1)) ([acadd87](https://github.com/anchildress1/save-the-sun/commit/acadd8710208e42dd99d81dee16df5c04e43998b))


### Bug Fixes

* **oracle:** read bare comparison symbols as power operators ([#6](https://github.com/anchildress1/save-the-sun/issues/6)) ([7f54112](https://github.com/anchildress1/save-the-sun/commit/7f541124a7cc0a5a43c06a553819c29c2712c0ae))
* **s11:** voice Sköll's Ask in his own first-person register ([#26](https://github.com/anchildress1/save-the-sun/issues/26)) ([adc61bd](https://github.com/anchildress1/save-the-sun/commit/adc61bdc72bb72c46f2cc6c993194e199f15ca7f))
* Sköll half-split asks, image delivery, and v1.5 screen-reader narration ([#28](https://github.com/anchildress1/save-the-sun/issues/28)) ([a036fae](https://github.com/anchildress1/save-the-sun/commit/a036fae793adac5e3bb25f9d4badb16c0ebe58c8))
* Sköll opener variety + more present reactions ([#13](https://github.com/anchildress1/save-the-sun/issues/13)) ([3f72a38](https://github.com/anchildress1/save-the-sun/commit/3f72a3818fe223a1c8f908b4d0456f1950e54008))
* stale-asset 404s, prod preview target, matched trait icons ([#27](https://github.com/anchildress1/save-the-sun/issues/27)) ([0df014c](https://github.com/anchildress1/save-the-sun/commit/0df014c14105bd96d748c9d8df44deb676c5f99d))


### Performance Improvements

* **images:** optimize asset delivery ([#25](https://github.com/anchildress1/save-the-sun/issues/25)) ([7a1af6e](https://github.com/anchildress1/save-the-sun/commit/7a1af6e5092f4aa05285c05dded6b2de14cc2b36))
