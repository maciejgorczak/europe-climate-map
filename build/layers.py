"""Build every hazard layer on a 30" (~1 km) grid -> grayscale data tiles + per-city values for the web app.
Scenario keys: h = today, m = 2050 moderate (SSP2-4.5), x = 2050 high (SSP5-8.5).
Layers with coarser sources (25 km climate indices, 5 km river trend, river basins) are repeated onto the
1 km grid without smoothing, so the map never shows detail the data does not have."""
import glob
import json
import os

import netCDF4 as nc
import numpy as np
import pyogrio
import rasterio
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.windows import Window
from scipy.ndimage import map_coordinates

from common import CELL, COLS, DL, N, ROOT, ROWS, W, WORK, make_data_tiles

R = 1 / 120
H, WD = ROWS * 30, COLS * 30
lat30 = N - (np.arange(H) + 0.5) * R
lon30 = W + (np.arange(WD) + 0.5) * R
land = np.load(os.path.join(WORK, "land30.npy")).astype(np.float32)
sea = land == 0
SCEN = {"h": ("historical", "1995-2014"), "m": ("ssp245", "2040-2059"), "x": ("ssp585", "2040-2059")}

# value range of the 1..255 code for each layer (the browser decodes with the same numbers via data/layers.js)
ENC = {"tx": (-5, 50), "tn": (-10, 35), "pra": (0, 3000), "ws": (0, 5), "rfs": (0, 100), "cfs": (0, 100),
       "hd35": (0, 200), "tr": (0, 220), "spei": (-3, 1.5), "cdd": (0, 200), "rx5": (-50, 100), "rfc": (-100, 150)}


def cckp(var, s, season=None):
    """World Bank CCKP CMIP6 ensemble median on the 0.25 deg grid (rows north -> south). season 2 = JJA."""
    scen, per = SCEN[s]
    agg = "seasonal" if season is not None else "annual"
    d = nc.Dataset(glob.glob(os.path.join(DL, f"cckp/climatology-{var}-{agg}-mean_*-{scen}_climatology_median_{per}.nc"))[0])
    lat, lon = d["lat"][:], d["lon"][:]
    la, lo = (lat > 33.9) & (lat < 72.1), (lon > -25.1) & (lon < 45.1)
    v = np.ma.filled(d[f"climatology-{var}-{agg}-mean"][season if season is not None else 0], np.nan)
    v = v[np.ix_(la, lo)][::-1]
    assert v.shape == (ROWS, COLS), v.shape
    return v


def coarse(a, f=30):
    return np.repeat(np.repeat(a, f, 0), f, 1)


rr, cc = np.meshgrid(((72 - lat30) / CELL).astype(np.float32), ((lon30 + 25) / CELL).astype(np.float32), indexing="ij")


def smooth(a):
    """Bilinear interpolation of a 0.25 deg change field onto 30" (standard delta-method downscaling)."""
    return map_coordinates(a, [rr, cc], order=1, mode="nearest").astype(np.float32)


def chelsa(name, temp):
    """CHELSA v2.1 1981-2010 climatology, Europe window on the 30" grid."""
    with rasterio.open(os.path.join(DL, f"chelsa/CHELSA_{name}_1981-2010_V.2.1.tif")) as r:
        c0, r0 = round((W - r.transform.c) / R), round((r.transform.f - N) / R)
        v = r.read(1, window=Window(c0, r0, WD, H)).astype(np.float32)
    v[(v == 0) | (v == 65535)] = np.nan
    return v * 0.1 - 273.15 if temp else v * 0.1



# --- 1 km: CHELSA baseline + CMIP6 change (2040-2059 minus 1995-2014) from CCKP
jja = {v: {s: cckp(v, s, season=2) for s in SCEN} for v in ["tasmax", "tasmin"]}
assert np.nanmean(jja["tasmax"]["h"]) > np.nanmean(cckp("tasmax", "h", season=0)), "season 2 is not summer"


def build_tx():
    base = chelsa("bio5", True)  # mean daily max of the warmest month
    return {s: base if s == "h" else base + smooth(jja["tasmax"][s] - jja["tasmax"]["h"]) for s in SCEN}


def build_tn():
    base = np.fmax(chelsa("tasmin_07", True), chelsa("tasmin_08", True))  # mean daily min, warmer of Jul/Aug
    return {s: base if s == "h" else base + smooth(jja["tasmin"][s] - jja["tasmin"]["h"]) for s in SCEN}


def build_pra():
    base = chelsa("bio12", False)  # yearly rainfall, mm
    pr = {s: cckp("pr", s) for s in SCEN}
    return {s: base if s == "h" else base * smooth(pr[s] / pr["h"]) for s in SCEN}


def build_ws():
    """WRI Aqueduct 4.0 water stress score 0-5 per river basin: baseline, 2050 BAU (SSP3-7.0), 2050 pessimistic."""
    gdb = glob.glob(os.path.join(DL, "aq/*/GDB/*.gdb"))[0]
    fut = pyogrio.read_dataframe(gdb, layer="future_annual", bbox=(-26, 33, 46, 73), columns=["bau50_ws_x_s", "pes50_ws_x_s"])
    base = pyogrio.read_dataframe(gdb, layer="baseline_annual", bbox=(-26, 33, 46, 73), columns=["bws_score"])
    out = {}
    for s, col, df in [("h", "bws_score", base), ("m", "bau50_ws_x_s", fut), ("x", "pes50_ws_x_s", fut)]:
        vals = df[col].where(df[col] >= 0)  # negative = no data / arid-low-use flags
        out[s] = rasterize(((g, v) for g, v in zip(df.geometry, vals) if np.isfinite(v)), out_shape=(H, WD),
                           transform=from_origin(W, N, R, R), fill=np.nan, dtype=np.float32)
    return out


