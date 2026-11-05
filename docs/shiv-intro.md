# Shiv Intro

For a new customer: type the name, place and mobile number, then use either of two separate buttons.

- **Save** puts the customer in the contacts on Tony's Samsung, with no Google or Samsung account.
- **Send** gives them the shop's greeting and visiting card on WhatsApp from Tony's number, 80928 50954: a smile, folded hands, then the card.

Status on 5 Nov 2026: the code is written and the Android app builds on GitHub. **Nothing is deployed, and the app has never run on a phone.**

## How it fits together

```
Counter page (#/intro)
   │  shivIntro:save / shivIntro:send
   ▼
Convex: introContacts (one row per number, two jobs on it)
   │                                     │
   │ live: shivIntro:waiting             │ live: shivIntro:toSend
   ▼                                     ▼
Shiv_Intro app on the Samsung      Railway whatsapp-bills (Tony's number)
writes into the phone's contacts   sends the greeting and visiting-card.jpg
   │ shivIntro:report                    │ shivIntro:claimSend, recordSend
   └───────────────► Convex ◄────────────┘
                       │ live
                       ▼
                 the page's signs update by themselves
```

| Part | Where |
|---|---|
| Server functions | `convex/shivIntro.ts`, table `introContacts` in `convex/schema.ts` |
| Phone-only rule | `INTRO_APP`, `phoneQuery` and `phoneMutation` in `convex/lib/guarded.ts` |
| Page | `src/features/intro/ShivIntro.tsx`, on the Counter's Shop menu |
| Sending the card | `sendIntro` in `whatsapp-bills/server.mjs` |
| Samsung app | `shiv-intro/` |
| Tests | `tests/shivIntro.test.ts` |

## Rules that must stay true

- **The phone is limited.** The app is a trusted device with `app: 'shiv-intro'`. It can only call the phone functions, not the books, customers or device list. It pairs with the shop PIN once, so no secret is built into the app file. Removing it from the Trusted devices page ends its access.
- **A name on the phone is never overwritten.** If the number is already there, the page says "Already on phone" and shows the name it is saved under.
- **A repeat save is harmless.** The phone checks the number before writing, so a crash after saving only leads to "Already on phone".
- **A customer is never greeted twice by accident.** A send is claimed before anything goes out and is not retried by itself. If the service stops halfway, the page offers Send again after 5 minutes. A customer already sent the card needs a confirmation to send again.
- **Sending hours are 9 am to 9 pm**, the same as bills. A Send pressed outside those hours waits.

## Deploy order

1. Commit the Mac's 4 uncommitted files, or the Convex deploy refuses to run.
2. Deploy `convex`.
3. Deploy `counter` and `whatsapp-bills`. **Send** works from here on, before the Samsung app exists.
4. Build and install the Samsung app. **Save** works from here on.

`whatsapp-bills` listens to Convex as soon as it starts, so deploy Convex first.

## Build the Samsung app

GitHub builds it, so no shop computer needs the Android tools. The workflow `.github/workflows/build-shiv-intro.yml` runs on every push that changes `shiv-intro/`, or by hand. To fetch the file:

```
gh run download <run-id> -n shiv-intro -D shiv-intro-ci
```

The first build passed on 5 Nov 2026 and gave `Shiv_Intro.apk`, about 11 MB, for 64-bit phones only. It has **not been run on a phone yet**.

**Install it only after Convex is deployed.** Until then the live server does not know the phone-only rule, so a phone paired as `shiv-intro` would get the same access as any trusted device.

Then install it on the Samsung, enter the shop PIN once, and allow what it asks. Add Shiv_Intro to Samsung's **Never auto sleeping apps** list.

Every build is signed with the shop's one Shiv_Intro key, so updates install over the top. The key is stored as the GitHub secrets `SHIV_INTRO_KEYSTORE_B64` and `SHIV_INTRO_KEYSTORE_PASSWORD`, with a copy on the shop PC in `Documents\Shiv_Intro signing key`. Keep a second copy somewhere safe. If the key is lost, the app has to be uninstalled and installed fresh.

## Test on the real phones

1. Save a contact: it appears within seconds, stored on the phone with no account, as "Name, Place".
2. Save a number already on the phone: no second contact, and the page shows the existing name.
3. Airplane mode, Save, reconnect: it saves.
4. Restart the phone: the app comes back by itself.
5. Leave the phone idle overnight, then Save. If this is slow, try holding a partial wake lock in `IntroService`, which uses a little more battery.
6. Send to a test number: a smile, folded hands and the card arrive from 80928 50954.
7. Send to a number not on WhatsApp: the page says "Not on WhatsApp".
8. Check the shop's other apps still work, because the login check in `convex/lib/guarded.ts` changed.

## Not decided or not done

- A customer sent the intro who later gets a bill with the counter's new-number option ticked is greeted again. The bills' greeting and this one do not know about each other yet.
- Bills and guarantee cards already hold names and numbers, so they could use the same Save later.
- Rows are kept, not deleted, because they are what stops a second card going to the same customer.
