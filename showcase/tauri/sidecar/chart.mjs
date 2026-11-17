// The real-quality chart card's pieces: a declarative chart spec (what the model writes) is checked in words it can
// fix, then rendered to an SVG with ECharts' server-side renderer — no DOM, no browser, no network. The overlay only
// draws the SVG as a picture on a card. The spec, theme and limits come from the working prototype in
// ~/.jarvis-tools/lab/visuals/chartspec.mjs; the checks, the text measuring, error bars, the right-hand axis and
// bar+line were added here.
import * as echarts from 'echarts';

// The overlay's palette (ink.js TONES) and look.
export const TONES = { accent: '#78ffe2', teal: '#78ffe2', amber: '#ffcf5c', coral: '#ff8a7a', lilac: '#b9a4ff', sky: '#7cc8ff', lime: '#b6f36b', red: '#ff6b6b', white: '#e8fffa' };
const ORDER = ['accent', 'amber', 'sky', 'coral', 'lilac', 'lime', 'red', 'white'];
const TEXT = '#dcfff6', DIM = '#8ab8b0', MID = '#28c4b8', DEEP = '#0e5c60', INK = '#032722';
// Single quotes only: ECharts' SSR writes fontFamily into style="..." without escaping, so a double quote here
// produces invalid SVG (verified with 6.1.0: the image fails to load).
const FONT = "'Martian Mono', 'Leelawadee UI', 'Noto Sans Thai', Thonburi, ui-monospace, monospace";

// Without a canvas ECharts guesses text widths at a full em per character for a "mono" font, counting each Thai vowel
// and tone mark as a letter: labels came out about twice their real width, so axes dropped most category names, the
// hbar's plot was squeezed to a sliver and legends spread out. Measured here per character instead: marks take no
// room, wide scripts a full em, the rest a monospace advance (a little generous, so real text never overruns).
const MARK = /\p{M}/u, WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|\p{Extended_Pictographic}/u, THAI = /[\u0e00-\u0e7f]/u;
export function textWidth(text, font = '11px') {
  const size = +(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 12);
  let w = 0;
  for (const ch of String(text ?? '')) w += MARK.test(ch) ? 0 : WIDE.test(ch) ? 1 : THAI.test(ch) ? 0.58 : 0.64;
  return { width: w * size };
}
echarts.setPlatformAPI({ measureText: textWidth });
// Long names shortened here, by that measure, with … after a whole letter: ECharts' own truncation counts every
// non-Latin character (Thai marks too) as a full Chinese one, and cut "ม.ค." to "…" and region names to three letters.
export function fit(text, px, size = 11) {
  const s = String(text ?? ''), w = (t) => textWidth(t, `${size}px`).width;
  if (w(s) <= px) return s;
  let out = '';
  for (const ch of s) { if (!MARK.test(ch) && w(`${out}${ch}…`) > px) break; out += ch; }
  return `${out.trimEnd()}…`;
}

echarts.registerTheme('ink', {
  color: ORDER.map((t) => TONES[t]),
  backgroundColor: 'transparent',
  textStyle: { color: TEXT, fontFamily: FONT, fontSize: 11 },
  title: { textStyle: { color: TEXT, fontFamily: FONT, fontSize: 13, fontWeight: 600 }, subtextStyle: { color: DIM } },
  legend: { textStyle: { color: DIM, fontFamily: FONT, fontSize: 11 }, icon: 'roundRect', itemWidth: 12, itemHeight: 4 },
  categoryAxis: { axisLine: { lineStyle: { color: MID, width: 1.5 } }, axisTick: { lineStyle: { color: MID } }, axisLabel: { color: DIM }, splitLine: { show: false }, nameTextStyle: { color: DIM } },
  valueAxis: { axisLine: { show: true, lineStyle: { color: MID, width: 1.5 } }, axisTick: { show: true, lineStyle: { color: MID } }, axisLabel: { color: DIM }, splitLine: { lineStyle: { color: 'rgba(120,255,226,0.10)', type: [3, 4] } }, nameTextStyle: { color: DIM } },
  timeAxis: { axisLine: { lineStyle: { color: MID } }, axisLabel: { color: DIM }, splitLine: { show: false } },
  logAxis: { axisLine: { show: true, lineStyle: { color: MID } }, axisLabel: { color: DIM }, splitLine: { lineStyle: { color: 'rgba(120,255,226,0.10)' } }, nameTextStyle: { color: DIM } },
  line: { symbolSize: 5, lineStyle: { width: 2.2 } },
  boxplot: { itemStyle: { borderWidth: 1.6 } },
});

