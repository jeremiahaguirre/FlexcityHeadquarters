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

## The rendered "hook" cut (`render/`)

Ready-to-post 20.0 s masters, made without Flow: a brand-first motion-graphics cut built from real
captures of the demo, with a finished ElevenLabs voiceover and music mix. It follows its own storyboard
(not the shot list in `PROMPT.md`):

1. **Hook (0–4 s).** A desk piling up with chat notifications, sticky notes, a crossed-out printout and a
   broken spreadsheet (one light direction, soft shadows, paper grain), around the question "Still
   juggling shifts by text, paper and spreadsheet?", whose words light up on the voice.
2. **Reveal.** On the beat, the desk is masked down into the FH mark on a mist field; the mark resolves,
   one light sweep, and the wordmark lands on "Flexcity Headquarters".
3. **What it is.** Left-aligned supers, each with a tight push-in on the real control it names: the
   schedule grid, the slide-to-clock-in control (dragged across, frames captured mid-drag), the approved
   pay run with gross and net, a typographic "Built for Canadian cities" beat, the sign-in header wiping
   from one language to the other, and three phone screens.
4. **Motto.** "Every shift. Every site. One HQ.", centred; "One HQ." is the film's only lime accent.
5. **End card.** Lockup, **Try the live demo** and the site's address; one arrow nudge, then perfectly
   still for the last 2.5 s or more.

Craft rules the stage follows: every cut lands on the music's eighth-note grid (120 bpm, measured from
`voiceover/music.mp3`); one easing family (expo out for entrances and camera moves, expo in-out for
travelling moves), no linear tweens, no overshoot, no loops; 4-sample motion blur on fast moves; one type
scale with -0.02em display tracking; the 9:16 cuts are laid out on their own with key text between
y 269 and 1536 (the top 14% and bottom 20% stay clear for the platforms' UI). No job titles or role
cards in the copy.

| Path | What it is |
| --- | --- |
| `render/FH-ad-{EN,FR}-{16x9,9x16}.mp4` | The four cuts: 1920×1080 or 1080×1920, 30 fps, H.264 yuv420p, +faststart, AAC 160k 48 kHz stereo |
| `render/FH-ad-{EN,FR}.srt`, `.vtt` | Captions of the spoken script, timed from `render/voiceover/TIMINGS.md` |
| `render/FH-ad-*-contact.png` | Contact sheets, one frame per second (t = k + 0.27 s) |
| `render/ad.html` | The stage: one deterministic HTML/CSS page per cut (`?lang=en\|fr&ar=16x9\|9x16`); word times, beat grid, type scale and motion-blur windows are all in it |
| `render/assets/` | Hi-res captures the stage pushes in on (desktop pages at 3×, phone close-ups at 6×, the slide control frame by frame), EN and FR |
| `render/capture-assets.cjs` | Retakes `render/assets/` from the demo build (`ONLY=slide,signin` for some) |
| `render/render.cjs` | Steps the stage frame by frame in headless Chromium (4 sub-frames inside fast moves) and pipes it to ffmpeg with the mix |
| `render/build.sh` | Rebuilds all four cuts, their contact sheets, and checks them with ffprobe |
| `render/voiceover/` | Voice takes, music, the two final mixes and `TIMINGS.md` (see its README) |

To rebuild (Playwright's Chromium and ffmpeg installed; about 35 minutes for all four on 4 cores):

```bash
bash marketing/google-flow-ad/render/build.sh                 # all four cuts
ONLY="fr-9x16" bash marketing/google-flow-ad/render/build.sh  # one cut
```

To retake the assets, serve the demo build as below on port 3310, then
`node marketing/google-flow-ad/render/capture-assets.cjs`, and look at every image before committing.
Before posting, watch each cut once with sound, and check the ElevenLabs plan's commercial-use terms for
paid media.

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
