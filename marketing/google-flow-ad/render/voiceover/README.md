# Voiceover and music (hook cut)

The finished audio for the 20-second "hook" ad, one mix per language. All of it was made with ElevenLabs:

| File | What it is |
| --- | --- |
| `vo-en.mp3` | English voice take: library voice "Noah - Confident Canadian Narrator", model `eleven_v4` |
| `vo-fr.mp3` | French voice take: library voice "Mathieu – Warm French Canadian Narrator", model `eleven_v4` |
| `music.mp3` | Upbeat instrumental bed, model `eleven_music_v2_5` (speech to text found no vocals in it) |
| `mix-en.wav`, `mix-fr.wav` | The final mixes, exactly 20.000 s, 48 kHz stereo, -15 LUFS integrated: voice starting at +0.10 s over the music bed, ducked under the voice; the music decays naturally after about 17 s |
| `TIMINGS.md` | Every word's start time on the final 20.0 s timeline, for EN and FR |

Both voice takes were transcribed with ElevenLabs speech to text and match the script word for word:

- EN: "Still juggling shifts by text, paper and spreadsheet? Meet Flexcity Headquarters! Scheduling, time
  clocks and payroll export, built for Canadian cities, in English and French, on any phone. Every shift.
  Every site. One HQ. Try the live demo now!"
- FR: « Encore des quarts gérés par texto, papier et chiffrier? Découvrez Flexcity Headquarters! Horaires,
  pointage et exportation de la paie, conçus pour les villes canadiennes, en français et en anglais, sur
  tout téléphone. Chaque quart. Chaque site. Un seul QG. Essayez la démo dès maintenant! »

How it is used: `../render.cjs` muxes `mix-<lang>.wav` into each cut as AAC 160 kb/s, 48 kHz stereo.
`../ad.html` (the `TM` table) and the caption files (`../FH-ad-EN.srt`/`.vtt`, `../FH-ad-FR.srt`/`.vtt`)
are timed from `TIMINGS.md`: supers land on their word, and scene cuts sit on the music's eighth-note grid
(120 bpm, first beat at 0.475 s, measured from `music.mp3` by onset analysis) at or just before the word.
If the audio is ever replaced, update `TIMINGS.md`, the `TM` table and the grid (`g`) in `ad.html` and the
captions together.

Check the ElevenLabs plan's commercial-use terms (voices and music) before running the ad as paid media.
