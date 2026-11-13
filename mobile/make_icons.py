"""生成 PWA 图标（纯标准库，无需 Pillow / ImageMagick / Node 依赖）。

图形：青绿渐变底 + 白色文献页 + 医疗十字 + 三条摘要文字线。
用有向距离场（SDF）逐像素绘制，边缘自带 1px 抗锯齿，不依赖任何字体或素材。

    python mobile/make_icons.py

产出在 mobile/pwa/icons/：
    icon-192.png / icon-512.png          普通图标（圆角，四角透明）
    icon-maskable-512.png                Android 自适应图标（全出血，内容缩进安全区）
    apple-touch-icon.png                 iOS 添加到主屏幕（全出血，不留透明）
"""
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pwa", "icons")

TOP = (56, 184, 164)
BOTTOM = (24, 106, 98)
WHITE = (255, 255, 255)


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else (hi if v > hi else v)


def sd_round_rect(x, y, cx, cy, hx, hy, r):
    """圆角矩形的有向距离，负数为内部。"""
    qx = abs(x - cx) - (hx - r)
    qy = abs(y - cy) - (hy - r)
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r


def bg_color(x, y):
    t = clamp(0.35 * x + 0.65 * y)
    return tuple(TOP[i] + (BOTTOM[i] - TOP[i]) * t for i in range(3))


def blend(dst, src, a):
    return tuple(dst[i] + (src[i] - dst[i]) * a for i in range(3))


def render(size, bleed=False, content_scale=1.0):
    """bleed=True 时背景铺满整张图（无透明角），内容按 content_scale 居中缩放。"""
    def shape(cx, cy, hx, hy, r=0.0):
        return (
            0.5 + (cx - 0.5) * content_scale,
            0.5 + (cy - 0.5) * content_scale,
            hx * content_scale,
            hy * content_scale,
            r * content_scale,
        )

    page = shape(0.5, 0.5, 0.225, 0.29, 0.035)
    cross_v = shape(0.5, 0.365, 0.037, 0.115, 0.012)
    cross_h = shape(0.5, 0.365, 0.115, 0.037, 0.012)
    lines = [
        shape(0.5, 0.515, 0.145, 0.011, 0.006),
        shape(0.5, 0.585, 0.145, 0.011, 0.006),
        shape(0.5, 0.655, 0.100, 0.011, 0.006),
    ]

    rows = []
    for py in range(size):
        y = (py + 0.5) / size
        row = bytearray()
        for px in range(size):
            x = (px + 0.5) / size
            bg = bg_color(x, y)

            if bleed:
                outer_alpha = 1.0
            else:
                d = sd_round_rect(x, y, 0.5, 0.5, 0.5, 0.5, 0.225)
                outer_alpha = clamp(0.5 - d * size)
                if outer_alpha <= 0.0:
                    row += b"\x00\x00\x00\x00"
                    continue

            col = bg
            # 白色文献页
            a = clamp(0.5 - sd_round_rect(x, y, *page) * size)
            col = blend(col, WHITE, a)

            # 页面上的十字与文字线：挖回底色，形成镂空
            d_cross = min(
                sd_round_rect(x, y, *cross_v),
                sd_round_rect(x, y, *cross_h),
            )
            col = blend(col, bg, clamp(0.5 - d_cross * size))
            d_lines = min(*(sd_round_rect(x, y, *ln) for ln in lines))
            col = blend(col, bg, clamp(0.5 - d_lines * size))

            row += bytes((int(col[0]), int(col[1]), int(col[2]), int(outer_alpha * 255)))
        rows.append(bytes(row))
    return rows


def _chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(name, size, rows):
    raw = b"".join(b"\x00" + r for r in rows)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(raw, 9))
        + _chunk(b"IEND", b"")
    )
    path = os.path.join(OUT, name)
    with open(path, "wb") as f:
        f.write(png)
    print(f"  {name:26s} {size}x{size}  {len(png) / 1024:.1f} KB")


def main():
    os.makedirs(OUT, exist_ok=True)
    print("生成 PWA 图标：")
    write_png("icon-192.png", 192, render(192))
    write_png("icon-512.png", 512, render(512))
    write_png("icon-maskable-512.png", 512, render(512, bleed=True, content_scale=0.66))
    write_png("apple-touch-icon.png", 180, render(180, bleed=True, content_scale=0.88))
    print("完成。")


if __name__ == "__main__":
    main()
