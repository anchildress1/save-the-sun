# UI Image Resources 🖼️

> Spec + status for generated UI art. The pipeline: art is generated outside the repo (Ashley's
> art direction), exported as WebP into `src/lib/assets-webp/`, imported with `?url&no-inline`.
> One entry per asset that needs more context than its filename.

## Eclipse medallion (S3 / R6)

| | |
|---|---|
| File | `src/lib/assets-webp/ui/eclipse-medallion.webp` |
| Status | **Pending generation** — `EclipseMedallion.svelte` paints a placeholder disc until the art lands |
| Spec | 512×512, transparent background, circular composition filling the frame |
| Direction | Dark Norse folk-art sun disc: aged-gold rim, deep midnight face. Matches the rune-card stone carving and the divider/button-border gilt. |
| Constraint | **Static art only.** Every state effect — corona glow, eclipse shadow bite, mic glyph, rune ring, wolf eyes — is a CSS layer on top. The artwork must not bake in glow, glyphs, or eyes, and never deforms. |
| Swap point | `.disc` in `EclipseMedallion.svelte`: replace the painted gradient with the `<img>`. Nothing else changes. |

The rim runes are **not** part of this asset: they reuse `src/lib/assets-webp/runes/*.webp`
positioned via CSS transforms (`RING_RUNES` in `medallionState.ts`).

🤖 _Drafted with AI assistance; decisions by Ashley._ ☀️