export const TYPES = ['line', 'area', 'scatter', 'bar', 'hbar', 'histogram', 'box', 'heatmap', 'pie', 'donut', 'radar'];
export const LIMITS = { series: 8, points: 2000, categories: 60, slices: 12 };

const isNum = Number.isFinite;
const when = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const XY = ['line', 'area', 'scatter'], CAT = ['bar', 'hbar', 'radar'];
const RIGHT_OK = ['line', 'area', 'scatter', 'bar'], ERR_OK = ['line', 'area', 'scatter', 'bar', 'hbar'];

/** Problems with a spec in words the model can fix ([] when fine). */
export function checkChart(c) {
  const out = [], S = c.series ?? [], cats = c.x?.categories, t = c.type;
  if (!TYPES.includes(t)) return [`type must be one of ${TYPES.join(', ')}.`];
  if (S.length > LIMITS.series) out.push(`at most ${LIMITS.series} series.`);
  const pts = S.reduce((a, s) => a + (s.data?.length ?? 0) + (s.values?.length ?? 0), 0);
  if (pts > LIMITS.points) out.push(`at most ${LIMITS.points} values in all (got ${pts}); summarise first.`);
  if ([...XY, 'bar', 'hbar', 'radar'].includes(t) && !S.length) out.push('needs series (each {name, data}).');
  if (CAT.includes(t) && !cats?.length) out.push(`needs x.categories (one name per ${t === 'radar' ? 'spoke' : 'bar'}).`);
  if (t === 'radar' && cats?.length && cats.length < 3) out.push('a radar needs at least 3 categories (its spokes); for 2, use bar.');
  for (const s of S) {
    const who = `series "${s.name}"`, d = s.data;
    if ([...XY, ...CAT].includes(t) && !Array.isArray(d)) { out.push(`${who}: needs data.`); continue; }
    if (CAT.includes(t) || (XY.includes(t) && cats)) {
      // One value per category (bars, spokes, or a line over named steps like months).
      if (!d.every(isNum)) out.push(`${who}: data must be numbers, one per category${XY.includes(t) ? ' (or drop x.categories and give [x, y] pairs)' : ''}.`);
      else if (cats && d.length !== cats.length) out.push(`${who}: ${d.length} values but ${cats.length} categories.`);
    } else if (XY.includes(t)) {
      const x = c.x?.time ? (v) => isNum(v) || when(v) : isNum;
      if (!d.every((p) => Array.isArray(p) && p.length === 2 && x(p[0]) && isNum(p[1]))) out.push(`${who}: data must be [x, y] pairs of numbers${c.x?.time ? ' (x may be a date like "2024-05-01")' : ''}${t === 'scatter' ? '' : ', or numbers with x.categories naming each one'}.`);
    }
    if (s.err != null) {
      if (!ERR_OK.includes(t)) out.push(`${who}: err (error bars) works on line, area, scatter, bar and hbar.`);
      else if (!Array.isArray(d) || s.err.length !== d.length || !s.err.every((e) => isNum(e) && e >= 0)) out.push(`${who}: err needs one number of 0 or more per value (the ± size), ${d?.length ?? 0} in all.`);
      else if (c.stacked || s.stack) out.push(`${who}: error bars don't go on stacked bars or areas.`);
    }
    if (s.axis === 'right' && !RIGHT_OK.includes(t)) out.push(`${who}: axis: 'right' works on line, area, scatter and bar.`);
    if (s.as && t !== 'bar') out.push(`${who}: as: 'line' is for a line drawn over the bars of a bar chart.`);
    if (['histogram', 'box'].includes(t) && !(s.values?.length >= (t === 'box' ? 3 : 2))) out.push(`${who}: needs values (the raw numbers, at least ${t === 'box' ? 3 : 2}).`);
    if (['histogram', 'box'].includes(t) && s.values?.length && !s.values.every(isNum)) out.push(`${who}: values must be numbers.`);
    if (t === 'radar' && c.y?.max != null && d?.some((v) => v > c.y.max)) out.push(`${who}: a value is above y.max (${c.y.max}); raise y.max or leave it out.`);
  }
  if (['histogram', 'box'].includes(t) && !S.length) out.push('needs series with values (the raw numbers).');
  // Only the first series was ever drawn: the rest vanished without a word.
  if (t === 'histogram' && S.length > 1) out.push('a histogram shows one series; to compare the spread of several groups, use box.');
  if (S.some((s) => s.axis === 'right') && S.every((s) => s.axis === 'right')) out.push("axis: 'right' is for a second measure beside the first: leave at least one series on the left.");
  if (c.y?.log && S.some((s) => (s.data ?? []).some((v) => (Array.isArray(v) ? v[1] : v) <= 0) && s.axis !== 'right')) out.push('y.log needs every value above 0.');
  if (c.y2?.log && S.some((s) => s.axis === 'right' && (s.data ?? []).some((v) => (Array.isArray(v) ? v[1] : v) <= 0))) out.push('y2.log needs every value on the right axis above 0.');
  if (['pie', 'donut'].includes(t)) {
    if (!(c.slices?.length >= 2)) out.push('needs slices (at least 2, each {name, value}).');
    else if (c.slices.some((q) => !isNum(q.value) || q.value < 0)) out.push('every slice value must be 0 or more (a share of the whole).');
    else if (!c.slices.some((q) => q.value > 0)) out.push('every slice is 0; at least one needs a value above 0.');
  }
  if (t === 'heatmap') {
    const g = c.grid;
    if (!g?.x?.length || !g?.y?.length || !g?.z?.length) out.push('needs grid {x: [column names], y: [row names], z: [[one row per y, one value per x]]}.');
    else {
      if (g.z.length !== g.y.length) out.push(`grid.z has ${g.z.length} rows but grid.y names ${g.y.length}; give one row per y.`);
      if (g.z.some((r) => r.length !== g.x.length)) out.push('every row of grid.z needs one value per grid.x.');
    }
  }
  return out;
}

