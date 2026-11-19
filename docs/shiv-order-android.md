# Shiv Order (door orders to the group)

Tony asked on 19 Nov 2026 for an order maker app: the doors on a counter bill
(model, size, pieces, rate) go to the **Shiv Hardware** WhatsApp group as
lines without rates, the way he typed them by hand:

```
3D MT158 78⅜x37²/⁸ - 1 pc
3D MT158 77⁴/⁸x37²/⁸ - 1 pc
```

The app makes those lines and, after **Send to group → Yes, send**, posts
them from the Shop WhatsApp (79705 50954). WhatsApp itself never opens.

## How it fits together

```
Shiv Order on the phone (shiv-order/, in.shivhardware.order, native Kotlin)
   │  POST https://sensible-panther-176.convex.cloud/api/action
   │  Authorization: Bearer <this phone's device token>
   ▼
convex/shopWhatsApp.ts  sendText({ mobile: 'group', text })   (trusted devices only)
   ▼
Railway whatsapp-reminders  POST /send-text   (x-shop-key = SEND_KEY)
   ▼
the group in the service's SHOP_GROUP_ID, from the Shop number
```

The phone is trusted once with the shop PIN (`devices:trust`, app
`shiv-order`); the PIN is not kept. Removing it on the panel's Trusted devices
page ends its token, and the app asks for the PIN again.

## The screen

- **Model**: chips of the models used (3D MT158, 3D 138, 3D 110, AC 1.2mm,
  AD 1.2mm to start; a typed new one is remembered and moves to the front).
- **Height / Width**: the inches typed (two figures jump on), the eighths
  tapped 0 to 7. ⅛ ⅜ ⅝ ⅞ use their own sign; 2, 4 and 6 eighths are written
  ²/⁸ ⁴/⁸ ⁶/⁸, as on the bills.
- **Pieces**: − and +. **Add door** puts the line on the order and keeps the
  model for the next door.
- **Other line**: anything else as typed (fitting, magnets).
- Tap a line to bring it back up and put it right; ✕ takes it off.
- Party name on top is optional (empty, the message is the lines only).
- The order being made is kept if the app is closed. **Clear** with nothing on
  the order shows the last order sent.

## Updates

Same as Shiv Counter (see docs/shiv-counter-android.md): raise `versionCode`
in `shiv-order/app/build.gradle.kts`, push (GitHub Actions `Build Shiv Order`
builds it), then

```
npm run release:android -- --app order --notes "What changed"
```

publishes it on the public repo StarkAg/shiv-order-releases as
`order-v<versionCode>`; the app offers Update now / Later when it opens.

Signing key: `C:\Users\tonya\Documents\Shiv Order signing key` (not OneDrive),
GitHub secrets `SHIV_ORDER_KEYSTORE_B64` / `SHIV_ORDER_KEYSTORE_PASSWORD`. Set
secrets from bash (`gh secret set NAME -R StarkAg/shiv-hardware-erp < file`),
never by piping from Windows PowerShell 5.1.
