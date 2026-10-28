#!/usr/bin/env python3
"""Generate the PromptShelf app icon (1024x1024 PNG, no external deps).

DEPRECATED: рисует старую иконку-заглушку и перезапишет актуальный app-icon.png.
Не запускайте её. Иконки для бандла теперь генерируются из готового app-icon.png:
    npm run tauri icon app-icon.png
"""
import zlib, struct, math

SIZE = 1024

# (kind, x0, y0, x1, y1, radius, (r,g,b))
BG = (100, 100, 924, 924, 184, (0x18, 0x18, 0x1B))
SHELF = (312, 700, 712, 728, 14, (0x52, 0x52, 0x5B))
CARD1 = (352, 500, 416, 702, 14, (0xFA, 0xFA, 0xFA))
CARD2 = (440, 440, 504, 702, 14, (0xA1, 0xA1, 0xAA))
CARD3 = (528, 540, 592, 702, 14, (0xE4, 0xE4, 0xE7))
SHAPES = [BG, SHELF, CARD1, CARD2, CARD3]


def sdf_rounded_rect(px, py, x0, y0, x1, y1, r):
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    hx, hy = (x1 - x0) / 2.0, (y1 - y0) / 2.0
    qx = abs(px - cx) - (hx - r)
    qy = abs(py - cy) - (hy - r)
    dx = max(qx, 0.0)
    dy = max(qy, 0.0)
    return math.hypot(dx, dy) + min(max(qx, qy), 0.0) - r


def clamp01(v):
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def render():
    rows = []
    for y in range(SIZE):
        row = bytearray()
        for x in range(SIZE):
            # paint order: later shapes composite over earlier ones
            dr, dg, db, da = 0.0, 0.0, 0.0, 0.0
            for (x0, y0, x1, y1, r, col) in SHAPES:
                d = sdf_rounded_rect(x + 0.5, y + 0.5, x0, y0, x1, y1, r)
                a = clamp01(0.5 - d)
                if a <= 0.0:
                    continue
                sr, sg, sb = col
                da_n = da + a * (1.0 - da)
                if da_n <= 0:
                    continue
                dr = (sr * a + dr * da * (1 - a)) / da_n
                dg = (sg * a + dg * da * (1 - a)) / da_n
                db = (sb * a + db * da * (1 - a)) / da_n
                da = da_n
            row += bytes((int(dr + 0.5), int(dg + 0.5), int(db + 0.5), int(da * 255 + 0.5)))
        rows.append(bytes(row))
    return rows


def write_png(path, rows):
    raw = b"".join(b"\x00" + r for r in rows)
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    rows = render()
    write_png("app-icon.png", rows)
    print("app-icon.png written")
