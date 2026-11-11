# Asset licences

Every image, icon, font and video shipped by the website (`apps/site`), the app (`apps/web`), the
brand folder and the emails, with where it comes from. Inventory taken November 2026; update it when
an asset is added. Anything of unknown origin must be replaced before launch.

## Fonts

| Asset | Source | Licence |
| --- | --- | --- |
| `apps/site/src/fonts/plus-jakarta-sans-latin-wght-normal.woff2`, `apps/web/src/fonts/…` (same file) | Plus Jakarta Sans, The Plus Jakarta Sans Project Authors (github.com/tokotype/PlusJakartaSans), Latin subset | SIL Open Font License 1.1; the licence text ships beside each file (`OFL.txt`). Self-hosted: no request to Google Fonts. |
| PDFs (`apps/api/src/services/privacy/*.ts`, `trust/exports.ts`) | PDFKit's built-in Helvetica (standard PDF base-14 font, not embedded) | No font file shipped. |
| Emails (`services/notifications/emailHtml.ts`) | Names "Plus Jakarta Sans" then system fonts in CSS; no font is linked or downloaded | — |

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
| `apps/site/public/screens/*.webp` (EN and FR, light and dark; captured by `apps/site/scripts/capture-screens.cjs`) and `og.png` | Screenshots of FH's own app from the static demo build: the fictional organization "City of Lakeview (demo)" with invented people ("Jordan Singh", "Sam Okafor", "Harper Reid", "Avery Tremblay", "Riley Chen", "Morgan Lee", "Casey Martin", "Taylor Nguyen", "Jess Okoye", "Drew Kowalski"). Phones (390 px wide): shift board, head count, my schedule, my pay, time off. Laptops (1440 px wide): HR overview, an employee's case file, org chart, required coverage, overtime order, onboarding. | FH's own. Each of the 44 images was checked (November 2026): only the invented people above, the fictional "Lakeview Aquatic Centre" and the demo crest drawn in code (`DEMO_LOGO`); no real person, real municipal crest, demo banner, spinner or empty list. Some sample text inside the demo data is English on the French screens (pool names, a coverage rule's name, case-file notes), as a customer's own data would be. The sample bank account on "My pay" is fictional ("••••4567, branch 12345"); its institution number 004 is a real bank's code, with no real account behind it. Re-check every new screenshot the same way. |
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
