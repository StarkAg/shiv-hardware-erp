# Register layout v1 — frozen 2 September 2026

The Cash Book exactly as it stood before the register page was reworked to
match the paper copy (the 13/12/25 page, photographed again as IMG_5308).

`App.jsx` and `index.css` here are **verbatim copies**, not imports. Nothing in
the app reads this folder, so it cannot drift and cannot break a build — it is
here to be looked at, diffed, or copied back.

## What v1 did, and what v2 changed

| | v1 (this folder) | v2 (current `src/`) |
|---|---|---|
| Online highlight | PhonePe purple | highlighter yellow, as on paper |
| Online entries | written once, on their own side | written on **both** sides, so they cancel |
| Online in the tally | held out of it, shown on a separate line | none needed: it cancels inside the columns |
| Tally | labelled lines (Opening / Cash in / Cash out / Register / Counted) | the paper's bare subtraction stack |

v1's reasoning for holding online out of the tally is in its own comment in
`CashReport` — "none of it is in the drawer, so it can never join the arithmetic
the count is checked against". v2 reaches the same cash figure by the paper's
route instead: an online line is entered against itself, so the two columns
subtract to cash on their own.

## To restore

    cp layouts/v1/App.jsx layouts/v1/index.css src/

That is a whole-app revert, not just the register page — every other change made
after 2 Sep 2026 goes with it. To take back only the page, lift `CashReport` and
the `.page` block of the stylesheet.
