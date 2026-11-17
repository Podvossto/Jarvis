// The road map: a map card that zooms down to streets. The overlay shows it with MapLibre in a sandboxed frame, on
// OpenFreeMap's vector tiles (free, no key) restyled here into the overlay's ink. Place names are looked up with
// Nominatim (one request a second at most, each answer kept), Thai provinces come from provinces.mjs, and only the
// hosts in safety.mjs's MAP_HOSTS are ever reached.
import { PROVINCES, Q } from './provinces.mjs';
import { BLOCK, GEOCODER, MAP_STYLE, checkDrawAction } from './safety.mjs';

// Named zooms, in MapLibre's levels (0 the whole world, 18 single houses).
export const SCOPES = { country: 5, province: 8, city: 11, district: 13, street: 16 };
// Place names looked up per map: each is up to a second (Nominatim's limit), so a map waits at most this long.
export const LIMITS = { lookups: 4 };

// ---------------------------------------------------------------- Thai provinces by name, Thai or English
// "Chon Buri", "Chonburi", "chon-buri province", "จังหวัดชลบุรี" and "จ.ชลบุรี" are one key.
const key = (s) => String(s ?? '').normalize('NFC').toLowerCase().trim()
  .replace(/^(จังหวัด|จ\.)\s*/u, '').replace(/^(changwat|province of)\s+/, '').replace(/\s+(province|changwat)$/, '')
  .replace(/[\s\-'’.]+/gu, '');
const BY_KEY = new Map();
PROVINCES.forEach((p, i) => { for (const n of [p.en, p.th, ...p.a]) BY_KEY.set(key(n), i); });
const KEYS = [...BY_KEY.keys()];
function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { const next = [i]; for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); row = next; }
  return row[b.length];
}
/** The Thai province called that, or null. Short forms are fine when only one province starts that way
 *  ("นครศรีฯ", "ประจวบ", "Nakhon Si"). */
export function findProvince(name) {
  const k = key(name).replace(/ฯ$/u, '');
  if (BY_KEY.has(k)) return PROVINCES[BY_KEY.get(k)];
  if ([...k].length < 3) return null;
  const hits = new Set(KEYS.filter((n) => n.startsWith(k)).map((n) => BY_KEY.get(n)));
  return hits.size === 1 ? PROVINCES[[...hits][0]] : null;
}
/** The nearest province names to a miss, for the model to pick from. */
export function nearProvinces(name) {
  const k = key(name);
  return [...new Set(KEYS.map((n) => [editDistance(k, n), BY_KEY.get(n)]).filter(([d]) => d <= Math.max(2, Math.floor(k.length / 3)))
    .sort((a, b) => a[0] - b[0]).map(([, i]) => i))].slice(0, 3).map((i) => `${PROVINCES[i].en} (${PROVINCES[i].th})`);
}
/** A province's outline as GeoJSON rings ([lon, lat] pairs). */
export function provinceRings(p) {
  return p.r.map((flat) => {
    const out = []; let x = 0, y = 0;
    for (let i = 0; i < flat.length; i += 2) { x += flat[i]; y += flat[i + 1]; out.push([x / Q, y / Q]); }
    out.push(out[0]);
    return out;
  });
}

// ---------------------------------------------------------------- what the model wrote
const LATLON = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
/** "13.75, 100.5" as { lat, lon }, or null for a name. */
export function parseLatLon(s) {
  const m = LATLON.exec(String(s ?? ''));
  if (!m) return null;
  const lat = +m[1], lon = +m[2];
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}
const hasLatLon = (p) => p.lat != null && p.lon != null;
/** zoom as a MapLibre level: a scope's, or the number written; NaN when it's neither. */
export const zoomLevel = (z) => (Object.hasOwn(SCOPES, String(z).trim().toLowerCase()) ? SCOPES[String(z).trim().toLowerCase()] : /^\s*\d+(\.\d+)?\s*$/.test(String(z)) ? +z : NaN);
/** A map mark asks for a road map when it gives place, zoom, a pin by place or a Thai province to shade. */
export const isRoadMap = (m) => m.place != null || m.zoom != null || (m.pins ?? []).some((p) => p.place != null) || (m.shade ?? []).some((s) => !!findProvince(s.name));
/** The province a map's place names, when the map shows it whole (no zoom, or province level or wider). Zoomed in
 *  further, the name is looked up instead: a province's middle is rarely its town ("Bangkok" at city zoom landed in
 *  Lat Krabang). */
