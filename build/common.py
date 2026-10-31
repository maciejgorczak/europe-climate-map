"""Shared grid definition and a minimal XYZ PNG tiler."""
import math
import os
import sys

import numpy as np
from PIL import Image

DL = sys.argv[1] if len(sys.argv) > 1 else os.environ["DL"]  # raw downloads folder
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(DL, "..", "work")
os.makedirs(WORK, exist_ok=True)

# 0.25 deg analysis grid, same cell centres as the World Bank CMIP6 files.
CELL = 0.25
W, N = -25.125, 72.125  # outer edges
ROWS, COLS = 153, 281   # lat 72..34, lon -25..45 (cell centres)


def maxpool2(a):
    h, w = a.shape
    a = np.pad(a, ((0, h % 2), (0, w % 2)))
    return a.reshape(a.shape[0] // 2, 2, a.shape[1] // 2, 2).max(axis=(1, 3))


def meanpool2(a):
    """2x2 mean of the non-zero codes (0 = no data stays 0)."""
    h, w = a.shape
    b = np.pad(a, ((0, h % 2), (0, w % 2))).astype(np.uint16)
    b = b.reshape(b.shape[0] // 2, 2, b.shape[1] // 2, 2)
    s, n = b.sum(axis=(1, 3)), (b > 0).sum(axis=(1, 3))
    return np.where(n > 0, (s + n // 2) // np.maximum(n, 1), 0).astype(np.uint8)


def _tiles(cls, west, north, res, out, zmin, zmax, pool, save):
    """Cut a uint8 raster (row 0 at `north`, square `res` deg pixels, 0 = empty) into XYZ tiles."""
    h, w = cls.shape
    east, south = west + w * res, north - h * res
    frac = (np.arange(256) + 0.5) / 256
    levels, count = [cls], 0
    lat2y = lambda lat, n: int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    for z in range(zmin, zmax + 1):
        n = 2 ** z
        k = max(0, int(math.floor(math.log2(360 / (256 * n) / res))))
        while len(levels) <= k:
            levels.append(pool(levels[-1]))
        a, r = levels[k], res * 2 ** k
        for x in range(int((west + 180) / 360 * n), int((east + 180) / 360 * n) + 1):
            ci = np.floor(((x + frac) / n * 360 - 180 - west) / r).astype(int)
            cok = (ci >= 0) & (ci < a.shape[1])
            if not cok.any():
                continue
            for y in range(lat2y(north, n), lat2y(south, n) + 1):
                lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y + frac) / n))))
                ri = np.floor((north - lat) / r).astype(int)
                rok = (ri >= 0) & (ri < a.shape[0])
                if not rok.any():
                    continue
                t = a[np.ix_(np.clip(ri, 0, a.shape[0] - 1), np.clip(ci, 0, a.shape[1] - 1))]
                t = (t * (rok[:, None] & cok[None, :])).astype(np.uint8)
                if not t.any():
                    continue
                d = os.path.join(out, str(z), str(x))
                os.makedirs(d, exist_ok=True)
                save(t, os.path.join(d, f"{y}.png"))
                count += 1
    print(f"{out}: {count} tiles", flush=True)


def make_tiles(cls, west, north, res, palette, out, zmin=4, zmax=9):
    """Class raster -> coloured PNG tiles. palette: RGB tuples for classes 1..n.
    Lower zooms max-pool so thin rivers survive."""
    pal = [0, 0, 0] + [c for rgb in palette for c in rgb]
    pal += [0] * (768 - len(pal))

    def save(t, path):
        img = Image.fromarray(t, "P")
        img.putpalette(pal)
        img.save(path, transparency=0)
    _tiles(cls, west, north, res, out, zmin, zmax, maxpool2, save)


def make_data_tiles(code, west, north, res, out, zmin=3, zmax=7):
    """Value codes (1..255, 0 = no data) -> grayscale PNG tiles the browser decodes. Lower zooms average."""
    _tiles(code, west, north, res, out, zmin, zmax, meanpool2, lambda t, p: Image.fromarray(t, "L").save(p))


if __name__ == "__main__":
    # self-check: tile maths puts a single pixel where it belongs
    a = np.zeros((4, 4), np.uint8)
    a[1, 2] = 1
    import tempfile
    with tempfile.TemporaryDirectory() as t:
        make_tiles(a, 10.0, 50.0, 1.0, [(255, 0, 0)], t, 3, 3)
        # pixel covers lon 12..13, lat 48..49 -> z3 tile x=4, y=2
        assert os.listdir(os.path.join(t, "3")) == ["4"], os.listdir(os.path.join(t, "3"))
        assert os.listdir(os.path.join(t, "3", "4")) == ["2.png"]
    with tempfile.TemporaryDirectory() as t:
        b = np.zeros((4, 4), np.uint8)
        b[0, 0], b[0, 1] = 10, 20  # mean pool ignores the zeros
        assert meanpool2(b)[0, 0] == 15
    print("ok")
