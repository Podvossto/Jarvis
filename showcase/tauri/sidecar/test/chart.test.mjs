// The real-quality chart card: a declarative spec (what the model writes) is checked in words it can fix, then
// rendered to an SVG in the sidecar with ECharts SSR (offline, in the overlay's palette). Run: npm test
import assert from 'node:assert/strict';
import { AVAILABLE, LIMITS, checkChart, chartSvg, version } from '../chart.mjs';
import { DrawArgs, checkDraw, resolveTargets } from '../draw.mjs';

const line = { type: 'line', title: 'อุณหภูมิเฉลี่ย', x: { categories: ['ม.ค.', 'เม.ย.', 'ก.ค.'], label: 'เดือน' }, y: { label: 'อุณหภูมิ', unit: '°C' },
  series: [{ name: 'กรุงเทพ', data: [27, 30.4, 28.9] }, { name: 'เชียงใหม่', data: [21.2, 28.9, 27.2], tone: 'amber', dash: true }] };
const bar = { type: 'bar', title: 'ยอดขาย', x: { categories: ['Q1', 'Q2', 'Q3'] }, y: { label: 'Revenue', unit: 'M฿' },
  series: [{ name: 'Online', data: [12, 15, 19] }, { name: 'Stores', data: [20, 19, 18], tone: 'sky' }] };

// ---- the checker, in words the model can fix
assert.deepEqual(checkChart(line), []);
assert.deepEqual(checkChart(bar), []);
assert.match(checkChart({ type: 'donut' })[0], /needs slices \(at least 2, each \{name, value\}\)/);
assert.match(checkChart({ type: 'line', series: [] })[0], /needs series \(each \{name, data\}\)/);
assert.match(checkChart({ type: 'bar', series: [{ name: 's', data: [1] }] })[0], /needs x\.categories/);
assert.match(checkChart({ type: 'bar', x: { categories: ['a'] }, series: [{ name: 's', data: [1, 2] }] })[0], /series "s": 2 values but 1 categories/);
assert.match(checkChart({ type: 'line', series: [{ name: 'a', data: ['many'] }] })[0], /data must be numbers, or \[x, y\] pairs of numbers/);
assert.match(checkChart({ type: 'scatter', series: [{ name: 'a', data: [[1], [2, 3, 4]] }] })[0], /data must be numbers/);
assert.match(checkChart({ type: 'line', series: Array.from({ length: LIMITS.series + 1 }, (_, i) => ({ name: String(i), data: [1] })) })[0], /at most 8 series/);
assert.match(checkChart({ type: 'line', series: [{ name: 'big', data: Array.from({ length: LIMITS.points + 1 }, () => 1) }] })[0], /at most 2000 values in all/);
assert.match(checkChart({ type: 'histogram', series: [{ name: 's' }] })[0], /needs series with values/);
assert.match(checkChart({ type: 'box', series: [{ name: 's' }] })[0], /needs series with values/);
assert.match(checkChart({ type: 'heatmap' })[0], /needs grid/);
assert.match(checkChart({ type: 'heatmap', grid: { x: ['a', 'b'], y: ['p'], z: [[1]] } })[0], /one value per grid\.x/);
assert.match(checkChart({ type: 'radar', series: [{ name: 'a', data: [1] }] })[0], /needs x\.categories/);