def build_rfs():
    share = np.load(os.path.join(WORK, "river_share30.npy")).astype(np.float32)
    return {"h": np.clip(share / np.maximum(land, 0.25), 0, 1) * 100}


def build_cfs():
    return {s: np.load(os.path.join(WORK, f"coast_share30_{k}.npy")).astype(np.float32) * 100
            for s, k in [("h", "today"), ("m", "rcp45"), ("x", "rcp85")]}


def build_rfc():
    """JRC PESETA IV % change of the 100-year river flow. 2050: ~2.0 C (SSP2-4.5), ~2.4 C (SSP5-8.5) warming."""
    p = nc.Dataset(os.path.join(DL, "peseta/high.nc"))
    f = lambda k: np.ma.filled(p[k][:], np.nan)
    plat, plon, base, c20, c30 = f("lat"), f("lon"), f("baseline_return_level"), f("return_level_perc_chng_20"), f("return_level_perc_chng_30")
    sel = (base >= 50) & np.isfinite(c20) & np.isfinite(c30) & np.isfinite(plat)  # real rivers only
    g = 6  # 0.05 deg bins ~ the 5 km source grid
    ri = np.floor((N - plat[sel]) / (R * g)).astype(int)
    ci = np.floor((plon[sel] - W) / (R * g)).astype(int)
    ok = (ri >= 0) & (ri < H // g) & (ci >= 0) & (ci < WD // g)
    out = {}
    for s, val in [("m", c20[sel]), ("x", 0.6 * c20[sel] + 0.4 * c30[sel])]:
        sm, n = np.zeros((H // g, WD // g)), np.zeros((H // g, WD // g))
        np.add.at(sm, (ri[ok], ci[ok]), val[ok])
        np.add.at(n, (ri[ok], ci[ok]), 1)
        out[s] = coarse(np.where(n > 0, sm / np.maximum(n, 1), np.nan), g)
    return out


def pct(var):
    h = cckp(var, "h")
    return {s: coarse((cckp(var, s) / h - 1) * 100) for s in "mx"}


BUILD = {
    "tx": build_tx, "tn": build_tn, "pra": build_pra, "ws": build_ws, "rfs": build_rfs, "cfs": build_cfs,
    "hd35": lambda: {s: coarse(cckp("hd35", s)) for s in SCEN},
    "tr": lambda: {s: coarse(cckp("tr", s)) for s in SCEN},
    "spei": lambda: {s: coarse(cckp("spei12", s)) for s in SCEN},
    "cdd": lambda: {s: coarse(cckp("cdd", s)) for s in SCEN},
    "rx5": lambda: pct("rx5day"),
    "rfc": build_rfc,
}

# cities (Natural Earth), European countries only, pop >= 50k
EU = set("ALB AND AUT BEL BGR BIH BLR CHE CYP CZE DEU DNK ESP EST FIN FRA GBR GRC HRV HUN IRL ISL ITA KOS "
         "XKX LIE LTU LUX LVA MCO MDA MKD MLT MNE NLD NOR POL PRT ROU RUS SMR SRB SVK SVN SWE UKR".split())
cities = []
for ft in json.load(open(os.path.join(DL, "ne/places.geojson")))["features"]:
    q = ft["properties"]
    r, c = int((N - q["latitude"]) / R), int((q["longitude"] - W) / R)
    if q["adm0_a3"] in EU and q["pop_max"] >= 50000 and 3 <= r < H - 3 and 3 <= c < WD - 3:
        cities.append([q["name"], q["adm0name"], q["pop_max"], round(q["latitude"], 3), round(q["longitude"], 3), r, c])
cities.sort(key=lambda x: -x[2])
near = [(dr, dc) for dr in range(-3, 4) for dc in range(-3, 4)]
near.sort(key=lambda d: d[0] ** 2 + d[1] ** 2)


def at_city(a, r, c):
    """Value at the city pixel, or the nearest valid pixel within ~3 km (coastal cities can sit on a sea pixel)."""
    for dr, dc in near:
        v = a[r + dr, c + dc]
        if np.isfinite(v):
            return round(float(v), 1)
    return None


cv, meta = {}, {}
for lid, build in BUILD.items():
    lo, hi = ENC[lid]
    for s, a in build().items():
        a = np.where(sea, np.nan, a)
        code = np.where(np.isfinite(a), 1 + np.round((np.clip(a, lo, hi) - lo) / (hi - lo) * 254), 0).astype(np.uint8)
        make_data_tiles(code, W, N, R, os.path.join(ROOT, f"tiles/data/{lid}_{s}"))
        cv[f"{lid}_{s}"] = [at_city(a, c[5], c[6]) for c in cities]
        meta.setdefault(lid, {"lo": lo, "hi": hi, "sc": ""})["sc"] += s
        print(lid, s, "min/median/max", *np.round(np.nanpercentile(a, [0, 50, 100]), 1), flush=True)

os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
with open(os.path.join(ROOT, "data/layers.js"), "w") as fh:
    fh.write("window.ENC=" + json.dumps(meta, separators=(",", ":")) + ";\n")
with open(os.path.join(ROOT, "data/cities.js"), "w") as fh:
    fh.write("window.CITIES=" + json.dumps([c[:5] for c in cities], ensure_ascii=False, separators=(",", ":")) + ";\n")
    fh.write("window.CV=" + json.dumps(cv, separators=(",", ":")) + ";\n")
print("cities", len(cities))
