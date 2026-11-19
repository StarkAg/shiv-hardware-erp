# Handoff: Shiv Intro phone apps (19 Nov 2026)

Where the Shiv Intro APK work stands, so another computer can carry on. Full design: `docs/shiv-intro.md`.

## Done and pushed

| Commit | What |
|---|---|
| a377eb9 | **Shiv_Intro 1.1** (`shiv-intro/`, versionCode 2). After setup, opening the app opens the Shiv Intro page (shivhardware-intro.vercel.app) inside it. The contact listener keeps running behind it, and a grey line on top shows its status. The one PIN typed in the app also connects the page (token handed to `localStorage['shiv-device-token']` once). Setup now ends with a "Never auto sleeping apps" step and a Done button. |
| c95b261 | **Shiv Intro Counter 1.0** (`shiv-intro-counter/`, package `in.shivhardware.introcounter`), new. A staff-only app: it opens only the Shiv Intro page, saves nothing on the phone and blocks links to the shop's other apps (only WhatsApp and phone-call links leave it). Signed with the same Shiv_Intro key, so there are no new secrets. Workflow: `.github/workflows/build-shiv-intro-counter.yml`. |

Shiv_Intro 1.1 built and is already at `C:\Users\tonya\OneDrive\Desktop\APK\Shiv_Intro.apk` on the shop PC.

## Left to do

1. **Fetch the Shiv Intro Counter APK.** Its first build (run 44528085252) was running when the session stopped. Check it:
   ```
   gh run view 44528085252 --json conclusion -q .conclusion
   gh run download 44528085252 -n shiv-intro-counter -D shiv-intro-counter-ci
   ```
   If it failed, read `gh run view 44528085252 --log-failed`, fix it and push. On the shop PC the file goes to `C:\Users\tonya\OneDrive\Desktop\APK\Shiv_Intro_Counter.apk`; every APK goes there. Delete `shiv-intro-counter-ci/` afterwards (it is not git-ignored).
2. **First run on real phones.** Neither app has been opened on a phone yet.
   - Samsung: Shiv_Intro 1.1. Check that the PIN is asked only once, the page opens, and Save lands in the contacts.
   - Staff phone: Shiv Intro Counter. Tony types the shop PIN once in the page. Check that Save reaches the Samsung, Send works, and the PIN screen's links to other apps do nothing.
   - **Never install Shiv_Intro (the listener) on a staff phone.** That phone would take the saves meant for the Samsung.
3. **Optional, offered and not yet asked for:** a self-updater for both apps like the Counter's (`shiv-counter/.../Updater.kt`, with its own public releases repo). Another session has renamed `scripts/release-counter-android.mjs` to `scripts/release-android.mjs` (staged, not committed by this session), so check that first.

## Not this session's work

Uncommitted on the shop PC at handoff, from other sessions, and left alone: `convex/monthly.ts`, `convex/shopWhatsApp.ts`, `src/features/ledger/components/SalaryRent.jsx`, `whatsapp-reminders/server.mjs`, the staged rename above, `shiv-order/` and `.github/workflows/build-shiv-order.yml`.
