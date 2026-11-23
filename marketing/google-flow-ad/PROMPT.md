# FlexcityHeadquarters: 20-second ad, Google Flow package

Everything here is ready to paste into Google Flow (Veo). The app screens are real screenshots from the
demo's sample city (`screenshots/`). Every claim the ad makes is in the checklist at the end, with the
file in this repository that backs it.

---

## 0. What Flow does today: verified vs assumed

Checked on 2026-11-23 by web search. Google's own pages were found for some points only; the rest come
from recent third-party guides. Check flow.google before a paid production run.

| Fact | Status |
| --- | --- |
| Flow generates video with Veo 3.1 and has **Ingredients to Video** (reference images for characters, objects and style), **Frames to Video** (a start image, optionally an end image) and **Extend** | Verified: Google blog, "Bringing new Veo 3.1 updates into Flow" |
| Those three modes generate **sound** (ambient, effects, speech) with the video | Verified: same Google post |
| **Extend** continues a clip from its last second | Verified: same Google post |
| Clips are **4, 6 or 8 seconds**; Ingredients clips are **8 s only**; Extend works only on 8 s Veo clips | Reported by recent third-party guides, not confirmed on a Google page |
| Flow offers **16:9 (landscape) and 9:16 (portrait)** | Portrait support was announced with Veo 3.1 (third-party report). Not confirmed on a Google page |
| **Scenebuilder** puts clips in order and trims them | Reported by third-party guides |
| You can drop still images (our screenshots) straight onto Scenebuilder's timeline, or overlay text | **Assumed not possible.** That is why this package finishes the edit in an ordinary video editor |
| Export resolution (720p, plus upscaling to 1080p on some plans) | **Assumed.** Check your plan |

The plan below needs only three things to be true: Veo clips of 4 to 8 s, a start-frame or ingredient
image, and an MP4 download. Everything else happens in a normal editor.

---

## 1. Concept

**One line:** *Every shift. Every site. One HQ.* We follow one ordinary day across a city's departments:
the pool deck, the rink, a pump station at dusk and the HR office. The same app sits in every pocket and
on every desk.

**Who it's for:**
- **The buyer:** municipal HR, payroll and recreation managers. They need to see one system for every
  department, with payroll and approvals that add up.
- **The users:** lifeguards, arena operators, parks and utility crews. They need to see that it's simple:
  a slide to clock in, a tap to say they're OK.

**Tone:** warm, real and early-morning optimistic. Real people at real municipal sites, with no stock-photo
gloss. The app's actual screens carry the product story.

**The motto is the spine of the script.** It is the site's own headline (`apps/site/src/content/copy.ts`,
`home.motto`): *Every shift.* (pool) → *Every site.* (rink) → … → *One HQ.* (end card).

---

## 2. How the edit is built (read this first)

Veo draws people and places well. It cannot draw an app's interface: text comes out garbled and buttons
turn into nonsense. So the ad has two kinds of shot:

1. **Live action (Veo, in Flow):** people, hands and places. The phone or laptop screen is turned away,
   or shows a plain, softly glowing screen with nothing readable on it.
2. **Screen inserts (your editor, not Veo):** the real screenshots, full frame or on a phone or laptop
   mock-up, with a gentle digital push-in. The text stays sharp and true.

They are cut together in an editor (DaVinci Resolve is free; CapCut or Premiere also work). Optionally,
corner-pin a screenshot onto the blank screen in a live-action clip (shot 7).

> **Option B: all inside Flow.** Put a screenshot on a phone in a still image, then use it as the **start
> frame** in Frames to Video with "the screen content stays static". Veo still tends to redraw small
> text, so check every frame. Use this only for wide shots where the screen is small.

---

## 3. Shot list: exactly 20.0 seconds

Generate every Veo clip at **6 s** (or 8 s if your plan only offers that with Ingredients). Trim to the
best moment. The **Use** column adds up to 20.0 s.

