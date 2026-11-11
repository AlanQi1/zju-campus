"""OCR 指定页范围的 PDF，输出为逐页文本。
用法：python ocr_pages.py <pdf> <start> <end> [--dpi 200] [--out 目录]
页号从 1 开始，含端点。
"""
import sys, os, io, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import fitz
from PIL import Image
import numpy as np
from rapidocr_onnxruntime import RapidOCR

pdf = sys.argv[1]
start = int(sys.argv[2])
end = int(sys.argv[3])
dpi = 200
out_dir = None
args = sys.argv[4:]
for i, a in enumerate(args):
    if a == '--dpi':
        dpi = int(args[i+1])
    if a == '--out':
        out_dir = args[i+1]

engine = RapidOCR()
doc = fitz.open(pdf)
if out_dir:
    os.makedirs(out_dir, exist_ok=True)

for pno in range(start, min(end, doc.page_count) + 1):
    page = doc[pno - 1]
    pix = page.get_pixmap(dpi=dpi)
    img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    res, _ = engine(np.array(img))
    lines = []
    if res:
        # res: [box, text, score]
        items = sorted(res, key=lambda r: (min(p[1] for p in r[0]), min(p[0] for p in r[0])))
        for box, text, score in items:
            lines.append(text)
    text = "\n".join(lines)
    header = f"===== PAGE {pno} ====="
    print(header)
    print(text)
    if out_dir:
        with open(os.path.join(out_dir, f"p{pno:03d}.txt"), "w", encoding="utf8") as f:
            f.write(header + "\n" + text + "\n")
