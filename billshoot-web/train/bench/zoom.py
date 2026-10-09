"""One photo, large, with every finder's corners in its own colour, for close
calls. Usage: python zoom.py a62 a102 ... -> zoom.jpg (side by side)."""
import json
import sys

import cv2
import numpy as np

js = json.load(open('out/js.json'))
da = json.load(open('out/docaligner.json'))
COLS = [('app', (0, 0, 255), lambda f: js[f]['app']),
        ('ours', (0, 140, 255), lambda f: js[f]['ours']),
        ('scanic', (255, 0, 255), lambda f: js[f]['scanic']['corners'] if js[f]['scanic']['score'] >= 0.5 else None),
        ('DAs', (255, 255, 0), lambda f: da[f]['lcnet100']),
        ('DAm', (255, 0, 0), lambda f: da[f]['fastvit_t8']),
        ('DAl', (0, 200, 0), lambda f: da[f]['fastvit_sa24'])]
H = 760
out = []
for name in sys.argv[1:]:
    f = name + '.jpg'
    img = cv2.imread(f'../work/photos/{f}')
    h, w = img.shape[:2]
    W = int(w * H / h)
    pad = 40
    c = cv2.copyMakeBorder(cv2.resize(img, (W, H)), pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    for i, (label, col, get) in enumerate(COLS):
        q = get(f)
        if q:
            pts = np.int32([[pad + p['x'] * W, pad + p['y'] * H] for p in q])
            cv2.polylines(c, [pts], True, col, 2)
        cv2.putText(c, label + ('' if q else ' -'), (pad + i * 70, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.6, col, 2)
    cv2.putText(c, name, (pad, H + pad + 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    out.append(c)
hmax = max(o.shape[0] for o in out)
cv2.imwrite('out/zoom.jpg', np.hstack([cv2.copyMakeBorder(o, 0, hmax - o.shape[0], 0, 10, cv2.BORDER_CONSTANT, value=(255, 255, 255)) for o in out]))
