# Europe climate risk map (2050)

Double-click `start.command`. It starts a small local web server and opens the map in your browser.
(The browser reads the data tiles to mix layers, and browsers allow that only from a server, not from a double-clicked HTML file.)
Or run `python3 -m http.server 8000` in this folder and open http://localhost:8000.
It needs internet for the base map and the two live layers (burnt areas, forest loss).

## Versions

`versions.html` compares five ways to draw the same data, plus the classic map (`index.html`):
`v1.html` engraving, `v2.html` survey contours, `v3.html` halftone, `v4.html` atlas plates, `v5.html` field dossier.
All of them use one engine (`app/core.js`, `app/core.css`): data tiles, panel, legend frame, readout, city ranking
and base map. A version only defines how the hazards are drawn (`paint`) and its legend.

## What is in it

- `tiles/data/{layer}_{h|m|x}` - every hazard on a 30" (~1 km) grid as grey-value tiles (today, 2050 SSP2-4.5, 2050 SSP5-8.5).
  The browser decodes them with the ranges in `data/layers.js`. Layers from 25 km or basin sources are repeated, not smoothed.
- `data/cities.js` - European cities with 50 000+ people (Natural Earth) and their value for every layer
- `tiles/river`, `tiles/coast` - flood depth overlays (90 m, 450 m)
- `data/base.js` - land, lakes and borders (Natural Earth) for the base map in the site's own colours
- `build/` - the scripts that made the files above

## Rebuild

Download into one folder (`DL`), then run `river.py`, `coastal.py`, `layers.py`, `basemap.py` with `DL` as the first argument
(Python 3.13 with numpy, netCDF4, rasterio, pyogrio, geopandas, shapely, scipy, pillow).

| `DL` subfolder | Source |
|---|---|
| `cckp/` | `https://wbg-cckp.s3.amazonaws.com/data/cmip6-x0.25/{var}/ensemble-all-{scenario}/climatology-{var}-{agg}-mean_cmip6-x0.25_ensemble-all-{scenario}_climatology_median_{period}.nc` for agg = annual: hd35, tr, spei12, cdd, rx5day, pr; agg = seasonal: tasmax, tasmin. Historical 1995-2014, ssp245 and ssp585 2040-2059 |
| `chelsa/` | `https://os.zhdk.cloud.switch.ch/chelsav2/GLOBAL/climatologies/1981-2010/bio/CHELSA_bio{5,12}_1981-2010_V.2.1.tif` and `.../tasmin/CHELSA_tasmin_{07,08}_1981-2010_V.2.1.tif` |
| `aq/` | `https://files.wri.org/aqueduct/aqueduct-4-0-water-risk-data.zip` (unzip the GDB folder) |
| `riverflood/rp100.tif` | `https://jeodpp.jrc.ec.europa.eu/ftp/public/JRC-OpenData/CEMS-EFAS/flood_hazard/Europe_RP100_filled_depth.tif` |
| `pwb/pwb.tif` | same folder, `Europe_permanent_water_bodies.tif` |
| `peseta/high.nc` | `https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/PESETAIV/LATEST/disEnsemble_highExtremes.nc` |
| `liscoast/` | `https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/LISCOAST/10012/LATEST/globalTWL_{baseline,RCP45,RCP85}.nc` |
| `etopo/` | NOAA ETOPO 2022 15" surface tiles N45/N60/N75 x W030/W015/E000/E015/E030 from `https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/15s/15s_surface_elev_netcdf/` |
| `ne/` | Natural Earth `ne_10m_land.geojson`, `ne_10m_lakes.geojson`, `ne_10m_admin_0_boundary_lines_land.geojson`, `ne_10m_populated_places_simple.geojson` (github.com/nvkelso/natural-earth-vector) |
