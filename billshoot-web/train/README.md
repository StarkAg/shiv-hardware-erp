# Bill Shoot page finder — training

A small network (MobileNetV3-small + light decoder, ~1.2M weights, ~5 MB)
that marks which pixels of a phone photo are the bill page. The app runs it
on the phone (`../src/finder.worker.js`, onnxruntime-web) and takes the four
corners from its mask (`cornersOfMask` in `../src/crop.js`).

It learns from practice photos (`data.py`): bill pages cut out of the shop's
own photos, pasted onto the shop's own photos (rug, grey desk, wood), at a
slant, with real light, shadow, blur and phone JPEG — each with an exact
answer. The bill photos themselves are not in git; `labels.json` lists them
by storage id with the corners two plain detectors found.

## On a new machine (Mac M1–M4 trains on its graphics, ~4–8× this PC)

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
python export.py work/model ../public                   # → ../public/page-finder.onnx
```

The first line `train.py` prints says what it trains on — `mps` on a Mac.
On the shop PC (processor only) a round took ~4 minutes; after 2 rounds the
practice check was at 90% and climbing, but real photos were not yet right —
it needs the full run.

Then build and deploy the app (`npm run deploy` in billshoot-web).

`train.py` saves the best round to `work/model/page-finder.pt`; the
dashboard shows the learning curve and the finder's guess on eight hard real
photos it never trains on (`WATCH` in train.py).
