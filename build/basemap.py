"""Natural Earth land, large lakes and country borders for Europe -> data/base.js (drawn in the site's own colours)."""
import json
import os

from shapely.geometry import box, mapping, shape

from common import DL, ROOT

CLIP = box(-30, 30, 50, 75)


def load(name, tol, keep=lambda p: True):
    out = []
    for f in json.load(open(os.path.join(DL, f"ne/{name}.geojson")))["features"]:
        if not keep(f["properties"]):
            continue
        g = shape(f["geometry"]).intersection(CLIP)
        if not g.is_empty:
            g = g.simplify(tol, preserve_topology=True)
            out.append({"type": "Feature", "properties": {}, "geometry": mapping(g)})
    return {"type": "FeatureCollection", "features": out}


def rounded(o):  # ~100 m precision keeps the file small
    if isinstance(o, float):
        return round(o, 3)
    if isinstance(o, (list, tuple)):
        return [rounded(x) for x in o]
    if isinstance(o, dict):
        return {k: rounded(v) for k, v in o.items()}
    return o


base = {
    "land": load("land", 0.005),
    "lakes": load("lakes", 0.005, lambda p: (p.get("scalerank") or 9) <= 4),
    "borders": load("borders", 0.005),
}
with open(os.path.join(ROOT, "data/base.js"), "w") as fh:
    fh.write("window.BASE=" + json.dumps(rounded(base), separators=(",", ":")) + ";\n")
print({k: len(v["features"]) for k, v in base.items()}, os.path.getsize(os.path.join(ROOT, "data/base.js")) // 1024, "KB")
