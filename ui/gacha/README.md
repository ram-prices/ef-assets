# Headhunting result textures

From the game client (the results screen after a pull): lossless WebP with straight alpha, exported as stored.

Rarity colours: 6★ orange, 5★ gold, 4★ purple. White pieces are meant to be tinted or blended.

`-sm` files are half-size copies for cards, made for strips over 40 KB.

| File | Source texture | Size | What it is |
|---|---|---|---|
| `strip-4.webp` | `bg_gacha_color_4` | 240×1352 | 4★ purple: strip base, coloured at the foot and fading up |
| `strip-4-2.webp` | `bg_gacha_color_4_2` | 240×1352 | 4★ purple: colour band over the strip (very faint, alpha peaks at 46) |
| `strip-4-glow.webp` | `bg_gacha_color_4_3` | 280×672 | 4★ purple: glow, bright at the top and fading down |
| `strip-4-glow-sm.webp` | `bg_gacha_color_4_3` | 140×336 | half-size copy |
| `strip-5.webp` | `bg_gacha_color_5` | 240×1352 | 5★ gold: strip base, coloured at the foot and fading up |
| `strip-5-2.webp` | `bg_gacha_color_5_2` | 240×1352 | 5★ gold: colour band over the strip |
| `strip-5-2-sm.webp` | `bg_gacha_color_5_2` | 120×676 | half-size copy |
| `strip-5-glow.webp` | `bg_gacha_color_5_3` | 280×672 | 5★ gold: glow, bright at the top and fading down |
| `strip-5-glow-sm.webp` | `bg_gacha_color_5_3` | 140×336 | half-size copy |
| `strip-6.webp` | `bg_gacha_color_6` | 240×1352 | 6★ orange: strip base, coloured at the foot and fading up |
| `strip-6-sm.webp` | `bg_gacha_color_6` | 120×676 | half-size copy |
| `strip-6-2.webp` | `bg_gacha_color_6_2` | 240×1352 | 6★ orange: colour band over the strip |
| `strip-6-2-sm.webp` | `bg_gacha_color_6_2` | 120×676 | half-size copy |
| `strip-6-glow.webp` | `bg_gacha_color_6_3` | 280×672 | 6★ orange: glow, bright at the top and fading down |
| `strip-6-glow-sm.webp` | `bg_gacha_color_6_3` | 140×336 | half-size copy |
| `light-bar-1.webp` | `bg_gacha_light_bar_01` | 1316×184 | white arc, thick |
| `light-bar-2.webp` | `bg_gacha_light_bar_02` | 1316×184 | white arc, thin |
| `glow.webp` | `deco_glow` | 459×2248 | white column glow |
| `glow-1.webp` | `deco_glow01` | 276×1588 | white column glow, narrower soft edge |
| `star.webp` | `deco_gacha_star` | 80×76 | white triangle with a soft glow |
| `fragments.webp` | `deco_gacha_fragments` | 244×132 | white shard |

## Motion textures

The `particle-` prefix is only a name: the result screen has **no particle systems**. `gachacharresultpanel`, `gachacharresultmodelcell`, `gachacharresultmodelcellground` and `gachasixstarbg` contain none, so there is no emission rate, lifetime or speed to copy. The motion is flat layers, scrolling shader UVs and one intro clip.

| File | Source texture | Size | What it is |
|---|---|---|---|
| `iridescent.webp` | `T_fx_ui_gacha_001_D` | 256×256 | iridescent thin-film. Not referenced by the result cell; the strips use `particle-rainbow`. Opaque, blend with `screen` |
| `flare.webp` | `T_fx_flare_0003` | 512×512 | white starburst, downscaled from 2048. Opaque on black, blend with `screen` |
| `star-flare.webp` | `T_fx_star_907_D` | 512×256 | blue horizontal lens flare, downscaled from 2048. Opaque on black, blend with `screen` |
| `particle-rainbow.webp` | `T_fx_flow_302_D` | 256×256 | 6★ rainbow colour (`6StarColor`, `M_sixstar_bg` main texture). Opaque |
| `particle-rainbow-mask.webp` | `T_ui_6starcolour_mask` | 128×64 | 6★ rainbow mask (`T_ui_6starcolour_mask`): only a slice of it is sampled, see below. Greyscale, use as a luminance mask |
| `particle-rainbow-warp-1.webp` | `T_fx_flow_326_M` | 256×256 | 6★ rainbow distortion 1. Greyscale |
| `particle-rainbow-warp-2.webp` | `T_fx_flow_407_M` | 128×128 | 6★ rainbow distortion 2. Greyscale |
| `particle-band.webp` | `T_fx_mask_141_c_M` | 128×256 | 6★ and 5★ moving band (`Up`, `Bottom`, the 2 s pulse). Greyscale, use as a luminance mask |
| `particle-sweep.webp` | `T_fx_mask_309_M` | 64×64 | all rarities: slow sweep (`LoopDeco`, 10 s). Greyscale, use as a luminance mask |
| `particle-ray.webp` | `T_ui_ray_05` | 512×256 | rainbow ray of the `Deco01` layer, downscaled from 1024. That layer stays off in the prefab and no state turns it on. Opaque on black |
| `particle-dots.webp` | `deco_gacha_texture` | 236×828 | white square dot grid, 6 px pitch on the file, solid at the foot and fading out at the top. Alpha only |
| `particle-dots-2.webp` | `deco_gacha_texture01` | 236×828 | the same grid, solid at the top and fading out at the foot. Alpha only |

## Result strip: layers

From `gachacharresultmodelcellground.prefab` and `GachaCharResultCtrl.lua`. Each cell is 188×1080. Listed bottom to top; N is the rarity.

