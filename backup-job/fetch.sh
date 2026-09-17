#!/usr/bin/env bash
#
# Copy one backup from Railway to this Mac, then open it and check it.
#
#   ./fetch.sh                             the newest nightly copy
#   ./fetch.sh weekly/2026-09-20-0200.zip  a particular one (see: railway ssh -s backups node backup.mjs list)
#
# Lands in ~/ShivBackups/from-railway/.
set -euo pipefail
cd "$(dirname "$0")"

FILE="${1:-}"
if [ -z "$FILE" ]; then
  NEWEST="$(railway ssh -s backups ls /data/daily | tr -d '\r' | grep '\.zip$' | sort | tail -1)"
  [ -n "$NEWEST" ] || { echo "no nightly copies on Railway yet" >&2; exit 1; }
  FILE="daily/$NEWEST"
fi

OUT="$HOME/ShivBackups/from-railway/$(echo "$FILE" | tr / -)"
mkdir -p "$(dirname "$OUT")"
# Sent as base64 so the terminal link cannot mangle the bytes.
railway ssh -s backups node backup.mjs send "$FILE" | tr -d '\r\n' | base64 --decode > "$OUT"
node backup.mjs verify "$OUT"
echo "saved $OUT"
