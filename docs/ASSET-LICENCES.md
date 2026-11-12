# Asset licences

Every image, icon, font and video shipped by the website (`apps/site`), the app (`apps/web`), the
brand folder and the emails, with where it comes from. Inventory taken November 2026; update it when
an asset is added. Anything of unknown origin must be replaced before launch.

## Fonts

Every font is shipped in this repository and served from our own origin; no page, email or PDF asks Google Fonts, Typekit or any CDN for one. The Content-Security-Policy says so too (`font-src 'self'` in `apps/web` middleware and `next.config.mjs`, a `<meta>` in both apps for static hosts, and `apps/site/vercel.json`). Checked by `apps/web/src/lib/selfHostedFonts.test.ts`, `apps/site/src/lib/selfHostedFonts.test.ts` (sources and built output, run again after each build in CI), `apps/api/test/unit/fonts.test.ts` (emails and PDFs) and `apps/web/e2e/fonts.e2e.ts` (pages load with every other host blocked).

| Asset | Source | Licence |
| --- | --- | --- |
| `apps/site/src/fonts/plus-jakarta-sans-latin-wght-normal.woff2`, `apps/web/src/fonts/…` (same file, SHA-256 `153fc85b70298beeb1d61a5f723331649e7f23bb77302a66e61cb3e2fbdb5e79`) | Plus Jakarta Sans 2.071, The Plus Jakarta Sans Project Authors (github.com/tokotype/PlusJakartaSans); variable weight 200–800, Latin subset (English and French), taken unchanged from `@fontsource-variable/plus-jakarta-sans` 5.3.0 | SIL Open Font License 1.1: use, bundling, embedding and redistribution with software are allowed as long as the copyright notice and licence go with it (the upstream `OFL.txt` ships beside each file, unchanged) and the font is not sold on its own. No Reserved Font Name is declared, so the subset keeps its name. Loaded with `next/font/local` and served from our own origin (`/_next/static/media/`): builds download nothing and pages request no font from any other host. |
| PDFs (`apps/api/src/services/privacy/*.ts`, `trust/exports.ts`) | PDFKit's built-in Helvetica and Courier (PDF standard base-14 fonts): the metrics ship inside the `pdfkit` package and every PDF reader supplies the glyphs; nothing is fetched or embedded | No font file shipped. |
| Emails (`services/notifications/emailHtml.ts`) | System font stack only (`-apple-system`, `Segoe UI`, Roboto, Helvetica, Arial, `sans-serif`): mail apps block web fonts, so none is named, linked or downloaded | — |

## Icons

| Asset | Source | Licence |
| --- | --- | --- |
| UI icons in the site and app | `lucide-react` 0.460.0 (Lucide) | ISC licence (Lucide is a fork of Feather, MIT). Keep the licence notice in the dependency (it ships in `node_modules/lucide-react/LICENSE`). |

## Brand

| Asset | Source | Licence |
| --- | --- | --- |
| `brand/fh-mark.svg`, `brand/fh-mark-512.png`, `brand/fh-lockups.png` | Drawn for FlexcityHeadquarters (see `brand/README.md`) | FH's own. **Owner to confirm** who created the mark and that FH owns it (assignment from any contractor), and consider a trademark search before registering the name. |
| `apps/web/src/app/icon.svg`, `apple-icon.png`, `apps/web/public/icon-*.png`, `apps/site/public/favicon.svg`, `apple-touch-icon.png`, `logo.png` | Exports of the FH mark | FH's own (as above). |
| Logo components (`Logo.tsx`, `LiveLogo.tsx`, `AliveMark.tsx`) | Code drawing the FH mark | FH's own. |

## Screenshots and clips (website)

| Asset | Source | Licence |
| --- | --- | --- |
| `apps/site/public/screens/*.webp` (EN and FR, light and dark; captured by `apps/site/scripts/capture-screens.cjs`) and `og.png` | Screenshots of FH's own app from the static demo build: the fictional organization "City of Lakeview (demo)" with invented people ("Jordan Singh", "Sam Okafor", "Harper Reid", "Avery Tremblay", "Riley Chen", "Morgan Lee", "Casey Martin", "Taylor Nguyen", "Jess Okoye", "Drew Kowalski", "Noah Gagnon", "Maya Fischer", "Liam Arsenault", "Zoe Laurent", "Kai Mendes"). Phones (390 px wide): shift board, head count, my schedule, my pay, time off. Laptops (1440 px wide): HR overview, an employee's case file, org chart, required coverage, overtime order, onboarding, the schedule builder's week view. | FH's own. Each of the 48 images was checked (November 2026; the schedule builder's four and the re-taken onboarding four on 12 November): only the invented people above, the fictional "Lakeview Aquatic Centre" and the demo crest drawn in code (`DEMO_LOGO`); no real person, real municipal crest, demo banner, spinner or empty list. Some sample text inside the demo data is English on the French screens (pool names, a coverage rule's name, case-file notes), as a customer's own data would be. The sample bank account on "My pay" is fictional ("••••4567, branch 12345"); its institution number 004 is a real bank's code, with no real account behind it. Re-check every new screenshot the same way. |
| `apps/site/public/clips/*.mp4` and poster `*.jpg` | Screen recordings of the demo app (board, clock-in, head count), EN/FR, light/dark | FH's own; silent, with a text description on the page. |

## Demo and seed data

- The public demo (`apps/web`, `NEXT_PUBLIC_DEMO=1`) uses **"City of Lakeview (demo)"** and a demo crest
  drawn in code (`DEMO_LOGO`, `apps/web/src/lib/demo.ts`): fictional, no real municipal crest.
- **Open risk:** the local development seed (`apps/api/prisma/seed.ts`) creates "City of Kelowna (demo)"
  with a real facility name ("Parkinson Recreation Centre"). It has no logo and is not public, but must
  never appear in screenshots, marketing or the public demo. Owner action: rename the dev seed to a
  fictional city when convenient (the shared dev accounts use `@kelowna.test`, so coordinate the change).
- Organization logos uploaded by customers belong to those customers; FH shows them only inside that
  customer's own account and sign-in page.

## Third-party data shown in the app

- Weather: Environment and Climate Change Canada open data, under the ECCC Data Servers End-use
  Licence, attributed on the forecast screen (see `docs/SUBPROCESSORS.md`).

## Unknown origin

None found. Anything added later without a known source and licence must be listed here first.
