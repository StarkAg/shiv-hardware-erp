# Handoff: Shiv Order app (19 Nov 2026, from the shop PC)

Pick this up on another computer: `git pull`, then read this and
`docs/shiv-order-android.md`.

## What Tony wants

An Android "order maker" for the **door orders** he posts in the **Shiv Hardware**
WhatsApp group. The counter bill has doors with sizes and rates; the group gets
the doors without rates, one line each, exactly like:

```
3D MT158 78⅜x37²/⁸ - 1 pc
3D MT158 78⁴/⁸x37⅜ - 1 pc
3D MT158 78x37⁴/⁸ - 1 pc
```

(⅛ ⅜ ⅝ ⅞ as their own sign; 2, 4 and 6 eighths written ²/⁸ ⁴/⁸ ⁶/⁸.) After
**Send to group → Yes, send** it posts from the Shop WhatsApp (79705 50954, on
Railway), with no WhatsApp to open. He also asked for **AI reading of the bill
photo** ("need ocr? ai"), so the lines fill themselves and he only checks them.

## Done and pushed

| Part | State |
|---|---|
| `shiv-order/` native Kotlin app (in.shivhardware.order) | Built on GitHub (`Build Shiv Order`, run 44527194137, success). Manual entry: model chips, height and width inches plus eighths taps, pieces, Add door, other lines, tap a line to edit, Clear, preview, Send with a Yes dialog, PIN once, self-update (Updater.kt). |
| Signing key | `C:\Users\tonya\Documents\Shiv Order signing key` on the shop PC; GitHub secrets `SHIV_ORDER_KEYSTORE_B64` / `_PASSWORD` set. |
| Railway `whatsapp-reminders` | **Deployed** with `POST /send-text` (deployment 7175cf69, SUCCESS). |
| `convex/shopWhatsApp.ts` `sendText` | Committed, **NOT deployed yet**. |
| `convex/ai.ts` `readDoorOrder` (+ `unwrapDoorOrder`, `cleanDoorLines`) | Committed, **NOT deployed yet**. |
| `scripts/release-android.mjs` | One release script: `npm run release:android -- --app order` (or `--app counter`). |
| No release yet | The repo StarkAg/shiv-order-releases is made by the script on the first release. |

## To do next, in order

1. **Deploy Convex** (sendText + readDoorOrder). The app cannot send until this
   is done. On the shop PC another session had uncommitted
   `convex/monthly.ts` and `src/features/ledger/components/SalaryRent.jsx`:
   stash them, deploy, then pop them, never ship them by accident:
   ```
   git stash push -m wip -- convex/monthly.ts src/features/ledger/components/SalaryRent.jsx
   npx convex deploy --yes --typecheck enable
   git stash pop
   ```
   `npm run deploy -- --only convex` refuses while the Mac has old unpushed work
   (refs/wip-others/mac: backup and BIS files, nothing in convex/), and its
   `--force` is not passed on to the check, so run `npx convex deploy` directly as above.
   On a computer without those files, `npx convex deploy --yes --typecheck enable` is all.

2. **Wire the bill photo into the app** (`shiv-order/.../MainActivity.kt`,
   `Shop.kt`). Not written yet. Plan:
   - A blue **Read bill photo** button at the top: camera (ACTION_IMAGE_CAPTURE
     into `cacheDir/camera/` through the FileProvider: add
     `<cache-path name="camera" path="camera/" />` to `res/xml/file_paths.xml`
     and an IMAGE_CAPTURE `<queries>` entry in the manifest) or gallery
     (ACTION_GET_CONTENT image/*).
   - Shrink to a JPEG, long side 2000, quality 85 (well under the model's 5 MB),
     base64 → `Shop` action `ai:readDoorOrder { jpeg }`. Answer:
     `{ ok, party, lines: [{kind:'door', model, h, h8, w, w8, qty, unsure} | {kind:'other', text, unsure}] }`.
   - Put **door** lines on the order (Tony's group posts carry the doors only).
     Show the **other** lines under them as "Also on the bill, tap to add".
   - Lines with `unsure: true` get the Signs yellow (wait) background and "check" until
     tapped and re-added. Remember each new model with `remember(model)`.
   - Do not fill the party name (his posts have none).
   - The Shiv Order earlier draft with photo picking and image shrinking is in git
     history: `git show 254d78a~0:shiv-order/app/src/main/java/in/shivhardware/order/MainActivity.kt`
     is the order version; the photo code (decode / ImageDecoder, camera, picker)
     was in the first "Shiv Group" draft, not committed, so write it fresh. The
     Counter app (`shiv-counter/.../MainActivity.kt`) has a working camera file chooser.

3. Raise nothing yet (versionCode 1 is unreleased). Commit, push, wait for
   `Build Shiv Order`, then:
   ```
   npm run release:android -- --app order --notes "First version: door orders to the group, AI reads the bill."
   ```
   Fetch the APK (`gh run download <run-id> -R StarkAg/shiv-hardware-erp -n shiv-order -D shiv-order-ci`),
   copy `Shiv_Order.apk` to Tony's Downloads and send it to him.

4. On the phone: install, enter the shop PIN once, read a bill, check, Send.
   Nothing has been tried on a phone yet, and nothing has been posted to the group.

## The AI reader, tried on Tony's two bills (19 Nov)

Same prompt and model as `readDoorOrder` (MeshAPI, `anthropic/claude-sonnet-5`):

- Bill 1 (M/S Boleshwar Bediya Ji): all 4 door lines exactly as Tony posted them;
  6 fittings returned as other lines (3 marked unsure).
- Bill 2 (M/S Rahul Bediya Ji): both 3D MT158 lines exactly as posted; AC/AD
  1.2mm doors read, 2 marked unsure; "fitting 7 item 2 set" misread as
  "28 set". So the check step before Send matters.
- MeshAPI sometimes returned the tool answer as a JSON string inside
  `{"lines": "..."}`: `unwrapDoorOrder` handles it.
- A big PNG (7 MB) is refused: send a JPEG.

Test script (not in git) was a node file calling the SDK with the prompt from
convex/ai.ts; get the key with `npx convex env get MESH_API_KEY --prod` into an
env variable, never printed.

## Gotchas

- GitHub secrets: set from **bash** (`gh secret set NAME -R StarkAg/shiv-hardware-erp < file`),
  never piped from Windows PowerShell 5.1. The repo has two remotes, so always pass `-R`.
- Never print `password.txt` from a key folder.
- `SHOP_GROUP_ID` on Railway is the group the sends go to (the same one Bill
  Shoot posts to). It is assumed to be "Shiv Hardware"; the first real send confirms it.