// A pin with only a name is looked up by that name, in the map's place when that is a name too: models write
// {name: 'ประตูท่าแพ'} on a map of Chiang Mai, and refusing it cost a whole round trip.
const pinPlace = (p, m) => p.place ?? (p.name ? `${p.name}${m.place != null && !parseLatLon(m.place) ? `, ${m.place}` : ''}` : null);
const wholeProvince = (m) => (m.zoom == null || zoomLevel(m.zoom) <= SCOPES.province ? findProvince(m.place) : null);
/** The names that need looking up (not lat, lon or a province shown whole): the map's centre, then its pins'. */
export function lookups(m) {
  const names = [m.place != null && !wholeProvince(m) ? m.place : null, ...(m.pins ?? []).filter((p) => !hasLatLon(p)).map((p) => pinPlace(p, m))].filter((s) => s != null && !parseLatLon(s));
  return [...new Set(names.map((s) => String(s).trim()))];
}
/** Problems with a road map, as lines for the model ([] when fine). */
export function checkRoadMap(m) {
  const out = [], pins = m.pins ?? [];
  if (m.zoom != null && !(zoomLevel(m.zoom) >= 1 && zoomLevel(m.zoom) <= 18)) out.push(`zoom is ${Object.keys(SCOPES).join(', ')} or a number from 1 to 18.`);
  if (m.place == null && !pins.length && !(m.shade ?? []).length) out.push('needs place (a place name or "lat,lon") to centre on, pins or shade.');
  for (const p of pins) {
    if (pinPlace(p, m) == null && !hasLatLon(p)) out.push(`pin "${p.name}": needs place (a place name or "lat,lon") or lat and lon.`);
    else if (hasLatLon(p) && !(Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)) out.push(`pin "${p.name}": lat must be between -90 and 90 and lon between -180 and 180.`);
  }
  for (const s of m.shade ?? []) if (!findProvince(s.name)) {
    const near = nearProvinces(s.name);
    out.push(`shade: no Thai province "${String(s.name).slice(0, 40)}"${near.length ? ` (nearest: ${near.join(', ')})` : ''}. On a road map shade takes Thai provinces; mark other places with pins.`);
  }
  (m.routes ?? []).forEach((r, k) => { for (const end of [r.from, r.to]) if (!pins.some((p) => p.name === end)) out.push(`route ${k + 1}: no pin is named "${end}"${pins.length ? ` (pins: ${pins.map((p) => `"${p.name}"`).join(', ')})` : ''}.`); });
  const names = lookups(m);
  if (names.length > LIMITS.lookups) out.push(`${names.length} place names to look up; at most ${LIMITS.lookups} per map. Give lat and lon for the rest.`);
  for (const n of names) { const v = checkDrawAction({ kind: 'geocode', text: n }); if (v.level === BLOCK) out.push(`place "${n.slice(0, 40)}": ${v.reason}`); }
  return out;
}

// ---------------------------------------------------------------- looking up place names (Nominatim)
/** Place names to { name, lat, lon, box } (null when nothing matches). One request a second at most, in turn, each
 *  answer kept (the newest `max`); a failed request isn't kept, so it's tried again next time. Only the place's words
 *  are sent: no language, location or anything else about the user. */
export function createGeocoder({ fetchImpl = fetch, now = Date.now, wait = (ms) => new Promise((r) => setTimeout(r, ms)), max = 300, gap = 1100 } = {}) {
  const kept = new Map();
  let queue = Promise.resolve(), last = -Infinity, sent = 0;
  async function ask(q) {
    const url = `${GEOCODER}?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
    if (checkDrawAction({ kind: 'map', url }).level === BLOCK) throw new Error('Blocked for safety.');
    let res;
    try {
      sent++;
      res = await fetchImpl(url, { headers: { 'user-agent': 'Roamies-Sidekick (desktop app; map card)', accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8000) });
    } catch (e) { throw Object.assign(new Error(`couldn't reach the place-name service (${e?.message ?? e})`), { offline: true }); }
    if (!res.ok) throw Object.assign(new Error(`the place-name service answered ${res.status}`), { offline: res.status >= 500 || res.status === 429 || res.status === 403 });
    const hit = (await res.json())?.[0];
    if (!hit) return null;
    const b = (hit.boundingbox ?? []).map(Number), lat = +hit.lat, lon = +hit.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { name: String(hit.display_name ?? q).slice(0, 120), lat, lon, ...(b.length === 4 && b.every(Number.isFinite) ? { box: [b[2], b[0], b[3], b[1]] } : {}) };
  }
  return {
    get sent() { return sent; },
    async find(query) {
      const q = String(query ?? '').trim().replace(/\s+/g, ' '), k = q.toLowerCase();
      const v = checkDrawAction({ kind: 'geocode', text: q });
      if (v.level === BLOCK) throw new Error(`Blocked for safety: ${v.reason}`);
      if (kept.has(k)) { const hit = kept.get(k); kept.delete(k); kept.set(k, hit); return hit; }
      // In turn, a request a second at most however many maps ask at once.
      const run = queue.then(async () => {
        const left = last + gap - now();
        if (left > 0) await wait(left);
        last = now();
        return ask(q);
      });
      queue = run.catch(() => {});
      kept.set(k, run);
      while (kept.size > max) kept.delete(kept.keys().next().value);
      try { const hit = await run; kept.set(k, hit); return hit; } catch (e) { kept.delete(k); throw e; }
    },
  };
}