| # | In → out | Use | What we see | Source | Screenshot and how it's used |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00.0 → 0:02.5 | 2.5 s | A lifeguard walks the pool deck at opening and glances down at their phone | Veo clip **A** | None in shot (the screen faces away) |
| 2 | 0:02.5 → 0:04.5 | 2.0 s | Their schedule: this week's lifeguard shifts | Editor insert | `02-schedule-9x16.png`, full frame or on a phone mock-up, slow push-in |
| 3 | 0:04.5 → 0:07.0 | 2.5 s | Before dawn, an arena operator at the rink door slides a thumb across the phone | Veo clip **B** | None in shot (screen seen edge-on) |
| 4 | 0:07.0 → 0:08.5 | 1.5 s | The Clock in card: *Slide to clock in* | Editor insert | `01-punch-in-9x16.png`, push-in on the slide button (see note) |
| 5 | 0:08.5 → 0:11.0 | 2.5 s | Dusk. A parks and utilities worker, alone at a pump station by a park, taps the phone and exhales | Veo clip **C** | None in shot |
| 6 | 0:11.0 → 0:12.5 | 1.5 s | Working alone: *Your check-in is due · I'm OK* | Editor insert | `03-working-alone-9x16.png`, push-in on **I'm OK** |
| 7 | 0:12.5 → 0:15.5 | 3.0 s | Afternoon. An HR manager at a desk approves, then the payroll screen | Veo clip **D** plus screens | Corner-pin `04-approvals-16x9.png` onto the laptop, then cut or slide to `05-payroll-16x9.png` at 0:14.0 |
| 8 | 0:15.5 → 0:17.0 | 1.5 s | The sign-in screen flips from English to French | Editor insert | `06-bilingual-sign-in-9x16.png` → `06-bilingual-sign-in-9x16-fr.png`, a quick horizontal wipe at 0:16.2 |
| 9 | 0:17.0 → 0:20.0 | 3.0 s | End card | Editor | `brand/fh-lockups.png` (stacked, light) plus text (section 5) |
| | | **20.0 s** | | | |

**Note on shot 4:** the lower half of `01-punch-in` shows the next shift as *Water Works Operator*.
In the 9:16 cut, keep the push-in tight on the Clock in card so the arena story reads cleanly. In 16:9,
the phone mock-up is small and it doesn't matter. Do not animate the slide by redrawing the button. If
you want motion, move a soft highlight dot along the slider track.

### 3.1 Flow prompts (copy and paste)

Paste the **character block** unchanged into every clip that has that person. Each prompt asks for
**no music, no dialogue and no on-screen text**, because music, voiceover and supers are added in the
edit.

**Character blocks** (one per person; make an ingredient image of each first, see section 7):

- **LIFEGUARD:** *a lifeguard in their mid-twenties, short dark curly hair, warm brown skin, red
  lifeguard polo and red shorts, a whistle on a lanyard, no logos or text on the clothing*
- **ARENA OPERATOR:** *an arena operator in their forties, close-cropped grey beard, navy insulated work
  jacket with reflective stripes, dark toque, no logos or text on the clothing*
- **PARKS WORKER:** *a parks and utilities crew member in their thirties, auburn hair tied back, high-vis
  yellow-green safety vest over a dark green work jacket, hard hat clipped to the belt, no logos or text*
- **HR MANAGER:** *an HR manager in their fifties, silver-streaked black hair, reading glasses pushed up,
  soft charcoal cardigan over a white collared shirt, no logos or text*

---

**Clip A: pool deck, opening (shot 1)**
Mode: *Ingredients to Video* (LIFEGUARD image) or *Text to Video*. Aspect: 16:9 (generate again in 9:16
for the vertical cut).

```
[LIFEGUARD] walks along the edge of an empty indoor municipal 25-metre pool at opening time, then
slows and glances down at a smartphone held at waist height; the phone screen faces away from camera.
Calm still water with lane ropes, tiled deck, a tall lifeguard chair in the background, morning light
through high windows making soft caustic reflections on the ceiling. Camera: smooth handheld tracking
shot at chest height moving alongside, then easing to a gentle stop as they look down. Natural colour,
clean and realistic, shallow depth of field, documentary commercial style, optimistic and quiet.
Audio: indoor pool ambience, gentle water lapping, echoing footsteps on wet tile, a distant
ventilation hum. No music, no dialogue, no voiceover. No text, no logos, no readable screens.
```

