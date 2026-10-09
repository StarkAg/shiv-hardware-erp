"""
Practice photos for the page finder, made from the shop's own material
(see prep.py): a cut-out bill page pasted onto a real photo of the counter,
at a slant, with the light, shadow, blur and phone-camera grain a real shot
has. Each comes with its answer — exactly which pixels are the page — so
any number can be made. Real photos whose outline is trusted are mixed in.

Pasting onto real photos, rather than plain textures, also teaches the
finder what to ignore: those photos already hold a bill, a rug, a grey desk
top, a second sheet peeking out — and only the pasted page is "the page".
"""
import json
from pathlib import Path

import cv2
import numpy as np
import torch
from torch.utils.data import Dataset

H, W = 256, 192  # what the finder looks at: a phone photo, portrait, made small

# Cut-outs found, by looking at them, to have table or a second sheet inside.
BAD = {4, 14, 28, 44, 89, 102, 110, 113, 128, 129, 158, 172, 177, 201, 202, 224, 229, 240}

MEAN = np.float32([0.485, 0.456, 0.406])
STD = np.float32([0.229, 0.224, 0.225])


def page_alpha(page):
    """Which pixels of a cut-out are paper: table showing past a torn or curled
    edge, reached from the border, is not."""
    h, w = page.shape[:2]
    lo = page.min(axis=2).astype(np.int16)
    hi = page.max(axis=2).astype(np.int16)
    paper_level = np.percentile(lo, 70)
    not_paper = ((lo < paper_level * 0.62) | (hi - lo > 60)).astype(np.uint8)
    band = max(4, int(min(h, w) * 0.06))
    reach = np.zeros_like(not_paper)
    reach[:band, :] = reach[-band:, :] = 1
    reach[:, :band] = reach[:, -band:] = 1
    cand = not_paper & reach
    n, lab = cv2.connectedComponents(cand, connectivity=4)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    off = np.isin(lab, list(border))
    alpha = np.where(off, 0, 255).astype(np.uint8)
    return cv2.medianBlur(alpha, 5)


def squarish(corners, w, h, slack=22):
    """Whether every corner of an outline is within `slack` degrees of square.
    A page seen at the angles bills are shot at always is; an outline that ran
    off into a grey desk top or rug, ending on the photo's corner, is not."""
    q = np.float32([[c['x'] * w, c['y'] * h] for c in corners])
    for k in range(4):
        u, v = q[k - 1] - q[k], q[(k + 1) % 4] - q[k]
        cos = float(u @ v / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-9))
        if abs(np.degrees(np.arccos(np.clip(cos, -1, 1))) - 90) > slack:
            return False
    return True


def load(root):
    root = Path(root)
    real = json.loads((root / 'real.json').read_text())
    bad = set(BAD)
    for r in real:
        img = cv2.imread(str(root / 'backs' / r['file']))
        r['img'] = img
        if not squarish(r['corners'], img.shape[1], img.shape[0]):
            bad.add(int(r['file'][1:-4]))
    real = [r for r in real if int(r['file'][1:-4]) not in bad]
    pages = []
    for f in sorted((root / 'pages').glob('*.jpg')):
        if f.stem.startswith('p') and int(f.stem[1:]) in bad:
            continue
        img = cv2.imread(str(f))
        alpha = page_alpha(img) if f.stem.startswith('p') else np.full(img.shape[:2], 255, np.uint8)
        pages.append((img, alpha))
    backs = [cv2.imread(str(f)) for f in sorted((root / 'backs').glob('*.jpg'))]
    return pages, backs, real


def portrait(img):
    return img if img.shape[0] >= img.shape[1] else cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)


def crop_to_frame(img, rng, keep=(0.65, 1.0)):
    """A portrait 4:3 piece of a photo, as a phone frames it, made W×H. Returns it and the mapping used."""
    h, w = img.shape[:2]
    s = rng.uniform(*keep)
    ch = min(h, int(w * H / W)) * s
    cw = ch * W / H
    y0 = rng.uniform(0, h - ch)
    x0 = rng.uniform(0, w - cw)
    m = np.float32([[W / cw, 0, -x0 * W / cw], [0, H / ch, -y0 * H / ch]])
    return cv2.warpAffine(img, m, (W, H), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REFLECT), m


