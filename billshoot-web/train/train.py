"""
Teach the page finder: which pixels of a phone photo are the bill page.

    python train.py <data dir> <out dir> [rounds]

A small network on the phone-sized MobileNetV3 (already taught to see on
ImageNet), with a light decoder that draws the page back at full size. It
learns from practice photos (data.py), which come with exact answers, and is
saved as page-finder.onnx for the phone (onnxruntime-web).
"""
import json
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader
from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small

from data import H, W, Practice, portrait, to_tensor


class Up(nn.Module):
    def __init__(self, cin, cskip, cout):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(cin + cskip, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True),
            nn.Conv2d(cout, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True),
        )

    def forward(self, x, skip):
        x = F.interpolate(x, size=skip.shape[-2:], mode='bilinear', align_corners=False)
        return self.conv(torch.cat([x, skip], 1))


class PageFinder(nn.Module):
    # Where MobileNetV3-small's stages end: strides 2, 4, 8, 16, 32.
    TAPS = (0, 1, 3, 8, 12)

    def __init__(self, pretrained=True):
        super().__init__()
        self.enc = mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.DEFAULT if pretrained else None).features
        self.mid = nn.Sequential(nn.Conv2d(576, 96, 1, bias=False), nn.BatchNorm2d(96), nn.ReLU(inplace=True))
        self.up16 = Up(96, 48, 64)
        self.up8 = Up(64, 24, 48)
        self.up4 = Up(48, 16, 32)
        self.up2 = Up(32, 16, 16)
        self.head = nn.Conv2d(16, 1, 1)

    def forward(self, x):
        size = x.shape[-2:]
        skips = []
        for i, layer in enumerate(self.enc):
            x = layer(x)
            if i in self.TAPS:
                skips.append(x)
        s2, s4, s8, s16, s32 = skips
        y = self.up16(self.mid(s32), s16)
        y = self.up8(y, s8)
        y = self.up4(y, s4)
        y = self.up2(y, s2)
        return F.interpolate(self.head(y), size=size, mode='bilinear', align_corners=False)


def loss_fn(logits, target):
    bce = F.binary_cross_entropy_with_logits(logits, target)
    p = torch.sigmoid(logits)
    inter = (p * target).sum((1, 2, 3))
    dice = 1 - (2 * inter + 1) / (p.sum((1, 2, 3)) + target.sum((1, 2, 3)) + 1)
    return bce + dice.mean()


# Real photos the plain finder got wrong — a grey desk top, the rug, a second
# sheet — shown with the finder's current guess after every round. It never
# trains on them.
WATCH = [1, 11, 21, 61, 62, 102, 110, 140]


# The fastest thing to train on: an Nvidia card, a Mac's own graphics (M1–M4,
# "mps"), else the processor.
DEVICE = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'


def preview(model, data, out):
    tiles = []
    for i in WATCH:
        img = cv2.imread(str(data / 'backs' / f'b{i}.jpg'))
        if img is None:
            continue
        small = cv2.resize(portrait(img), (W, H), interpolation=cv2.INTER_AREA)
        with torch.no_grad():
            m = (model(to_tensor(small)[None].to(DEVICE))[0, 0] > 0).cpu().numpy().astype(np.uint8)
        big = cv2.resize(small, (W * 2, H * 2))
        tint = big.copy()
        tint[cv2.resize(m, (W * 2, H * 2), interpolation=cv2.INTER_NEAREST) > 0] = (60, 200, 60)
        big = cv2.addWeighted(big, 0.65, tint, 0.35, 0)
        cnts, _ = cv2.findContours(cv2.resize(m, (W * 2, H * 2), interpolation=cv2.INTER_NEAREST), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(big, cnts, -1, (0, 255, 0), 2)
        tiles.append(big)
    cv2.imwrite(str(out / 'preview.jpg'), np.hstack(tiles), [cv2.IMWRITE_JPEG_QUALITY, 85])


def one_thread(_):
    cv2.setNumThreads(1)
    torch.set_num_threads(1)


def main():
    data, out = Path(sys.argv[1]), Path(sys.argv[2])
    rounds = int(sys.argv[3]) if len(sys.argv) > 3 else 20
    out.mkdir(parents=True, exist_ok=True)
    # On the processor — measured on the shop PC (i5-1235U: 2 fast cores, 8
    # small) — six threads train fastest; more only fight each other, and two
    # helpers making practice photos keep to one thread each. With graphics
    # doing the training, the processor is free to make photos faster.
    torch.set_num_threads(6)
    helpers = 2 if DEVICE == 'cpu' else max(2, (os.cpu_count() or 4) - 2)
    print(f'training on {DEVICE}, {helpers} helpers making practice photos', flush=True)
    progress = {'rounds': rounds, 'per_round': 3200, 'steps': [], 'checks': [], 'started': time.time()}

    def tell():
        (out / 'progress.json').write_text(json.dumps(progress))
    torch.manual_seed(0)
    per_round = 3200
    steps_per_round = per_round // 24
    # One stream of practice photos for the whole run, each made fresh from its
    # own number, so the helpers start once (on Windows each start copies all
    # the photos over) and no photo repeats.
    train = Practice(data, rounds * per_round, real_share=0.0, seed=1)
    check = Practice(data, 256, real_share=0.0, seed=999)  # fixed practice photos, never trained on
    check_set = [check[i] for i in range(len(check))]
    model = PageFinder().to(DEVICE)
    enc = list(model.enc.parameters())
    rest = [p for n, p in model.named_parameters() if not n.startswith('enc.')]
    opt = torch.optim.AdamW([{'params': enc, 'lr': 6e-4}, {'params': rest, 'lr': 2e-3}], weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=[6e-4, 2e-3], total_steps=rounds * steps_per_round, pct_start=0.1)
    loader = DataLoader(train, batch_size=24, num_workers=helpers, drop_last=True, worker_init_fn=one_thread, prefetch_factor=4, persistent_workers=True)
    best = 0
    step = 0
    preview(model.eval(), data, out)
    tell()
    model.train()
    t0, seen, total = time.time(), 0, 0.0
    for x, y in loader:
        x, y = x.to(DEVICE), y.to(DEVICE)
        loss = loss_fn(model(x), y)
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        total += loss.item() * len(x)
        seen += len(x)
        step += 1
        if step % 10 == 0:
            progress['steps'].append([step, round(total / seen, 4), round(time.time() - progress['started'])])
            tell()
        if step % steps_per_round:
            continue
        r = step // steps_per_round
        model.eval()
        inter = union = 0
        with torch.no_grad():
            for k in range(0, len(check_set), 32):
                xb = torch.stack([c[0] for c in check_set[k:k + 32]]).to(DEVICE)
                yb = torch.stack([c[1] for c in check_set[k:k + 32]]).to(DEVICE)
                pb = (model(xb) > 0).float()
                inter += (pb * yb).sum().item()
                union += ((pb + yb) > 0).float().sum().item()
        iou = inter / union
        print(f'round {r}/{rounds}  loss {total / seen:.4f}  check IoU {iou:.4f}  {time.time() - t0:.0f}s', flush=True)
        if iou > best:
            best = iou
            torch.save({k: v.cpu() for k, v in model.state_dict().items()}, out / 'page-finder.pt')
        preview(model, data, out)
        progress['checks'].append([r, round(iou, 4), round(time.time() - progress['started'])])
        tell()
        model.train()
        t0, seen, total = time.time(), 0, 0.0
    print('best check IoU', round(best, 4))


if __name__ == '__main__':
    main()
