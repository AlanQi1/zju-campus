"""OCR 单张图片并输出文字+中心坐标（用于判断图中标注位置）。
用法：python ocr_boxes.py <图片路径> [--min-score 0.3]
"""
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

path = sys.argv[1]
engine = RapidOCR()
img = Image.open(path).convert('RGB')
w, h = img.size
res, _ = engine(np.array(img))
print(f"# {path}  size={w}x{h}")
rows = []
if res:
    for box, text, score in res:
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        cx, cy = sum(xs) / 4, sum(ys) / 4
        rows.append((cy, cx, text, score, min(xs), max(xs), min(ys), max(ys)))
rows.sort()
for cy, cx, text, score, x0, x1, y0, y1 in rows:
    fx, fy = cx / w, cy / h
    print(f"({fx:.2f},{fy:.2f}) score={score} box=[{x0:.0f},{y0:.0f},{x1:.0f},{y1:.0f}] {text}")
