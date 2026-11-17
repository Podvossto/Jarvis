// The road map: a map card that zooms to streets (roadmap.mjs, MapLibre in a sandboxed frame on the overlay). The
// spec check, Thai provinces by name, the place-name lookups (kept, one a second, network stubbed here), the inked
// style, offline maps, and the frame's sandbox read off the overlay's source. Run: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DrawArgs, checkDraw, resolveTargets } from '../draw.mjs';
import { PROVINCES } from '../provinces.mjs';
import { LIMITS, SCOPES, createGeocoder, createStyles, findProvince, inkColor, inkStyle, isRoadMap, lookups, parseColor, parseLatLon, provinceRings, roadMapPayload } from '../roadmap.mjs';
import { GEOCODER, MAP_HOSTS, MAP_STYLE } from '../safety.mjs';
import { createTools } from '../tools.mjs';

// ---- the provinces: all 77, each with a Thai and an English name and an outline
assert.equal(PROVINCES.length, 77);
for (const p of PROVINCES) {
  assert.ok(/^TH-\d\d$/.test(p.iso) && p.en && /[฀-๿]/.test(p.th), `${p.iso} is named`);
  const rings = provinceRings(p);
  assert.ok(rings.length && rings.every((r) => r.length >= 4), `${p.en} has an outline`);
  for (const [lon, lat] of rings.flat()) assert.ok(lon >= p.b[0] - 0.01 && lon <= p.b[2] + 0.01 && lat >= p.b[1] - 0.01 && lat <= p.b[3] + 0.01, `${p.en}'s outline is inside its box`);
}
assert.equal(new Set(PROVINCES.map((p) => p.th)).size, 77, 'no two share a Thai name');

// ---- by name, Thai or English, the ways people write them
const iso = (n) => findProvince(n)?.iso ?? null;
for (const [name, want] of [
  ['เชียงใหม่', 'TH-50'], ['จังหวัดเชียงใหม่', 'TH-50'], ['จ.เชียงใหม่', 'TH-50'], ['Chiang Mai', 'TH-50'], ['chiangmai', 'TH-50'], ['Chiang Mai Province', 'TH-50'],
  ['กรุงเทพฯ', 'TH-10'], ['กทม.', 'TH-10'], ['Bangkok', 'TH-10'], ['Krung Thep Maha Nakhon', 'TH-10'],
  ['Chonburi', 'TH-20'], ['Chon Buri', 'TH-20'], ['ชลบุรี', 'TH-20'], ['Korat', 'TH-30'], ['โคราช', 'TH-30'], ['Ayutthaya', 'TH-14'], ['อยุธยา', 'TH-14'],
  ['นครศรีฯ', 'TH-80'], ['ประจวบ', 'TH-77'], ['Nakhon Si', 'TH-80'], ['Phang-nga', 'TH-82'], ['Bueng Kan', 'TH-38'], ['บึงกาฬ', 'TH-38'],
]) assert.equal(iso(name), want, `"${name}" is ${want}`);
for (const name of ['Nakhon', 'นคร', 'Tokyo', 'Japan', 'Chiang', 'xx', '']) assert.equal(iso(name), null, `"${name}" is no one province`);

