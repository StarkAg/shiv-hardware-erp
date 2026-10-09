"""DocAligner's heatmap models on every shop photo. The photo gets a black
border first, so a corner just off the frame can still be found; corners come
back as fractions of the photo. Writes docaligner.json."""
import json
import os
import time

import cv2
import numpy as np
from docaligner import DocAligner

PHOTOS = '../work/photos'
CFGS = ['lcnet100', 'fastvit_t8', 'fastvit_sa24']


def order(q):
    """Top-left first, then clockwise (image y points down)."""
    c = q.mean(0)
    ang = np.arctan2(q[:, 1] - c[1], q[:, 0] - c[0])
    q = q[np.argsort(ang)]
    first = np.argmin(q.sum(1))
    return np.roll(q, -first, 0)


files = sorted([f for f in os.listdir(PHOTOS) if f.endswith('.jpg')], key=lambda f: int(f[1:-4]))
out = {f: {} for f in files}
for cfg in CFGS:
    model = DocAligner(model_cfg=cfg)
    spent = 0
    for f in files:
        img = cv2.imread(os.path.join(PHOTOS, f))
        h, w = img.shape[:2]
        p = int(0.12 * max(h, w))
        pad = cv2.copyMakeBorder(img, p, p, p, p, cv2.BORDER_CONSTANT, value=(0, 0, 0))
        t = time.time()
        q = np.asarray(model(pad), dtype=np.float64)
        spent += time.time() - t
        if q.shape != (4, 2):
            out[f][cfg] = None
            continue
        q = order(q - p)
        out[f][cfg] = [{'x': float(x / w), 'y': float(y / h)} for x, y in q]
    found = sum(1 for f in files if out[f][cfg])
    print(f'{cfg}: found {found}/{len(files)}, {spent / len(files) * 1000:.0f} ms/photo', flush=True)
json.dump(out, open('out/docaligner.json', 'w'))
