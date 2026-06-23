#!/usr/bin/env bash
# Regenerate the Disco sales sizzle reel (docs/marketing/disco-tour.mp4) from dashboard screenshots.
# Tells the product story in ~11s: snapshot (Library) → rebrand+build (Build console) → deliver
# (branded handover) → the system running (Activity). Requires ffmpeg (brew install ffmpeg).
#
# To refresh the frames, recapture these four 16:9-ish viewport screenshots into docs/screenshots/
# (the handover one is full-page and gets cropped to its above-the-fold region below):
#   library.png  build-console.png  public-handover.png  activity.png
set -euo pipefail
cd "$(dirname "$0")/../.."
S=docs/screenshots
OUT=docs/marketing/disco-tour.mp4
norm='scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x0e0d13,setsar=1,format=yuv420p'

ffmpeg -y -loglevel error \
  -loop 1 -t 3   -i "$S/library.png" \
  -loop 1 -t 3.5 -i "$S/build-console.png" \
  -loop 1 -t 3   -i "$S/public-handover.png" \
  -loop 1 -t 3   -i "$S/activity.png" \
  -filter_complex "\
[0]$norm[v0];\
[1]$norm[v1];\
[2]crop=in_w:min(in_h\,in_w*0.5625):0:0,$norm[v2];\
[3]$norm[v3];\
[v0][v1]xfade=transition=fade:duration=0.6:offset=2.4[x1];\
[x1][v2]xfade=transition=fade:duration=0.6:offset=5.3[x2];\
[x2][v3]xfade=transition=fade:duration=0.6:offset=7.7[v]" \
  -map "[v]" -r 30 -pix_fmt yuv420p -movflags +faststart "$OUT"

echo "wrote $OUT"