// ---- what the model writes
assert.deepEqual(parseLatLon('13.7563, 100.5018'), { lat: 13.7563, lon: 100.5018 });
assert.equal(parseLatLon('Wat Pho'), null);
assert.equal(parseLatLon('95, 100'), null, 'a latitude past 90 is no place');
const ok = (m) => DrawArgs.safeParse({ beats: [{ marks: [{ kind: 'map', ...m }] }] }).success;
const problems = (m) => checkDraw({ beats: [{ marks: [{ kind: 'map', ...m }] }] });
assert.ok(ok({ place: 'Bangkok', zoom: 'city' }) && ok({ place: 'Bangkok', zoom: 11 }), 'zoom is a scope or a level');
assert.match(problems({ place: 'Bangkok', zoom: 'planet' })[0], /zoom is country, province/, 'an unknown scope is refused');
assert.deepEqual(problems({ place: 'Bangkok', zoom: '12' }), [], 'a level written as words is fine');
assert.ok(ok({ pins: [{ name: 'วัดโพธิ์', place: 'Wat Pho, Bangkok' }] }), 'a pin by place');
assert.deepEqual(problems({ place: 'Bangkok', zoom: 'city' }), []);
assert.deepEqual(problems({ shade: [{ name: 'เชียงใหม่' }] }), [], 'a province alone is a road map, fitted to it');
assert.deepEqual(problems({ place: 'Chiang Mai', zoom: 'street', pins: [{ name: 'A', place: 'Tha Phae Gate' }, { name: 'B', lat: 18.79, lon: 98.98 }], routes: [{ from: 'A', to: 'B' }] }), []);
assert.match(problems({ place: 'Bangkok', zoom: 40 })[0], /zoom is country, province, city, district, street or a number from 1 to 18/);
assert.match(problems({ zoom: 'city' })[0], /needs place/);
// Regression: a pin with only a name was refused, and the model spent a whole round trip adding place to each.
assert.deepEqual(problems({ place: 'x', pins: [{ name: 'A' }] }), [], 'a pin with only a name is looked up by it');
assert.match(problems({ place: 'Bangkok', shade: [{ name: 'Chiang Mia' }] })[0], /no Thai province "Chiang Mia" \(nearest: Chiang Mai \(เชียงใหม่\)/, 'a misspelt province gets the nearest names');
assert.match(problems({ place: 'Bangkok', pins: [{ name: 'A', lat: 1, lon: 2 }], routes: [{ from: 'A', to: 'C' }] })[0], /route 1: no pin is named "C"/);
const many = Array.from({ length: LIMITS.lookups + 1 }, (_, i) => ({ name: `p${i}`, place: `Place ${i}` }));
assert.match(problems({ pins: many })[0], /5 place names to look up; at most 4 per map\. Give lat and lon for the rest/, 'never a long run of lookups');
assert.match(problems({ place: 'call 0812345678 near Siam' })[0], /phone or account number/, 'a lookup carries a place, nothing about the user');
assert.deepEqual(lookups({ place: 'Bangkok', pins: [{ name: 'a', place: 'Siam Paragon' }, { name: 'b', place: '13.7,100.5' }, { name: 'c', place: 'Siam Paragon' }, { name: 'd', lat: 1, lon: 1 }] }), ['Siam Paragon'], 'a province shown whole and lat,lon need no lookup, and a name is asked once');
assert.deepEqual(lookups({ place: 'เชียงใหม่', zoom: 'province', pins: [{ name: 'a', place: 'Chiang Mai' }] }), ['Chiang Mai'], 'a province shown whole needs none; a pin by name does');
// The country map is as it was.
assert.equal(isRoadMap({ region: 'Europe', shade: [{ name: 'France' }], pins: [{ name: 'Paris', lat: 48.9, lon: 2.35 }] }), false);
assert.deepEqual(problems({ region: 'Europe', shade: [{ name: 'France' }] }), []);
assert.match(problems({ pins: [{ name: 'Paris' }] })[0], /lat must be between -90 and 90/, 'a country map pin still needs lat and lon');
const [country] = await resolveTargets([{ marks: [{ kind: 'map', shade: [{ name: 'Thailand' }] }] }], {});
assert.ok(country.marks[0].view && !country.marks[0].road, 'a country map still gets its view from the outlines');
assert.equal((await resolveTargets([{ marks: [{ kind: 'map', place: 'Bangkok', zoom: 'city' }] }], {}))[0].marks[0].view, undefined, 'a road map is filled in later, with the photos');

// ---- looking up place names: kept, one request a second at most, in turn, only the place's words sent
{
  let clock = 0, calls = [];
  const slept = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, at: clock, opts });
    const q = new URL(url).searchParams.get('q');
    return { ok: true, status: 200, json: async () => (q === 'Nowhere at all' ? [] : [{ lat: '13.7465', lon: '100.4927', display_name: `${q}, Bangkok, Thailand`, boundingbox: ['13.74', '13.75', '100.49', '100.50'] }]) };
  };
  const geo = createGeocoder({ fetchImpl, now: () => clock, wait: async (ms) => { slept.push(ms); clock += ms; } });
  const [a, b, c] = await Promise.all([geo.find('Wat Pho'), geo.find('Grand Palace'), geo.find('wat  pho')]);
  assert.equal(calls.length, 2, 'the same place asked twice at once is one request');
  assert.ok(calls[1].at - calls[0].at >= 1000, 'requests are at least a second apart');
  assert.deepEqual(a, c);
  assert.deepEqual(a.box, [100.49, 13.74, 100.5, 13.75], 'the box is west, south, east, north');
  assert.equal(b.lat, 13.7465);
  await geo.find('Wat Pho');
  assert.equal(calls.length, 2, 'a place looked up before is not asked again');
  assert.equal(await geo.find('Nowhere at all'), null);
  await geo.find('Nowhere at all');
  assert.equal(calls.length, 3, 'nothing found is remembered too');
  const u = new URL(calls[0].url);
  assert.equal(`${u.origin}${u.pathname}`, GEOCODER);
  assert.deepEqual([...u.searchParams.keys()].sort(), ['format', 'limit', 'q'], 'only the place: no language, location or email');
  assert.match(calls[0].opts.headers['user-agent'], /^Roamies-Sidekick/, 'an app name identifies the requests, nothing about the user');
  assert.ok(!('referer' in calls[0].opts.headers) && !('accept-language' in calls[0].opts.headers));
  await assert.rejects(geo.find('me@example.com'), /Blocked for safety/, 'an email address is never sent');
  assert.equal(calls.length, 3);
  // Offline: the failure isn't kept, so the next try asks again.
  let down = true;
  const geo2 = createGeocoder({ fetchImpl: async () => { if (down) throw new Error('getaddrinfo ENOTFOUND'); return { ok: true, json: async () => [] }; }, now: () => clock, wait: async (ms) => { clock += ms; } });
  await assert.rejects(geo2.find('Siam'), (e) => e.offline === true);
  down = false;
  assert.equal(await geo2.find('Siam'), null, 'tried again once back online');
}

