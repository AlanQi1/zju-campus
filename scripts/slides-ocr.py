#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把一节课的课件截图批量 OCR 成文字，供笔记生成使用。

用法：
    python scripts/slides-ocr.py <课件目录> [输出 json]

输出结构：
    {"generatedAt": "...", "engine": "rapidocr", "pages": [{"file": "ppt-001.jpg", "lines": ["..."]}]}

依赖：pip install rapidocr-onnxruntime
"""
import json
import os
import sys
import time
from datetime import datetime, timezone

IMAGE_EXT = {'.jpg', '.jpeg', '.png', '.webp', '.bmp'}


def main():
    if len(sys.argv) < 2:
        print('用法：python scripts/slides-ocr.py <课件目录> [输出 json]', file=sys.stderr)
        return 1
    src = sys.argv[1]
    if not os.path.isdir(src):
        print(f'目录不存在：{src}', file=sys.stderr)
        return 1
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(src, 'ocr.json')

    files = sorted(
        name for name in os.listdir(src) if os.path.splitext(name)[1].lower() in IMAGE_EXT
    )
    if not files:
        print('目录里没有图片', file=sys.stderr)
        return 1

    from rapidocr_onnxruntime import RapidOCR

    engine = RapidOCR()
    pages = []
    started = time.time()
    for index, name in enumerate(files, 1):
        path = os.path.join(src, name)
        try:
            result, _ = engine(path)
        except Exception as error:  # 单张失败不影响整体
            print(f'[warn] {name}: {error}', file=sys.stderr)
            result = None
        lines = []
        for item in result or []:
            text = str(item[1]).strip()
            if text:
                lines.append(text)
        pages.append({'file': name, 'lines': lines})
        print(f'[{index}/{len(files)}] {name} → {len(lines)} 行', file=sys.stderr)

    payload = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'engine': 'rapidocr',
        'pages': pages,
    }
    with open(out, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1)
    print(f'完成：{len(pages)} 页，用时 {time.time() - started:.1f}s → {out}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