**Clip B: rink door, before dawn (shot 3)**
Mode: *Ingredients to Video* (ARENA OPERATOR). Aspect: 16:9 / 9:16.

```
[ARENA OPERATOR] stands just inside the staff door of a community ice arena before dawn, breath faintly
visible, and slides their thumb across a smartphone screen in one smooth left-to-right motion, then
pockets the phone and pulls on work gloves. The phone is seen edge-on so the screen content is not
visible. Behind them, a dim empty rink with fresh white ice, boards and a resurfacing machine parked
by the gate, work lights flickering on one bank at a time. Camera: slow push-in from medium to medium
close-up, slight low angle. Lighting: cool blue pre-dawn ambient with warm sodium work lights warming
up. Realistic, cinematic commercial, steady and capable mood.
Audio: big empty arena room tone, the clunk of a breaker as lights come on, a soft phone haptic tap,
gloves rustling. No music, no dialogue, no voiceover. No text, no logos, no readable screens.
```

**Clip C: pump station at dusk, working alone (shot 5)**
Mode: *Ingredients to Video* (PARKS WORKER). Aspect: 16:9 / 9:16.

```
[PARKS WORKER] stands alone outside a small concrete municipal pump station at the edge of a park at
dusk, a heavy steel door ajar behind them and tall evergreens beyond. They glance at a smartphone,
tap the screen once with their thumb, and give a small relieved exhale and nod, then turn back toward
the door. The screen faces away from camera. Camera: locked-off wide shot that slowly drifts closer
(dolly in), eye level. Lighting: deep blue dusk sky, last orange glow on the horizon, a single caged
wall light over the door. Realistic, grounded, reassuring mood, documentary commercial style.
Audio: evening crickets, distant traffic, a low electrical pump hum from inside, one soft phone
confirmation chime. No music, no dialogue, no voiceover. No text, no logos, no readable screens.
```

**Clip D: HR office, afternoon (shot 7)**
Mode: *Ingredients to Video* (HR MANAGER). Aspect: 16:9 (for the 9:16 cut, generate in 9:16 with the
laptop lower in frame).

```
[HR MANAGER] sits at a tidy desk in a bright municipal office in the afternoon, clicks a laptop
trackpad twice, then leans back slightly with a satisfied small smile and picks up a coffee mug. The
laptop is at a three-quarter angle toward camera and its screen shows a plain, evenly lit off-white
screen with no text or interface, flat and unchanging, for screen replacement. Window light from the
left, plants and a wall calendar softly out of focus behind. Camera: slow arc of a few degrees around
the desk at seated eye level. Clean, warm, modern commercial look, calm and in-control mood.
Audio: quiet office ambience, two soft trackpad clicks, distant phone ringing in another office,
mug set down on the desk. No music, no dialogue, no voiceover. No text, no logos on the laptop.
```

### 3.2 Continuity notes (so the cuts flow)

