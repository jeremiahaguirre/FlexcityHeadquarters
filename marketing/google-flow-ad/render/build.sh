#!/usr/bin/env bash
# Builds the four 20.0 s "hook" cuts with their audio, their contact sheets, and checks them with ffprobe.
# Needs node with Playwright (Chromium) and ffmpeg. Run from anywhere: bash marketing/google-flow-ad/render/build.sh
#   ONLY="en-16x9 fr-9x16" bash build.sh    rebuilds some cuts only; CRF=16 for higher quality (default 18).
# Inputs: ad.html (the stage, timed from voiceover/TIMINGS.md), assets/ (capture-assets.cjs), ../../../brand/fh-mark.svg,
# and the finished mixes voiceover/mix-en.wav and voiceover/mix-fr.wav (muxed as AAC 160k, 48 kHz stereo).
# The captions (FH-ad-EN/FR .srt and .vtt) are hand-timed from voiceover/TIMINGS.md and live beside this script.
set -euo pipefail
cd "$(dirname "$0")"
CRF="${CRF:-18}"
ONLY="${ONLY:-en-16x9 en-9x16 fr-16x9 fr-9x16}"

pids=()
for cut in $ONLY; do
  lang="${cut%-*}"; ar="${cut#*-}"
  node render.cjs "$lang" "$ar" "FH-ad-${lang^^}-${ar}.mp4" "$CRF" & pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done

for cut in $ONLY; do
  lang="${cut%-*}"; ar="${cut#*-}"; f="FH-ad-${lang^^}-${ar}.mp4"; base="${f%.mp4}"
  if [[ "$ar" == 16x9 ]]; then tile=5x4; w=384; else tile=10x2; w=216; fi
  # One frame per second: frame 8 of every second (t = k + 0.27 s), labelled with its time.
  ffmpeg -loglevel error -y -i "$f" \
    -vf "select='eq(mod(n\,30)\,8)',scale=${w}:-2,drawtext=fontfile=/usr/share/fonts/opentype/inter/Inter-Bold.otf:text='%{eif\:t\:d}.27s':x=8:y=8:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4,tile=${tile}:padding=4:color=black" \
    -frames:v 1 "${base}-contact.png"
  ffprobe -v error -show_entries stream=codec_type,codec_name,pix_fmt,width,height,r_frame_rate,sample_rate,channels,bit_rate \
    -show_entries format=duration,size -of compact "$f"
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  awk -v d="$dur" -v f="$f" 'BEGIN { if (d < 19.95 || d > 20.05) { print f ": duration " d " is not 20.0 s +-0.05"; exit 1 } }'
done
