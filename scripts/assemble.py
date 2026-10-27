#!/usr/bin/env python3
"""
assemble.py — 把模型出的图整理成小红书可上传的成品。

做四件事：
  1. 统一压到 1080×1440（模型常输出 3584×4800 或 896×1200）
  2. 裁掉偶发的白边
  3. 拼一张并排预览图
  4. 打包 zip

用法：
  python scripts/assemble.py --src out/ --dst final/ --cut 0.035
  python scripts/assemble.py --src out/ --dst final/ --names 01-封面,02-对比,03-时间线

依赖：Pillow（pip install pillow）
"""

from __future__ import annotations

import argparse
import os
import sys
import zipfile

try:
    from PIL import Image
except ImportError:
    sys.exit("缺少 Pillow。安装：pip install pillow")

TARGET_W, TARGET_H = 1080, 1440


def cover_fit(im: Image.Image, w: int = TARGET_W, h: int = TARGET_H) -> Image.Image:
    """等比缩放后居中裁切，保证不变形且铺满目标尺寸。"""
    sw, sh = im.size
    scale = max(w / sw, h / sh)
    im = im.resize((round(sw * scale), round(sh * scale)), Image.LANCZOS)
    nw, nh = im.size
    left = (nw - w) // 2
    top = (nh - h) // 2
    return im.crop((left, top, left + w, top + h))


def has_bottom_band(im: Image.Image) -> bool:
    """判断底边是否为明显白条（生图偶发瑕疵）。

    只认"接近纯白"这一种情况，阈值收紧，宁可漏判也不要误伤好图。
    """
    w, h = im.size
    edge = im.crop((0, h - 6, w, h)).convert("RGB").resize((32, 1))
    body = im.crop((0, h - 90, w, h - 20)).convert("RGB").resize((32, 1))

    def mean(px):
        return sum(px) / 3

    e = mean(edge.getpixel((16, 0)))
    b = mean(body.getpixel((16, 0)))
    return e > 238 and (e - b) > 25


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="生图输出目录")
    ap.add_argument("--dst", default="final", help="成品目录")
    ap.add_argument("--names", default="", help="逗号分隔的成品名，按文件顺序；留空则用原名")
    ap.add_argument("--cut", type=float, default=0.0, help="从底部裁掉的比例，如 0.035")
    ap.add_argument("--auto-crop", action="store_true",
                    help="自动检测并裁掉底部白条（默认关闭，避免误伤）")
    ap.add_argument("--quality", type=int, default=94)
    ap.add_argument("--no-zip", action="store_true")
    args = ap.parse_args()

    os.makedirs(args.dst, exist_ok=True)

    exts = {".jpg", ".jpeg", ".png", ".webp"}
    files = sorted(
        os.path.join(args.src, f)
        for f in os.listdir(args.src)
        if os.path.splitext(f)[1].lower() in exts
    )
    if not files:
        sys.exit(f"{args.src} 里没有图片")

    names = [n.strip() for n in args.names.split(",") if n.strip()]
    outs: list[str] = []

    for i, path in enumerate(files):
        im = Image.open(path).convert("RGB")

        if args.cut > 0:
            w, h = im.size
            im = im.crop((0, 0, w, int(h * (1 - args.cut))))
        elif args.auto_crop and has_bottom_band(im):
            w, h = im.size
            im = im.crop((0, 0, w, int(h * 0.97)))
            print(f"  ! {os.path.basename(path)} 检测到底部白条，已裁掉 3%")

        im = cover_fit(im)

        stem = names[i] if i < len(names) else os.path.splitext(os.path.basename(path))[0]
        out = os.path.join(args.dst, f"{stem}.jpg")
        im.save(out, "JPEG", quality=args.quality, subsampling=0)
        outs.append(out)
        print(f"  {os.path.basename(out):<20} {im.size[0]}x{im.size[1]}  {os.path.getsize(out) // 1024} KB")

    # 并排预览
    tw, th, gap, pad = 330, 440, 18, 26
    cols = min(len(outs), 3)
    sheet = Image.new("RGB", (cols * tw + (cols - 1) * gap + 2 * pad, th + 2 * pad), (206, 214, 217))
    for i, f in enumerate(outs[:cols]):
        sheet.paste(Image.open(f).resize((tw, th), Image.LANCZOS), (pad + i * (tw + gap), pad))
    preview = os.path.join(args.dst, "预览.jpg")
    sheet.save(preview, quality=90)

    if not args.no_zip:
        zpath = os.path.join(args.dst, "小红书图文.zip")
        with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
            for f in outs:
                z.write(f, os.path.basename(f))
        print(f"\n打包：{zpath}")

    print(f"完成：{len(outs)} 张，预览 {preview}")


if __name__ == "__main__":
    main()