- **Time of day runs forward:** morning pool (A) → pre-dawn rink (B, a deliberate cutaway to "another
  site, same morning") → dusk pump station (C) → afternoon office (D). In the edit, order the warm
  colour grade so shot 7 feels like "meanwhile at HQ". If you want a strict clock, swap C and D.
- **Screen direction:** every phone action moves **left to right** (the glance in A, the slide in B,
  the tap in C), matching the slide-to-clock-in direction in the app. Keep it that way so the inserts
  feel like point-of-view shots.
- **Match cuts:** cut from A to shot 2 on the downward glance. Cut from B to shot 4 mid-slide. Cut from
  C to shot 6 on the thumb tap. Shot 6 → 7 is a hard cut on the chime.
- **Grade:** one LUT for all four Veo clips. Push shadows slightly toward FH teal (`#0F766E`) and keep
  skin natural, so the live action sits next to the app's teal-on-light screens.
- **Same props:** the same plain black phone in every hand (say "a plain black smartphone" if Veo varies
  it). No real city crests, uniforms with logos, or real place names anywhere.
- **Sound bridges:** start each clip's ambience 6 frames before the picture cut. That J-cut hides the
  speed of the montage.

---

## 4. Voiceover script (timed to 20.0 s)

Read warmly and briskly, like a colleague, not an announcer. About 30 words in English, leaving room to
breathe. Say the name as **"Flex-city Headquarters"**.

| Time | English | Canadian French |
| --- | --- | --- |
| 0:00.3 → 0:04.3 | "Every shift, on every phone." | « Chaque quart, sur chaque téléphone. » |
| 0:04.6 → 0:08.3 | "Every site: one slide to clock in." | « Chaque site : on pointe d'un glissement. » |
| 0:08.6 → 0:12.3 | "Nobody works alone unnoticed." | « Personne ne travaille seul sans qu'on le sache. » |
| 0:12.6 → 0:15.3 | "Approved hours go straight to payroll." | « Les heures approuvées passent directement à la paie. » |
| 0:15.6 → 0:16.9 | "In English and French." | « En français et en anglais. » |
| 0:17.3 → 0:19.6 | "FlexcityHeadquarters. One HQ." | « FlexcityHeadquarters. Un seul QG. » |

French runs about 15% longer. If a line overruns, trim the pause before it, never the end card. For
the French cut, use the `-fr` screenshots (section 6.3).

### On-screen text (supers)

Font: Plus Jakarta Sans (the brand typeface), ExtraBold for headlines and Medium for fine print. White on
a 60% dark scrim over live action. Ink `#0B1F22` on light frames.

| Shot | English | French |
| --- | --- | --- |
| 1–2 | **Every shift.** | **Chaque quart.** |
| 3–4 | **Every site.** · *Slide to clock in* | **Chaque site.** · *Glisser pour pointer* |
| 5–6 | **Nobody works alone unnoticed.** | **Personne ne travaille seul sans qu'on le sache.** |
| 5–6 fine print (keep) | *Check-ins support your working-alone procedure. In an emergency, call 911.* | *Les vérifications appuient votre procédure de travail seul. En cas d'urgence, composez le 911.* |
| 7 | **Approved hours → payroll** | **Heures approuvées → paie** |
| 8 | **English · Français** | **Français · English** |
| every screen insert, corner (keep) | *Demo screens, sample data* | *Écrans de démo, données fictives* |

### End card (0:17.0 → 0:20.0)

- The stacked FH lockup from `brand/fh-lockups.png` (light version), centred.
- **Every shift. Every site. One HQ.** / **Chaque quart. Chaque site. Un seul QG.**
- The web address, exactly as the site uses it today:
  **flexcity-headquarters-iota.vercel.app**
  (README.md: the site's production address "today", until a custom domain is set in
  `NEXT_PUBLIC_SITE_URL`. **Swap in the custom domain here once it exists.**)
- Optional small call to action, the site's own button label: **Try the live demo** / **Essayer la démo**.
- No phone number or email address: the site doesn't publish one yet (`apps/site/src/lib/site.ts` has
  placeholders).

---

## 5. Music and sound

- **Music:** a warm, optimistic modern score at about **108–112 BPM**: muted piano or plucked guitar
  ostinato, light claps or shaker, a soft synth pad. Start sparse under shot 1. Add a kick at 0:04.5
  ("Every site"). Pull back to almost nothing under shot 5 (the alone beat should feel quiet and safe).
  Lift again at 0:12.5. Land a clean resolve on the downbeat at 0:17.0, with a 3-second tail under the
  end card. Use a library track you hold a licence for, or generate one in a music tool whose terms allow
  advertising.
- **Mix:** voiceover at about −14 LUFS integrated for social (−16 for broadcast-style YouTube). Duck the
  music 6–8 dB under the voice. Keep Veo's ambience low, about −24 dB, as texture only.
- **Signature sounds** (from the Veo clips, or added from a library): pool water and footsteps (1); the
  breaker clunk and a phone haptic tap (3); one soft confirmation chime on **I'm OK** (5→6), the
  emotional peak; trackpad clicks (7); a gentle two-note chime on the logo (9).
- **Language swap:** the French cut uses the same music and effects, with the French voiceover and supers.

---

## 6. Variants

