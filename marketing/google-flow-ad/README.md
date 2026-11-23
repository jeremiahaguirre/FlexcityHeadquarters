# Google Flow ad kit (20 seconds)

A ready-to-use kit for making a 20-second FlexcityHeadquarters ad in Google Flow (Veo), in English and
Canadian French, at 16:9 and 9:16.

## What's here

| Path | What it is |
| --- | --- |
| `PROMPT.md` | The full package: concept, a 20.0 s shot list, copy-and-paste Flow prompts, the EN and FR voiceover, supers and end card, music, variants, Flow tips, and a claims checklist with sources |
| `screenshots/` | Fresh captures from the app's demo (fictional "City of Lakeview (demo)", sample people only), light mode, demo banner hidden. `*-9x16.png` are 1080×1920, `*-16x9.png` are 1920×1080, and `*-fr.png` are the French screens |
| `capture.cjs` | The Playwright script that made the screenshots, so they can be retaken after the app changes |

Screens: `01-punch-in` (slide to clock in), `02-schedule` (phone) and `02-schedule-builder` (laptop),
`03-working-alone`, `04-approvals`, `05-payroll`, `05-hr-overview` and `05-pay-statement`, and
`06-bilingual-sign-in` (EN and FR, with the sample city's logo).

## How to use it, in 5 steps

1. **Read `PROMPT.md` sections 2 and 3.** Veo films the people. The real screenshots are cut in
   afterwards, so the app's text is never redrawn by the model.
2. **Make the four characters** (lifeguard, arena operator, parks worker, HR manager) as reference
   images. Add them to Flow as ingredients.
3. **Generate clips A–D in Flow** with the prompts in section 3.1, once in 16:9 and once in 9:16. Make
   2–4 takes each and keep the best. Download the MP4s.
4. **Edit in any video editor** following the shot list: trim to the timings, drop in the screenshots,
   add the voiceover (section 4), supers, music and end card (sections 4–5). Use the `-fr` screens for
   the French cut.
5. **Check, then export** four masters (EN and FR, at 16:9 and 9:16). Tick every row of the claims
   checklist (section 8) before the ad goes out, and update the end-card web address once the site has
   its own domain.

## Retaking the screenshots

```bash
npm ci                                   # the lockfile needs npm 11 or later (Node 26 per .nvmrc)
(cd apps/api && npx prisma generate)     # the demo build imports the API's permission types
(cd apps/web && npm run build:demo)      # writes apps/web/out
node apps/web/e2e/serve-demo.cjs 3310 &  # serve it
node marketing/google-flow-ad/capture.cjs   # ONLY=01-punch-in,03-working-alone to redo some
```

The script launches Chromium from `/opt/pw-browsers/chromium` (override with `CHROMIUM=`). Look at every
new image before committing: sample names only, no spinners and no broken layouts.
