# General task intake

This pipeline sends any shop task to the existing Codex chat and returns its answer to the local website. Images are optional. It uses no separate AI API. The website is a local front end to `codex queue`; the chat uses the tools and CLIs available for the requested job. The site runs only on `127.0.0.1`, on the computer running Codex. The installed `codex queue` accepts text only, so the message gives this chat the paths of any images saved locally; the chat reads those files with `view_image`.

## Start the site

```bash
npm run sync
npm run intake -- serve --thread <this-chat-uuid>
```

Open `http://127.0.0.1:8787`. Write the task and optionally attach up to 12 images. The site saves the images locally and queues their paths with the message to the chosen Codex chat. It then waits for the chat to finish and report back through the CLI. Closing the page does not erase the request; the latest request is shown again on this computer.

The files and replies live in `.intake/jobs/` and are ignored by Git. Keep the Codex desktop app and this CLI server running while using the site. The website does not expose a remote endpoint or copy AI credentials to the browser.

## CLI intake without the site

```bash
npm run intake -- submit --thread <this-chat-uuid> --note "Check why yesterday's stock total changed"
npm run intake -- submit --thread <this-chat-uuid> --image /absolute/path/invoice.jpg --note "Record this supplier invoice if missing"
npm run intake -- status --id <request-uuid>
npm run intake -- retry --id <failed-request-uuid>
```

## Purchase and payment helper

For a purchase or payment task, the chat interprets the documents and prepares a manifest. The same CLI checks the math and references before posting:

```bash
npm run intake -- validate --manifest /absolute/path/intake.json
npm run intake -- post --manifest /absolute/path/intake.json
npm run intake -- reply --id <request-uuid> --text "Posted invoices 151 and 153; closing balance INR 23,904 Cr."
```

`post` writes each purchase or payment as one bill and one voucher, attaches its photo, then reads back the supplier balance. An existing bill with the same party, kind, date and supplier reference is skipped if its amount matches; a conflicting amount stops the run. If a batch stops after some entries, rerun the same manifest to finish it. A payment requires its own dated amount, method and reference; an amount marked **due** is never a payment. Other tasks are handled in this chat with the tools and CLIs appropriate to that task.

The site and `submit` command are not limited to purchases. They accept a text-only task or images of any shop document. `validate` and `post` are the purchase/payment helper within the same CLI, used only for those accounting tasks.

## Manifest

```json
{
  "requestId": "optional-site-request-uuid",
  "supplier": "M/s Shri Murli Plywood, RMG (Grace)",
  "purchases": [
    {
      "ref": "162",
      "date": "2026-09-29",
      "total": 2100,
      "photo": "/absolute/path/invoice-162.jpg",
      "items": [
        { "description": "GRACE 19MM MR 5X3", "qty": 2, "unit": "Pc", "sqft": 15, "sqftRate": 70, "amount": 2100 }
      ]
    }
  ]
}
```

`total` must equal the sum of every line. Add a `payments` array only when there is payment evidence. Each payment needs `ref`, `date`, `amount`, `mode` (`cash`, `online`, or `upi`), and optionally `photo`. The supplier must already have an account under Sundry Creditors so a misspelled name cannot silently create another one.
