"""JRC/Copernicus EFAS 100-year river flood depth (3", ~90 m) -> 9" class tiles + flooded share of each 30" (~1 km) cell.
Permanent water bodies (lakes, wide rivers) are masked out so they do not count as flood zone."""
import os

import numpy as np
import rasterio
from rasterio.windows import Window

from common import CELL, COLS, DL, N, ROOT, ROWS, W, WORK, make_tiles

R = 0.0025  # 9" output
src = rasterio.open(os.path.join(DL, "riverflood/rp100.tif"))
pwb = rasterio.open(os.path.join(DL, "pwb/pwb.tif"))
assert src.transform == pwb.transform and src.shape == pwb.shape
rs, left, top = src.transform.a, src.transform.c, src.transform.f
out = np.zeros((round(ROWS * CELL / R), round(COLS * CELL / R)), np.uint8)
R30 = 1 / 120  # 30" analysis grid
share = np.full((round(ROWS * CELL / R30), round(COLS * CELL / R30)), np.nan, np.float32)

j1 = int(np.ceil((W + COLS * CELL - left) / rs - 0.5))
lon_c = left + (np.arange(j1) + 0.5) * rs
oj = np.floor((lon_c - W) / R).astype(int)
cj = np.floor((lon_c - W) / R30).astype(int)
sj, scj = np.flatnonzero(np.r_[True, np.diff(oj) != 0]), np.flatnonzero(np.r_[True, np.diff(cj) != 0])
ncol = np.diff(np.r_[scj, j1])

for r in range(ROWS):
    lat_top, lat_bot = N - r * CELL, N - (r + 1) * CELL
    i0 = max(0, int(np.ceil((top - lat_top) / rs - 0.5)))
    i1 = min(src.height, int(np.ceil((top - lat_bot) / rs - 0.5)))
    if i1 <= i0:
        continue
    win = Window(0, i0, j1, i1 - i0)
    d = src.read(1, window=win)
    fl = (d != src.nodata) & (d > 0) & ~(pwb.read(1, window=win) == 1)  # flood zone minus lakes
    cls = np.where(fl, np.digitize(d, [0.5, 1, 2], right=True) + 1, 0).astype(np.uint8)
    lat_c = top - (np.arange(i0, i1) + 0.5) * rs
    oi = np.floor((N - lat_c) / R).astype(int)
    si = np.flatnonzero(np.r_[True, np.diff(oi) != 0])
    blk = np.maximum.reduceat(np.maximum.reduceat(cls, si, axis=0), sj, axis=1)
    out[np.ix_(oi[si], oj[sj])] = blk
    # the raster only holds flooded pixels (rest is nodata), so this is the share of the whole 30" cell;
    # layers.py divides by the land fraction.
    ci = np.floor((N - lat_c) / R30).astype(int)
    sci = np.flatnonzero(np.r_[True, np.diff(ci) != 0])
    cnt = np.add.reduceat(np.add.reduceat(fl.astype(np.int32), sci, axis=0), scj, axis=1)
    share[np.ix_(ci[sci], cj[scj])] = cnt / np.outer(np.diff(np.r_[sci, i1 - i0]), ncol)
    if r % 20 == 0:
        print("row", r, flush=True)

np.save(os.path.join(WORK, "river_share30.npy"), share.astype(np.float16))
# blues: <=0.5 m, 0.5-1, 1-2, >2 m
make_tiles(out, W, N, R, [(158, 202, 225), (66, 146, 198), (8, 81, 156), (8, 48, 107)],
           os.path.join(ROOT, "tiles/river"), 4, 10)