// ---------------------------------------------------------------- the style, in the overlay's ink
const LED = ['#051214', '#0e5c60', '#28c4b8', '#78ffe2', '#e6fffa'];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** A CSS colour (#rgb, #rrggbb, rgb(a), hsl(a)) as [r, g, b, a], or null. */
export function parseColor(s) {
  const t = String(s).trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(t)) return [...hex(`#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`), 1];
  if (/^#[0-9a-f]{6}$/.test(t)) return [...hex(t), 1];
  const m = /^(rgb|hsl)a?\(([^)]*)\)$/.exec(t);
  if (!m) return null;
  const v = m[2].split(/[\s,/]+/).filter(Boolean).map((x) => parseFloat(x)), a = v[3] ?? 1;
  if (v.length < 3 || v.some((x) => !Number.isFinite(x))) return null;
  if (m[1] === 'rgb') return [v[0], v[1], v[2], a];
  const [h, sat, l] = [v[0], v[1] / 100, v[2] / 100], c = (1 - Math.abs(2 * l - 1)) * sat, f = (n) => { const k = (n + h / 30) % 12; return l - (c / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0) * 255, f(8) * 255, f(4) * 255, a];
}
/** Any colour → the same brightness on the ink ramp: dark stays dark, light becomes bright teal. */
export function inkColor(s) {
  const c = parseColor(s);
  if (!c) return s;
  const L = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255, f = Math.min(0.999, Math.pow(L, 0.8) * 1.15) * (LED.length - 1), i = Math.floor(f), k = f - i;
  const A = hex(LED[i]), B = hex(LED[Math.min(i + 1, LED.length - 1)]);
  return `rgba(${A.map((v, j) => Math.round(v + (B[j] - v) * k)).join(',')},${Math.round(c[3] * 100) / 100})`;
}
const isColor = (v) => typeof v === 'string' && /^(#|rgb|hsl)/i.test(v);
const walk = (v) => (isColor(v) ? inkColor(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
/** Every address a style would make the map load (sources, tiles, glyphs, sprites). */
export function styleUrls(st) {
  const out = [st.glyphs, ...(Array.isArray(st.sprite) ? st.sprite.map((s) => s?.url) : [st.sprite])];
  for (const src of Object.values(st.sources ?? {})) out.push(src.url, ...(src.tiles ?? []));
  return out.filter((u) => u != null).map(String);
}
/** OpenFreeMap's dark style in the ink palette, the lab's restyle: brighter main roads, light labels on a dark halo,
 *  no shaded relief (its rasters fight the palette). Throws when it would load from anywhere outside MAP_HOSTS. */
export function inkStyle(st) {
  const bad = styleUrls(st).find((u) => checkDrawAction({ kind: 'map', url: u.replace(/\{[^}]*\}/g, '0') }).level === BLOCK);
  if (bad) throw new Error(`the map style loads from ${bad.slice(0, 80)}, which isn't allowed`);
  const out = structuredClone(st);
  for (const l of out.layers ?? []) {
    if (l.paint) for (const k of Object.keys(l.paint)) if (/color$/.test(k)) l.paint[k] = walk(l.paint[k]);
    if (l.id === 'background') l.paint = { ...l.paint, 'background-color': '#061618' };
    if (l.type === 'line' && /motorway|trunk|primary/.test(l.id) && !/casing/.test(l.id)) l.paint['line-color'] = '#78ffe2';
    if (l.type === 'symbol') l.paint = { ...l.paint, 'text-color': '#dcfff6', 'text-halo-color': '#051214', 'text-halo-width': 1.4 };
  }
  out.layers = (out.layers ?? []).filter((l) => !/shaded|hillshade/.test(l.source ?? '') && l.type !== 'raster' && l.type !== 'hillshade');
  for (const id of Object.keys(out.sources ?? {})) if (out.sources[id].type === 'raster' || out.sources[id].type === 'raster-dem') delete out.sources[id];
  return out;
}
/** The inked style, fetched once a day; a failure is remembered for half a minute so an offline map fails fast. */
export function createStyles({ fetchImpl = fetch, now = Date.now } = {}) {
  let got = null, at = 0, failed = null;
  return {
    async get() {
      if (got && now() - at < 86_400_000) return got;
      if (failed && now() - failed.at < 30_000) throw failed.err;
      try {
        if (checkDrawAction({ kind: 'map', url: MAP_STYLE }).level === BLOCK) throw new Error('Blocked for safety.');
        let res;
        try { res = await fetchImpl(MAP_STYLE, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8000) }); }
        catch (e) { throw Object.assign(new Error(`couldn't reach ${new URL(MAP_STYLE).hostname} (${e?.message ?? e})`), { offline: true }); }
        if (!res.ok) throw Object.assign(new Error(`${new URL(MAP_STYLE).hostname} answered ${res.status}`), { offline: true });
        got = inkStyle(await res.json()); at = now(); failed = null;
        return got;
      } catch (err) { failed = { err, at: now() }; throw err; }
    },
  };
}