const axisName = (a) => (a?.label ? `${a.label}${a.unit ? ` (${a.unit})` : ''}` : a?.unit ?? '');
const fmt = (unit) => (v) => `${+Number(v).toPrecision(4)}${unit && unit.length <= 3 ? unit : ''}`;
function quartiles(v) {
  const s = [...v].sort((a, b) => a - b), q = (p) => { const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
  const q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1, lo = Math.min(...s.filter((x) => x >= q1 - 1.5 * iqr)), hi = Math.max(...s.filter((x) => x <= q3 + 1.5 * iqr));
  return { box: [lo, q1, q(0.5), q3, hi], out: s.filter((x) => x < lo || x > hi) };
}
function bins(values, n) {
  const lo = Math.min(...values), hi = Math.max(...values), k = n ?? Math.max(5, Math.min(30, Math.ceil(Math.log2(values.length) + 1))), w = (hi - lo) / k || 1;
  const counts = Array(k).fill(0); for (const v of values) counts[Math.min(k - 1, Math.floor((v - lo) / w))]++;
  return counts.map((c, i) => [lo + i * w, lo + (i + 1) * w, c]);
}
const W = 520, H = 320;
// Category names: every one shown while they fit their slot (shortened with … when long), else ECharts thins them.
const named = (px) => (name) => fit(name, px);
const catLabels = (n, room) => (n <= 16 ? { interval: 0, formatter: named(Math.max(30, room / n - 3)) } : { hideOverlap: true });
const pct = (p) => `${p.percent < 1 ? p.percent.toFixed(1) : Math.round(p.percent)}%`;

/** spec -> ECharts option (the ink theme does the look). */
export function toOption(c) {
  const toneOf = (s, i) => TONES[s.tone] ?? TONES[ORDER[i % ORDER.length]];
  const S = c.series ?? [], right = S.some((s) => s.axis === 'right');
  const base = { animation: false, title: c.title ? { text: c.title, left: 8, top: 4 } : undefined, grid: { left: 56, right: right ? 60 : 24, top: c.title ? 56 : 32, bottom: 52 } };
  const legend = S.length > 1 ? { top: c.title ? 26 : 4, right: 8, formatter: named(110) } : undefined;
  const plotW = W - base.grid.left - base.grid.right;
  const xAx = (type) => ({ type, name: axisName(c.x), nameLocation: 'middle', nameGap: 28, min: c.x?.min, max: c.x?.max, scale: type === 'value', ...(type === 'value' && c.type === 'scatter' ? { boundaryGap: ['3%', '3%'] } : {}), data: type === 'category' ? c.x?.categories : undefined,
    axisLabel: type === 'value' ? { formatter: fmt(c.x?.unit) } : type === 'category' ? catLabels(c.x?.categories?.length ?? 0, plotW) : { hideOverlap: true } });
  const yAx = (a = c.y, type = a?.log ? 'log' : 'value') => ({ type, name: axisName(a), nameLocation: 'middle', nameGap: 42, min: a?.min, max: a?.max, scale: c.type === 'scatter' || c.type === 'line', ...(c.type === 'scatter' ? { boundaryGap: ['4%', '4%'] } : {}), axisLabel: type === 'value' ? { formatter: fmt(a?.unit) } : {} });
  // The second measure's axis on the right, its grid lines off so the two scales' lines don't cross each other.
  const yAxes = () => (right ? [yAx(), { ...yAx(c.y2), nameGap: 46, splitLine: { show: false }, alignTicks: true }] : yAx());
  const refs = (c.lines ?? []).map((r) => ({ [r.x != null ? 'xAxis' : 'yAxis']: r.x ?? r.y, name: r.text, label: { formatter: r.text ?? '', color: TEXT, position: 'insideEndTop' }, lineStyle: { color: TONES[r.tone] ?? TONES.amber, type: 'dashed' } }));
  const notes = (c.notes ?? []).map((n) => ({ coord: [n.x, n.y], value: n.text, symbol: 'pin', symbolSize: 34, itemStyle: { color: TONES[n.tone] ?? TONES.amber }, label: { color: INK, fontSize: 9, formatter: n.text } }));
  const extras = (i) => (i === 0 && (refs.length || notes.length) ? { markLine: refs.length ? { symbol: 'none', data: refs } : undefined, markPoint: notes.length ? { data: notes } : undefined } : {});
  const side = (s) => (s.axis === 'right' ? { yAxisIndex: 1 } : {});
  // Error bars: a whisker with caps at each value, ± err. On bars it sits on its own bar (barLayout gives the offset).
  const bars = S.filter((s) => (c.type === 'bar' || c.type === 'hbar') && s.as !== 'line'), horiz = c.type === 'hbar';
  const whiskers = (s, i) => (s.err ? [{
    type: 'custom', name: s.name, z: 4, silent: true, ...side(s),
    // Both ends are data, so the axis grows to hold them (a whisker past the top was cut off).
    data: s.data.map((v, k) => { const [a, y] = Array.isArray(v) ? v : [k, v]; return [a, y - s.err[k], y + s.err[k]]; }),
    encode: horiz ? { y: 0, x: [1, 2] } : { x: 0, y: [1, 2] },
    renderItem: (p, api) => {
      const a = api.value(0), at = (val) => api.coord(horiz ? [val, a] : [a, val]);
      const lo = at(api.value(1)), hi = at(api.value(2)), k = bars.indexOf(s), lay = k >= 0 || horiz ? api.barLayout({ count: Math.max(1, bars.length), barGap: '30%', barCategoryGap: '20%', barMaxWidth: 28 })?.[Math.max(0, k)] : null;
      const off = lay?.offsetCenter ?? 0, cap = Math.max(3, Math.min(7, (lay?.width ?? 12) / 3)), stroke = { stroke: TEXT, lineWidth: 1.4 };
      const pts = horiz ? [[lo[0], lo[1] + off], [hi[0], hi[1] + off]] : [[lo[0] + off, lo[1]], [hi[0] + off, hi[1]]];
      const tick = ([x, y]) => ({ type: 'line', shape: horiz ? { x1: x, y1: y - cap, x2: x, y2: y + cap } : { x1: x - cap, y1: y, x2: x + cap, y2: y }, style: stroke });
      return { type: 'group', children: [{ type: 'line', shape: { x1: pts[0][0], y1: pts[0][1], x2: pts[1][0], y2: pts[1][1] }, style: stroke }, tick(pts[0]), tick(pts[1])] };
    },
  }] : []);
  switch (c.type) {
    case 'line': case 'area': case 'scatter': {
      const cat = !!c.x?.categories, xt = cat ? 'category' : c.x?.time ? 'time' : 'value';
      return { ...base, legend, xAxis: xAx(xt), yAxis: yAxes(), series: S.flatMap((s, i) => [{ name: s.name, type: c.type === 'scatter' ? 'scatter' : 'line', data: s.data, ...side(s), smooth: !!s.smooth, stack: s.stack, showSymbol: c.type === 'scatter' || s.points || (s.data?.length ?? 0) <= 24, color: toneOf(s, i), lineStyle: s.dash ? { type: 'dashed' } : undefined, areaStyle: c.type === 'area' ? { opacity: 0.18 } : undefined, symbolSize: c.type === 'scatter' ? 7 : 5, ...extras(i) }, ...whiskers(s, i)]) };
    }
    case 'bar': case 'hbar': {
      const h = horiz, n = c.x.categories.length;
      const cat = { ...xAx('category'), name: h ? '' : axisName(c.x), axisLabel: h ? { formatter: named(96), interval: 0 } : catLabels(n, plotW) };
      const val = { ...yAx(c.y, c.y?.log ? 'log' : 'value'), name: axisName(c.y), scale: false };
      const yA = h ? { ...cat, inverse: true } : right ? [val, { ...yAx(c.y2), scale: false, nameGap: 46, splitLine: { show: false }, alignTicks: true }] : val;
      // Values written on the bars only when they're the whole story: a line or whiskers over them ran into the numbers.
      const solo = S.length === 1 && !c.stacked && !S[0].err;
      return { ...base, legend, grid: { ...base.grid, left: h ? 112 : 56 }, xAxis: h ? { ...val, nameGap: 28 } : cat, yAxis: yA,
        series: S.flatMap((s, i) => [s.as === 'line'
          ? { name: s.name, type: 'line', data: s.data, ...side(s), color: toneOf(s, i), smooth: !!s.smooth, lineStyle: s.dash ? { type: 'dashed' } : undefined, symbolSize: 5, z: 3, ...extras(i) }
          : { name: s.name, type: 'bar', data: s.data, ...side(s), stack: c.stacked ? 'all' : s.stack, color: toneOf(s, i), barMaxWidth: 28, barGap: '30%', barCategoryGap: '20%', itemStyle: { borderRadius: 1 }, label: solo ? { show: true, position: h ? 'right' : 'top', color: TEXT, fontSize: 10, formatter: (p) => fmt(c.y?.unit)(p.value) } : undefined, ...extras(i) }, ...whiskers(s, i)]) };
    }
    case 'histogram': {
      const s = S[0], b = bins(s.values, c.bins);
      return { ...base, xAxis: { ...xAx('value'), scale: false, min: b[0][0], max: b.at(-1)[1] }, yAxis: { ...yAx(), scale: false, name: c.y?.label ?? 'count' },
        series: [{ type: 'custom', name: s.name, data: b, renderItem: (p, api) => { const a = api.coord([api.value(0), api.value(2)]), z = api.coord([api.value(1), 0]); return { type: 'rect', shape: { x: a[0] + 0.5, y: a[1], width: z[0] - a[0] - 1, height: z[1] - a[1] }, style: { fill: toneOf(s, 0), opacity: 0.85 } }; }, encode: { x: [0, 1], y: 2 } }] };
    }
    case 'box': {
      const groups = S.map((s) => ({ name: s.name, ...quartiles(s.values) }));
      return { ...base, xAxis: { ...xAx('category'), data: groups.map((g) => g.name), axisLabel: catLabels(groups.length, plotW) }, yAxis: { ...yAx(), scale: true },
        series: [{ type: 'boxplot', data: groups.map((g) => g.box), itemStyle: { color: 'rgba(120,255,226,0.12)', borderColor: TONES.accent } },
          { type: 'scatter', data: groups.flatMap((g, i) => g.out.map((v) => [i, v])), color: TONES.amber, symbolSize: 6 }] };
    }
    case 'heatmap': {
      const g = c.grid, flat = g.z.flatMap((row, yi) => row.map((v, xi) => [xi, yi, v])), vs = flat.map((q) => q[2]), lo = Math.min(...vs), hi = Math.max(...vs);
      // Light words on the dark end of the scale, dark on the light end: one colour for all was unreadable on half the cells.
      const data = flat.map((q) => ({ value: q, label: { color: (q[2] - lo) / (hi - lo || 1) < 0.5 ? TEXT : INK } }));
      return { ...base, grid: { ...base.grid, left: 76, right: 70 }, xAxis: { ...xAx('category'), data: g.x, axisLabel: catLabels(g.x.length, W - 146), splitArea: { show: false } },
        // Rows top to bottom in the order given, the way the z matrix reads (ECharts puts the first row at the bottom).
        yAxis: { ...yAx(), type: 'category', scale: false, data: g.y, inverse: true, axisLabel: { formatter: named(64), interval: 0 } },
        visualMap: { min: lo, max: hi, right: 6, top: 'middle', itemHeight: 120, textStyle: { color: DIM }, inRange: { color: ['#051214', DEEP, MID, TONES.accent, '#e6fffa'] }, calculable: false },
        series: [{ type: 'heatmap', data, label: { show: g.x.length * g.y.length <= 80, fontSize: 9 }, itemStyle: { borderColor: '#061618', borderWidth: 1 } }] };
    }
    case 'pie': case 'donut':
      // The pie on the left, its names in a column on the right: centred, the legend ran over the slices.
      return { ...base, legend: { orient: 'vertical', left: 318, top: 'middle', formatter: named(180) },
        series: [{ type: 'pie', radius: c.type === 'donut' ? ['38%', '62%'] : '62%', center: [160, c.title ? 180 : 165], data: c.slices.map((q, i) => ({ name: q.name, value: q.value, itemStyle: { color: TONES[q.tone] ?? TONES[ORDER[i % ORDER.length]], borderColor: '#061618', borderWidth: 2 } })), label: { color: TEXT, formatter: pct }, labelLine: { lineStyle: { color: DIM }, length: 8, length2: 8 } }] };
    case 'radar':
      return { ...base, legend, radar: { center: ['50%', c.title ? '58%' : '54%'], radius: '62%', indicator: c.x.categories.map((n) => ({ name: n, max: c.y?.max })), axisName: { color: DIM, formatter: named(90) }, splitLine: { lineStyle: { color: 'rgba(120,255,226,0.18)' } }, splitArea: { show: false }, axisLine: { lineStyle: { color: DEEP } } },
        series: [{ type: 'radar', data: S.map((s, i) => ({ name: s.name, value: s.data, lineStyle: { color: toneOf(s, i) }, itemStyle: { color: toneOf(s, i) }, areaStyle: { color: toneOf(s, i), opacity: 0.12 } })) }] };
  }
  throw new Error(`unknown chart type ${c.type}`);
}

/** spec -> SVG string (what goes to the overlay, which draws it as a picture on a card). */
export function chartSvg(c, { width = W, height = H } = {}) {
  const bad = checkChart(c);
  if (bad.length) throw new Error(bad.join(' '));
  const ch = echarts.init(null, 'ink', { renderer: 'svg', ssr: true, width, height });
  try { ch.setOption(toOption(c)); return ch.renderToSVGString(); } finally { ch.dispose(); }
}
export const version = echarts.version;
