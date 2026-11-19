# Shiv Counter on Android ("POS for the phone")

Tony asked on 19 Nov 2026 for the Shiv Counter as an Android app that works by
touch, like a POS. A Posiflex POS machine for the counter is planned later; this
is the phone version for now.

## How it fits together

```
Shiv Counter app on the phone (shiv-counter/, in.shivhardware.counter)
   │  a web view of https://shivhardware-counter.vercel.app
   │  user agent + "ShivCounterApp/<version>"
   │  window.ShivCounterAndroid: share(files), print(title), version()
   ▼
The Counter website (counter.html → src/counter.tsx)
   │  src/lib/posApp.ts sees the user agent and switches on:
   │    - html.pos-app: the touch look (counter-signs.css)
   │    - /pos: home screen of big tiles (features/pos/PosHome.tsx)
   │    - the Home bar in place of the swipe bar (CounterLayout)
   │    - the number pad for number boxes (components/PosNumberPad.tsx)
   │    - navigator.share / window.print / save links through the bridge
   ▼
Same Convex, same shop PIN, same print queue as the website
```

The app is only a frame. **A change to the Counter's screens goes out with
`npm run deploy -- --only counter` and reaches the phone at once, with no new
APK.** Only a change inside `shiv-counter/` needs a new build.

Nothing in the touch look reaches the PC app or the website: it switches on
only when the user agent has `ShivCounterApp/`.

## What the app does that the website cannot

| | How |
|---|---|
| Full screen, screen stays on | Bars hidden (swipe from the edge brings them back), `FLAG_KEEP_SCREEN_ON` |
| Back goes back a page | `onBackPressed`; at the first page the app is put away, not closed |
| Camera and gallery in photo boxes | `onShowFileChooser`, the phone's camera app through a FileProvider (no camera permission) |
| Share a quotation picture to WhatsApp | `posApp.ts` defines `navigator.share`, files go to `ShivCounterAndroid.share` as base64, the phone's share sheet opens |
| Print (the slip, a preview) | `window.print` calls `ShivCounterAndroid.print`, Android's print screen, A4 |
| Save links (a blob with a download name) | Handed to the share sheet, where they can be saved or sent |
| Links to WhatsApp, the dialer, UPI, the guarantee site | Opened in their own app; a blank window pointed at a link (a bill photo, another shop app) is caught the same way |
| No internet | A plain "No internet / Try again" page |

Quotations and guarantee cards print through the shop PC as they do from the
website (`printViaShop`, the print queue). Printing straight to the Epson with
the PC off is still the plan in `docs/one-tap-phone-print.md`.

## The number pad

Every number box (type number or tel, or inputmode numeric / decimal / tel)
gets the pad instead of the phone's keyboard. The first key replaces what is
in the box, as on a till. **Next** is the PC's Enter (`lib/enterFlow`): past
the last box it lands on the screen's Print button. **Done** puts it away.
The point key is off for counts and phone numbers. A box can opt out with
`data-pos-pad="off"`.

## Build and install

GitHub builds it (`.github/workflows/build-shiv-counter.yml`), so no shop
computer needs the Android tools. It runs on every push that changes
`shiv-counter/`, or by hand. To fetch the file:

```
gh run download <run-id> -n shiv-counter -D shiv-counter-ci
```

Install `Shiv_Counter.apk` on the phone (allow installing from this source
once), open it and enter the shop PIN once.

**Every build given to the phones needs a higher `versionCode`** in
`shiv-counter/app/build.gradle.kts`, or Android refuses to install it over the
last one.

Every build is signed with the shop's one Shiv Counter key, so updates install
over the top. It is stored as the GitHub secrets `SHIV_COUNTER_KEYSTORE_B64`
and `SHIV_COUNTER_KEYSTORE_PASSWORD`, with a copy on the shop PC in
`C:\Users\tonya\Documents\Shiv Counter signing key`. Keep a second copy
somewhere safe. If the key is lost, the app has to be uninstalled and
installed fresh.

## Test on the phone

1. It opens on the tiles. Every tile opens its page; Home comes back.
2. Make a quotation with the number pad only: sizes, quantity, Next to Print.
3. Print it: it comes out at the shop as from the website.
4. Share it: WhatsApp is in the share sheet and the picture arrives.
5. A guarantee card: take the photo with the camera, and pick one from the gallery.
6. Slip: Print opens Android's print screen.
7. Back walks back through pages; at the tiles it puts the app away.
8. Airplane mode, open the app: "No internet", then Try again once back online.
9. Open the website on a phone browser and on the PC: no tiles, no pad, nothing changed.
