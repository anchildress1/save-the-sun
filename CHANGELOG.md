# Changelog

## [2.0.0](https://github.com/anchildress1/save-the-sun/compare/v1.0.0...v2.0.0) (2026-06-20)


### Features

* add output mute — silence the voices, keep the captions ([#56](https://github.com/anchildress1/save-the-sun/issues/56)) ([431ac1d](https://github.com/anchildress1/save-the-sun/commit/431ac1dfe436f602fc3b0b23e7cde269b84c4a73))
* collapsible /debug, accurate voice tee + verdict logging, and a TTS 429 fallback ([#71](https://github.com/anchildress1/save-the-sun/issues/71)) ([ec5a8c0](https://github.com/anchildress1/save-the-sun/commit/ec5a8c050aaa148c17022b48e499ba6d3ff10382))
* final polish — onboarding, verdict guard, docs, Codecov ([#67](https://github.com/anchildress1/save-the-sun/issues/67)) ([72da48f](https://github.com/anchildress1/save-the-sun/commit/72da48f87879a3b2204f45475e2363899f695322))
* finalize v2 — voice indicator overhaul, mic hint, and quota-aligned limits ([#68](https://github.com/anchildress1/save-the-sun/issues/68)) ([066b336](https://github.com/anchildress1/save-the-sun/commit/066b336620fad55d7cca651b3fa25b4bb9f783ed))
* finish the voice rite — dropped-response recovery, authored Oracle flair + endings, full end screen ([#65](https://github.com/anchildress1/save-the-sun/issues/65)) ([da88073](https://github.com/anchildress1/save-the-sun/commit/da88073cd55be266382315c8904e659ec4ab2671))
* Oracle voice — tuning, game-turn gating, and S10 audio-only delivery ([#55](https://github.com/anchildress1/save-the-sun/issues/55)) ([d14726a](https://github.com/anchildress1/save-the-sun/commit/d14726acfff214325cac564e2cb321db54c531f5))
* push-to-talk voice — retire the Live session ([#60](https://github.com/anchildress1/save-the-sun/issues/60)) ([afcaa3f](https://github.com/anchildress1/save-the-sun/commit/afcaa3fcdeebb48fbcab598ac40ac41b3434e7b6))
* record a real live Sköll corpus with per-run proof ([#51](https://github.com/anchildress1/save-the-sun/issues/51)) ([0ce2e37](https://github.com/anchildress1/save-the-sun/commit/0ce2e379ee9e31ca440977aad3e1295a96d71e48))
* S1 — Live API ephemeral token endpoint ([#30](https://github.com/anchildress1/save-the-sun/issues/30)) ([8e7430d](https://github.com/anchildress1/save-the-sun/commit/8e7430d5377bf388be7d8270c5f4c676bdf13612))
* S10 — transcripts to text (everything spoken is also written) ([#42](https://github.com/anchildress1/save-the-sun/issues/42)) ([935af05](https://github.com/anchildress1/save-the-sun/commit/935af052f6502a90e9fe1038ba51ae210efa7302))
* S2 — Live session client (the Oracle speaks) ([#32](https://github.com/anchildress1/save-the-sun/issues/32)) ([8f6832c](https://github.com/anchildress1/save-the-sun/commit/8f6832c1d741f2dfa31b5f8f5abccae1f01a6393))
* S3 — the eclipse medallion (tap to wake the voice) ([#33](https://github.com/anchildress1/save-the-sun/issues/33)) ([c8f5b94](https://github.com/anchildress1/save-the-sun/commit/c8f5b9405c7a227b099726c0993753264590271c))
* S4 — permission + device failure (the eclipse seal) ([#34](https://github.com/anchildress1/save-the-sun/issues/34)) ([810dbc5](https://github.com/anchildress1/save-the-sun/commit/810dbc5f74281107b8a272f0617b52104f872f48))
* S5 — silence timeout (the quiet seal) ([#35](https://github.com/anchildress1/save-the-sun/issues/35)) ([d53f288](https://github.com/anchildress1/save-the-sun/commit/d53f2884075db38eb1855c0254d77830ccd50886))
* S7 — engine tool calls (her moves answer to your voice) ([#37](https://github.com/anchildress1/save-the-sun/issues/37)) ([591c56c](https://github.com/anchildress1/save-the-sun/commit/591c56c38b8b69a2c14e23f05813ea0ee20bcfc1))
* S8 — destructive action confirmation (the rite demands her word twice) ([#40](https://github.com/anchildress1/save-the-sun/issues/40)) ([400f60a](https://github.com/anchildress1/save-the-sun/commit/400f60a0e06503c965061e842ea3525a099a8a5a))
* S9 — cast lockout (the cast is sacred, nothing interrupts it) ([#41](https://github.com/anchildress1/save-the-sun/issues/41)) ([c903ba1](https://github.com/anchildress1/save-the-sun/commit/c903ba1886be94500283f6251bdfd0ffd20b2ac8))
* scope /debug to any session via ?session ([#44](https://github.com/anchildress1/save-the-sun/issues/44)) ([3524f1b](https://github.com/anchildress1/save-the-sun/commit/3524f1b900be0715523c07cf6b4ee9c3e0417503))
* speak the wake invitation on a round's first wake ([#36](https://github.com/anchildress1/save-the-sun/issues/36)) ([79d4cb6](https://github.com/anchildress1/save-the-sun/commit/79d4cb6d446e8c168f21ecf1a2bb479ef3b49446))
* tint the turn pill in Sköll's steel on his live turn ([#46](https://github.com/anchildress1/save-the-sun/issues/46)) ([31a1880](https://github.com/anchildress1/save-the-sun/commit/31a1880e9a155d4bd56bd7b877cd5c81e334f5b3))
* tune Sköll's pacing to 7.5–9 turn wins with a metrics corpus ([#48](https://github.com/anchildress1/save-the-sun/issues/48)) ([f4dfb11](https://github.com/anchildress1/save-the-sun/commit/f4dfb118346e30db8e6613d9cad197dd4f5c97a2))
* tune the Oracle's voice — shorter lines, confidence-skip confirmations, caption flush ([#53](https://github.com/anchildress1/save-the-sun/issues/53)) ([4500145](https://github.com/anchildress1/save-the-sun/commit/4500145c5e1ae9497557a8d920a89f9fea419ef5))
* voice-as-delivery P1 — the Oracle speaks via server TTS ([#58](https://github.com/anchildress1/save-the-sun/issues/58)) ([4338e63](https://github.com/anchildress1/save-the-sun/commit/4338e63430244889a5baf6e0f4e4b1a62deac524))
* voice-prep batch + Sköll plays like a twelve-year-old ([#62](https://github.com/anchildress1/save-the-sun/issues/62)) ([1e60b7c](https://github.com/anchildress1/save-the-sun/commit/1e60b7c341f5a483414222e2226c45d9806bcab1))


### Bug Fixes

* asking a new question auto-passes Sköll's hanging question ([#43](https://github.com/anchildress1/save-the-sun/issues/43)) ([54ac712](https://github.com/anchildress1/save-the-sun/commit/54ac7127588afeeabfc9e72b05351b855f5ecc10))
* bound the action/advance/new-game and TTS-stream fetches ([#63](https://github.com/anchildress1/save-the-sun/issues/63)) ([4731540](https://github.com/anchildress1/save-the-sun/commit/47315409544920db1a3f0875983ec9f64e3196da))
* S? — wolf-turn reload reconcile (a lost Advance can't strand the rite) ([#47](https://github.com/anchildress1/save-the-sun/issues/47)) ([54b92e4](https://github.com/anchildress1/save-the-sun/commit/54b92e4c13cb63e91b6b7af15c2df8811da04235))
* scope /debug to the browser's own session (drop ?session peeking) ([#52](https://github.com/anchildress1/save-the-sun/issues/52)) ([f2953cb](https://github.com/anchildress1/save-the-sun/commit/f2953cb98bf121df0c8c02e27ac468fae0961c2a))
* UI/visual polish — Pass button, oracle glow, frames, spacing, shadows ([#50](https://github.com/anchildress1/save-the-sun/issues/50)) ([0f9b7af](https://github.com/anchildress1/save-the-sun/commit/0f9b7af768f402cded7fd2a46cd82f597232d406))


### Miscellaneous Chores

* release 2.0.0 ([80ccd53](https://github.com/anchildress1/save-the-sun/commit/80ccd5369799cf18c932cc514cc001d1b5575a69))

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
