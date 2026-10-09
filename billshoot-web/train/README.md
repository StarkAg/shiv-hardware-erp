# Bill Shoot page finder — training

**The app no longer runs the finder trained here.** It runs two ready-made
ones, chosen by the comparison below (`../src/finders.js`). This folder is kept
to train again, and to compare any new finder against the shop's own photos.

A small network (MobileNetV3-small + light decoder, ~1.2M weights, ~5 MB)
that marks which pixels of a phone photo are the bill page, with the four
corners taken from its mask (`cornersOfMask` in `../src/crop.js`).

It learns from practice photos (`data.py`): bill pages cut out of the shop's
own photos, pasted onto the shop's own photos (rug, grey desk, wood), at a
slant, with real light, shadow, blur and phone JPEG — each with an exact
answer. The bill photos themselves are not in git; `labels.json` lists them
by storage id with the corners two plain detectors found.

## Choosing the finder (October 2026)

Six finders were run on all 250 of the shop's photos and graded by eye on 60
of them (the eight hard `WATCH` photos and 52 at random): right, close (half),
or wrong, with "no page found" counting as the whole photo, as the app uses
it. `bench/grades.txt` holds the grades.

| finder | size | camera photos (52) | 8 hard ones | PDFs, screenshots (8) |
|---|---|---|---|---|
| plain light-and-edges (`findPage`, was live) | — | 40% | 0% | 100% |
| trained here, 40 rounds on the Mac | 4.8 MB | 28% | 0% | 56% |
| scanic DocCornerNet LEAN | 1.9 MB | 71% | 56% | 31% |
| DocAligner lcnet100 | 4.8 MB | 63% | 56% | 75% |
| DocAligner fastvit_t8 | 13 MB | 59% | 38% | 100% |
| DocAligner fastvit_sa24 | 83 MB | 67% | 62% | 100% |

They fail on different photos, so the app asks scanic and DocAligner lcnet100
and keeps the answer whose sides sit best on a real paper edge (`edgeSupport`):
**77% of camera photos, 100% of PDFs and screenshots**. scanic alone outlines
the page live. (scanic with the 83 MB DocAligner reached 83%, too big for a
phone.)

The finder trained here scored 98% on its own practice check but 28% on real
photos: it never saw one (`real_share=0.0`), and pasted pages are not enough.
What still goes wrong: a bill running out of the picture, and a second paper
lying over the bill's corner.

To compare again (photos fetched as below; `out/` is not in git):

```sh
cd bench && npm install && mkdir -p out
pip install docaligner-docsaid                # into train/.venv
node run-js.mjs                               # plain, trained, scanic → out/js.json
python run-docaligner.py                      # the three DocAligner models → out/docaligner.json
python sheets.py                              # out/sheets/*.jpg to grade by eye; zoom.py a62 a102 for close calls
node choose.mjs                               # scores from grades.txt, alone and in pairs
node check-finders.mjs                        # ../src/finders.js gives the graded answers, and its score
node web-check.mjs                            # the app's onnxruntime-web answers as onnxruntime-node does
```

## Training again, on a new machine (Mac M1–M4 trains on its graphics, ~4–8× the shop PC)

```sh
git pull
npm install                                             # in shiv-panel/: fetch.cjs uses its convex package
cd billshoot-web && npm install && cd train
python3 -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# A device key for the shop's Convex, once per machine. Either make one
# (from shiv-panel/, logged in to Convex):
#   npx convex run --prod devices:issueServerKey '{"name":"Training Mac"}'
# or copy the shop PC's from print-server/.env.local (SSH over Tailscale).
export SHIV_DEVICE_TOKEN=...
node fetch.cjs work/photos                              # the 250 bill photos, from the books
python prep.py work/photos work/data                    # pages, backgrounds
node dashboard/serve.cjs work/model &                   # watch it learn: http://localhost:5198
python train.py work/data work/model 40                 # 40 rounds of 3,200 practice photos
python export.py work/model work/model                  # → work/model/page-finder.onnx, for bench/
```

The first line `train.py` prints says what it trains on — `mps` on a Mac,
where a round takes about 20 seconds. Before training again, give it the real
photos (`real_share` in `train.py`, keeping `WATCH` out of them), and judge it
with `bench/`, not its practice check.

`train.py` saves the best round to `work/model/page-finder.pt`; the
dashboard shows the learning curve and the finder's guess on eight hard real
photos it never trains on (`WATCH` in train.py).
