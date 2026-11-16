// The real-quality chart card's pieces: a declarative chart spec (what the model writes) is checked in words it can
// fix, then rendered to an SVG with ECharts' server-side renderer — no DOM, no browser, no network. The overlay only
// draws the SVG as a picture on a card. The spec, theme and limits come from the working prototype in
// ~/.jarvis-tools/lab/visuals/chartspec.mjs; only the echarts import (npm, not a vendored file) and the data-shape
// rule in checkChart differ.
import * as echarts from 'echarts';

// The overlay's palette (ink.js TONES) and look.
export const TONES = { accent: '#78ffe2', teal: '#78ffe2', amber: '#ffcf5c', coral: '#ff8a7a', lilac: '#b9a4ff', sky: '#7cc8ff', lime: '#b6f36b', red: '#ff6b6b', white: '#e8fffa' };
const ORDER = ['accent', 'amber', 'sky', 'coral', 'lilac', 'lime', 'red', 'white'];
const TEXT = '#dcfff6', DIM = '#8ab8b0', MID = '#28c4b8', DEEP = '#0e5c60';
// Single quotes only: ECharts' SSR writes fontFamily into style="..." without escaping, so a double quote here
// produces invalid SVG (verified with 6.1.0: the image fails to load).
const FONT = "'Martian Mono', 'Leelawadee UI', 'Noto Sans Thai', Thonburi, ui-monospace, monospace";

echarts.registerTheme('ink', {
  color: ORDER.map((t) => TONES[t]),
  backgroundColor: 'transparent',
  textStyle: { color: TEXT, fontFamily: FONT, fontSize: 11 },
  title: { textStyle: { color: TEXT, fontFamily: FONT, fontSize: 13, fontWeight: 600 }, subtextStyle: { color: DIM } },
  legend: { textStyle: { color: DIM, fontFamily: FONT, fontSize: 11 }, icon: 'roundRect', itemWidth: 12, itemHeight: 4 },
  categoryAxis: { axisLine: { lineStyle: { color: MID, width: 1.5 } }, axisTick: { lineStyle: { color: MID } }, axisLabel: { color: DIM }, splitLine: { show: false }, nameTextStyle: { color: DIM } },
  valueAxis: { axisLine: { show: true, lineStyle: { color: MID, width: 1.5 } }, axisTick: { show: true, lineStyle: { color: MID } }, axisLabel: { color: DIM }, splitLine: { lineStyle: { color: 'rgba(120,255,226,0.10)', type: [3, 4] } }, nameTextStyle: { color: DIM } },
  timeAxis: { axisLine: { lineStyle: { color: MID } }, axisLabel: { color: DIM }, splitLine: { show: false } },
  logAxis: { axisLine: { show: true, lineStyle: { color: MID } }, axisLabel: { color: DIM }, splitLine: { lineStyle: { color: 'rgba(120,255,226,0.10)' } } },
  line: { symbolSize: 5, lineStyle: { width: 2.2 } },
  boxplot: { itemStyle: { borderWidth: 1.6 } },
});

export const TYPES = ['line', 'area', 'scatter', 'bar', 'hbar', 'histogram', 'box', 'heatmap', 'pie', 'donut', 'radar'];
// What the draw tool offers today (the renderer below draws every type; the rest unlock as this list grows).
export const AVAILABLE = ['line', 'bar'];
export const LIMITS = { series: 8, points: 2000, categories: 60, slices: 12 };

const numberish = (v) => Number.isFinite(v) || (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite));

