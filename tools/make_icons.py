#!/usr/bin/env python3
"""Generate the PWA icons as PNGs using only the Python stdlib.

Draws a simple stopwatch (ring + hand + crown) on a dark background.
The artwork stays inside the inner 80% so the icons are maskable-safe.
"""
import math
import os
import struct
import zlib

BG = (16, 19, 26)      # matches --bg / theme_color
FG = (46, 204, 113)    # matches --accent

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'icons')


def chunk(typ, data):
    return (struct.pack('>I', len(data)) + typ + data
            + struct.pack('>I', zlib.crc32(typ + data) & 0xFFFFFFFF))


def write_png(path, size, pixel):
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type: None
        for x in range(size):
            raw += bytes(pixel(x, y))
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)


def stopwatch_pixel(size):
    cx = cy = size / 2.0
    ring_r = size * 0.25
    stroke = size * 0.075
    hand_w = size * 0.035
    hand_len = ring_r * 0.62
    knob_r = size * 0.05
    knob_cy = cy - ring_r - size * 0.07

    def cov(d):  # ~1px anti-aliased coverage from a signed distance
        return max(0.0, min(1.0, d + 0.5))

    def pixel(x, y):
        px, py = x + 0.5, y + 0.5
        d = math.hypot(px - cx, py - cy)
        a = cov(stroke / 2 - abs(d - ring_r))                          # dial ring
        hx = cov(hand_w / 2 - abs(px - cx))                            # hand
        hy = cov(min(py - (cy - hand_len), cy - py))
        a = max(a, min(hx, hy))
        a = max(a, cov(hand_w * 1.4 - d))                              # center hub
        a = max(a, cov(knob_r - math.hypot(px - cx, py - knob_cy)))    # crown
        return tuple(round(b + (f - b) * a) for b, f in zip(BG, FG))

    return pixel


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, size in [('icon-512.png', 512), ('icon-192.png', 192),
                       ('apple-touch-icon.png', 180)]:
        path = os.path.join(OUT_DIR, name)
        write_png(path, size, stopwatch_pixel(size))
        print(f'wrote {path} ({size}x{size})')


if __name__ == '__main__':
    main()