// ---- the style in the overlay's ink, and nowhere else
const style = {
  version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' }, ne2_shaded: { type: 'raster', tiles: ['https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'] } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': 'rgb(12,12,12)' } },
    { id: 'ne2', type: 'raster', source: 'ne2_shaded' },
    { id: 'highway_motorway_inner', type: 'line', source: 'openmaptiles', paint: { 'line-color': 'hsl(0,0%,27%)' } },
    { id: 'water', type: 'fill', source: 'openmaptiles', paint: { 'fill-color': ['interpolate', ['linear'], ['zoom'], 5, '#181818', 10, 'rgba(60,60,60,0.8)'] } },
    { id: 'place_city', type: 'symbol', source: 'openmaptiles', layout: { 'text-field': '{name}' }, paint: { 'text-color': 'rgb(101,101,101)' } },
  ],
};
assert.deepEqual(parseColor('hsla(0,0%,85%,0.53)').map(Math.round), [217, 217, 217, 1]);
assert.deepEqual(parseColor('rgb(27 ,27 ,29)'), [27, 27, 29, 1]);
assert.equal(parseColor('#000').join(), '0,0,0,1');
assert.equal(inkColor('#000'), 'rgba(5,18,20,1)', 'black is the ink\'s darkest');
const inked = inkStyle(style);
assert.equal(inked.layers.find((l) => l.id === 'background').paint['background-color'], '#061618');
assert.equal(inked.layers.find((l) => l.id === 'highway_motorway_inner').paint['line-color'], '#78ffe2', 'main roads stand out');
assert.match(JSON.stringify(inked.layers.find((l) => l.id === 'water').paint), /rgba\(\d+,\d+,\d+,0\.8\)/, 'colours inside expressions are inked, alpha kept');
assert.equal(inked.layers.find((l) => l.id === 'place_city').paint['text-color'], '#dcfff6');
assert.ok(!inked.layers.some((l) => l.type === 'raster') && !inked.sources.ne2_shaded, 'no shaded relief');
assert.equal(style.layers[0].paint['background-color'], 'rgb(12,12,12)', 'the fetched style is left as it was');
assert.throws(() => inkStyle({ ...style, glyphs: 'https://evil.example/fonts/{fontstack}/{range}.pbf' }), /isn't allowed/, 'a style that loads from elsewhere is refused');
assert.throws(() => inkStyle({ ...style, sources: { x: { type: 'vector', tiles: ['http://tiles.openfreemap.org/{z}/{x}/{y}.pbf'] } } }), /isn't allowed/, 'plain http too');
{
  let n = 0, clock = 0, up = true;
  const styles = createStyles({ fetchImpl: async (url) => { n++; assert.equal(url, MAP_STYLE); if (!up) throw new Error('offline'); return { ok: true, json: async () => style }; }, now: () => clock });
  await styles.get(); await styles.get();
  assert.equal(n, 1, 'the style is fetched once a day');
  clock += 86_400_001; up = false;
  await assert.rejects(styles.get(), (e) => e.offline);
  await assert.rejects(styles.get(), (e) => e.offline);
  assert.equal(n, 2, 'offline, it fails fast for half a minute instead of asking again');
}

// ---- the payload: views, provinces, pins and lines; offline says so
{
  const fakeGeo = { find: async (q) => (q === 'Nowhere' ? null : { name: `${q}, Thailand`, lat: 18.7877, lon: 98.9931, box: [98.99, 18.78, 99.0, 18.79] }) };
  const styles = { get: async () => inkStyle(style) };
  const pay = (m) => roadMapPayload(m, { geocoder: fakeGeo, styles });
  assert.deepEqual((await pay({ place: 'Bangkok' })).view, { bounds: findProvince('Bangkok').b }, 'a province shown whole needs no lookup');
  assert.deepEqual((await pay({ place: 'Bangkok', zoom: 'province' })).view, { center: [100.635, 13.725], zoom: SCOPES.province });
  assert.deepEqual((await pay({ place: 'Bangkok', zoom: 'city' })).view, { center: [98.9931, 18.7877], zoom: SCOPES.city }, 'zoomed in, the name is looked up (its town, not the province middle)');
  assert.deepEqual((await pay({ place: '13.75,100.5', zoom: 17 })).view, { center: [100.5, 13.75], zoom: 17 });
  const cm = await pay({ shade: [{ name: 'เชียงใหม่' }] });
  assert.deepEqual(cm.view.bounds, findProvince('Chiang Mai').b, 'a shaded province fills the view');
  assert.equal(cm.areas[0].name, 'เชียงใหม่ Chiang Mai');
  assert.ok(cm.areas[0].rings[0].length > 20 && cm.areas[0].tone === 'amber');
  const walk = await pay({ place: 'Tha Phae Gate', pins: [{ name: 'A', place: 'Tha Phae Gate' }, { name: 'B', lat: 18.8, lon: 98.95 }], routes: [{ from: 'A', to: 'B' }] });
  assert.deepEqual(walk.routes[0], { from: [98.9931, 18.7877], to: [98.95, 18.8], tone: 'amber' });
  assert.deepEqual(walk.pins.map((p) => p.name), ['A', 'B'], 'no extra dot when pins mark the map');
  assert.deepEqual((await pay({ place: '13.75,100.5', zoom: 17 })).pins, [{ name: '', lon: 100.5, lat: 13.75 }], 'the place itself gets a dot');
  assert.deepEqual(cm.pins, [], 'a whole province gets none');
  assert.match(walk.found[0], /"Tha Phae Gate" is Tha Phae Gate, Thailand/, 'the model is told what each name turned out to be');
  assert.deepEqual((await pay({ pins: [{ name: 'A', lat: 18.8, lon: 98.95 }] })).view, { center: [98.95, 18.8], zoom: 14 }, 'one pin alone: its neighbourhood');
  await assert.rejects(pay({ place: 'Nowhere' }), /no place called "Nowhere" was found/);
  const off = await roadMapPayload({ place: 'Bangkok' }, { geocoder: fakeGeo, styles: { get: async () => { throw Object.assign(new Error("couldn't reach tiles.openfreemap.org"), { offline: true }); } } });
  assert.deepEqual(off, { offline: "couldn't reach tiles.openfreemap.org" });
}

// ---- through the draw tool: the overlay gets the payload, the model hears what happened
{
  const sent = [];
  const make = (styles) => {
    const made = createTools({ allowActions: false, ui: (m) => { if (m.kind !== 'agent') return; if (m.e?.type === 'draw') { sent.push(m.e); setTimeout(() => made.ink.started(m.e.id, m.e.seg), 5); } }, ask: async () => false, openUrl: async () => {}, onCommitments: async () => {}, showList: async () => {}, fmtWhen: String, commitmentsText: () => '', userName: 'Test',
      roadMaps: { geocoder: { find: async () => ({ name: 'Siam Paragon, Bangkok', lat: 13.746, lon: 100.535 }) }, styles } });
    return made.tools.find((t) => t.name === 'draw');
  };
  const draw = make({ get: async () => inkStyle(style) });
  const res = await draw.execute({ beats: [{ say: 'Here.', marks: [{ kind: 'map', place: 'Siam Paragon', zoom: 'street' }] }] }, { toolCallId: 'm1' });
  assert.match(res, /Drew p\d+ map “Siam Paragon”/);
  assert.match(res, /On the map: "Siam Paragon" is Siam Paragon, Bangkok/);
  const road = sent.at(-1).beats[0].marks[0].road;
  assert.deepEqual(road.view, { center: [100.535, 13.746], zoom: 16 });
  assert.equal(road.style.layers[0].paint['background-color'], '#061618', 'the inked style rides along');
  const offline = make({ get: async () => { throw Object.assign(new Error("couldn't reach tiles.openfreemap.org (fetch failed)"), { offline: true }); } });
  const res2 = await offline.execute({ beats: [{ marks: [{ kind: 'map', place: 'Bangkok', zoom: 'city' }] }] }, { toolCallId: 'm2' });
  assert.match(res2, /The road map did not load: couldn't reach tiles\.openfreemap\.org .* tell them plainly/, 'offline: the model is told the map did not load');
  assert.ok(sent.at(-1).beats[0].marks[0].road.offline, 'and the card is told to say so');
}

// ---- the overlay's frame: sandboxed, and only the map hosts on its CSP
{
  const ink = readFileSync(new URL('../../../roamies/ink.js', import.meta.url), 'utf8');
  const hosts = JSON.parse(/const MAP_HOSTS = (\[[^\]]*\])/.exec(ink)[1].replace(/'/g, '"'));
  assert.deepEqual(hosts, MAP_HOSTS.map((h) => `https://${h}`), "the frame's hosts are safety.mjs's MAP_HOSTS");
  const csp = /const MAP_CSP = `([^`]*)`/.exec(ink)[1];
  assert.match(csp, /^default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: \$\{MAP_HOSTS\.join\(' '\)\}; connect-src \$\{MAP_HOSTS\.join\(' '\)\}; worker-src blob:; child-src blob:; font-src data:$/, 'nothing else: no scripts from anywhere, no other hosts');
  const road = ink.slice(ink.indexOf('async function drawRoadMap'), ink.indexOf('// ---------------------------------------------------------------- maps: country outlines'));
  assert.match(road, /setAttribute\('sandbox', 'allow-scripts'\)/, 'an opaque origin: scripts, but not the app');
  assert.ok(!/allow-same-origin|allow-top-navigation|allow-popups|allow-forms/.test(road), 'none of the exits');
  assert.match(road, /e\.source !== frame\.contentWindow/, 'only its own frame is listened to');
  assert.match(road, /replace\(\/<\/g, '\\\\u003c'\)/, "the data can't close its script element");
  assert.match(ink, /fetch\(`roamies\/vendor\/maplibre-gl\.\$\{x\}`\)/, 'MapLibre comes from the app, never a CDN');
  assert.ok(!/unpkg|jsdelivr|cdnjs/.test(ink), 'no CDN anywhere in the overlay');
  assert.match(ink, /OpenMapTiles<\/a> Data from <a href="https:\/\/www\.openstreetmap\.org\/copyright"/, 'the licences\' credit is on the card');
  const build = readFileSync(new URL('../../build.sh', import.meta.url), 'utf8');
  assert.match(build, /sidecar\/node_modules\/maplibre-gl\/dist\/\$f/, 'build.sh copies the vendored MapLibre');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.devDependencies['maplibre-gl'], /^\d+\.\d+\.\d+$/, 'at an exact version');
}
console.log('road map tests: passed');