/** Problems with a spec in words the model can fix ([] when fine). */
export function checkChart(c) {
  const out = [], S = c.series ?? [];
  if (!TYPES.includes(c.type)) out.push(`type must be one of ${TYPES.join(', ')}.`);
  if (S.length > LIMITS.series) out.push(`at most ${LIMITS.series} series.`);
  const pts = S.reduce((a, s) => a + (s.data?.length ?? 0) + (s.values?.length ?? 0), 0);
  if (pts > LIMITS.points) out.push(`at most ${LIMITS.points} values in all (got ${pts}); summarise first.`);
  if (['pie', 'donut'].includes(c.type) && !(c.slices?.length >= 2)) out.push('needs slices (at least 2, each {name, value}).');
  if (c.type === 'heatmap' && !(c.grid?.z?.length)) out.push('needs grid {x: [...], y: [...], z: [[one row per y, one value per x]]}.');
  if (c.type === 'heatmap' && c.grid?.z?.some((r) => r.length !== c.grid.x.length)) out.push('every row of grid.z needs one value per grid.x.');
  if (['line', 'area', 'scatter', 'bar', 'hbar', 'radar'].includes(c.type) && !S.length) out.push('needs series (each {name, data}).');
  if (['histogram', 'box'].includes(c.type) && !S.some((s) => s.values?.length)) out.push('needs series with values (the raw numbers).');
  if (['bar', 'hbar', 'radar'].includes(c.type) && !c.x?.categories?.length) out.push('needs x.categories (one name per bar or spoke).');
  for (const s of S) if (c.x?.categories && Array.isArray(s.data) && ['bar', 'hbar', 'radar'].includes(c.type) && s.data.length !== c.x.categories.length) out.push(`series "${s.name}": ${s.data.length} values but ${c.x.categories.length} categories.`);
  for (const s of S) if (s.data && ['line', 'area', 'scatter', 'bar', 'hbar'].includes(c.type) && !s.data.every(numberish)) out.push(`series "${s.name}": data must be numbers, or [x, y] pairs of numbers.`);
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

/** spec -> ECharts option (the ink theme does the look). */
export function toOption(c) {
  const toneOf = (s, i) => TONES[s.tone] ?? TONES[ORDER[i % ORDER.length]];
  const S = c.series ?? [], base = { animation: false, title: c.title ? { text: c.title, left: 8, top: 4 } : undefined, grid: { left: 56, right: 24, top: c.title ? 56 : 32, bottom: 52, containLabel: false } };
  const legend = S.length > 1 || c.type === 'pie' || c.type === 'donut' ? { top: c.title ? 26 : 4, right: 8 } : undefined;
  const xAx = (type) => ({ type, name: axisName(c.x), nameLocation: 'middle', nameGap: 28, min: c.x?.min, max: c.x?.max, data: type === 'category' ? c.x?.categories : undefined, axisLabel: type === 'value' ? { formatter: fmt(c.x?.unit) } : {} });
  const yAx = (type = c.y?.log ? 'log' : 'value') => ({ type, name: axisName(c.y), nameLocation: 'middle', nameGap: 42, min: c.y?.min, max: c.y?.max, data: type === 'category' ? c.x?.categories : undefined, axisLabel: type === 'value' ? { formatter: fmt(c.y?.unit) } : {} });
  const refs = (c.lines ?? []).map((r) => ({ [r.x != null ? 'xAxis' : 'yAxis']: r.x ?? r.y, name: r.text, label: { formatter: r.text ?? '', color: TEXT }, lineStyle: { color: TONES[r.tone] ?? TONES.amber, type: 'dashed' } }));
  const notes = (c.notes ?? []).map((n) => ({ coord: [n.x, n.y], value: n.text, symbol: 'pin', symbolSize: 34, itemStyle: { color: TONES[n.tone] ?? TONES.amber }, label: { color: '#032722', fontSize: 9, formatter: n.text } }));
  const extras = (i) => (i === 0 && (refs.length || notes.length) ? { markLine: refs.length ? { symbol: 'none', data: refs } : undefined, markPoint: notes.length ? { data: notes } : undefined } : {});
  switch (c.type) {
    case 'line': case 'area': case 'scatter': {
      const cat = !!c.x?.categories, xt = cat ? 'category' : c.x?.time ? 'time' : 'value';
      return { ...base, legend, xAxis: xAx(xt), yAxis: yAx(), series: S.map((s, i) => ({ name: s.name, type: c.type === 'scatter' ? 'scatter' : 'line', data: s.data, smooth: !!s.smooth, stack: s.stack, showSymbol: c.type === 'scatter' || s.points || (s.data?.length ?? 0) <= 24, color: toneOf(s, i), lineStyle: s.dash ? { type: 'dashed' } : undefined, areaStyle: c.type === 'area' ? { opacity: 0.18 } : undefined, symbolSize: c.type === 'scatter' ? 7 : 5, ...extras(i) })) };
    }
    case 'bar': case 'hbar': {
      const h = c.type === 'hbar', cat = { ...xAx('category'), name: h ? '' : axisName(c.x) }, val = { ...yAx('value'), name: axisName(c.y) };
      return { ...base, legend, grid: { ...base.grid, left: h ? 110 : 56 }, xAxis: h ? val : cat, yAxis: h ? { ...cat, inverse: true, nameGap: 90 } : val,
        series: S.map((s, i) => ({ name: s.name, type: 'bar', data: s.data, stack: c.stacked ? 'all' : s.stack, color: toneOf(s, i), barMaxWidth: 28, itemStyle: { borderRadius: 1 }, label: S.length === 1 && !c.stacked ? { show: true, position: h ? 'right' : 'top', color: TEXT, fontSize: 10, formatter: (p) => fmt(c.y?.unit)(p.value) } : undefined, ...extras(i) })) };
    }
    case 'histogram': {
      const s = S[0], b = bins(s.values, c.bins);
      return { ...base, xAxis: { ...xAx('value'), min: b[0][0], max: b.at(-1)[1] }, yAxis: { ...yAx('value'), name: c.y?.label ?? 'count' },
        series: [{ type: 'custom', name: s.name, data: b, renderItem: (p, api) => { const a = api.coord([api.value(0), api.value(2)]), z = api.coord([api.value(1), 0]); return { type: 'rect', shape: { x: a[0] + 0.5, y: a[1], width: z[0] - a[0] - 1, height: z[1] - a[1] }, style: { fill: toneOf(s, 0), opacity: 0.85 } }; }, encode: { x: [0, 1], y: 2 } }] };
    }
    case 'box': {
      const groups = S.map((s) => ({ name: s.name, ...quartiles(s.values) }));
      return { ...base, xAxis: { ...xAx('category'), data: groups.map((g) => g.name) }, yAxis: yAx(),
        series: [{ type: 'boxplot', data: groups.map((g) => g.box), itemStyle: { color: 'rgba(120,255,226,0.12)', borderColor: TONES.accent } },
          { type: 'scatter', data: groups.flatMap((g, i) => g.out.map((v) => [i, v])), color: TONES.amber, symbolSize: 6 }] };
    }
    case 'heatmap': {
      const g = c.grid, flat = g.z.flatMap((row, yi) => row.map((v, xi) => [xi, yi, v])), vs = flat.map((q) => q[2]);
      return { ...base, grid: { ...base.grid, right: 70 }, xAxis: { ...xAx('category'), data: g.x, splitArea: { show: false } }, yAxis: { ...yAx('category'), data: g.y },
        visualMap: { min: Math.min(...vs), max: Math.max(...vs), right: 6, top: 'middle', itemHeight: 120, textStyle: { color: DIM }, inRange: { color: ['#051214', DEEP, MID, TONES.accent, '#e6fffa'] }, calculable: false },
        series: [{ type: 'heatmap', data: flat, label: { show: g.x.length * g.y.length <= 80, color: '#032722', fontSize: 9 }, itemStyle: { borderColor: '#061618', borderWidth: 1 } }] };
    }
    case 'pie': case 'donut':
      return { ...base, legend: { ...legend, orient: 'vertical', top: 'middle' }, series: [{ type: 'pie', radius: c.type === 'donut' ? ['42%', '68%'] : '68%', center: ['40%', '55%'], data: c.slices.map((q, i) => ({ name: q.name, value: q.value, itemStyle: { color: TONES[q.tone] ?? TONES[ORDER[i % ORDER.length]], borderColor: '#061618', borderWidth: 2 } })), label: { color: TEXT, formatter: '{d}%' }, labelLine: { lineStyle: { color: DIM } } }] };
    case 'radar':
      return { ...base, legend, radar: { indicator: c.x.categories.map((n) => ({ name: n, max: c.y?.max })), axisName: { color: DIM }, splitLine: { lineStyle: { color: 'rgba(120,255,226,0.18)' } }, splitArea: { show: false }, axisLine: { lineStyle: { color: DEEP } } },
        series: [{ type: 'radar', data: S.map((s, i) => ({ name: s.name, value: s.data, lineStyle: { color: toneOf(s, i) }, itemStyle: { color: toneOf(s, i) }, areaStyle: { color: toneOf(s, i), opacity: 0.12 } })) }] };
  }
  throw new Error(`unknown chart type ${c.type}`);
}

/** spec -> SVG string (what goes to the overlay, which draws it as a picture on a card). */
export function chartSvg(c, { width = 520, height = 320 } = {}) {
  const bad = checkChart(c);
  if (bad.length) throw new Error(bad.join(' '));
  const ch = echarts.init(null, 'ink', { renderer: 'svg', ssr: true, width, height });
  try { ch.setOption(toOption(c)); return ch.renderToSVGString(); } finally { ch.dispose(); }
}
export const version = echarts.version;
