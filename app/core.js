/* Shared engine for every map version: data tiles, panel, legend frame, readout, ranking, base map.
   A version calls CM.start({ paint, legend, glyph, ... }) and only decides how hazards are drawn. */
(() => {
const ENC = window.ENC, CITIES = window.CITIES, CV = window.CV;
const clamp = x => Math.max(0, Math.min(1, x));
const ok = x => x !== null && x !== undefined && !Number.isNaN(x);
const fmt = v => !ok(v) ? '-' : Math.abs(v) >= 10 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString();

// s = [value with no concern, value that is severe]; nd0 = no data counts as no concern
const DATA = [
  { id: 'tx', g: 'Heat', name: 'Summer heat', res: '1 km', unit: 'average daily high in the hottest month', u: '°C', s: [26, 36] },
  { id: 'tn', g: 'Heat', name: 'Warm nights', res: '1 km', unit: 'average night low in the hottest month', u: '°C', s: [14, 22] },
  { id: 'hd35', g: 'Heat', name: 'Very hot days', res: '25 km', unit: 'days a year above 35 °C', u: 'd', s: [0, 40] },
  { id: 'tr', g: 'Heat', name: 'Tropical nights', res: '25 km', unit: 'nights a year above 20 °C', u: 'n', s: [0, 60] },
  { id: 'ws', g: 'Water', name: 'Water stress', res: 'basin', unit: 'Aqueduct score 0-5, 4 and up = extremely high', u: '', s: [1, 5] },
  { id: 'pra', g: 'Water', name: 'Low rainfall', res: '1 km', unit: 'rain per year, less is drier', u: 'mm', s: [700, 300] },
  { id: 'spei', g: 'Water', name: 'Drought', res: '25 km', unit: 'SPEI-12, below 0 is drier than 1995-2014', u: '', s: [0, -1.2] },
  { id: 'cdd', g: 'Water', name: 'Dry spells', res: '25 km', unit: 'longest run of days under 1 mm rain', u: 'd', s: [20, 80] },
  { id: 'rfs', g: 'Floods', name: 'River floods', res: '1 km', unit: 'share of land in the 100-year flood zone', u: '%', s: [0, 50] },
  { id: 'rfc', g: 'Floods', name: 'River flood trend', res: '5 km', unit: 'change of the 100-year river flow', u: '%', s: [0, 40], nd0: true, sign: true },
  { id: 'cfs', g: 'Floods', name: 'Coastal floods', res: '1 km', unit: 'share of land below the 100-year sea level, no dikes', u: '%', s: [0, 50] },
  { id: 'rx5', g: 'Floods', name: 'Heavy rain', res: '25 km', unit: 'change in the wettest 5 days of the year', u: '%', s: [0, 25], sign: true },
];
const byId = Object.fromEntries(DATA.map(l => [l.id, l]));
const CENTRE = [53, 14]; // middle of mapped Europe, between Berlin and Prague
const BOX = [[33.875, -25.125], [72.125, 45.125]];
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const LIVE = [
  { id: 'riverdepth', name: 'River depth 90 m', note: 'Today’s 100-year river flood, darker = deeper',
    lyr: c => L.tileLayer('tiles/river/{z}/{x}/{y}.png', { pane: 'detail', className: c, minNativeZoom: 4, maxNativeZoom: 10, bounds: BOX, errorTileUrl: BLANK, opacity: .85, attribution: 'Copernicus EMS / JRC' }) },
  { id: 'coastdepth', name: 'Coast depth 450 m', note: '2050 high scenario 100-year sea flood, no dikes',
    lyr: c => L.tileLayer('tiles/coast/{z}/{x}/{y}.png', { pane: 'detail', className: c, minNativeZoom: 4, maxNativeZoom: 9, bounds: BOX, errorTileUrl: BLANK, opacity: .8, attribution: 'JRC LISCoAsT, NOAA ETOPO' }) },
  { id: 'forest', name: 'Forest loss', note: 'Tree cover lost 2001-2024, live (Global Forest Watch)',
    lyr: c => L.tileLayer('https://tiles.globalforestwatch.org/umd_tree_cover_loss/latest/dynamic/{z}/{x}/{y}.png', { pane: 'detail', className: c, maxNativeZoom: 12, attribution: 'Hansen/UMD, Global Forest Watch' }) },
  { id: 'fire', name: 'Burnt areas', note: 'Wildfires since 2000, live (EFFIS), zoom in for shapes',
    lyr: c => L.tileLayer.wms('https://maps.effis.emergency.copernicus.eu/effis', { pane: 'detail', className: c, layers: 'modis.ba', format: 'image/png', transparent: true, version: '1.1.1', time: '2000-01-01/2026-12-31', opacity: .75, attribution: 'EFFIS' }) },
];
const PERIODS = { h: 'Today', m: '2050 moderate', x: '2050 high' };
const PLONG = { h: 'Today, recent climate', m: '2050 moderate, SSP2-4.5', x: '2050 high, SSP5-8.5' };

const st = { period: 'm', mode: null, on: new Set(), w: Object.fromEntries(DATA.map(l => [l.id, 1])), minPop: 100000, country: '', pick: null };
const per = l => ENC[l.id].sc.includes(st.period) ? st.period : (st.period === 'h' ? 'm' : 'h');
const dec = (id, c) => ENC[id].lo + (c - 1) / 254 * (ENC[id].hi - ENC[id].lo);
const sev = (l, v) => clamp((v - l.s[0]) / (l.s[1] - l.s[0]));
const selData = () => [...st.on].map(id => byId[id]).filter(Boolean); // selection order
const show = (l, v) => ok(v) ? (l.sign && v > 0 ? '+' : '') + fmt(v) : '-';
const withUnit = (l, v) => show(l, v) + (ok(v) && l.u ? (l.u === '°C' || l.u === 'mm' ? ' ' : '') + l.u : '');
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
let O = {}, map, hz, col = {};

// ---------- data tiles ----------
const cache = new Map(), scratch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
scratch.canvas.width = scratch.canvas.height = 256;
function px(url) {
  let p = cache.get(url);
  if (p) { cache.delete(url); cache.set(url, p); return p; }
  p = new Promise(res => {
    const im = new Image();
    im.onload = () => {
      scratch.clearRect(0, 0, 256, 256); scratch.drawImage(im, 0, 0);
      const d = scratch.getImageData(0, 0, 256, 256).data, a = new Uint8Array(65536);
      for (let i = 0; i < 65536; i++) a[i] = d[i * 4];
      res(a);
    };
    im.onerror = () => res(null); // no tile = sea, no data
    im.src = url;
  });
  cache.set(url, p);
  if (cache.size > 1600) cache.delete(cache.keys().next().value);
  return p;
}
const url = (l, p, z, x, y) => `tiles/data/${l.id}_${p}/${z}/${x}/${y}.png`;
const luts = {};
const lut = (l, p) => luts[l.id + p] || (luts[l.id + p] = Float32Array.from({ length: 256 }, (_, c) => c ? sev(l, dec(l.id, c)) : -1));

/* Severity (0..1, -1 = no data) for one display tile at n x n pixels. Data exists for zoom 3-7 (1 km at 7);
   deeper zooms resample the zoom-7 tile bilinearly so line-work stays sharp at every zoom.
   coarsen > 0 reads a coarser level on purpose, for versions that need a generalised field (contours). */
async function field(l, p, z, x, y, n, coarsen = 0) {
  const nz = Math.max(3, Math.min(7, z) - coarsen), k = z - nz, s2 = 2 ** k, tx = Math.floor(x / s2), ty = Math.floor(y / s2);
  const d = await px(url(l, p, nz, tx, ty));
  if (!d) return null;
  const T = lut(l, p), out = new Float32Array(n * n), f = s2 * n / 256;
  const ox = (x - tx * s2) * 256 / s2, oy = (y - ty * s2) * 256 / s2;
  for (let j = 0; j < n; j++) {
    const v = oy + (j + .5) / f - .5, y0 = Math.max(0, Math.min(255, Math.floor(v))), y1 = Math.min(255, y0 + 1), fy = Math.max(0, Math.min(1, v - y0));
    for (let i = 0; i < n; i++) {
      const u = ox + (i + .5) / f - .5, x0 = Math.max(0, Math.min(255, Math.floor(u))), x1 = Math.min(255, x0 + 1), fx = Math.max(0, Math.min(1, u - x0));
      const a = d[y0 * 256 + x0], b = d[y0 * 256 + x1], c = d[y1 * 256 + x0], e = d[y1 * 256 + x1];
      out[j * n + i] = a && b && c && e
        ? (T[a] * (1 - fx) + T[b] * fx) * (1 - fy) + (T[c] * (1 - fx) + T[e] * fx) * fy
        : T[d[(fy < .5 ? y0 : y1) * 256 + (fx < .5 ? x0 : x1)]];
    }
  }
  return out;
}
// weighted mean severity of the selected layers per pixel (-1 where nothing is known)
function combine(F, sel) {
  const n = F.find(Boolean)?.length || 0, out = new Float32Array(n).fill(-1);
  const w = sel.map(l => st.w[l.id]), nd0 = sel.map(l => !!l.nd0);
  for (let p = 0; p < n; p++) {
    let sw = 0, ww = 0, wz = 0, real = false;
    for (let i = 0; i < F.length; i++) {
      const s = F[i] ? F[i][p] : -1;
      if (s >= 0) { sw += w[i] * s; ww += w[i]; if (!nd0[i]) real = true; } else if (nd0[i]) wz += w[i];
    }
    if (real) ww += wz;
    if (ww > 0 && (real || nd0.every(Boolean))) out[p] = sw / ww;
  }
  return out;
}
function score(vals, raw) { // vals: id -> value; raw = no clamp (breaks ties in the ranking)
  let sw = 0, ww = 0;
  for (const l of selData()) {
    const v = vals[l.id], s = ok(v) ? (raw ? (v - l.s[0]) / (l.s[1] - l.s[0]) : sev(l, v)) : (l.nd0 ? 0 : null);
    if (s !== null) { sw += st.w[l.id] * s; ww += st.w[l.id]; }
  }
  return ww ? 100 * sw / ww : null;
}

const Hazards = L.GridLayer.extend({
  _clampZoom(z) { return L.GridLayer.prototype._clampZoom.call(this, Math.round(z)); }, // Leaflet's redraw() skips the rounding at fractional zoom
  createTile(co, done) {
    const R = Math.min(2, Math.ceil(window.devicePixelRatio || 1)), n = 256 * R;
    const cv = document.createElement('canvas'); cv.width = cv.height = n; cv.style.width = cv.style.height = '256px';
    const sel = selData();
    Promise.all(sel.map(l => field(l, per(l), co.z, co.x, co.y, n, O.coarsen || 0))).then(F => {
      if (F.some(Boolean)) {
        const ctx = cv.getContext('2d'), img = ctx.createImageData(n, n);
        O.paint(img.data, { sel, F, n, R, co, combine: () => combine(F, sel) });
        ctx.putImageData(img, 0, 0);
      }
      done(null, cv);
    });
    return cv;
  }
});

// ---------- values at a point ----------
async function valueAt(l, p, lat, lng) {
  if (!ENC[l.id].sc.includes(p)) return null;
  const n = 2 ** 7 * 256, X = (lng + 180) / 360 * n, Y = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n;
  const d = await px(url(l, p, 7, Math.floor(X / 256), Math.floor(Y / 256)));
  const c = d ? d[Math.floor(Y % 256) * 256 + Math.floor(X % 256)] : 0;
  return c ? dec(l.id, c) : null;
}
async function profile(lat, lng) { // every layer, every period
  const V = {};
  await Promise.all(DATA.flatMap(l => ['h', 'm', 'x'].map(async p => { V[l.id + p] = await valueAt(l, p, lat, lng); })));
  return V;
}
function nearestCity(lat, lng, km = 25) {
  let best = null, bd = 1e9;
  for (const c of CITIES) { const d = (c[3] - lat) ** 2 + ((c[4] - lng) * Math.cos(lat * Math.PI / 180)) ** 2; if (d < bd) { bd = d; best = c; } }
  return Math.sqrt(bd) * 111 < km ? best : null;
}

// ---------- panel ----------
const $ = s => document.querySelector(s);
function panelHTML() {
  const groups = ['Heat', 'Water', 'Floods'];
  return `<button id="toggle">Layers</button>
  <header class="ph"><div class="eyebrow">${O.eyebrow || 'Europe · climate risk'}</div><h1>${O.title}</h1></header>
  <input type="search" id="search" list="citylist" placeholder="Find a city" aria-label="Find a city"><datalist id="citylist"></datalist>
  <div class="lab">Time</div>
  <div class="seg" id="period">${Object.entries(PERIODS).map(([k, v]) => `<button data-v="${k}" class="${k === st.period ? 'on' : ''}">${v}</button>`).join('')}</div>
  <nav class="tabs" id="tabs"><button data-t="layers" class="on">Layers</button><button data-t="cities">Cities</button><button data-t="about">About</button></nav>
  <section class="tab" data-t="layers">
  ${O.modes ? `<div class="lab">Show as</div><div class="seg" id="mode">${O.modes.map(m => `<button data-v="${m.id}" class="${m.id === st.mode ? 'on' : ''}">${m.label}</button>`).join('')}</div>` : ''}
  <div class="lab">Hazards <span class="hint" id="hzhint"></span></div>
  <div id="hazards">${O.hazardsHTML ? O.hazardsHTML() : groups.map(g => `<div class="grp">${g}</div>` + DATA.filter(l => l.g === g).map(l =>
    `<label class="hz" data-id="${l.id}"><input type="checkbox" value="${l.id}"><span class="box"></span><span class="gl-wrap"></span><span class="nm">${l.name}</span><span class="rs">${l.res}</span>
     <span class="wt"><input type="range" min="0" max="3" step="0.5" value="1" data-w="${l.id}" aria-label="Weight of ${l.name}"><output>1</output></span></label>`).join('')).join('')}</div>
  <div class="lab">Overlays</div>
  <div class="chips" id="live">${LIVE.map(o => `<button class="chip" data-id="${o.id}" title="${o.note}">${o.name}</button>`).join('')}<button class="chip on" data-id="labels">Names</button></div>
  ${O.panelExtra || ''}
  </section>
  <section class="tab" data-t="cities" hidden>
    <p class="note" style="margin:0 0 10px">Cities with the lowest score for the hazards you selected.</p>
    <div class="filters"><select id="country" aria-label="Country"><option value="">All countries</option></select>
    <select id="minpop" aria-label="Population"><option value="50000">50k+</option><option value="100000" selected>100k+</option><option value="250000">250k+</option><option value="1000000">1M+</option></select></div>
    <div class="rankhead" aria-hidden="true"><span></span><span>City</span><span>Score</span></div>
    <ol class="rank" id="rank"></ol>
  </section>
  <section class="tab about" data-t="about" hidden>
    <h3>How to read it</h3>
    <p>Each hazard becomes a number from 0 (no concern) to 1 (severe). The score is their weighted average, times 100. The thresholds are my choice, not a standard.</p>
    <ul>${DATA.map(l => `<li>${l.name}: ${withUnit(l, l.s[0])} = 0, ${withUnit(l, l.s[1])} = 1. ${l.unit[0].toUpperCase() + l.unit.slice(1)}.</li>`).join('')}</ul>
    <h3>Sources</h3>
    <ul><li>1 km heat and rain: CHELSA 1981-2010 plus the World Bank CMIP6 change to 2040-2059 ("delta" method).</li>
    <li>25 km heat, drought, dry spells, heavy rain: World Bank CCKP, CMIP6, median of about 25 models.</li>
    <li>Water stress: WRI Aqueduct 4.0 per river basin. 2050 moderate uses SSP3-7.0 (no SSP2-4.5 run exists).</li>
    <li>River floods: Copernicus EMS / JRC, 100-year flood, today. Trend: JRC PESETA IV.</li>
    <li>Coastal floods: JRC LISCoAsT extreme sea levels on NOAA ETOPO 2022 elevation, my calculation.</li>
    <li>Forest loss: Global Forest Watch. Burnt areas: EFFIS. Base map and cities: Natural Earth.</li></ul>
    <p>Each source keeps its licence (e.g. Aqueduct CC BY 4.0, JRC flood maps ODbL). Keep the credits if you reuse this. <a href="https://github.com/maciejgorczak/europe-climate-map">Code and build steps</a>.</p>
    <h3>Limits</h3>
    <ul><li>Only 1 km layers show local detail. 25 km layers average coast and inland, valley and mountain.</li>
    <li>2050 heat at 1 km is probably 0.3 °C too low: the base climate is 1981-2010.</li>
    <li>Flood layers ignore dikes. They show exposure, not certain damage.</li>
    <li>Not included: future wildfire danger, storms, landslides, city heat islands, cost of living, politics.</li></ul>
  </section>`;
}

function refresh() {
  Object.keys(luts).forEach(k => delete luts[k]);
  hz.redraw();
  document.querySelectorAll('#hazards [data-id]').forEach(el => {
    const on = st.on.has(el.dataset.id);
    el.classList.toggle('on', on);
    el.classList.toggle('off', !!(!on && O.maxOn && st.on.size >= O.maxOn));
    el.classList.toggle('weighted', O.weights === 'always' || (O.weights === 'mode' && st.mode === 'score'));
    const g = el.querySelector('.gl-wrap');
    if (g && O.glyph) g.innerHTML = O.glyph(byId[el.dataset.id], [...st.on].indexOf(el.dataset.id));
  });
  $('#hzhint').textContent = O.maxOn ? `up to ${O.maxOn}` : '';
  for (const o of LIVE) {
    $(`#live [data-id="${o.id}"]`).classList.toggle('on', st.on.has(o.id));
    if (st.on.has(o.id)) live[o.id] = (live[o.id] || o.lyr(O.inkOverlays === false ? '' : 'ink-tiles')).addTo(map);
    else if (live[o.id]) map.removeLayer(live[o.id]);
  }
  legend(); ranking();
  O.after && O.after(st);
}
const live = {};

function legend() {
  const sel = selData(), notes = [];
  for (const l of sel) if (per(l) !== st.period) notes.push(`${l.name}: ${per(l) === 'h' ? 'today only' : 'no today value, shows 2050 moderate'}.`);
  if (st.on.has('ws') && st.period !== 'h') notes.push(`Water stress 2050 uses Aqueduct ${st.period === 'm' ? 'SSP3-7.0' : 'SSP5-8.5'}.`);
  const lv = LIVE.filter(o => st.on.has(o.id)).map(o => o.name).join(', ');
  const body = sel.length ? O.legend(sel) : '<div class="fn" style="margin:0">Select a hazard on the left.</div>';
  $('#legend').innerHTML = `<div class="t">${PLONG[st.period]}</div>${body}${lv ? `<div class="fn">Overlays: ${lv}.</div>` : ''}${notes.length ? `<div class="fn">${notes.join(' ')}</div>` : ''}`;
}
const rangeLabel = l => `${show(l, l.s[0])}→${withUnit(l, l.s[1])}`;

const cityVal = (l, i) => (CV[l.id + '_' + per(l)] || [])[i];
function ranking() {
  const el = $('#rank');
  if (!selData().length) { el.innerHTML = '<li class="empty">Select a hazard to rank cities.</li>'; return; }
  const list = CITIES.map((c, i) => { const v = Object.fromEntries(selData().map(l => [l.id, cityVal(l, i)])); return { c, i, s: score(v), r: score(v, true) }; })
    .filter(x => x.c[2] >= st.minPop && (!st.country || x.c[1] === st.country) && ok(x.s))
    .sort((a, b) => a.s - b.s || a.r - b.r).slice(0, 15);
  if (!list.length) { el.innerHTML = '<li class="empty">No city this big here. Lower the population.</li>'; return; }
  el.innerHTML = list.map(({ c, i, s }) => {
    const worst = selData().filter(l => ok(cityVal(l, i)) && sev(l, cityVal(l, i)) >= .4).map(l => l.name);
    return `<li data-i="${i}"><span><b>${c[0]}</b><span class="c">${c[1]}${worst.length ? ' · watch ' + worst.join(', ').toLowerCase() : ''}</span></span><span class="s">${fmt(s)}</span></li>`;
  }).join('');
}

// ---------- readout ----------
let pin;
async function pick(lat, lng, title) {
  st.pick = { lat, lng };
  const icon = L.divIcon({ className: 'pin', iconSize: [0, 0], html: '<svg width="22" height="22"><path d="M11 0v8M11 14v8M0 11h8M14 11h8" stroke="var(--accent)" stroke-width="1.5"/><rect x="8.5" y="8.5" width="5" height="5" fill="none" stroke="var(--accent)" stroke-width="1.5"/></svg>' });
  pin ? pin.setLatLng([lat, lng]) : (pin = L.marker([lat, lng], { icon, pane: 'pin', interactive: false }).addTo(map));
  const near = nearestCity(lat, lng);
  const name = title || (near ? 'Near ' + near[0] + ', ' + near[1] : 'Selected place');
  const pop = O.readout ? null : L.popup({ maxWidth: 330, autoPanPadding: [20, 20] }).setLatLng([lat, lng]).setContent('<div class="pop">Reading values…</div>').openOn(map);
  const V = await profile(lat, lng);
  if (O.readout) return O.readout({ lat, lng, name, V });
  const row = l => `<tr><td>${l.name} <small>${l.res}</small></td>${['h', 'm', 'x'].map(p => `<td>${withUnit(l, V[l.id + p])}</td>`).join('')}</tr>`;
  const sel = selData(), rest = DATA.filter(l => !st.on.has(l.id));
  const cur = Object.fromEntries(DATA.map(l => [l.id, V[l.id + per(l)]]));
  const sc = score(cur);
  pop.setContent(`<div class="pop"><h3>${name}</h3><div class="ll">${lat.toFixed(3)}°N ${lng.toFixed(3)}°E</div>
    <table><tr><th></th><th>Today</th><th>2050 mod</th><th>2050 high</th></tr>${sel.map(row).join('')}</table>
    ${ok(sc) ? `<div class="sc">Score, ${PERIODS[st.period].toLowerCase()}: <b>${fmt(sc)}</b> / 100</div>` : ''}
    <details class="more"><summary>All other hazards</summary><table>${rest.map(row).join('')}</table></details></div>`);
}
function goCity(c) { map.flyTo([c[3], c[4]], 9, { duration: .8 }); map.once('moveend', () => pick(c[3], c[4], `${c[0]}, ${c[1]}`)); }

// ---------- base map ----------
function baseMap() {
  const B = window.BASE, r = L.canvas({ pane: 'land', padding: .5 }), rb = L.canvas({ pane: 'borders', padding: .5 });
  L.geoJSON(B.land, { renderer: r, interactive: false, style: { stroke: false, fillColor: col.bgHex, fillOpacity: 1 } }).addTo(map);
  L.geoJSON(B.lakes, { renderer: r, interactive: false, style: { stroke: false, fillColor: col.seaHex, fillOpacity: 1 } }).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    { pane: 'land', className: 'street-tiles', minZoom: 9, maxNativeZoom: 16, opacity: .35, attribution: 'Streets &copy; Esri' }).addTo(map);
  L.geoJSON(B.land, { renderer: rb, interactive: false, style: { color: col.inkHex, weight: .7, opacity: .55, fill: false } }).addTo(map);
  L.geoJSON(B.lakes, { renderer: rb, interactive: false, style: { color: col.inkHex, weight: .5, opacity: .4, fill: false } }).addTo(map);
  L.geoJSON(B.borders, { renderer: rb, interactive: false, style: { color: col.inkHex, weight: .8, opacity: .5, dashArray: '4 3' } }).addTo(map);
  map.attributionControl.addAttribution('Base: Natural Earth');
  // city names in the site's mono type, thinned by zoom so they never collide
  const names = L.layerGroup();
  const draw = () => {
    names.clearLayers();
    const z = map.getZoom(), min = z < 4.5 ? 3e6 : z < 5.25 ? 1.5e6 : z < 6 ? 6e5 : z < 7 ? 2.5e5 : z < 8 ? 1e5 : 5e4;
    const b = map.getBounds().pad(.05), placed = [];
    for (const c of CITIES) {
      if (c[2] < min || !b.contains([c[3], c[4]])) continue;
      const p = map.latLngToContainerPoint([c[3], c[4]]), r = [p.x - 4, p.y - 8, p.x + 10 + c[0].length * 6.6, p.y + 8];
      if (placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) continue;
      placed.push(r);
      names.addLayer(L.marker([c[3], c[4]], { pane: 'labels', interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'city', iconSize: [0, 0], html: `<i></i><span>${c[0]}</span>` }) }));
    }
  };
  map.on('zoomend moveend', draw); draw();
  return names;
}

