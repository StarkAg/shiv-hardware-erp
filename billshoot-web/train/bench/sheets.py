"""Contact sheets for grading by eye: each row one photo, each column one
finder's corners drawn on it (a red X where it found nothing). 5 photos per
sheet, written to sheets/NN.jpg, with the photo order in sample.json."""
import json
import os
import random

import cv2
import numpy as np

import sys
sys.path.insert(0, '..')
from data import BAD  # photos prep set aside as not usable

js = json.load(open('out/js.json'))
da = json.load(open('out/docaligner.json'))
WATCH = [1, 11, 21, 61, 62, 102, 110, 140]
COLS = [('app now', lambda f: js[f]['app']),
        ('ours', lambda f: js[f]['ours']),
        ('scanic', lambda f: js[f]['scanic']['corners'] if js[f]['scanic']['score'] >= 0.5 else None),
        ('DA small', lambda f: da[f]['lcnet100']),
        ('DA medium', lambda f: da[f]['fastvit_t8']),
        ('DA large', lambda f: da[f]['fastvit_sa24'])]

rest = [n for n in range(1, 251) if n not in WATCH and n not in BAD]
random.Random(7).shuffle(rest)
sample = [f'a{n}.jpg' for n in WATCH + rest[:52]]
json.dump(sample, open('out/sample.json', 'w'))

TH = 300
os.makedirs('out/sheets', exist_ok=True)
for s in range(0, len(sample), 4):
    rows = []
    for k, f in enumerate(sample[s:s + 4]):
        img = cv2.imread(f'../work/photos/{f}')
        h, w = img.shape[:2]
        tw = int(w * TH / h)
        base = cv2.resize(img, (tw, TH))
        cells = []
        for name, get in COLS:
            c = base.copy()
            q = get(f)
            if q:
                pts = np.int32([[p['x'] * tw, p['y'] * TH] for p in q])
                cv2.polylines(c, [pts], True, (0, 255, 0), 2)
                for p in pts:
                    cv2.circle(c, tuple(int(v) for v in p), 4, (0, 0, 255), -1)
            else:
                cv2.line(c, (10, 10), (tw - 10, TH - 10), (0, 0, 255), 4)
                cv2.line(c, (tw - 10, 10), (10, TH - 10), (0, 0, 255), 4)
            cv2.rectangle(c, (0, 0), (tw, 22), (0, 0, 0), -1)
            cv2.putText(c, f'{s + k + 1}:{f[:-4]} {name}', (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
            cells.append(cv2.copyMakeBorder(c, 3, 3, 3, 3, cv2.BORDER_CONSTANT, value=(255, 255, 255)))
        row = np.hstack(cells)
        rows.append(row)
    wmax = max(r.shape[1] for r in rows)
    rows = [cv2.copyMakeBorder(r, 0, 0, 0, wmax - r.shape[1], cv2.BORDER_CONSTANT, value=(255, 255, 255)) for r in rows]
    cv2.imwrite(f'out/sheets/{s // 4 + 1:02d}.jpg', np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 82])
print(len(sample), 'photos,', (len(sample) + 3) // 4, 'sheets')