def light_and_camera(img, rng):
    """What a real shot does to a picture: uneven light, a shadow, a colour
    cast, blur, grain, phone JPEG."""
    out = img.astype(np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    a, b = rng.normal(0, 0.35, 2)
    grad = 1 + (a * (xx / W - 0.5) + b * (yy / H - 0.5))
    out *= (grad * rng.uniform(0.7, 1.15))[..., None]
    if rng.random() < 0.45:
        pts = (rng.random((rng.integers(3, 6), 2)) * [W * 1.4, H * 1.4] - [W * 0.2, H * 0.2]).astype(np.int32)
        shade = np.zeros((H, W), np.float32)
        cv2.fillPoly(shade, [pts], 1.0)
        shade = cv2.GaussianBlur(shade, (0, 0), rng.uniform(2, 12))
        out *= (1 - shade * rng.uniform(0.2, 0.5))[..., None]
    out *= rng.uniform(0.93, 1.07, 3)[None, None, :]
    out = np.clip(out, 0, 255)
    gamma = rng.uniform(0.75, 1.3)
    out = 255 * (out / 255) ** gamma
    if rng.random() < 0.6:
        out = cv2.GaussianBlur(out, (0, 0), rng.uniform(0.3, 1.3))
    out += rng.normal(0, rng.uniform(0, 7), out.shape)
    out = np.clip(out, 0, 255).astype(np.uint8)
    ok, enc = cv2.imencode('.jpg', out, [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(40, 95))])
    return cv2.imdecode(enc, cv2.IMREAD_COLOR)


def synthetic(pages, backs, rng):
    back, _ = crop_to_frame(portrait(backs[rng.integers(len(backs))]), rng, keep=(0.88, 1.0))
    if rng.random() < 0.5:
        back = cv2.flip(back, 1)
    page, alpha = pages[rng.integers(len(pages))]
    ph, pw = page.shape[:2]
    if rng.random() < 0.1:  # a bill photographed sideways
        page, alpha = cv2.rotate(page, cv2.ROTATE_90_CLOCKWISE), cv2.rotate(alpha, cv2.ROTATE_90_CLOCKWISE)
        ph, pw = pw, ph
    area = rng.uniform(0.3, 0.88) * W * H
    sw = np.sqrt(area * pw / ph)
    sh = area / sw
    cx = W / 2 + rng.normal(0, 0.1 if rng.random() < 0.8 else 0.25) * W
    cy = H / 2 + rng.normal(0, 0.1 if rng.random() < 0.8 else 0.25) * H
    ang = np.deg2rad(rng.normal(0, 8) if rng.random() < 0.85 else rng.uniform(-30, 30))
    rect = np.float32([[-sw / 2, -sh / 2], [sw / 2, -sh / 2], [sw / 2, sh / 2], [-sw / 2, sh / 2]])
    rot = np.float32([[np.cos(ang), -np.sin(ang)], [np.sin(ang), np.cos(ang)]])
    dst = rect @ rot.T + [cx, cy]
    # Perspective: the phone held not quite square over the counter.
    dst += rng.normal(0, 0.035, dst.shape) * [sw, sh]
    src = np.float32([[0, 0], [pw, 0], [pw, ph], [0, ph]])
    m = cv2.getPerspectiveTransform(src, dst.astype(np.float32))
    warped = cv2.warpPerspective(page, m, (W, H), flags=cv2.INTER_AREA)
    a = cv2.warpPerspective(alpha, m, (W, H), flags=cv2.INTER_LINEAR).astype(np.float32) / 255
    # A soft drop shadow under the paper, as it lies a hair above the counter.
    if rng.random() < 0.5:
        sh_a = cv2.GaussianBlur(np.roll(a, (int(rng.integers(1, 4)), int(rng.integers(-2, 3))), (0, 1)), (0, 0), 2)
        back = (back * (1 - 0.35 * sh_a[..., None])).astype(np.uint8)
    img = (back * (1 - a[..., None]) + warped * a[..., None]).astype(np.uint8)
    return light_and_camera(img, rng), (a > 0.5).astype(np.float32)


def real_sample(real, rng):
    r = real[rng.integers(len(real))]
    img = r['img']
    h, w = img.shape[:2]
    pts = np.float32([[c['x'] * w, c['y'] * h] for c in r['corners']])
    mask = np.zeros((h, w), np.uint8)
    cv2.fillPoly(mask, [pts.astype(np.int32)], 255)
    if h < w:
        img, mask = portrait(img), portrait(mask)
    crop, m = crop_to_frame(img, rng, keep=(0.85, 1.0))
    mk = cv2.warpAffine(mask, m, (W, H), flags=cv2.INTER_NEAREST)
    if rng.random() < 0.5:
        crop, mk = cv2.flip(crop, 1), cv2.flip(mk, 1)
    return light_and_camera(crop, rng), (mk > 127).astype(np.float32)


def to_tensor(img):
    x = (img[..., ::-1].astype(np.float32) / 255 - MEAN) / STD  # BGR → RGB, normalised
    return torch.from_numpy(x.transpose(2, 0, 1).copy())


class Practice(Dataset):
    """`n` practice photos a round, new ones every round."""

    def __init__(self, root, n, real_share=0.3, seed=0):
        self.pages, self.backs, self.real = load(root)
        self.n, self.real_share, self.seed = n, real_share, seed
        self.round = 0

    def __len__(self):
        return self.n

    def __getitem__(self, i):
        rng = np.random.default_rng((self.seed, self.round, i))
        if self.real and rng.random() < self.real_share:
            img, mask = real_sample(self.real, rng)
        else:
            img, mask = synthetic(self.pages, self.backs, rng)
        return to_tensor(img), torch.from_numpy(mask)[None]