// ---- rendering: an SVG in the overlay's palette, offline, deterministic
assert.ok(parseInt(version) >= 6, `echarts ${version}`);
const svg = chartSvg(line);
assert.match(svg, /^<svg /);
assert.match(svg, /width="520"/);
assert.match(svg, /อุณหภูมิเฉลี่ย/, 'the title is drawn');
assert.match(svg, /#78ffe2/, 'the first series wears the overlay accent');
assert.match(svg, /#ffcf5c/, 'a named tone wins');
assert.match(svg, /stroke-dasharray/, 'dash: true dashes');
assert.ok(svg.length > 2000, `a real chart carries real drawing (${svg.length} bytes)`);
assert.match(chartSvg(line), /^<svg /, 'it renders again just as well');
const barSvg = chartSvg(bar);
assert.match(barSvg, /<rect/, 'bars are rectangles');
assert.match(barSvg, /ยอดขาย/);
assert.ok(barSvg.length > 2000);
const withRefs = chartSvg({ ...line, lines: [{ y: 30, text: '30°C' }], notes: [{ x: 1, y: 31, text: 'ร้อนสุด' }] });
assert.match(withRefs, /30°C/);
assert.match(withRefs, /ร้อนสุด/);
assert.throws(() => chartSvg({ type: 'line', series: [] }), /needs series/, 'a bad spec never reaches the overlay');

// ---- the types behind the gate still render (they arrive with the code, they unlock as one line)
const pairs = (n, f) => Array.from({ length: n }, (_, i) => [+ (i / (n - 1) * 10).toFixed(1), +f(i).toFixed(2)]);
const dormants = {
  area: { type: 'area', title: 'Area', x: { label: 'x' }, y: { label: 'y' }, series: [{ name: 'sin', data: pairs(20, (i) => Math.sin(i / 3)) }] },
  scatter: { type: 'scatter', title: 'Scatter', x: { label: 'h' }, series: [{ name: 'A', data: [[150, 50], [160, 55], [170, 62]] }] },
  hbar: { type: 'hbar', title: 'Hbar', x: { categories: ['กรุงเทพฯ', 'เชียงใหม่'] }, series: [{ name: 'pop', data: [5.5, 1.8] }] },
  histogram: { type: 'histogram', title: 'Hist', x: { label: 'score' }, series: [{ name: 'scores', values: [40, 55, 62, 64, 71, 88] }] },
  box: { type: 'box', title: 'Box', y: { label: 'h' }, series: [{ name: 'A', values: [1, 2, 3, 4, 5] }, { name: 'B', values: [2, 3, 4, 5, 6] }] },
  heatmap: { type: 'heatmap', title: 'Heat', grid: { x: ['6h', '12h', '18h'], y: ['Mon', 'Tue'], z: [[1, 5, 2], [3, 4, 1]] } },
  pie: { type: 'pie', title: 'Pie', slices: [{ name: 'Gas', value: 55 }, { name: 'Solar', value: 6 }] },
  donut: { type: 'donut', title: 'Donut', slices: [{ name: 'Gas', value: 55 }, { name: 'Solar', value: 6 }] },
  radar: { type: 'radar', title: 'Radar', x: { categories: ['A', 'B', 'C'] }, y: { max: 10 }, series: [{ name: 'P1', data: [9, 6, 8] }] },
};
for (const [type, spec] of Object.entries(dormants)) {
  assert.deepEqual(checkChart(spec), [], `${type}: a sound spec`);
  assert.match(chartSvg(spec), /^<svg /, `${type} renders`);
}

// ---- through the draw tool: the schema takes it, the gate speaks, the svg is rendered before it's sent
const mark = (chart) => ({ kind: 'chart', chart });
assert.deepEqual(checkDraw({ beats: [{ say: 'Trends.', marks: [mark(line)] }] }), []);
assert.deepEqual(checkDraw({ beats: [{ say: 'Bars.', marks: [mark(bar)] }] }), []);
assert.match(checkDraw({ beats: [{ say: 'x', marks: [mark(dormants.pie)] }] })[0], /chart type "pie" isn't available yet \(available: line, bar\)/);
assert.ok(DrawArgs.safeParse({ beats: [{ say: 'x', marks: [mark(bar)] }] }).success, 'the schema takes a chart mark');
assert.match(checkDraw({ beats: [{ say: 'x', marks: [{ kind: 'chart' }] }] })[0], /needs chart \(the spec\)/, 'a chart mark needs its spec, in words the model can fix');
assert.ok(!DrawArgs.safeParse({ beats: [{ say: 'x', marks: [mark({ type: 'bubble' })] }] }).success, 'an unknown type is refused');

{
  const [b] = await resolveTargets([{ say: 'x', marks: [mark(line)] }], {});
  const m = b.marks[0];
  assert.match(m.svg, /^<svg /, 'the svg is rendered before the mark goes to the overlay');
  assert.equal(m.kind, 'chart');
}
console.log('chart tests: passed');
