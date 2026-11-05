#!/usr/bin/env bash
#
# Cut the raw screen recording of the in-app tour into the finished video:
# trims to the tour's first frame, normalises to 1080p, and mixes voiceover
# over a ducked music bed.
#
# The tour runs for exactly 53.0s (see `npm --prefix frontend run tour:cues`),
# so DURATION defaults to that. Because the tour's timing is wall-clock
# deterministic, the same trim offset works for every take.
#
# Motion blur is OFF by default. --motion-blur N turns it on by blending N
# consecutive frames (tmix), which is what a physical shutter does over its
# open period; 3 is roughly a 50ms shutter at 60fps. It is left available
# but unused because the tour's camera moves read better clean.
#
#   video/postproduce.sh --raw take1.mov --start 3.2 --vo vo.m4a --music bed.mp3
#
set -euo pipefail

RAW="" ; VO="" ; MUSIC="" ; OUT="video/ship-route-planner.mp4"
START="0"
DURATION="90.5"
MUSIC_DB="-19"
BLUR_FRAMES="0"

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'USAGE'

Options:
  --raw PATH      Raw screen recording (required)
  --start SEC     Seconds to trim off the head, to the tour's first frame (default 0)
  --duration SEC  Length to keep (default 90.5 — the tour's exact runtime)
  --vo PATH       Voiceover audio (optional)
  --music PATH    Music bed (optional; looped and ducked under the voiceover)
  --music-db DB   Music bed level before ducking (default -19)
  --motion-blur N Frames to blend for shutter motion blur; off by default (0)
  --out PATH      Output file (default video/ship-route-planner.mp4)
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --raw)       RAW="$2"; shift 2 ;;
    --start)     START="$2"; shift 2 ;;
    --duration)  DURATION="$2"; shift 2 ;;
    --vo)        VO="$2"; shift 2 ;;
    --music)     MUSIC="$2"; shift 2 ;;
    --music-db)  MUSIC_DB="$2"; shift 2 ;;
    --motion-blur) BLUR_FRAMES="$2"; shift 2 ;;
    --out)       OUT="$2"; shift 2 ;;
    -h|--help)   usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

command -v ffmpeg >/dev/null 2>&1 || {
  echo "ffmpeg not found. Install it with:  brew install ffmpeg" >&2
  exit 1
}
[ -n "$RAW" ] || { echo "--raw is required" >&2; usage; exit 1; }
[ -f "$RAW" ] || { echo "no such file: $RAW" >&2; exit 1; }

FADE_OUT=$(awk -v d="$DURATION" 'BEGIN { printf "%.2f", d - 0.9 }')

# tmix must run after fps so the blend window is a known slice of time, and
# before format so it averages in full precision rather than after chroma
# subsampling has already thrown detail away.
if [ "$BLUR_FRAMES" -gt 1 ] 2>/dev/null; then
  WEIGHTS=$(awk -v n="$BLUR_FRAMES" 'BEGIN { for (i = 0; i < n; i++) printf "1 "; }' | sed 's/ $//')
  BLUR=",tmix=frames=${BLUR_FRAMES}:weights='${WEIGHTS}'"
  echo "[video] motion blur: blending ${BLUR_FRAMES} frames"
else
  BLUR=""
fi

# Video: trim, normalise to 1080p60, blend for shutter blur, fade head and tail.
VF="[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=60\
${BLUR},format=yuv420p,fade=t=in:st=0:d=0.5,fade=t=out:st=${FADE_OUT}:d=0.9[v]"

inputs=(-ss "$START" -t "$DURATION" -i "$RAW")
filters=("$VF")
idx=1
vo_idx="" ; music_idx=""

if [ -n "$VO" ]; then
  [ -f "$VO" ] || { echo "no such file: $VO" >&2; exit 1; }
  inputs+=(-t "$DURATION" -i "$VO")
  vo_idx="$idx"; idx=$((idx + 1))
fi

if [ -n "$MUSIC" ]; then
  [ -f "$MUSIC" ] || { echo "no such file: $MUSIC" >&2; exit 1; }
  # Looped so a short bed still covers the full runtime.
  inputs+=(-stream_loop -1 -t "$DURATION" -i "$MUSIC")
  music_idx="$idx"; idx=$((idx + 1))
fi

AFMT="aformat=sample_rates=48000:channel_layouts=stereo"

if [ -n "$vo_idx" ] && [ -n "$music_idx" ]; then
  # sidechaincompress pulls the bed down whenever the voiceover speaks, so the
  # narration stays intelligible without hand-drawn volume automation.
  filters+=("[${vo_idx}:a]${AFMT},dynaudnorm=f=250:g=15,asplit=2[vo][sc]")
  filters+=("[${music_idx}:a]${AFMT},volume=${MUSIC_DB}dB[bed]")
  filters+=("[bed][sc]sidechaincompress=threshold=0.025:ratio=9:attack=25:release=420[duck]")
  filters+=("[vo][duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,\
afade=t=in:st=0:d=0.4,afade=t=out:st=${FADE_OUT}:d=0.9[a]")
elif [ -n "$vo_idx" ]; then
  filters+=("[${vo_idx}:a]${AFMT},dynaudnorm=f=250:g=15,\
afade=t=in:st=0:d=0.4,afade=t=out:st=${FADE_OUT}:d=0.9[a]")
elif [ -n "$music_idx" ]; then
  filters+=("[${music_idx}:a]${AFMT},volume=${MUSIC_DB}dB,\
afade=t=in:st=0:d=0.8,afade=t=out:st=${FADE_OUT}:d=0.9[a]")
fi

graph=$(IFS=';'; echo "${filters[*]}")
maps=(-map "[v]")
if [ -n "$vo_idx" ] || [ -n "$music_idx" ]; then
  maps+=(-map "[a]" -c:a aac -b:a 192k)
else
  maps+=(-an)
fi

mkdir -p "$(dirname "$OUT")"

echo "[video] raw=$RAW start=${START}s duration=${DURATION}s -> $OUT"
ffmpeg -hide_banner -y "${inputs[@]}" \
  -filter_complex "$graph" \
  "${maps[@]}" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -movflags +faststart \
  "$OUT"

echo "[video] done: $OUT"
ffprobe -hide_banner -v error -show_entries format=duration,size -of default=noprint_wrappers=1 "$OUT"
