"""
The trained page finder, made ready for the phone.

    python export.py <model dir> <app public dir>

Writes page-finder.onnx (what onnxruntime-web runs in finder.worker.js) and
checks it answers as the trained network does.
"""
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch

from data import H, W
from train import PageFinder

model_dir, public = Path(sys.argv[1]), Path(sys.argv[2])
model = PageFinder(pretrained=False)
model.load_state_dict(torch.load(model_dir / 'page-finder.pt', map_location='cpu'))
model.eval()

dest = public / 'page-finder.onnx'
x = torch.randn(1, 3, H, W)
torch.onnx.export(model, x, str(dest), input_names=['image'], output_names=['page'], opset_version=17, dynamo=False)

with torch.no_grad():
    want = model(x).numpy()
got = ort.InferenceSession(str(dest), providers=['CPUExecutionProvider']).run(None, {'image': x.numpy()})[0]
agree = ((want > 0) == (got > 0)).mean()
print(f'{dest.name}: {dest.stat().st_size / 1e6:.1f} MB, same answer on {agree * 100:.2f}% of pixels, largest difference {np.abs(want - got).max():.2e}')
