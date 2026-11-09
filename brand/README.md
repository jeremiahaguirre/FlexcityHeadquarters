# FlexcityHeadquarters (FH) brand

![FH mark](fh-mark-512.png)

Live brand sheet: https://claude.ai/artifact/RVezCWRV6pniiHhXrN1unv

## The mark

**The flowing F and the city H.** The F is drawn as two sweeping ribbons, with a lighter layer behind for depth; it stands for the flexibility the app gives staff. Beside it, a soft white disc holds the city: an H-shaped twin tower joined by a skybridge, the headquarters.

| File | Use |
| --- | --- |
| `fh-mark.svg` | Master artwork (scales to any size) |
| `fh-mark-512.png` | Raster for documents and slides (transparent) |
| `fh-lockups.png` | Long-form lockups, horizontal and stacked, light and dark |
| `apps/web/src/app/icon.svg` | Browser favicon |
| `apps/web/src/app/apple-icon.png` | iOS home screen (white, full-bleed) |
| `apps/web/public/icon-*.png` | Installable web app icons (incl. maskable) |
| `apps/web/src/components/Logo.tsx` | `<Logo variant="horizontal" \| "stacked" \| "mark">` |

## Long form

- **Horizontal:** mark, then **Flexcity** (ExtraBold) **Headquarters** (Medium, teal) set solid as one word, tight tracking.
- **Stacked:** mark above **Flexcity**, with **HEADQUARTERS** beneath in small caps, wide tracking, teal.
- Typeface: **Plus Jakarta Sans**. On dark backgrounds, "Headquarters" switches to light teal `#5EEAD4`.
- Short form **FH** only where space is tight.

## Colours

The mark is teal-led. The app uses the four FH colours in a fixed balance so screens feel comfortable and confident, with the accents reserved for meaning:

| Colour | Fill | Text on light | On dark | Share | Role |
| --- | --- | --- | --- | --- | --- |
| Soft neutrals | `#F3F7F6` / `#FFFFFF` | `#0B1F22` | `#0B1416` | ~70% | Surfaces, text |
| **Teal** | `#0F766E` | `#0F766E` | `#5EEAD4` | ~20% | Actions, navigation, the mark |
| **Chartreuse** | `#C5F23A` | `#4D7C0F` | `#C5F23A` | ~5% | Confirmed, open; the mark's highlight |
| **Magenta** | `#C026D3` | `#A21CAF` | `#F0ABFC` | ~3% | New items, notifications |
| **Vermilion** | `#E34234` | `#B42318` | `#FF8A7A` | ~2% | Needs attention, overtime |

All text shades pass WCAG AA (4.5:1). Safety-critical "closed" states use crimson `#9F1239` plus an icon shape, never colour alone.

## Rules

- Keep clear space around the mark of at least the disc's width.
- Don't recolour the ribbons, separate the disc from the F, or rotate the mark.
- On app icons the mark sits on white, mist (`#E1F1EE`) or night (`#0B1416`) tiles.
- Customers' own logos appear alongside FH in the app header (white-labelling); they never replace the FH favicon.
