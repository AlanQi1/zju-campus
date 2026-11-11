#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把单张图片 OCR 成文字，输出 JSON 到指定文件（或 stdout）。

用法：
    python scripts/ocr-image.py <图片> [输出 json]

输出结构：
    {"engine": "rapidocr", "file": "...", "lines": ["..."], "boxes": [{"text","score","box"}]}

依赖：pip install rapidocr-onnxruntime
"""
import json
import os
import sys

# Windows 控制台默认 GBK，往 Node 里回传 JSON 会乱码——强制 UTF-8。
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass


def main():
    if len(sys.argv) < 2:
        print('用法：python scripts/ocr-image.py <图片> [输出 json]', file=sys.stderr)
        return 2
    src = sys.argv[1]
    if not os.path.isfile(src):
        print(f'图片不存在：{src}', file=sys.stderr)
        return 1
    out = sys.argv[2] if len(sys.argv) > 2 else ''

    from rapidocr_onnxruntime import RapidOCR

    engine = RapidOCR()
    result, _ = engine(src)

    lines = []
    boxes = []
    for item in result or []:
        text = str(item[1]).strip()
        if not text:
            continue
        lines.append(text)
        score = float(item[2]) if len(item) > 2 and item[2] is not None else None
        box = item[0] if item else None
        boxes.append({'text': text, 'score': score, 'box': box})

    payload = {
        'engine': 'rapidocr',
        'file': os.path.basename(src),
        'lines': lines,
        'boxes': boxes,
    }
    text = json.dumps(payload, ensure_ascii=False)
    if out:
        with open(out, 'w', encoding='utf-8') as fp:
            fp.write(text)
        print(json.dumps({'ok': True, 'lines': len(lines), 'out': out}, ensure_ascii=False))
    else:
        sys.stdout.write(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
