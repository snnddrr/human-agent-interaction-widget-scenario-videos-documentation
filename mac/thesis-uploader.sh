#!/bin/bash
# Thesis uploader: watches a folder for screen recordings, compresses each one
# and uploads it to the video documentation site, where it waits in "New"
# for review. The original moves to the folder's "Uploaded" subfolder.
#
# Runs in the background via launchd whenever the folder changes, and every
# few minutes to retry anything that failed. Written for macOS's bash 3.2.

set -u
APP_DIR="${THESIS_UPLOADER_HOME:-$HOME/Library/Application Support/ThesisUploader}"
# shellcheck source=/dev/null
. "$APP_DIR/config" || { echo "No config at $APP_DIR/config"; exit 1; }
: "${SITE_URL:?}" "${UPLOAD_KEY:?}" "${WATCH_DIR:?}"

WORK="$APP_DIR/work"
LOCK="$APP_DIR/lock"
FAILS="$APP_DIR/failures"
UPLOADED="$WATCH_DIR/Uploaded"
NOT_UPLOADED="$WATCH_DIR/Couldn't upload"
MAX_TRIES=5
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

notify() {
  [ "$(uname)" = Darwin ] || { log "notify: $1"; return 0; }
  local text="${1//\"/\\\"}"
  osascript -e "display notification \"$text\" with title \"Thesis archive\"" >/dev/null 2>&1 || true
}

# ---------- one run at a time ----------
mkdir -p "$WORK" "$FAILS"
if ! mkdir "$LOCK" 2>/dev/null; then
  # A lock older than 3 hours is left over from a crash.
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +180 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null; mkdir "$LOCK" || exit 0
  else exit 0; fi
fi
trap 'rm -rf "$WORK"/*; rmdir "$LOCK" 2>/dev/null' EXIT

# ---------- helpers ----------
mtime() { date -r "$1" +%s; }
created() { if [ "$(uname)" = Darwin ]; then stat -f %B "$1"; else mtime "$1"; fi; }
iso_utc() { if [ "$(uname)" = Darwin ]; then date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ; else date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; fi; }
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\000-\037'; }

json_get() { # file key
  if command -v plutil >/dev/null 2>&1; then plutil -extract "$2" raw -o - "$1" 2>/dev/null
  else python3 -c 'import json,sys; v=json.load(open(sys.argv[1])).get(sys.argv[2]); print("" if v is None else v)' "$1" "$2"; fi
}

