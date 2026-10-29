#!/usr/bin/env python3
"""
Re-save the stored bill photos as WebP at quality 80, same size, and point
the books at the copies (convex/photoSwap.ts).

    python3 -I scripts/compress-photos.py convert <export.zip> <workdir>
    python3 -I scripts/compress-photos.py upload  <workdir>
    python3 -I scripts/compress-photos.py swap    <workdir>
    python3 -I scripts/compress-photos.py check   <workdir>
    python3 -I scripts/compress-photos.py delete  <workdir>

<export.zip> is `npx convex export --prod --include-file-storage`: the
originals, kept as the backup. Each step writes its result into <workdir>
(pairs.json) and can be run again; nothing is deleted until `delete`, and the
server refuses to delete a file anything still points at.

The camera's rotation is applied before saving, because WebP from here
carries no EXIF and a phone photo would otherwise arrive on its side. A copy
is only kept when it is at least 15% smaller.
"""
import json
import os
import subprocess
import sys
import urllib.request
import zipfile
from io import BytesIO

from PIL import Image, ImageOps

QUALITY = 80
MIN_SAVING = 0.15
TABLES = ['vouchers', 'bills', 'billFlows', 'trash', 'workshopJobs', 'billsTrash', 'voucherInbox', 'guaranteeClaims']
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(fn, args):
    out = subprocess.run(['npx', 'convex', 'run', '--prod', fn, json.dumps(args)],
                         cwd=REPO, capture_output=True, text=True)
    if out.returncode:
        raise SystemExit(f'{fn} failed: {out.stderr[-600:]}')
    return json.loads(out.stdout)


def load(work):
    path = os.path.join(work, 'pairs.json')
    return json.load(open(path)) if os.path.exists(path) else {}


def save(work, pairs):
    json.dump(pairs, open(os.path.join(work, 'pairs.json'), 'w'), indent=1)


def convert(zip_path, work):
    os.makedirs(os.path.join(work, 'webp'), exist_ok=True)
    pairs = load(work)
    z = zipfile.ZipFile(zip_path)
    docs = [json.loads(l) for l in z.read('_storage/documents.jsonl').splitlines() if l.strip()]
    names = {os.path.basename(n).split('.')[0]: n for n in z.namelist() if n.startswith('_storage/') and not n.endswith('.jsonl')}
    before = after = kept = 0
    for d in docs:
        sid, kind = d['_id'], d.get('contentType') or ''
        if kind not in ('image/jpeg', 'image/png') or sid in pairs:
            continue
        raw = z.read(names[sid])
        img = ImageOps.exif_transpose(Image.open(BytesIO(raw)))
        if img.mode not in ('RGB', 'L'):
            img = img.convert('RGB')
        buf = BytesIO()
        img.save(buf, 'WEBP', quality=QUALITY, method=6)
        small = buf.getvalue()
        before += len(raw)
        if len(small) > len(raw) * (1 - MIN_SAVING):
            after += len(raw)
            continue
        after += len(small)
        kept += 1
        open(os.path.join(work, 'webp', sid + '.webp'), 'wb').write(small)
        pairs[sid] = {'from': sid, 'size': len(raw), 'newSize': len(small)}
    save(work, pairs)
    print(f'{kept} photos converted: {before / 1e6:.1f} MB -> {after / 1e6:.1f} MB')


def upload(work):
    pairs = load(work)
    todo = [p for p in pairs.values() if not p.get('to')]
    print(f'{len(todo)} to upload')
    while todo:
        batch, todo = todo[:50], todo[50:]
        urls = run('photoSwap:uploadUrls', {'count': len(batch)})
        for p, url in zip(batch, urls):
            body = open(os.path.join(work, 'webp', p['from'] + '.webp'), 'rb').read()
            req = urllib.request.Request(url, data=body, method='POST', headers={'Content-Type': 'image/webp'})
            p['to'] = json.load(urllib.request.urlopen(req, timeout=120))['storageId']
        save(work, pairs)
        print(f'  {sum(1 for p in pairs.values() if p.get("to"))} uploaded')


def swap(work):
    pairs = [{'from': p['from'], 'to': p['to']} for p in load(work).values() if p.get('to')]
    for table in TABLES:
        cursor, changed = None, 0
        while True:
            r = run('photoSwap:apply', {'table': table, 'pairs': pairs, 'cursor': cursor})
            changed += r['changed']
            if r['done']:
                break
            cursor = r['cursor']
        print(f'{table}: {changed} changed')


def check(work):
    olds = [p['from'] for p in load(work).values() if p.get('to')]
    news = [p['to'] for p in load(work).values() if p.get('to')]
    for table in TABLES:
        o = run('photoSwap:references', {'ids': olds, 'table': table})
        n = run('photoSwap:references', {'ids': news, 'table': table})
        print(f'{table}: old {o}, new {n}')


def delete(work):
    pairs = load(work)
    olds = [p['from'] for p in pairs.values() if p.get('to') and not p.get('deleted')]
    while olds:
        batch, olds = olds[:100], olds[100:]
        run('photoSwap:remove', {'ids': batch})
        for sid in batch:
            pairs[sid]['deleted'] = True
        save(work, pairs)
        print(f'  deleted {len(batch)}')


if __name__ == '__main__':
    step = sys.argv[1]
    {'convert': lambda: convert(sys.argv[2], sys.argv[3]),
     'upload': lambda: upload(sys.argv[2]),
     'swap': lambda: swap(sys.argv[2]),
     'check': lambda: check(sys.argv[2]),
     'delete': lambda: delete(sys.argv[2])}[step]()
