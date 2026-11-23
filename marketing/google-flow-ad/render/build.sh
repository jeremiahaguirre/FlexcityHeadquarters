#!/usr/bin/env bash
# Builds the four 20.0 s cuts, their contact sheets, and checks them with ffprobe.
# Needs node with Playwright (Chromium) and ffmpeg. Run from anywhere: bash marketing/google-flow-ad/render/build.sh
# The SRT files (FH-ad-EN.srt, FH-ad-FR.srt) are hand-written from PROMPT.md section 4 and live beside this script.
set -euo pipefail
cd "$(dirname "$0")"
CRF="${CRF:-20}"

pids=()
for lang in en fr; do
  for ar in 16x9 9x16; do
    node render.cjs "$lang" "$ar" "FH-ad-${lang^^}-${ar}.mp4" "$CRF" & pids+=($!)
  done
done
for p in "${pids[@]}"; do wait "$p"; done

for f in FH-ad-*.mp4; do
  base="${f%.mp4}"
  if [[ "$f" == *16x9* ]]; then tile=5x4; w=384; else tile=10x2; w=216; fi
  # One frame per second: frame 8 of every second (t = k + 0.27 s, clear of most cuts), labelled with its time.
  ffmpeg -loglevel error -y -i "$f" \
    -vf "select='eq(mod(n\,30)\,8)',scale=${w}:-2,drawtext=fontfile=/usr/share/fonts/opentype/inter/Inter-Bold.otf:text='%{eif\:t\:d}.27s':x=8:y=8:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4,tile=${tile}:padding=4:color=black" \
    -frames:v 1 "${base}-contact.png"
  ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_frames \
    -show_entries format=duration,size -of compact "$f"
done
