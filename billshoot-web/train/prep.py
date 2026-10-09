"""
Material for teaching Bill Shoot to find the page, from the shop's own bill photos.

    python prep.py <photos dir> <out dir>

<photos dir> holds a1.jpg … (fetch.cjs downloads them from the books);
labels.json, beside this file, holds for each photo the corners found by the
plain detector (a) and the edge-checked one (b), as fractions (worked out in
the browser with src/crop.js).

Out come three things:
  pages/      the page cut out of every photo where both detectors agree to
              within 2% (so the outline can be trusted), straightened; plus
              screenshots and PDF pages, which are a page already
  backs/      every real photo (not the screenshots), to paste pages onto —
              the rug, the grey desk, the wood table, as the shop shoots on
  real.json   the trusted photos with their corners, to train on as they are
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

photos, out = map(Path, sys.argv[1:3])
(out / 'pages').mkdir(parents=True, exist_ok=True)
(out / 'backs').mkdir(parents=True, exist_ok=True)

found = {p['n']: p for p in json.loads((Path(__file__).parent / 'labels.json').read_text())['photos']}


def agree(a, b):
    if not a or not b:
        return False
    return max(abs(p['x'] - q['x']) + abs(p['y'] - q['y']) for p, q in zip(a, b)) < 0.02


def flatten(img, corners, long_side=1000):
    h, w = img.shape[:2]
    q = np.float32([[c['x'] * w, c['y'] * h] for c in corners])
    pw = max(np.linalg.norm(q[0] - q[1]), np.linalg.norm(q[3] - q[2]))
    ph = max(np.linalg.norm(q[0] - q[3]), np.linalg.norm(q[1] - q[2]))
    s = min(1.0, long_side / max(pw, ph))
    pw, ph = int(pw * s), int(ph * s)
    m = cv2.getPerspectiveTransform(q, np.float32([[0, 0], [pw, 0], [pw, ph], [0, ph]]))
    return cv2.warpPerspective(img, m, (pw, ph), flags=cv2.INTER_AREA)


real = []
pages = backs = screens = 0
for i in sorted(found):
    img = cv2.imread(str(photos / f'a{i}.jpg'))
    if img is None:
        continue
    row = found[i]
    # A screenshot or PDF page: no table round it, and almost all of it white.
    lo = img.min(axis=2)
    if not row['a'] and not row['b'] and (lo > 200).mean() > 0.6:
        page = img if max(img.shape[:2]) <= 1000 else cv2.resize(img, None, fx=1000 / max(img.shape[:2]), fy=1000 / max(img.shape[:2]), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(out / 'pages' / f's{i}.jpg'), page, [cv2.IMWRITE_JPEG_QUALITY, 92])
        screens += 1
        continue
    small = cv2.resize(img, None, fx=900 / max(img.shape[:2]), fy=900 / max(img.shape[:2]), interpolation=cv2.INTER_AREA) if max(img.shape[:2]) > 900 else img
    cv2.imwrite(str(out / 'backs' / f'b{i}.jpg'), small, [cv2.IMWRITE_JPEG_QUALITY, 90])
    backs += 1
    if agree(row['a'], row['b']):
        cv2.imwrite(str(out / 'pages' / f'p{i}.jpg'), flatten(img, row['b']), [cv2.IMWRITE_JPEG_QUALITY, 92])
        real.append({'file': f'b{i}.jpg', 'corners': row['b']})
        pages += 1

(out / 'real.json').write_text(json.dumps(real))
print(f'pages {pages} cut out, {screens} screens, {backs} backgrounds, {len(real)} real labelled')
