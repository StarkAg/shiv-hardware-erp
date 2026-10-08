#!/usr/bin/env bash
# Deploy Shiv Print to Vercel production and always repoint the shop-facing
# domain to the fresh deployment. Run: npm run deploy
set -euo pipefail
cd "$(dirname "$0")"

DOMAIN="shivhardware-print.vercel.app"

echo "▶ Deploying to Vercel production…"
# Current Vercel CLI versions emit a JSON deployment object in non-interactive
# shells. Extract its URL before using it as an alias target.
# The CLI's output format is not stable: sometimes a JSON object, sometimes
# plain text with the URL on a "Production" line. Parsing it as JSON and
# failing meant `set -e` killed the script AFTER the deploy but BEFORE the
# alias — so the build went live on a URL nobody uses while the shop's own
# domain still served the previous one, and the deploy looked successful.
# Confirmed on attendance-web. So: try JSON, fall back to reading the URL out
# of the text, and never treat "no URL" as merely a parse problem.
DEPLOYMENT="$(npx vercel --prod --yes 2>&1)"
printf '%s\n' "$DEPLOYMENT"

URL="$(printf '%s' "$DEPLOYMENT" | node -e '
let output = ""
process.stdin.on("data", (chunk) => { output += chunk })
process.stdin.on("end", () => {
  try {
    const url = JSON.parse(output)?.deployment?.url
    if (url) return process.stdout.write(url.replace(/^https?:\/\//, ""))
  } catch { /* not JSON this time; read it out of the text instead */ }
  // The deployment URL carries a build hash; the aliased one does not, so
  // never pick up an existing alias. The CLI also prints the Production line
  // twice, the first one truncated by the terminal width ("...-projects.ve"),
  // so match complete URLs only and take the last — a truncated line simply
  // yields nothing to match.
  const usable = output.split("\n").filter((l) => !/Aliased|Inspect/.test(l))
  const urlsIn = (ls) => ls.flatMap((l) =>
    [...l.matchAll(/https:\/\/([A-Za-z0-9.-]+\.vercel\.app)\b/g)].map((m) => m[1]))
  const fromProd = urlsIn(usable.filter((l) => /^\s*Production\s/.test(l)))
  const anyUrl = urlsIn(usable)
  process.stdout.write(fromProd[fromProd.length - 1] ?? anyUrl[anyUrl.length - 1] ?? "")
})
')"

if [ -z "$URL" ]; then
  # The deploy itself already happened by this point, so say so plainly rather
  # than exiting as though nothing did — the build is live, just not aliased.
  echo "" >&2
  echo "✖ Deployed, but could not read the deployment URL from the output above." >&2
  echo "  $DOMAIN still points at the PREVIOUS build. Finish it with:" >&2
  echo "    npx vercel alias set <the-production-url-above> $DOMAIN" >&2
  exit 1
fi

echo "▶ Pointing $DOMAIN → $URL"
npx vercel alias set "$URL" "$DOMAIN"

echo "✔ Live: https://$DOMAIN"
