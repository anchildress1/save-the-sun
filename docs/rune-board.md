# Save the Sun — Rune Board (v7)

Uses a classic deduction attribute-grid structure: balanced visible traits, one hidden target, and solvability through yes/no narrowing.

The runes are the complete Elder Futhark, all 24, in plain spellings.

## Traits (the axes a player can ask about)

| Trait | Values | Runes per value |
|---|---|---|
| **Element** | Sun, Fire, Air, Spirit, Water, Earth | 4 |
| **Power** | 1, 2, 3, 4, 5, 6 | 4 |
| **Fill** | Light ○, Dark ● | 12 |
| **Color** | Gold, Red, Purple, Green, Blue, Black | 4 |

Power (the count) and fill (light/dark) are each askable on their own turn. Glyph mapping: hollow ○ = Light, solid ● = Dark. Engine/data field names: element, power, fill, color. Player-facing axis names: element, power, light, hue.

All four traits are independent — each value splits 2/2 across every other trait, so no trait predicts another. Knowing the color tells you nothing about element, fill, or power, and vice versa.

## The 24 Runes

| # | Rune | Glyph | Meaning | Element | Power | Fill | Color |
|---|---|---|---|---|---|---|---|
| 1 | Sowilo | ᛋ | sun | Sun | 1 | Dark ● | Red |
| 2 | Dagaz | ᛞ | day, dawn | Sun | 4 | Light ○ | Purple |
| 3 | Kenaz | ᚲ | torch | Sun | 5 | Light ○ | Green |
| 4 | Wunjo | ᚹ | joy | Sun | 6 | Dark ● | Blue |
| 5 | Fehu | ᚠ | cattle, wealth | Fire | 1 | Light ○ | Purple |
| 6 | Uruz | ᚢ | aurochs, strength | Fire | 2 | Dark ● | Green |
| 7 | Thurisaz | ᚦ | thorn, giant | Fire | 5 | Dark ● | Blue |
| 8 | Tiwaz | ᛏ | the god Tyr | Fire | 6 | Light ○ | Black |
| 9 | Ansuz | ᚨ | god, breath | Air | 1 | Light ○ | Gold |
| 10 | Raido | ᚱ | ride, journey | Air | 2 | Dark ● | Green |
| 11 | Ehwaz | ᛖ | horse | Air | 3 | Light ○ | Blue |
| 12 | Gebo | ᚷ | gift | Air | 6 | Dark ● | Black |
| 13 | Perthro | ᛈ | dice-cup, fate | Spirit | 1 | Dark ● | Gold |
| 14 | Eihwaz | ᛇ | yew tree | Spirit | 2 | Light ○ | Red |
| 15 | Algiz | ᛉ | elk, protection | Spirit | 3 | Light ○ | Blue |
| 16 | Mannaz | ᛗ | humanity | Spirit | 4 | Dark ● | Black |
| 17 | Laguz | ᛚ | water, lake | Water | 2 | Light ○ | Gold |
| 18 | Isa | ᛁ | ice | Water | 3 | Dark ● | Red |
| 19 | Hagalaz | ᚺ | hail | Water | 4 | Dark ● | Purple |
| 20 | Naudiz | ᚾ | need | Water | 5 | Light ○ | Black |
| 21 | Jera | ᛃ | year, harvest | Earth | 3 | Dark ● | Gold |
| 22 | Berkana | ᛒ | birch | Earth | 4 | Light ○ | Red |
| 23 | Ingwaz | ᛜ | the god Ing, fertility | Earth | 5 | Dark ● | Purple |
| 24 | Othala | ᛟ | heritage, estate | Earth | 6 | Light ○ | Green |

## Notes

- Every rune is a unique combination of element, power, fill, and color.
- All four traits are independent — no trait predicts another; each only narrows by its own elimination.
- All 24 runes stay visible all game, traits and all. The secret is which one you're racing to name.
- Meanings group to element as flavor (sun → Sun, fierce → Fire, movement → Air, mystical → Spirit, cold/flowing → Water, growth/land → Earth). Mechanics run on traits.
- All names, glyphs, and meanings are the historically attested Elder Futhark.
