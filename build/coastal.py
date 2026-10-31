"""Coastal flood zone: land below the local 100-year extreme sea level (JRC LISCOAST total water level,
median, incl. sea level rise) that is connected to the sea. Elevation: NOAA ETOPO 2022, 15" (~450 m).
Simple 'bathtub' model: ignores dikes and flood defences, so it shows exposure, not expected damage."""
import glob
import json
import os

import netCDF4 as nc
import numpy as np
from rasterio.features import rasterize
from rasterio.transform import from_origin
from scipy import ndimage
from scipy.spatial import cKDTree

from common import CELL, COLS, DL, N, ROOT, ROWS, W, WORK, make_tiles

R = 1 / 240  # 15"
H, Wd = round(ROWS * CELL / R), round(COLS * CELL / R)
elev = np.full((H, Wd), np.nan, np.float32)
for f in glob.glob(os.path.join(DL, "etopo/*.nc")):
    d = nc.Dataset(f)
    lat, lon = d["lat"][:], d["lon"][:]
    r = np.round((N - lat) / R - 0.5).astype(int)
    c = np.round((lon - W) / R - 0.5).astype(int)
    rk, ck = (r >= 0) & (r < H), (c >= 0) & (c < Wd)
    elev[np.ix_(r[rk], c[ck])] = d["z"][:][np.ix_(rk, ck)]
print("gap pixels (east of 45E, inland)", int(np.isnan(elev).sum()))
elev[np.isnan(elev)] = 9999  # ponytail: thin strip east of 45E has no ETOPO tile; inland, so never coastal

land_geo = json.load(open(os.path.join(DL, "ne/land.geojson")))["features"]
land = rasterize(((f["geometry"], 1) for f in land_geo), out_shape=(H, Wd),
                 transform=from_origin(W, N, R, R), dtype=np.uint8).astype(bool)

# per-pixel nearest coastal point (lon scaled by cos(lat) so distances are roughly isotropic)
pts = nc.Dataset(os.path.join(DL, "liscoast/globalTWL_RCP85.nc"))
plon, plat = pts["longitude"][:], pts["latitude"][:]
keep = (plon > -32) & (plon < 50) & (plat > 28) & (plat < 76)
twl = {  # 100-year total water level in metres, median (percentile index 1); decade index 4 = 2050
    "today": nc.Dataset(os.path.join(DL, "liscoast/globalTWL_baseline.nc"))["TWL"][:, 1],
    "rcp45": nc.Dataset(os.path.join(DL, "liscoast/globalTWL_RCP45.nc"))["TWL"][:, 1, 4],
    "rcp85": pts["TWL"][:, 1, 4],
}
for k in twl:
    twl[k] = np.ma.filled(twl[k], np.nan)[keep]
ok = np.all([np.isfinite(v) for v in twl.values()], axis=0)
plon, plat = plon[keep][ok], plat[keep][ok]
for k in twl:
    twl[k] = twl[k][ok]
print("coastal points", len(plon), {k: (float(np.min(v)), float(np.max(v))) for k, v in twl.items()})
cand = np.nonzero(elev <= np.max(twl["rcp85"]))
clat = N - (cand[0] + 0.5) * R
tree = cKDTree(np.c_[plon * np.cos(np.radians(plat)), plat])
_, nearest = tree.query(np.c_[(W + (cand[1] + 0.5) * R) * np.cos(np.radians(clat)), clat])

sea_seed = elev < -20
cell_land = np.add.reduceat(np.add.reduceat(land.astype(np.int32), np.arange(0, H, 60), 0), np.arange(0, Wd, 60), 1)
np.save(os.path.join(WORK, "land_frac.npy"), (cell_land / 3600).astype(np.float32))
sum2 = lambda a: a.reshape(H // 2, 2, Wd // 2, 2).sum(axis=(1, 3), dtype=np.int32)  # 15" -> 30"
land30 = sum2(land)
np.save(os.path.join(WORK, "land30.npy"), (land30 / 4).astype(np.float16))
for k, v in twl.items():
    level = np.full(elev.shape, -np.inf, np.float32)
    level[cand] = v[nearest]
    below = elev <= level
    lab, _ = ndimage.label(below)
    wet = np.isin(lab, np.unique(lab[sea_seed & below])) & land
    del lab
    flooded = np.add.reduceat(np.add.reduceat(wet.astype(np.int32), np.arange(0, H, 60), 0), np.arange(0, Wd, 60), 1)
    share = np.where(cell_land > 0, flooded / np.maximum(cell_land, 1), np.nan).astype(np.float32)
    np.save(os.path.join(WORK, f"coast_share_{k}.npy"), share)
    np.save(os.path.join(WORK, f"coast_share30_{k}.npy"),
            np.where(land30 > 0, sum2(wet) / np.maximum(land30, 1), np.nan).astype(np.float16))
    print(k, "flooded land pixels", int(wet.sum()))
    if k == "rcp85":
        depth = np.where(wet, level - elev, 0)
        cls = np.where(wet, np.digitize(depth, [0.5, 1, 2], right=True) + 1, 0).astype(np.uint8)
        # purples: <=0.5 m, 0.5-1, 1-2, >2 m below the 2050 flood level
        make_tiles(cls, W, N, R, [(218, 170, 230), (178, 110, 205), (128, 50, 170), (84, 20, 120)],
                   os.path.join(ROOT, "tiles/coast"), 4, 9)