### 6.1 16:9 (web, YouTube, presentations): 1920×1080

- Generate clips A–D in **16:9**.
- **Phone inserts (2, 4, 6, 8):** put the 9:16 screenshot on a simple phone mock-up, slightly right of
  centre on a soft light-teal background (`#F3F7F6` to white). The super sits on the left third.
- **Shot 7:** corner-pin `04-approvals-16x9.png` and `05-payroll-16x9.png` onto the laptop. Or cut to
  them full frame for 0.8 s each if the track wobbles.
- Alternative for shot 2 in 16:9: `02-schedule-builder-16x9.png` (the supervisor's week view) full frame.
  It reads better on a big screen than a phone.

### 6.2 9:16 (Reels, Shorts, TikTok): 1080×1920

- Generate clips A–D again in **9:16**. Don't crop the 16:9 versions: the framing and the subject's
  position change.
- **Phone inserts:** the 9:16 screenshots are already 1080×1920, so use them full frame with a 105→112%
  push-in.
- **Shot 7:** use `04-approvals-9x16.png` full frame (instead of a laptop corner-pin), then a 0.5 s
  glimpse of `05-pay-statement-9x16.png`: "and everyone's pay statement is waiting in the app" (site
  copy). The voiceover doesn't change.
- **Safe zones:** keep supers between 250 px from the top and 400 px from the bottom, clear of the
  platform's interface. Captions are burned in, because most people watch with the sound off.
- The first 1.5 s must hook: open on the lifeguard already moving, with the super **Every shift.** on
  frame 1.

### 6.3 French cut (either aspect)

Replace these screens: `01-punch-in-9x16-fr.png`, `02-schedule-9x16-fr.png` (or
`02-schedule-builder-16x9-fr.png`), `03-working-alone-9x16-fr.png`, and for shot 8 play the wipe in
reverse (`…-fr.png` → English). The approvals and payroll screens exist in English only. In the French
cut, shot 7 can use `02-schedule-builder-16x9-fr.png` on the laptop instead, and the super still reads
**Heures approuvées → paie**. Note: a few sample-data texts stay in English in the French screens (for
example "Pump station 4, lower level" on the working-alone screen). That's the demo's recorded data, not
a translation gap.

---

## 7. Production tips for Flow

1. **Consistent characters:** make one clear, neutral, front-lit still of each person (waist-up, plain
   background) with an image tool you're licensed to use. Add it to Flow as an **ingredient** and paste
   the matching character block from section 3.1 unchanged into every prompt. Generate 2–4 takes per
   clip and keep the one whose face and uniform match.
2. **Never ask Veo to draw the app.** Prompts say "screen faces away" or "plain, evenly lit off-white
   screen, no interface". The real screenshots go in afterwards. If a take shows invented UI or garbled
   text anyway, reject it or hide the screen with a reframe.
3. **Legible text:** screenshots are 1080×1920 (phone) and 1920×1080 (laptop). Don't scale a phone shot
   below about 45% of frame height in 16:9, or the button labels blur on mobile. Push in on the one
   element that matters (the slide button, **I'm OK**, the Approved pill). Hold each insert at least
   1.5 s. Supers: at least 64 px tall in 9:16 and 48 px in 16:9.
4. **Corner-pin (shot 7):** track the laptop screen's four corners in your editor (Resolve: Fusion
   planar tracker; Premiere: Corner Pin plus a tracker; CapCut: mask plus keyframes). Add a light screen
   glow and a 3–5% reflection so it sits in the scene.
5. **No real people, places or brands:** all screens come from the fictional "City of Lakeview (demo)"
   with invented names. Don't prompt for real city names, crests or uniforms with logos.
6. **Sound:** Veo makes ambience with each clip. Keep it, but generate with "no music, no dialogue" so
   your score and voiceover don't fight with invented music or speech.
7. **Assemble and export:** download each Veo clip from Flow as MP4 at the highest resolution your plan
   offers. If you use Flow's Scenebuilder to rough-cut the live action, export that too. Build the final
   edit in your editor on a 1920×1080 timeline (and a 1080×1920 one) at 24 or 30 fps, as you prefer.
   Export H.264 MP4 at 16–20 Mbps with AAC 48 kHz audio. Make four masters: EN-16x9, EN-9x16, FR-16x9
   and FR-9x16. Add an SRT caption file for each language.
8. **Retake the screenshots** after visible app changes with `capture.cjs` (README in this folder), so
   the ad never shows a screen the app no longer has.

---

## 8. Claims checklist

Every statement the ad makes, in voiceover, supers or end card, and where it is backed. Repository paths
are relative to the root.

| Claim in the ad | Backed by |
| --- | --- |
| Product name **FlexcityHeadquarters** | `apps/site/src/content/copy.ts` (`meta.title`, used site-wide); `brand/README.md` |
| Motto **Every shift. Every site. One HQ.** / **Chaque quart. Chaque site. Un seul QG.** | `apps/site/src/content/copy.ts` (`home.motto`, EN and FR); `apps/web/src/locales/en-CA.json` and `fr-CA.json` (`motto`) |
| Schedules on staff phones ("every shift, on every phone") | `copy.ts` `home.lead` ("… in English and French, on any phone") and `home.roles` (front-line staff see their schedule); `apps/site/src/content/screens.ts` (`phone-schedule`); screenshot `02-schedule-9x16.png` |
| Pools, arenas, parks and water works on one platform (the four sites shown) | `copy.ts` `home.lead` ("every city department, from pools and arenas to parks and water works") and `home.departments` |
| **Slide to clock in** / one slide to clock in | `copy.ts` features "Clock in with a slide" / FR "Pointer d'un glissement"; `apps/web/src/components/punch/PunchControl.tsx` (`SlideToConfirm`, `punch.slideIn`); screenshot `01-punch-in-9x16.png` |
| **Nobody works alone unnoticed** / check-in with a tap, **I'm OK** | `copy.ts` `home.alone` (title, steps; FR "Personne ne travaille seul sans qu'on le sache"); `apps/web/src/app/(app)/alone/page.tsx`; screenshot `03-working-alone-9x16.png` |
| Working alone at pump stations, parks patrols, arenas at night (the scenes chosen) | `copy.ts` `home.alone.places` ("Pump stations", "Arenas at night", "Parks patrols") |
| Fine print: supports your procedure; in an emergency, call 911 | `copy.ts` `home.alone.note`; the app's own working-alone screen ("In an emergency, call 911") |
| Approvals in one place (shot 7 screen) | `apps/web/src/locales/en-CA.json` (approvals `description`: "Everything waiting for a supervisor, in one place."); `apps/web/src/app/(app)/manage/approvals/page.tsx` |
| **Approved hours go straight to payroll** | `copy.ts` features "Clock in with a slide" ("Punches go to review, then straight into payroll") and `home.day` 4:30 p.m. step ("Approved hours become pay …"); `apps/web/src/app/(app)/manage/payroll/page.tsx` |
| Pay statements in the app (9:16 shot 7 variant) | `copy.ts` `home.day` ("everyone's pay statement is waiting in the app"); `screens.ts` (`phone-pay`) |
| **In English and French** | `copy.ts` `home.why` "Fully bilingual" ("Every screen and notice in English and Canadian French, chosen per person"); `apps/web/src/locales/en-CA.json` / `fr-CA.json` |
| Web address **flexcity-headquarters-iota.vercel.app** | `README.md` (`NEXT_PUBLIC_SITE_URL`: "today `https://flexcity-headquarters-iota.vercel.app`"); `apps/site/src/lib/seo.ts` |
| **Try the live demo** / **Essayer la démo** (optional end-card call to action) | `copy.ts` `home.ctaDemo` (EN "Try the live demo") and `nav.tryDemo` (FR "Essayer la démo") |
| "Demo screens, sample data" | `apps/web/src/lib/demo.ts` (fictional "City of Lakeview (demo)"); `copy.ts` screen captions ("Real screens from the demo, with its sample organization and invented people") |

**Deliberately not claimed:** prices, customers, certifications, awards, testimonials, a launch province
or date (the marketing site doesn't name one), offline punching (true per the site, but not shown), and
anything about AI.