| Layer | Picture | Shown for | Notes |
|---|---|---|---|
| `BgReflection` | `strip-N-glow` | all | floor reflection, hangs below the cell, 224×536, 0.9 alpha |
| `BgColor` | black | all | |
| `BgMain2` | `strip-N-2` | all | behind the art |
| `FiveStar` / `Up`, `Bottom` | `particle-band` | 5★ | tint `#FFEB7A` |
| `SixStarBg` / `Up`, `Bottom` | `particle-band` | 6★ | tint `#FF757A` |
| `CharImg` | operator art | all | |
| `SixStar` / `6StarColor` | `particle-rainbow` | 6★ | **over the art**; full width, 1000 tall, top edge 1130 up, rotated 180° |
| `BgMain1` | `strip-N` | all | **over the art** |
| `DecoTexture` | dots, see below | all | foot of the cell, 660 tall, 0.1 alpha |
| `Deco` | `deco_gacha_color` | all | not exported |
| `CharShadowImgReflection` | silhouette | all | 0.7 alpha |
| `LoopDeco` | dots, see below | all | foot of the cell, 660 tall, sweep mask, 0.2 tint alpha |

In front of the cell, `FiveLight` (`glow-1`, tint `#FFFC29`) is 5★ only and `Lght02` (`glow`, tint `#FF998A`) is 6★ only. `AddHight01` is the 4★ equivalent. 6★ also keeps `sixLight01`, a 247×844 flare at the foot of the cell, at 0.67 alpha after the intro.

`DecoTexture` and `LoopDeco` have an empty sprite slot in the dump. `particle-dots` is matched to them by size only: 236×828 is 1.25× the 188×660 layer, like the other art. Which of the two files goes on which layer is not recorded.

## Result strip: what loops

These run forever from the material time, so all cells stay in phase, and 5★ and 6★ pulse together. Speeds are UV units per second, so 0.5 is a 2 s period.

| Rarity | Layer | Motion | Period |
|---|---|---|---|
| 6★, 5★ | `Up` | `particle-band` scrolls V at -0.5, sampled at 0.35 wide, offset 0.35 | 2 s |
| 6★, 5★ | `Bottom` | the same at +0.5, so the two run in opposite directions | 2 s |
| 6★ | `6StarColor` | colour scrolls at (-0.1, -0.1), sampled 0.16 wide by 1 tall; warp 1 (tiling 0.2×0.2, strength 0.05) and warp 2 (tiling 0.1×0.5, strength 0.1) both scroll at (-0.1, -0.1) | 10 s |
| 6★ | `6StarColor` mask | static: `particle-rainbow-mask`, tiling 0.2×0.5, offset 1×0. That slice of the dome is what makes the diagonal ribbon | none |
| All | `LoopDeco` | `particle-sweep` scrolls V at -0.1 | 10 s |

Blending on these layers is One / OneMinusSrcAlpha. `screen` is the closest CSS match. The shader itself was not decompiled, so how the warp and mask combine is read from the material values, not confirmed.

## Result strip: intro

`gachacharresult_in` runs once and lasts 4.0 s. The curves below are for cell 1; the same clip staggers each cell.

| Time | Layer | Change |
|---|---|---|
| 0–0.97 s | `Ground` | fades in |
| 0.15–0.38 s | `BgMain1`, `BgColor`, `BgReflection`, silhouette | flicker on and off at 30 fps |
| 0.97–1.07 s | `BgMain2` | flickers on |
| 1.0–1.23 s | `CharImg` | flickers on |
| 1.5–1.73 s | `BgColor` | flickers again |
| 1.63–1.73 s | `StarNode` | flickers on |
| 1.8–3.13 s | `AddHight` | grid glitch, 0.25 alpha fading to 0 |
| 1.83–2.0 s | `6StarColor` | rainbow fades in (6★) |
| 2.1–2.17 s | `FiveStar`, `SixStarBg` | band layers appear |
| 2.1–3.68 s | `FiveLight`, `Lght02`, `AddHight01` | front glow snaps on (0.6, 1, 1), then fades out |
| 2.63–2.73 s | `Deco` | flickers on |
| 2.8–2.97 s | `LoopDeco` | fades in |

| Cell | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| First flicker (s) | 0.15 | 0.08 | 0.48 | 0.43 | 0.75 | 0.28 | 0.63 | 0.72 | 0.52 | 0.80 |
| Rainbow in (s) | 1.83 | 2.17 | 2.33 | 2.50 | 2.60 | 2.33 | 2.17 | 2.00 | 1.83 | 2.00 |
| Band and glow in (s) | 2.10 | 2.03 | 1.97 | 1.90 | 1.83 | 1.83 | 1.90 | 1.97 | 2.03 | 2.10 |
| `LoopDeco` in (s) | 2.80 | 2.80 | 2.37 | 2.40 | 2.58 | 2.40 | 2.80 | 2.80 | 2.80 | 2.80 |

The clip also has curves for `SixStarGlow`, `DecoGlow`, `RightLight`, `GroundLight` and `Light01`, but those objects are not in the prefab, so they do nothing. `gachacharresultmodel_sixstarlight_in` is empty.

## Result strip: per rarity

- 6★: `BgMain` strips, the 2 s band in `#FF757A`, the 10 s rainbow ribbon over the art, the dot grid and the 10 s sweep.
- 5★: `BgMain` strips, the 2 s band in `#FFEB7A`, the dot grid and the 10 s sweep. No rainbow.
- 4★: `BgMain` strips, the dot grid and the 10 s sweep. No band, so its only loop is the slow sweep.
