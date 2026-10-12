#!/usr/bin/env bash
#
# Copy one backup from Railway to this Mac, then open it and check it.
#
#   ./fetch.sh gradex                              the newest nightly copy of a project
#   ./fetch.sh gradex/weekly/2026-10-11-0300.zip   a particular one (see `list` in backup.mjs)
#
# Lands in ~/convex-backups/from-railway/.
set -euo pipefail
cd "$(dirname "$0")"

# Named outright, so this works whichever folder Railway thinks is linked.
RW=(railway ssh -p 3204a621-3a84-4ad0-9960-d9195243d081 -e production -s convex-backups)

FILE="${1:?which project, or which copy}"
case "$FILE" in
  *.zip) ;;
  *)
    NEWEST="$("${RW[@]}" ls "/data/$FILE/daily" | tr -d '\r' | grep '\.zip$' | sort | tail -1)"
    [ -n "$NEWEST" ] || { echo "no nightly copies of $FILE on Railway yet" >&2; exit 1; }
    FILE="$FILE/daily/$NEWEST"
    ;;
esac

OUT="$HOME/convex-backups/from-railway/$(echo "$FILE" | tr / -)"
mkdir -p "$(dirname "$OUT")"
# Sent as base64 so the terminal link cannot mangle the bytes.
"${RW[@]}" node backup.mjs send "$FILE" | tr -d '\r\n' | base64 --decode > "$OUT"
node backup.mjs verify "$OUT"
echo "saved $OUT"
