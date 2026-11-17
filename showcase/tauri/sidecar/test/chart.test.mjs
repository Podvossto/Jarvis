// The real-quality chart card: a declarative spec (what the model writes) is checked in words it can fix, then
// rendered to an SVG in the sidecar with ECharts SSR (offline, in the overlay's palette). Run: npm test
import assert from 'node:assert/strict';
import { LIMITS, TYPES, checkChart, chartSvg, fit, textWidth, toOption, version } from '../chart.mjs';
import { DrawArgs, checkDraw, resolveTargets } from '../draw.mjs';

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const line = { type: 'line', title: 'อุณหภูมิเฉลี่ย', x: { categories: ['ม.ค.', 'เม.ย.', 'ก.ค.'], label: 'เดือน' }, y: { label: 'อุณหภูมิ', unit: '°C' },
  series: [{ name: 'กรุงเทพ', data: [27, 30.4, 28.9] }, { name: 'เชียงใหม่', data: [21.2, 28.9, 27.2], tone: 'amber', dash: true }] };
const bar = { type: 'bar', title: 'ยอดขาย', x: { categories: ['Q1', 'Q2', 'Q3'] }, y: { label: 'Revenue', unit: 'M฿' },
  series: [{ name: 'Online', data: [12, 15, 19] }, { name: 'Stores', data: [20, 19, 18], tone: 'sky' }] };
const pairs = (n, f) => Array.from({ length: n }, (_, i) => [+(i / (n - 1) * 10).toFixed(1), +f(i).toFixed(2)]);
// One sound spec per type (Thai and long names on purpose: they're what broke the layout).
const specs = {
  line, bar,
  area: { type: 'area', title: 'Area', x: { label: 'x' }, y: { label: 'y' }, series: [{ name: 'sin', data: pairs(20, (i) => Math.sin(i / 3)) }] },
  scatter: { type: 'scatter', title: 'ส่วนสูงกับน้ำหนัก', x: { label: 'ส่วนสูง', unit: 'cm' }, series: [{ name: 'A', data: [[150, 50], [160, 55], [170, 62]] }] },
  hbar: { type: 'hbar', title: 'ประชากร', x: { categories: ['กรุงเทพมหานคร', 'เชียงใหม่', 'A very long category name indeed'] }, series: [{ name: 'pop', data: [5.5, 1.8, 1.2] }] },
  histogram: { type: 'histogram', title: 'คะแนน', x: { label: 'score' }, series: [{ name: 'scores', values: [40, 55, 62, 64, 71, 88] }] },
  box: { type: 'box', title: 'Box', y: { label: 'h' }, series: [{ name: 'เซิร์ฟเวอร์ A', values: [1, 2, 3, 4, 20] }, { name: 'B', values: [2, 3, 4, 5, 6] }] },
  heatmap: { type: 'heatmap', title: 'Heat', grid: { x: ['6h', '12h', '18h'], y: ['จันทร์', 'อังคาร'], z: [[1, 5, 2], [3, 4, 9]] } },
  pie: { type: 'pie', title: 'พลังงาน', slices: [{ name: 'ก๊าซธรรมชาติ', value: 55 }, { name: 'พลังงานหมุนเวียน', value: 12 }, { name: 'อื่นๆ', value: 0.5 }] },
  donut: { type: 'donut', title: 'Donut', slices: [{ name: 'Gas', value: 55 }, { name: 'Solar', value: 6 }] },
  radar: { type: 'radar', title: 'มือถือ', x: { categories: ['กล้อง', 'แบตเตอรี่', 'ราคา'] }, y: { max: 10 }, series: [{ name: 'P1', data: [9, 6, 8] }] },
};
assert.deepEqual(Object.keys(specs).sort(), [...TYPES].sort(), 'a case for every type');

