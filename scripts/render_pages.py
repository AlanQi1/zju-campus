"""渲染 PDF 指定页为 PNG。
用法：python render_pages.py <pdf> <start> <end> [--dpi 150] [--out 目录]
"""
import sys, os
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import fitz

pdf, start, end = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
dpi, out_dir = 150, '.'
args = sys.argv[4:]
for i, a in enumerate(args):
    if a == '--dpi': dpi = int(args[i+1])
    if a == '--out': out_dir = args[i+1]
os.makedirs(out_dir, exist_ok=True)
doc = fitz.open(pdf)
for pno in range(start, min(end, doc.page_count) + 1):
    pix = doc[pno - 1].get_pixmap(dpi=dpi)
    p = os.path.join(out_dir, f"p{pno:03d}.png")
    pix.save(p)
    print(p)
