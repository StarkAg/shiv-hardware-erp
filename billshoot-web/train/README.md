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
cd billshoot-web/train
python3 -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# a device key for the shop's Convex, once per machine (from shiv-panel/):
#   npx convex run --prod devices:issueServerKey '{"name":"Training Mac"}'
export SHIV_DEVICE_TOKEN=...                            # or put it in print-server/.env.local
node fetch.cjs work/photos                              # the bill photos, from the books
python prep.py work/photos work/data                    # pages, backgrounds
node dashboard/serve.cjs work/model &                   # watch it learn: http://localhost:5198
python train.py work/data work/model 20                 # 20 rounds of 3,200 practice photos
python export.py work/model ../public                   # → ../public/page-finder.onnx
```

Then build and deploy the app (`npm run deploy` in billshoot-web).

`train.py` saves the best round to `work/model/page-finder.pt`; the
dashboard shows the learning curve and the finder's guess on eight hard real
photos it never trains on (`WATCH` in train.py).