// ---- every type: a sound spec passes, renders a valid SVG in the overlay's look
assert.ok(parseInt(version) >= 6, `echarts ${version}`);
for (const [type, spec] of Object.entries(specs)) {
  assert.deepEqual(checkChart(spec), [], `${type}: a sound spec`);
  const svg = chartSvg(spec);
  assert.match(svg, /^<svg [^>]*width="520" height="320"/, `${type} renders at card size`);
  assert.ok(svg.length > 1500, `${type} carries real drawing (${svg.length} bytes)`);
  assert.ok(!/NaN|undefined/.test(svg), `${type}: no NaN or undefined in the drawing`);
  assert.ok(!/style="[^"]*"[^ />]/.test(svg), `${type}: every attribute is closed (a stray quote breaks the whole image)`);
  if (spec.title) assert.ok(svg.includes(spec.title), `${type}: the title is drawn`);
}
const svg = chartSvg(line);
assert.match(svg, /#78ffe2/, 'the first series wears the overlay accent');
assert.match(svg, /#ffcf5c/, 'a named tone wins');
assert.match(svg, /stroke-dasharray/, 'dash: true dashes');
assert.match(chartSvg(bar), /<path d="M\S+ \S+L/, 'bars are drawn');
const withRefs = chartSvg({ ...line, lines: [{ y: 30, text: '30°C' }], notes: [{ x: 1, y: 31, text: 'ร้อนสุด' }] });
assert.match(withRefs, /30°C/);
assert.match(withRefs, /ร้อนสุด/);
assert.equal(toOption({ ...line, lines: [{ y: 30, text: 'ค่าเฉลี่ยทั้งปี' }] }).series[0].markLine.data[0].label.position, 'insideEndTop',
  'regression: a reference line\'s name sat past the plot\'s right edge and was cut off; it goes inside, above the line');
assert.throws(() => chartSvg({ type: 'line', series: [] }), /needs series/, 'a bad spec never reaches the overlay');

// ---- the checker, per type, in words the model can fix
const first = (c) => checkChart(c)[0] ?? '';
assert.match(first({ type: 'bubble' }), /type must be one of line, area/);
assert.match(first({ type: 'line', series: [] }), /needs series \(each \{name, data\}\)/);
assert.match(first({ type: 'line', series: [{ name: 'a', data: ['many'] }] }), /data must be \[x, y\] pairs of numbers, or numbers with x\.categories/);
assert.match(first({ type: 'line', x: { categories: ['a', 'b'] }, series: [{ name: 'a', data: [1, 2, 3] }] }), /3 values but 2 categories/);
assert.match(first({ type: 'line', x: { categories: ['a'] }, series: [{ name: 'a', data: [[1, 2]] }] }), /numbers, one per category \(or drop x\.categories/);
assert.deepEqual(checkChart({ type: 'line', x: { time: true }, series: [{ name: 'a', data: [['2024-01-01', 1], ['2024-02-01', 2]] }] }), [], 'dates on a time axis');
assert.match(first({ type: 'line', x: { time: true }, series: [{ name: 'a', data: [['soon', 1]] }] }), /x may be a date like "2024-05-01"/);
assert.match(first({ type: 'scatter', series: [{ name: 'a', data: [1, 2] }] }), /data must be \[x, y\] pairs of numbers\./, 'a scatter needs pairs');
assert.match(first({ type: 'scatter', series: [{ name: 'a', data: [[1], [2, 3, 4]] }] }), /data must be \[x, y\] pairs/);
assert.match(first({ type: 'bar', series: [{ name: 's', data: [1] }] }), /needs x\.categories \(one name per bar\)/);
assert.match(first({ type: 'bar', x: { categories: ['a'] }, series: [{ name: 's', data: [1, 2] }] }), /series "s": 2 values but 1 categories/);
// Regression: [x, y] pairs passed the old check on a bar chart and drew nothing sensible.
assert.match(first({ type: 'bar', x: { categories: ['a', 'b'] }, series: [{ name: 's', data: [[0, 1], [1, 2]] }] }), /data must be numbers, one per category\./);
assert.match(first({ type: 'hbar', x: { categories: ['a'] }, series: [{ name: 's' }] }), /series "s": needs data/);
assert.match(first({ type: 'line', series: Array.from({ length: LIMITS.series + 1 }, (_, i) => ({ name: String(i), data: [[0, 1]] })) }), /at most 8 series/);
assert.match(first({ type: 'line', series: [{ name: 'big', data: Array.from({ length: LIMITS.points + 1 }, (_, i) => [i, 1]) }] }), /at most 2000 values in all/);
assert.match(first({ type: 'histogram', series: [{ name: 's' }] }), /needs values \(the raw numbers, at least 2\)/);
// Regression: a histogram drew only its first series; the others vanished without a word.
assert.match(first({ type: 'histogram', series: [{ name: 'a', values: [1, 2] }, { name: 'b', values: [3, 4] }] }), /one series; to compare the spread of several groups, use box/);
assert.match(first({ type: 'box', series: [{ name: 's', values: [1, 2] }] }), /needs values \(the raw numbers, at least 3\)/);
// Regression: a box series without values crashed the renderer (spread of undefined) once another series had them.
assert.match(first({ type: 'box', series: [{ name: 'a', values: [1, 2, 3] }, { name: 'b' }] }), /series "b": needs values/);
assert.match(first({ type: 'heatmap' }), /needs grid \{x: \[column names\], y: \[row names\]/);
assert.match(first({ type: 'heatmap', grid: { x: ['a', 'b'], y: ['p'], z: [[1]] } }), /one value per grid\.x/);
// Regression: more z rows than y names passed the old check and drew rows with no name.
assert.match(first({ type: 'heatmap', grid: { x: ['a'], y: ['p'], z: [[1], [2]] } }), /grid\.z has 2 rows but grid\.y names 1/);
assert.match(first({ type: 'donut' }), /needs slices \(at least 2, each \{name, value\}\)/);
assert.match(first({ type: 'pie', slices: [{ name: 'a', value: -1 }, { name: 'b', value: 2 }] }), /0 or more \(a share of the whole\)/);
assert.match(first({ type: 'pie', slices: [{ name: 'a', value: 0 }, { name: 'b', value: 0 }] }), /every slice is 0/);
assert.match(first({ type: 'radar', series: [{ name: 'a', data: [1] }] }), /needs x\.categories \(one name per spoke\)/);
assert.match(first({ type: 'radar', x: { categories: ['a', 'b'] }, series: [{ name: 'a', data: [1, 2] }] }), /at least 3 categories/);
assert.match(first({ type: 'radar', x: { categories: ['a', 'b', 'c'] }, y: { max: 5 }, series: [{ name: 'a', data: [1, 2, 9] }] }), /above y\.max/);
assert.match(first({ ...line, y: { log: true }, series: [{ name: 'a', data: [0, 1, 2] }] }), /y\.log needs every value above 0/);

// ---- what a ScottPlot user reaches for: error bars, a second y axis, bar + line, a log axis
const err = { type: 'bar', title: 'Mean ± SD', x: { categories: ['Control', 'Drug A'] }, y: { unit: 'mg' }, series: [{ name: 'w1', data: [10, 14], err: [2, 3] }, { name: 'w2', data: [11, 22], err: [1, 4] }] };
assert.deepEqual(checkChart(err), []);
const errOpt = toOption(err), whisk = errOpt.series.filter((s) => s.type === 'custom');
assert.equal(whisk.length, 2, 'one whisker series per series with err');
assert.deepEqual(whisk[1].data[1], [1, 18, 26], 'each whisker carries its low and high end');
assert.deepEqual(whisk[1].encode, { x: 0, y: [1, 2] }, 'regression: whiskers past the top were cut off; both ends now count toward the axis');
assert.match(chartSvg(err), />30mg</, 'so the axis reaches past the tallest whisker (22 + 4)');
assert.ok(!errOpt.series[0].label, 'no numbers on bars that carry whiskers');
assert.deepEqual(checkChart({ type: 'hbar', x: { categories: ['a', 'b'] }, series: [{ name: 's', data: [1, 2], err: [0.1, 0.2] }] }), []);
assert.deepEqual(checkChart({ type: 'scatter', series: [{ name: 's', data: [[1, 2], [2, 3]], err: [0.1, 0.2] }] }), []);
assert.match(first({ ...err, series: [{ name: 's', data: [1, 2], err: [1] }] }), /err needs one number of 0 or more per value \(the ± size\), 2 in all/);
assert.match(first({ ...err, stacked: true }), /error bars don't go on stacked/);
assert.match(first({ ...specs.pie, series: [{ name: 's', err: [1] }] }), /err \(error bars\) works on line, area, scatter, bar and hbar/);
const combo = { type: 'bar', title: 'รายได้และการเติบโต', x: { categories: ['2565', '2566', '2567'] }, y: { label: 'รายได้', unit: 'M฿' }, y2: { label: 'เติบโต', unit: '%' },
  series: [{ name: 'รายได้', data: [160, 150, 190] }, { name: 'เติบโต', data: [18.5, -6.2, 26.7], as: 'line', axis: 'right', tone: 'amber' }] };
assert.deepEqual(checkChart(combo), []);
const comboOpt = toOption(combo);
assert.deepEqual(comboOpt.series.map((s) => [s.type, s.yAxisIndex ?? 0]), [['bar', 0], ['line', 1]], 'bar + line, the line on the right axis');
assert.equal(comboOpt.yAxis.length, 2);
assert.equal(comboOpt.yAxis[1].name, 'เติบโต (%)');
assert.ok(comboOpt.yAxis[1].alignTicks, 'the right axis lines its ticks up with the left one');
assert.match(chartSvg(combo), /เติบโต \(%\)/);
assert.match(first({ ...line, series: [{ name: 'a', data: [1, 2, 3], as: 'line' }] }), /as: 'line' is for a line drawn over the bars/);
assert.match(first({ ...line, series: [{ name: 'a', data: [1, 2, 3], axis: 'right' }] }), /leave at least one series on the left/);
assert.match(first({ ...specs.radar, series: [{ name: 'a', data: [1, 2, 3], axis: 'right' }, { name: 'b', data: [1, 2, 3] }] }), /axis: 'right' works on line, area, scatter and bar/);
assert.equal(toOption({ ...line, x: { categories: ['a', 'b', 'c'] }, y: { log: true } }).yAxis.type, 'log');
assert.match(chartSvg({ type: 'line', x: { categories: ['1', '2', '3'] }, y: { log: true }, series: [{ name: 'a', data: [1, 100, 10000] }] }), />10,000</);

// ---- text that fits: Thai and long names
// Regression: ECharts guessed a full em per character for a "mono" font and counted Thai vowel and tone marks as
// letters, so labels measured about twice their width: a 12-month axis dropped 8 of its months, region names were cut
// to three letters and the hbar's plot was squeezed to a sliver at the right.
assert.equal(textWidth('น้ำ', '11px').width, textWidth('นา', '11px').width, 'tone and vowel marks take no room');
assert.ok(textWidth('กรุงเทพมหานคร', '11px').width < 11 * 13 * 0.6, 'a Thai word measures about its real width');
assert.ok(textWidth('中文', '10px').width === 20, 'wide scripts a full em');
const months = chartSvg({ type: 'line', title: 't', x: { categories: MONTHS }, series: [{ name: 'a', data: MONTHS.map((_, i) => i) }] });
for (const m of MONTHS) assert.ok(months.includes(`>${m}<`), `every month is named in full on a 12-month axis (${m})`);
const hb = toOption(specs.hbar);
assert.equal(hb.grid.left, 112, 'the hbar keeps a fixed column for its names');
assert.equal(hb.yAxis.axisLabel.formatter('A very long category name indeed'), fit('A very long category name indeed', 96));
assert.ok(fit('ภาคตะวันออกเฉียงเหนือ', 67).length >= 8, `a long Thai name keeps most of a slot (${fit('ภาคตะวันออกเฉียงเหนือ', 67)})`);
assert.equal(fit('short', 100), 'short', 'what fits is left alone');
assert.match(fit('ภาคตะวันออกเฉียงเหนือ', 40), /…$/, 'what is cut ends in …');
{
  const s = 'ที่นี่ที่นั่น', cut = fit(s, 30), kept = cut.slice(0, -1);
  assert.ok(s.startsWith(kept) && !/^\p{M}/u.test(s.slice(kept.length)) && textWidth(cut).width <= 30, `a cut never parts a letter from its marks, and fits (${cut})`);
}
// Regression: the pie's legend sat over the slices; the pie is on the left now and its names in a column beside it.
const pieOpt = toOption(specs.pie);
assert.ok(pieOpt.legend.left > pieOpt.series[0].center[0] + 0.62 * 160 + 40, 'the legend clears the pie and its labels');
assert.equal(pieOpt.series[0].label.formatter({ percent: 14.08 }), '14%', 'whole percents (14.08% was cut to "8…" on a donut)');
assert.equal(pieOpt.series[0].label.formatter({ percent: 0.42 }), '0.4%');
// Regression: one dark label colour on every heatmap cell was unreadable on the dark half of the scale.
const heat = toOption(specs.heatmap);
assert.deepEqual(new Set(heat.series[0].data.map((d) => d.label.color)).size, 2, 'light words on dark cells, dark on light');
assert.equal(heat.yAxis.inverse, true, 'the first row of z is the top row, as the matrix reads');
// Regression: a scatter's x axis started at 0, packing heights of 150 to 180 cm into the right edge.
assert.equal(toOption(specs.scatter).xAxis.scale, true);

// ---- through the draw tool: the schema takes every type, the svg is rendered before it's sent
const mark = (chart) => ({ kind: 'chart', chart });
for (const [type, spec] of Object.entries(specs)) {
  assert.ok(DrawArgs.safeParse({ beats: [{ say: 'x', marks: [mark(spec)] }] }).success, `the schema takes a ${type} chart`);
  assert.deepEqual(checkDraw({ beats: [{ say: 'x', marks: [mark(spec)] }] }), [], `${type} is offered to the model`);
}
assert.ok(DrawArgs.safeParse({ beats: [{ say: 'x', marks: [mark(combo)] }] }).success, 'the schema takes y2, axis, as and err');
assert.match(checkDraw({ beats: [{ say: 'x', marks: [{ kind: 'chart' }] }] })[0], /needs chart \(the spec\)/, 'a chart mark needs its spec, in words the model can fix');
assert.match(checkDraw({ beats: [{ say: 'x', marks: [mark({ type: 'pie', slices: [] })] }] })[0], /beat 1 mark 1 \(chart\): needs slices/, 'the checker speaks through draw');
assert.ok(!DrawArgs.safeParse({ beats: [{ say: 'x', marks: [mark({ type: 'bubble' })] }] }).success, 'an unknown type is refused');
{
  const [b] = await resolveTargets([{ say: 'x', marks: [mark(line)] }], {});
  const m = b.marks[0];
  assert.match(m.svg, /^<svg /, 'the svg is rendered before the mark goes to the overlay');
  assert.equal(m.kind, 'chart');
}
console.log('chart tests: passed');