// ---------------------------------------------------------------- everything the overlay needs
const r5 = (v) => Math.round(v * 1e5) / 1e5;
/** The road map's payload for the overlay: { style, view: { center, zoom } or { bounds }, pins, areas, routes, found }
 *  or, when the map service can't be reached, { offline: reason } (the card says so). Throws a problem the model can
 *  fix (a place nobody knows). found: what each looked-up name turned out to be, for the tool result. */
export async function roadMapPayload(m, { geocoder, styles }) {
  const found = [], where = async (s, whole = null) => {
    const ll = parseLatLon(s); if (ll) return ll;
    if (whole) return { lat: (whole.b[1] + whole.b[3]) / 2, lon: (whole.b[0] + whole.b[2]) / 2, box: whole.b };
    const hit = await geocoder.find(s);
    if (!hit) throw new Error(`no place called "${String(s).slice(0, 60)}" was found. Spell it as a map would (add the city or country: "Wat Pho, Bangkok"), or give "lat,lon".`);
    found.push(`"${String(s).slice(0, 40)}" is ${hit.name}`);
    return hit;
  };
  let style;
  try {
    // The style and the lookups at once: both are round trips.
    const [st, centre, pins] = await Promise.all([
      styles.get(),
      m.place != null ? where(m.place, wholeProvince(m)) : null,
      Promise.all((m.pins ?? []).map(async (p) => ({ ...(hasLatLon(p) ? { lat: p.lat, lon: p.lon } : await where(pinPlace(p, m))), name: p.name }))),
    ]);
    style = st;
    const areas = (m.shade ?? []).map((s) => { const p = findProvince(s.name); return { name: `${p.th} ${p.en}`, tone: s.tone ?? 'amber', box: p.b, rings: provinceRings(p) }; });
    const byName = new Map(pins.map((p) => [p.name, p]));
    const routes = (m.routes ?? []).map((r) => ({ from: [r5(byName.get(r.from).lon), r5(byName.get(r.from).lat)], to: [r5(byName.get(r.to).lon), r5(byName.get(r.to).lat)], tone: r.tone ?? 'amber' }));
    // The view: centred on place at zoom; else fitted to the place's own extent, the shaded provinces and the pins.
    const zoom = m.zoom == null ? null : zoomLevel(m.zoom);
    let view;
    if (centre && zoom != null) view = { center: [r5(centre.lon), r5(centre.lat)], zoom };
    else {
      let box = null;
      const join = (b) => { box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : [...b]; };
      if (centre) join(centre.box ?? [centre.lon, centre.lat, centre.lon, centre.lat]);
      for (const a of areas) join(a.box);
      for (const p of pins) join([p.lon, p.lat, p.lon, p.lat]);
      // The zoom asked for round the middle of it all; one point alone (a pin, a place without an extent) at street
      // level less a little, so its neighbourhood shows.
      const mid = [r5((box[0] + box[2]) / 2), r5((box[1] + box[3]) / 2)], dot = box[2] - box[0] < 1e-4 && box[3] - box[1] < 1e-4;
      view = zoom != null || dot ? { center: mid, zoom: zoom ?? 14 } : { bounds: box.map(r5) };
    }
    // The place itself gets a dot when nothing else is marked (not a whole province: that's shown as one).
    if (centre && !wholeProvince(m) && !pins.length) pins.unshift({ name: '', lat: centre.lat, lon: centre.lon });
    return { style, view, pins: pins.map((p) => ({ name: p.name, lon: r5(p.lon), lat: r5(p.lat) })), areas: areas.map(({ box, ...a }) => a), routes, found };
  } catch (e) {
    if (e?.offline) return { offline: e.message };
    throw e;
  }
}
