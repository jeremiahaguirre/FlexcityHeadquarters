# Voiceover

Generated with ElevenLabs text to speech (model `eleven_v4`), one take per language, from the script in
`../../PROMPT.md` section 4:

- English: library voice "Noah - Confident Canadian Narrator" (`9hb1f7xQcMLB90qbYSY3`).
- French: library voice "Mathieu – Warm French Canadian Narrator" (`ea8mX8XjQt6IYaKiIshC`).

Both takes were transcribed with ElevenLabs speech to text (`eleven_scribe_v1`) and match the script word
for word. The name is spoken "Flexcity Headquarters".

`build_vo.py` cuts each line from the take and places it at the PROMPT.md time, then normalizes to
-16 LUFS (peak -1.5 dBTP), 48 kHz stereo. To rebuild the videos' audio:

```bash
python3 build_vo.py
for L in EN FR; do for A in 16x9 9x16; do f=../FH-ad-$L-$A.mp4
  ffmpeg -y -i $f -i FH-ad-$L-vo-20s.wav -map 0:v:0 -map 1:a:0 -c:v copy -af apad -t 20 \
    -c:a aac -b:a 160k -ar 48000 -ac 2 -movflags +faststart tmp.mp4 && mv tmp.mp4 $f
done; done
```

The SRT and WebVTT caption files beside the videos follow the voiceover's timing.
Check the ElevenLabs plan's commercial-use terms before running the ad as paid media.
