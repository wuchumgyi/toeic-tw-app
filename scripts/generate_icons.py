import os
from PIL import Image, ImageDraw, ImageFont

ICON_DIR = r"d:\AI tools\英文學習\assets\icons"
os.makedirs(ICON_DIR, exist_ok=True)


def load_font(size: int, bold: bool = True):
    candidates = [
        r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\msjhbd.ttc" if bold else r"C:\Windows\Fonts\msjh.ttc",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()


def draw_icon(size: int, maskable: bool = False) -> Image.Image:
    # 使用 2x 超取樣繪製後縮放，確保邊緣平滑銳利
    s = size * 2
    img = Image.new("RGBA", (s, s), (30, 58, 95, 255))
    draw = ImageDraw.Draw(img)

    # 漸層背景（從深藏青到墨藍）
    for y in range(s):
        ratio = y / s
        r = int(24 + (38 - 24) * ratio)
        g = int(49 + (76 - 49) * ratio)
        b = int(84 + (122 - 84) * ratio)
        draw.line([(0, y), (s, y)], fill=(r, g, b, 255))

    pad = int(s * (0.14 if maskable else 0.09))
    inner_r = int(s * 0.14)

    # 內部紙質感圓角卡片框
    draw.rounded_rectangle(
        [pad, pad, s - pad, s - pad],
        radius=inner_r,
        fill=(248, 245, 236, 255),
    )

    # 頂部暖金色書籤色條
    bar_h = int(s * 0.14)
    bar_pad = pad + int(s * 0.05)
    draw.rounded_rectangle(
        [bar_pad, pad + int(s * 0.05), s - bar_pad, pad + int(s * 0.05) + bar_h],
        radius=int(s * 0.04),
        fill=(217, 119, 6, 255),
    )

    # 頂部小標「TW」
    f_top = load_font(int(s * 0.075), bold=True)
    top_text = "TW · 繁體精校"
    # 使用英文以確保任何字體皆清晰不缺字
    top_text = "TAIWAN EDITION"
    tb = draw.textbbox((0, 0), top_text, font=f_top)
    tw = tb[2] - tb[0]
    th = tb[3] - tb[1]
    draw.text(
        ((s - tw) / 2, pad + int(s * 0.05) + (bar_h - th) / 2 - int(s * 0.01)),
        top_text,
        fill=(255, 255, 255, 255),
        font=f_top,
    )

    # 中央主字「TOEIC」
    f_main = load_font(int(s * 0.215), bold=True)
    main_text = "TOEIC"
    mb = draw.textbbox((0, 0), main_text, font=f_main)
    mw = mb[2] - mb[0]
    mh = mb[3] - mb[1]
    draw.text(
        ((s - mw) / 2, s * 0.43 - mh / 2),
        main_text,
        fill=(30, 58, 95, 255),
        font=f_main,
    )

    # 裝飾分隔線
    line_y = int(s * 0.61)
    line_w = int(s * 0.42)
    draw.rounded_rectangle(
        [(s - line_w) // 2, line_y, (s + line_w) // 2, line_y + int(s * 0.02)],
        radius=int(s * 0.01),
        fill=(37, 99, 235, 255),
    )

    # 底部副標「UP 990」
    f_sub = load_font(int(s * 0.095), bold=True)
    sub_text = "STUDY APP"
    sb = draw.textbbox((0, 0), sub_text, font=f_sub)
    sw = sb[2] - sb[0]
    draw.text(
        ((s - sw) / 2, int(s * 0.675)),
        sub_text,
        fill=(92, 101, 112, 255),
        font=f_sub,
    )

    return img.resize((size, size), Image.Resampling.LANCZOS)


def main():
    draw_icon(192, maskable=False).save(os.path.join(ICON_DIR, "icon-192.png"))
    draw_icon(512, maskable=False).save(os.path.join(ICON_DIR, "icon-512.png"))
    draw_icon(512, maskable=True).save(os.path.join(ICON_DIR, "icon-maskable-512.png"))
    draw_icon(180, maskable=False).save(os.path.join(ICON_DIR, "apple-touch-icon.png"))

    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#1E3A5F"/>
  <rect x="46" y="46" width="420" height="420" rx="68" fill="#F8F5EC"/>
  <rect x="72" y="72" width="368" height="72" rx="20" fill="#D97706"/>
  <text x="256" y="119" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="800" fill="#FFFFFF">TAIWAN EDITION</text>
  <text x="256" y="275" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="112" font-weight="800" fill="#1E3A5F">TOEIC</text>
  <rect x="148" y="312" width="216" height="10" rx="5" fill="#2563EB"/>
  <text x="256" y="388" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="46" font-weight="700" fill="#5C6570">STUDY APP</text>
</svg>
"""
    with open(os.path.join(ICON_DIR, "icon.svg"), "w", encoding="utf-8") as f:
        f.write(svg)
    print("Generated all PWA PNG & SVG icons successfully!")


if __name__ == "__main__":
    main()
