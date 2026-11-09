#!/usr/bin/env python3
"""
ref-frames.py — 从原图 / 原视频里抽出关键帧并裁剪成"参考图"。

为什么需要它：
  原帖里能证明结论的画面（模型对比、界面截图、报错信息）不能重画，
  必须裁出来当参考图交给生图模型，成图才有真实感。
  手工截帧容易漏掉信息最全的那一帧，所以让脚本干。

用法：
  # 视频：抽第 6 秒的一帧，整帧输出
  python scripts/ref-frames.py --video src.mp4 --at 6 --out-dir refs/

  # 视频：抽第 6 秒，裁出上半屏（上下分屏对比图）
  python scripts/ref-frames.py --video src.mp4 --at 6 --split top --out-dir refs/
  python scripts/ref-frames.py --video src.mp4 --at 6 --split bottom --out-dir refs/

  # 指定裁剪框 x,y,w,h（像素）
  python scripts/ref-frames.py --video src.mp4 --at 6 --crop 0,0,1296,620 --name opus

  # 抽多个时间点
  python scripts/ref-frames.py --video src.mp4 --at 0,4,6,9.8 --split bottom

  # 直接裁原图
  python scripts/ref-frames.py --image poster.jpg --crop 120,300,800,600 --name poster-crop

依赖：opencv-python（pip install opencv-python）。没有 ffmpeg 也能用。
"""

from __future__ import annotations

import argparse
import os
import sys

try:
    import cv2
except ImportError:
    sys.exit("缺少 opencv。安装：pip install opencv-python")


def parse_crop(s: str | None):
    if not s:
        return None
    parts = [int(p) for p in s.replace(" ", "").split(",")]
    if len(parts) != 4:
        sys.exit("--crop 需要 4 个整数：x,y,w,h")
    return tuple(parts)


def clamp(x, y, w, h, width, height):
    """把裁剪框裁进画面内，避免越界出黑边。"""
    x = max(0, min(x, width - 1))
    y = max(0, min(y, height - 1))
    w = max(1, min(w, width - x))
    h = max(1, min(h, height - y))
    return x, y, w, h


def grab_frame(cap, seconds: float):
    cap.set(cv2.CAP_PROP_POS_MSEC, seconds * 1000)
    ok, frame = cap.read()
    if not ok:
        return None
    return frame


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", help="原视频路径")
    ap.add_argument("--image", help="原图路径")
    ap.add_argument("--at", default="0", help="时间点（秒），逗号分隔；或总时长的百分比，如 60%%")
    ap.add_argument("--crop", help="裁剪框 x,y,w,h")
    ap.add_argument("--split", choices=["top", "bottom"], help="按上下分屏裁一半")
    ap.add_argument("--name", default="ref", help="输出文件名前缀")
    ap.add_argument("--out-dir", default="refs", help="输出目录")
    ap.add_argument("--quality", type=int, default=95)
    args = ap.parse_args()

    if not args.video and not args.image:
        sys.exit("需要 --video 或 --image")

    os.makedirs(args.out_dir, exist_ok=True)
    crop = parse_crop(args.crop)

    if args.image:
        img = cv2.imread(args.image)
        if img is None:
            sys.exit(f"读不到图片：{args.image}")
        h, w = img.shape[:2]
        x, y, cw, ch = crop if crop else (0, 0, w, h)
        x, y, cw, ch = clamp(x, y, cw, ch, w, h)
        out = os.path.join(args.out_dir, f"{args.name}.png")
        cv2.imwrite(out, img[y:y + ch, x:x + cw])
        print(f"{out}  {cw}x{ch}")
        return

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        sys.exit(f"读不到视频：{args.video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    duration = total / fps if fps else 0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"视频 {w}x{h}  {duration:.2f}s  {fps:.2f}fps")

    times = [t.strip() for t in args.at.split(",") if t.strip()]
    for i, raw in enumerate(times):
        t = duration * float(raw.rstrip("%")) / 100 if raw.endswith("%") else float(raw)
        frame = grab_frame(cap, t)
        if frame is None:
            print(f"  ! {t}s 取不到帧，跳过")
            continue

        if crop:
            x, y, cw, ch = clamp(*crop, w, h)
        elif args.split == "top":
            x, y, cw, ch = 0, 0, w, h // 2
        elif args.split == "bottom":
            x, y, cw, ch = 0, h // 2, w, h // 2
        else:
            x, y, cw, ch = 0, 0, w, h

        tag = f"{args.name}-{raw.replace('.', 'p')}s" if len(times) > 1 else args.name
        out = os.path.join(args.out_dir, f"{tag}.png")
        cv2.imwrite(out, frame[y:y + ch, x:x + cw])
        print(f"  {out}  {cw}x{ch}")

    cap.release()


if __name__ == "__main__":
    main()