absolute() { case "$1" in /*) printf '%s%s' "${SITE_URL%/}" "$1" ;; *) printf '%s' "$1" ;; esac; }

api() { # json-body out-file -> http status
  curl -sS -m 60 -o "$2" -w '%{http_code}' -X POST "${SITE_URL%/}/api/ingest" \
    -H "authorization: Bearer $UPLOAD_KEY" -H 'content-type: application/json' --data-binary "$1"
}

# A file is ready once it has stopped growing and nothing has it open.
is_settled() {
  local f="$1" s1 s2
  [ $(( $(date +%s) - $(mtime "$f") )) -ge 5 ] || return 1
  s1=$(wc -c < "$f"); sleep 3; s2=$(wc -c < "$f")
  [ "$s1" = "$s2" ] || return 1
  if command -v lsof >/dev/null 2>&1 && lsof -- "$f" >/dev/null 2>&1; then return 1; fi
  return 0
}

unique_path() { # dir name
  local dir="$1" name="$2" base ext n=2
  base="${name%.*}"; ext="${name##*.}"
  [ -e "$dir/$name" ] || { printf '%s/%s' "$dir" "$name"; return; }
  while [ -e "$dir/$base $n.$ext" ]; do n=$((n + 1)); done
  printf '%s/%s %s.%s' "$dir" "$base" "$n" "$ext"
}

failed() { # file reason
  local f="$1" key tries
  key=$(printf '%s' "$(basename "$f")" | cksum | cut -d' ' -f1)
  tries=$(( $(cat "$FAILS/$key" 2>/dev/null || echo 0) + 1 ))
  echo "$tries" > "$FAILS/$key"
  log "FAILED ($tries/$MAX_TRIES) $(basename "$f"): $2"
  if [ "$tries" -ge "$MAX_TRIES" ]; then
    mkdir -p "$NOT_UPLOADED"
    mv "$f" "$(unique_path "$NOT_UPLOADED" "$(basename "$f")")"
    rm -f "$FAILS/$key"
    notify "Couldn't upload $(basename "$f"). It's in the \"Couldn't upload\" folder. $2"
  elif [ "$tries" -eq 1 ]; then
    notify "Upload of $(basename "$f") didn't work. Trying again in a few minutes."
  fi
}

# ---------- compress ----------
compress() { # in out poster -> sets DURATION
  local in="$1" out="$2" poster="$3"
  DURATION=""
  if command -v ffmpeg >/dev/null 2>&1; then
    ffmpeg -nostdin -hide_banner -loglevel error -y -i "$in" \
      -vf "scale='min(1920,iw)':-2" -fpsmax 60 \
      -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p \
      -c:a aac -b:a 128k -movflags +faststart "$out" || return 1
    ffmpeg -nostdin -hide_banner -loglevel error -y -ss 1 -i "$out" -frames:v 1 -vf "scale='min(1600,iw)':-2" -q:v 3 "$poster" 2>/dev/null \
      || ffmpeg -nostdin -hide_banner -loglevel error -y -i "$out" -frames:v 1 -q:v 3 "$poster" 2>/dev/null || rm -f "$poster"
    DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out" 2>/dev/null)
    return 0
  fi
  if command -v avconvert >/dev/null 2>&1; then
    # Built into macOS: hardware encoder, up to 1920x1080, no poster frame.
    avconvert --source "$in" --output "$out" --preset Preset1920x1080 --replace >/dev/null 2>&1 || return 1
    rm -f "$poster"
    DURATION=$(mdls -raw -name kMDItemDurationSeconds "$in" 2>/dev/null | grep -E '^[0-9.]+$' || true)
    return 0
  fi
  return 2
}

# ---------- upload one file ----------
process() {
  local f="$1" name base out poster size created_at body status id vurl purl ctype has_poster
  name=$(basename "$f"); base="${name%.*}"
  out="$WORK/$base.mp4"; poster="$WORK/$base.jpg"
  log "Compressing $name ($(( $(wc -c < "$f") / 1048576 )) MB)"
  compress "$f" "$out" "$poster"; case $? in
    0) ;;
    2) failed "$f" "ffmpeg isn't installed. Run the installer again, or install it with: brew install ffmpeg"; return ;;
    *) failed "$f" "Compressing didn't work."; return ;;
  esac
  size=$(wc -c < "$out" | tr -d ' ')
  created_at=$(iso_utc "$(created "$f")")
  has_poster=false; [ -s "$poster" ] && has_poster=true
  ctype="video/mp4"
  log "Compressed to $(( size / 1048576 )) MB, uploading"

  body="{\"action\":\"start\",\"filename\":\"$(json_escape "$name")\",\"size\":$size,\"recordedAt\":\"$created_at\",\"duration\":${DURATION:-0},\"poster\":$has_poster,\"contentType\":\"$ctype\"}"
  status=$(api "$body" "$WORK/start.json") || { failed "$f" "No connection to the site."; return; }
  [ "$status" = 200 ] || { failed "$f" "The site said: $(cat "$WORK/start.json" 2>/dev/null) ($status)"; return; }
  id=$(json_get "$WORK/start.json" id); vurl=$(json_get "$WORK/start.json" videoUrl); purl=$(json_get "$WORK/start.json" posterUrl)
  [ -n "$id" ] && [ -n "$vurl" ] || { failed "$f" "Unexpected reply from the site."; return; }

  curl -sS --fail -m 3600 --retry 3 --retry-delay 5 -X PUT -T "$out" -H "content-type: $ctype" "$(absolute "$vurl")" -o /dev/null \
    || { failed "$f" "The video upload was interrupted."; return; }
  if [ "$has_poster" = true ] && [ -n "$purl" ]; then
    curl -sS --fail -m 120 --retry 2 -X PUT -T "$poster" -H "content-type: image/jpeg" "$(absolute "$purl")" -o /dev/null || log "Poster upload failed, continuing without it"
  fi

  status=$(api "{\"action\":\"complete\",\"id\":\"$id\"}" "$WORK/done.json") || { failed "$f" "No connection to the site."; return; }
  [ "$status" = 200 ] || { failed "$f" "The site said: $(cat "$WORK/done.json" 2>/dev/null) ($status)"; return; }

  mkdir -p "$UPLOADED"
  mv "$f" "$(unique_path "$UPLOADED" "$name")"
  mv "$out" "$(unique_path "$UPLOADED" "$base (web).mp4")"
  rm -f "$poster" "$FAILS/$(printf '%s' "$name" | cksum | cut -d' ' -f1)"
  log "Uploaded $name as \"$(json_get "$WORK/done.json" title)\""
  notify "\"$(json_get "$WORK/done.json" title)\" is waiting for review in New."
}

# ---------- main ----------
[ -d "$WATCH_DIR" ] || exit 0
found=0
while IFS= read -r -d '' f; do
  found=1
  is_settled "$f" || { log "Waiting for $(basename "$f") to finish saving"; continue; }
  process "$f"
done < <(find "$WATCH_DIR" -maxdepth 1 -type f \( -iname '*.mov' -o -iname '*.mp4' -o -iname '*.m4v' \) ! -name '.*' -print0)
[ "$found" = 1 ] || true
