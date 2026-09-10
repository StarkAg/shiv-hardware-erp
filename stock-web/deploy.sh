#!/usr/bin/env bash
# Deploy the stock panel to Vercel production and repoint the shop-facing
# domain at the fresh deployment. Run: npm run deploy
set -euo pipefail
cd "$(dirname "$0")"

DOMAIN="shivhardware-stock.vercel.app"

echo "▶ Deploying to Vercel production…"
DEPLOYMENT="$(npx vercel --prod --yes)"
URL="$(printf '%s' "$DEPLOYMENT" | node -e '
let output = ""
process.stdin.on("data", (chunk) => { output += chunk })
process.stdin.on("end", () => {
  try {
    const deployment = JSON.parse(output)
    if (!deployment?.deployment?.url) throw new Error("Deployment URL was not returned")
    process.stdout.write(deployment.deployment.url)
  } catch (error) {
    console.error(`Could not read Vercel deployment URL: ${error.message}`)
    process.exit(1)
  }
})
')"

if [ -z "$URL" ]; then
  echo "✖ Could not determine the deployment URL." >&2
  exit 1
fi

echo "▶ Pointing $DOMAIN → $URL"
npx vercel alias set "$URL" "$DOMAIN"

echo "✔ Live: https://$DOMAIN"