// ---------- start ----------
/* Zoom that shows Europe around CENTRE. Portrait screens fit Europe's width (-12..42 E). Landscape screens are
   height-limited, so take the middle between "full width" and "full height" (35..70 N): the far north and
   south crop a little, but Europe fills the screen and no Asia shows. */
function startZoom() {
  const { x, y } = map.getSize(), merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const zw = Math.log2(x / 256 * 360 / 54), zh = Math.log2(y / 256 * 2 * Math.PI / (merc(70) - merc(35)));
  return Math.ceil((zh < zw ? (zw + zh) / 2 : zw) * 4) / 4;
}

function start(opts) {
  O = Object.assign({ title: 'Climate risk 2050', defaultOn: ['tx', 'ws', 'rfs'], weights: 'mode' }, opts);
  document.body.classList.add('field');
  st.mode = O.modes ? O.modes[0].id : null;
  O.defaultOn.forEach(id => st.on.add(id));
  const cs = getComputedStyle(document.body);
  for (const [k, v] of Object.entries({ ink: '--ink', soft: '--ink-soft', muted: '--ink-muted', accent: '--accent', bg: '--bg', bg2: '--bg-2', line: '--line', sea: '--sea' })) {
    col[k + 'Hex'] = cs.getPropertyValue(v).trim(); col[k] = rgb(col[k + 'Hex']);
  }
  $('#panel').innerHTML = panelHTML();
  map = L.map('map', { zoomSnap: .25, zoomDelta: .5, minZoom: 3, maxZoom: 13, zoomControl: false });
  L.control.zoom({ position: 'topright' }).addTo(map);
  for (const [n, z] of [['land', 200], ['hazard', 300], ['detail', 350], ['borders', 380], ['labels', 600], ['pin', 650]]) {
    map.createPane(n).style.zIndex = z;
    if (n !== 'hazard') map.getPane(n).style.pointerEvents = 'none';
  }
  map.setView(CENTRE, startZoom(), { animate: false });
  const names = baseMap().addTo(map);
  hz = new Hazards({ pane: 'hazard', bounds: BOX, keepBuffer: 1, updateWhenZooming: false, opacity: O.opacity || 1,
    attribution: 'CHELSA, World Bank CCKP, WRI Aqueduct, JRC' }).addTo(map);
  map.on('click', e => pick(e.latlng.lat, e.latlng.lng));

  // controls
  const segs = (id, key) => $(id) && $(id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st[key] = b.dataset.v; $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); refresh();
  });
  segs('#period', 'period'); segs('#mode', 'mode');
  $('#hazards').addEventListener('click', e => {
    if (e.target.closest('.wt')) { e.preventDefault(); return; }
    const el = e.target.closest('[data-id]'); if (!el) return;
    e.preventDefault();
    const id = el.dataset.id;
    if (st.on.has(id)) st.on.delete(id); else if (!O.maxOn || st.on.size < O.maxOn) st.on.add(id);
    refresh();
  });
  let raf = 0;
  $('#hazards').addEventListener('input', e => {
    if (!e.target.dataset.w) return;
    st.w[e.target.dataset.w] = +e.target.value; e.target.nextElementSibling.textContent = e.target.value;
    cancelAnimationFrame(raf); raf = requestAnimationFrame(refresh);
  });
  $('#live').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    if (b.dataset.id === 'labels') { b.classList.toggle('on'); return b.classList.contains('on') ? names.addTo(map) : map.removeLayer(names); }
    st.on.has(b.dataset.id) ? st.on.delete(b.dataset.id) : st.on.add(b.dataset.id); refresh();
  });
  $('#rank').addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) goCity(CITIES[+li.dataset.i]); });
  $('#country').insertAdjacentHTML('beforeend', [...new Set(CITIES.map(c => c[1]))].sort((a, b) => a.localeCompare(b)).map(n => `<option>${n}</option>`).join(''));
  $('#country').addEventListener('change', e => { st.country = e.target.value; ranking(); });
  $('#minpop').addEventListener('change', e => { st.minPop = +e.target.value; ranking(); });
  $('#citylist').innerHTML = CITIES.map(c => `<option value="${c[0]}, ${c[1]}">`).join('');
  $('#search').addEventListener('change', e => {
    const q = e.target.value.toLowerCase();
    const c = CITIES.find(c => `${c[0]}, ${c[1]}`.toLowerCase() === q) || CITIES.find(c => c[0].toLowerCase().startsWith(q));
    if (c) goCity(c);
  });
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $('#tabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab').forEach(t => { t.hidden = t.dataset.t !== b.dataset.t; });
  });
  $('#toggle').addEventListener('click', () => $('#panel').classList.toggle('open'));
  if (location.protocol === 'file:') $('#banner').style.display = 'block';
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => location.reload());
  refresh();
  return map;
}

window.CM = { DATA, LIVE, st, col, start, refresh, selData, per, sev, fmt, ok, show, withUnit, rangeLabel, profile, valueAt, combine, score,
  pick, goCity, url, px, lut, PERIODS, get map() { return map; } };
})();
