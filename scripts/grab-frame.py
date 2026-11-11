#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从直播 m3u8 抓一张「现在」的画面。

智云课堂直播流是 HLS，教室全景摄像头（黑板 + 投影 + 讲台）。
本脚本用 OpenCV 打开流，循环读帧丢弃缓冲，取最后一帧（=最新），
可选裁剪黑板区域并放大，便于 OCR 认手写数字。

用法：
    python scripts/grab-frame.py --url "https://.../xxx.m3u8?auth_key=..." --out shot.png
    python scripts/grab-frame.py --url ... --out board.png --mode board
    python scripts/grab-frame.py --url ... --out out.png --drain 4

stdout 只输出一行 JSON：{"ok":true,"file":...,"width":..,"height":..,"frames":N,"ms":..,"mode":".."}
"""
import argparse
import json
import os
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')


def fail(msg):
    print(json.dumps({'ok': False, 'error': str(msg)}, ensure_ascii=False))
    sys.exit(0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', required=True, help='m3u8 直播地址')
    ap.add_argument('--out', required=True, help='输出图片路径')
    ap.add_argument('--mode', default='full', choices=['full', 'board', 'slide'],
                    help='full=整幅画面；board=左侧黑板区；slide=右侧投影区')
    ap.add_argument('--drain', type=float, default=2.5, help='最多花多少秒把缓冲读新（取最后一帧）')
    ap.add_argument('--max-frames', type=int, default=400, help='最多读多少帧')
    ap.add_argument('--scale', type=float, default=2.0, help='裁剪后放大倍数')
    ap.add_argument('--enhance', action='store_true',
                    help='额外输出一张给 OCR 用的增强图（反相 + 局部对比 + 锐化），适合深色黑板上的白粉笔字')
    args = ap.parse_args()

    try:
        import cv2
    except Exception as exc:  # noqa: BLE001
        fail('本机没有 opencv-python（cv2）：%s' % exc)
        return

    out_path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)

    started = time.time()
    cap = cv2.VideoCapture(args.url)
    if not cap.isOpened():
        cap.release()
        fail('打不开直播流（链接可能已过期或需要重新登录）')
        return

    frame = None
    frames = 0
    deadline = started + max(0.5, args.drain)
    while frames < args.max_frames:
        ok, img = cap.read()
        if not ok or img is None:
            break
        frame = img
        frames += 1
        if time.time() >= deadline:
            break
    cap.release()

    if frame is None:
        fail('直播流打开了但一帧都读不到（老师可能还没开播）')
        return

    h, w = frame.shape[:2]
    if args.mode == 'board':
        # 黑板在画面左段（1920x1080 下约 x 180~830、y 190~620），右边紧挨着投影幕，不能越界
        crop = frame[int(h * 0.17):int(h * 0.585), int(w * 0.095):int(w * 0.432)]
    elif args.mode == 'slide':
        # 投影幕在画面中右段（约 x 835~1595、y 140~560）
        crop = frame[int(h * 0.13):int(h * 0.525), int(w * 0.434):int(w * 0.832)]
    else:
        crop = frame

    if args.mode != 'full' and args.scale > 1:
        crop = cv2.resize(crop, None, fx=args.scale, fy=args.scale, interpolation=cv2.INTER_CUBIC)

    # cv2.imwrite 在 Windows 上处理中文路径会失败，统一走 imencode + 自己写文件
    ok, buf = cv2.imencode('.png', crop, [int(cv2.IMWRITE_PNG_COMPRESSION), 3])
    if not ok:
        fail('PNG 编码失败')
        return
    try:
        with open(out_path, 'wb') as fh:
            fh.write(buf.tobytes())
    except OSError as exc:
        fail('写图片失败：%s（%s）' % (out_path, exc))
        return

    enhanced = None
    if args.enhance:
        enhanced = enhance_for_ocr(crop, out_path)

    print(json.dumps({
        'ok': True,
        'file': out_path,
        'enhanced': enhanced,
        'mode': args.mode,
        'width': int(crop.shape[1]),
        'height': int(crop.shape[0]),
        'sourceWidth': int(w),
        'sourceHeight': int(h),
        'frames': frames,
        'ms': int((time.time() - started) * 1000),
    }, ensure_ascii=False))


def enhance_for_ocr(crop, out_path):
    """黑板上是白粉笔字：反相成「浅底深字」，OCR 模型对这类图准得多。

    步骤：灰度 → 反相 → CLAHE 局部对比度 → 轻微锐化。写失败就返回 None，
    调用方照旧用原图 OCR。
    """
    try:
        import cv2
        import numpy as np
    except Exception:  # noqa: BLE001
        return None
    try:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
        inverted = cv2.bitwise_not(gray)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        boosted = clahe.apply(inverted)
        blur = cv2.GaussianBlur(boosted, (0, 0), 1.2)
        sharp = cv2.addWeighted(boosted, 1.6, blur, -0.6, 0)
        out = os.path.splitext(out_path)[0] + '-enh.png'
        ok, buf = cv2.imencode('.png', sharp, [int(cv2.IMWRITE_PNG_COMPRESSION), 3])
        if not ok:
            return None
        with open(out, 'wb') as fh:
            fh.write(buf.tobytes())
        return out
    except Exception:  # noqa: BLE001
        return None


if __name__ == '__main__':
    main()
