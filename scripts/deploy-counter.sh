#!/usr/bin/env bash
# The counter site, built from the same dist as the panel.
#
# Both are entry points of one project, so `npm run build` produces index.html
# (panel) and counter.html (counter) side by side from one set of chunks. This
# publishes a copy of that dist whose index.html IS the counter, which is why no
# rewrite rule is needed and the shared chunks keep their own names.
#
# Run: npm run deploy:counter   (after npm run build)
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN="shivhardware-counter.vercel.app"
OUT=".counter-dist"

[ -f dist/counter.html ] || { echo "✖ Run npm run build first." >&2; exit 1; }

rm -rf "$OUT"
cp -R dist "$OUT"
cp "$OUT/counter.html" "$OUT/index.html"

# The project must already exist — `vercel deploy --project` will not create
# one. Made once, then this is a no-op that prints "already exists".
npx vercel project add shiv-counter >/dev/null 2>&1 || true

echo "▶ Deploying the counter to Vercel production…"
DEPLOYMENT="$(npx vercel deploy "$OUT" --project shiv-counter --prod --yes)"
URL="$(printf '%s' "$DEPLOYMENT" | grep -oE 'https://shiv-counter-[a-z0-9]+-[a-z0-9-]+\.vercel\.app' | head -1)"
[ -n "$URL" ] || { echo "✖ Could not determine the deployment URL." >&2; exit 1; }

echo "▶ Pointing $DOMAIN → $URL"
npx vercel alias set "$URL" "$DOMAIN"
rm -rf "$OUT"
echo "✔ Live: https://$DOMAIN"
