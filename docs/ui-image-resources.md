# UI Image Resources 🖼️

> Spec + status for generated UI art. The pipeline: art is generated outside the repo (Ashley's
> art direction), exported as WebP into `src/lib/assets-webp/`, imported with `?url&no-inline`.
> One entry per asset that needs more context than its filename.

## Voice medallion sprite (S3 / R6)

| | |
|---|---|
| File | `src/lib/assets-webp/ui/voice-medallion-sprite.webp` |
| Status | **Live (POC, test1)** — `EclipseMedallion.svelte` renders it as the `.disc` layer |
| Sheet | 2048×1536, 8 columns × 6 rows = 48 frames of 256px, black background |
| Authoring | One dim→bright→dim glow loop across the sheet, read left-to-right then top-to-bottom; frame 31 (end of row 4) is the peak. `spriteFrame()` in `medallionState.ts` owns the state→frame map. |
| Playback | Static frame per state (asleep 0, waking 8, listening/thinking rest 12, peak 31); hearing climbs the ramp with mic flare; listening/speaking/Sköll step the full loop via paired `steps()` animations (x walks a row, y drops a row per x cycle). Reduced motion freezes on the static frame. |
| Sköll | Same sheet, `hue-rotate`/`saturate` ember tint — always paired with the wolf-eyes shape signal. |
| Regenerate | Re-export the sheet at the same grid, then `cwebp -q 80 -m 6 <png> -o src/lib/assets-webp/ui/voice-medallion-sprite.webp`. A different grid means updating `SPRITE_COLS`/`SPRITE_ROWS` and the CSS `background-size`/step counts together. |
| Source | `poc-voice-sprite/` (untracked, temporary) |

The rim runes are **not** part of this asset: they reuse `src/lib/assets-webp/runes/*.webp`
via CSS transforms (`RING_RUNES` in `medallionState.ts`); the mic glyph and wolf eyes stay CSS
layers on top. The eclipse itself lives in the artwork — no CSS shadow is painted over it.

🤖 _Drafted with AI assistance; decisions by Ashley._ ☀️
