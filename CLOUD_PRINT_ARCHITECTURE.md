# Cloud Print Architecture

## Target

Staff Android app must work outside shop Wi-Fi. The physical printer still belongs to the Windows shop computer.

```text
Android Staff App
  creates customer / quotation / guarantee / print job
        |
        v
Railway Node API
  HTTP API for Android and printer agent
        |
        v
Convex
  cloud database for customers, documents, print jobs
        |
        v
Windows Shop Print Server
  polls Railway API, claims jobs, prints locally
        |
        v
Physical Printer
```

## What Exists Now

- Convex project:
  - `shiv-hardware-panel`
  - dev URL: `https://dapper-meadowlark-236.convex.cloud`
  - production URL: `https://sensible-panther-176.convex.cloud`

- Railway project:
  - `shiv-hardware`
  - environment: `production`
  - cloud API URL: `https://cloud-api-production-4953.up.railway.app`

- `convex/schema.ts`
  - `customers`
  - `quotations`
  - `guaranteeDocuments`
  - `printJobs`

- `convex/printJobs.ts`
  - create print job
  - list pending jobs
  - claim next jobs
  - mark printing
  - complete
  - fail

- `convex/customers.ts`
  - list customers
  - upsert customer

- `convex/documents.ts`
  - save/list quotations
  - save/list guarantee documents

- `cloud-api/server.mjs`
  - Railway-ready Express API
  - talks to Convex using `CONVEX_URL`
  - protected by optional `CLOUD_API_KEY`

- `print-server/server.mjs`
  - optional cloud polling using `CLOUD_API_URL`
  - claims print jobs
  - prints on local machine
  - marks jobs complete/failed

- `src/lib/cloudApi.ts`
  - frontend helper for creating cloud print jobs

## Current Print UX

There is one user-facing print button:

```text
Print
```

Behavior:

1. User taps `Print`.
2. App first tries the local Wi-Fi print server.
3. If local print fails or is unreachable, and cloud print is configured, the app automatically queues the job to Railway/Convex for the shop printer.
4. User sees status text such as:

```text
Sent to HP...
Shop print queued (...)
```

Changed files:

- `src/features/print/PrintPreview.tsx`
- `src/lib/cloudApi.ts`

Local config:

- `.env.local` includes the cloud API URL/key for the web app.
- `.env.local` is ignored by git.

Verified:

```bash
npm run build
```

## Workflow Roadmap

Build the actual workflow on top of the cloud setup.

### Print Action

Original two-action plan:

- `Print Now` -> local Wi-Fi print server
- `Print at Shop` -> creates Convex/Railway cloud print job

Current product decision:

- Keep only one `Print` button.
- The button first attempts local Wi-Fi printing.
- If local printing fails or the staff app is outside shop Wi-Fi, it queues the job to Convex/Railway for the shop printer.

This lets staff use the app outside Wi-Fi without adding a second print button.

### Windows Print Server

On the shop Windows PC, run:

```bash
npm run print:server
```

Because `print-server/.env` has:

```text
CLOUD_API_URL=https://cloud-api-production-4953.up.railway.app
```

the Windows/shop print server polls cloud print jobs and prints them locally.

### Android App

After cloud print is wired, wrap the React app with Capacitor:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init
npx cap add android
npm run build
npx cap sync android
npx cap open android
```

### Recommended Order

1. Wire cloud print into quotation/guarantee print screens.
2. Add a small cloud status/queue view.
3. Make the Windows print server Windows-compatible, because current printing still uses `lp`, which is macOS/Linux.
4. Package Android with Capacitor.

Before Windows packaging, replace `lp` with Windows printing, likely using SumatraPDF.

## Setup Order

1. Configure Convex:

```bash
npm run convex:dev
```

This creates/selects a Convex deployment and generates `convex/_generated`.

2. Run cloud API locally:

```bash
cp cloud-api/.env.example cloud-api/.env
# Fill CONVEX_URL and CLOUD_API_KEY
npm run cloud:api
```

Production `cloud-api` currently uses:

```text
CONVEX_URL=https://sensible-panther-176.convex.cloud
```

3. Run Windows/shop print server with cloud polling:

```bash
cp print-server/.env.example print-server/.env
# Fill CLOUD_API_URL and CLOUD_API_KEY
npm run print:server
```

Shop print server should use:

```text
CLOUD_API_URL=https://cloud-api-production-4953.up.railway.app
```

4. Android app creates jobs through:

```text
POST /api/print-jobs
```

5. Windows print server polls:

```text
POST /api/print-jobs/claim
POST /api/print-jobs/:id/printing
POST /api/print-jobs/:id/complete
POST /api/print-jobs/:id/fail
```

## Railway Boundary

Do not run Railway deploy commands unless deployment is explicitly requested. The API is ready for Railway, but deployment is a separate step.
