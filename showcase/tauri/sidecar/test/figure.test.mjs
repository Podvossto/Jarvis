// The figure card: a detailed picture in named parts (figure.mjs turns it into SVG, nothing model-written reaches the
// overlay as markup), and callouts that point at one part at a time in later beats while the voice explains it.
// Run: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIMITS, checkFigure, figurePayload, figureSvg } from '../figure.mjs';
import { CARDS, DrawArgs, checkDraw, createParts, linkCallouts, resolveTargets } from '../draw.mjs';
import { createTools } from '../tools.mjs';

// A piston engine, written the way the model would.
const engine = {
  view: [300, 240],
  parts: [
    { id: 'cylinder', label: 'กระบอกสูบ', tone: 'white', shapes: [{ type: 'path', d: 'M100 20 L100 150 M200 20 L200 150', width: 3 }] },
    { id: 'piston', label: 'ลูกสูบ', tone: 'amber', fill: 'amber', shapes: [{ type: 'rect', x: 104, y: 70, w: 92, h: 40, r: 4 }] },
    { id: 'rod', label: 'ก้านสูบ', tone: 'sky', shapes: [{ type: 'line', x1: 150, y1: 100, x2: 180, y2: 190, width: 4 }] },
    { id: 'crank', label: 'เพลาข้อเหวี่ยง', tone: 'coral', shapes: [{ type: 'circle', cx: 150, cy: 190, r: 34 }, { type: 'circle', cx: 180, cy: 190, r: 4, fill: 'coral', opacity: 1 }] },
    { id: 'spark', label: 'หัวเทียน', tone: 'lime', shapes: [{ type: 'polyline', points: [[150, 0], [150, 20]] }, { type: 'text', x: 150, y: 16, text: '⚡', size: 10 }] },
  ],
};

// ---- the checker, in words the model can fix
assert.deepEqual(checkFigure(engine), [], 'a sound figure');
const first = (f) => checkFigure(f)[0] ?? '';
assert.match(first({ ...engine, view: [400] }), /view must be \[width, height\]/);
assert.match(first({ view: [10, 10], parts: [] }), /parts: 1 to 24/);
assert.match(first({ view: [100, 100], parts: [{ id: 'Lens', shapes: [{ type: 'circle', cx: 1, cy: 1, r: 1 }] }] }), /id must be lowercase letters.*; put the name people read in label/);
assert.match(first({ view: [100, 100], parts: [{ id: 'a', shapes: [{ type: 'circle', cx: 1, cy: 1, r: 1 }] }, { id: 'a', shapes: [{ type: 'circle', cx: 1, cy: 1, r: 1 }] }] }), /two parts share the id "a"/);
assert.match(first({ view: [100, 100], parts: [{ id: 'a', shapes: [] }] }), /needs shapes/);
assert.match(first({ view: [100, 100], parts: [{ id: 'a', shapes: [{ type: 'blob' }] }] }), /type must be one of path, circle/);
// Regression (from the prototype): a shape missing a coordinate was written as cx="undefined", and the whole picture
// then failed to load on the card.
assert.match(first({ view: [100, 100], parts: [{ id: 'a', shapes: [{ type: 'circle', cx: 10, cy: 10 }] }] }), /part 1 \(a\) shape 1: a circle needs r\./);
assert.match(first({ view: [100, 100], parts: [{ id: 'a', shapes: [{ type: 'rect', x: 1 }] }] }), /a rect needs y, w, h/);
assert.match(first({ view: [100, 100], parts: [{ id: 'a', shapes: [{ type: 'polygon', points: [[1, 2]] }] }] }), /points must be \[\[x, y\], …\], at least 2/);
assert.match(first({ view: [100, 100], parts: [{ id: 'a', shapes: [{ type: 'circle', cx: 1, cy: 1, r: 1, opacity: 3 }] }] }), /opacity is 0 to 1/);
assert.match(first({ view: [100, 100], parts: [{ id: 'a', shapes: [{ type: 'text', x: 1, y: 1, text: 'x'.repeat(LIMITS.text + 1) }] }] }), /text needs 1 to 40 characters/);
assert.match(first({ view: [100, 100], parts: [{ id: 'a', shapes: Array.from({ length: LIMITS.shapes + 1 }, () => ({ type: 'circle', cx: 1, cy: 1, r: 1 })) }] }), /at most 300 shapes/);

// ---- nothing hostile gets through: no markup, no urls, no scripts
const hostile = {
  'script in a path': { id: 'a', shapes: [{ type: 'path', d: 'M0 0"/><script>alert(1)</script><path d="' }] },
  'url() in a path': { id: 'a', shapes: [{ type: 'path', d: 'M0 0 url(https://evil.example/x)' }] },
  'foreignObject type': { id: 'a', shapes: [{ type: 'foreignObject' }] },
  'url() fill': { id: 'a', fill: 'url(https://evil.example/x)', shapes: [{ type: 'circle', cx: 1, cy: 1, r: 1 }] },
  'id injection': { id: 'a" onload="x', shapes: [{ type: 'circle', cx: 1, cy: 1, r: 1 }] },
  'string coordinates': { id: 'a', shapes: [{ type: 'circle', cx: '1" onclick="x', cy: 1, r: 1 }] },
  // Regression (from the prototype): `in` let "constructor" pass as a tone, which wrote a function into the SVG.
  'an inherited name as a tone': { id: 'a', tone: 'constructor', shapes: [{ type: 'circle', cx: 1, cy: 1, r: 1 }] },
  'an inherited name as a shape fill': { id: 'a', shapes: [{ type: 'circle', cx: 1, cy: 1, r: 1, fill: '__proto__' }] },
};
for (const [name, part] of Object.entries(hostile)) {
  const f = { view: [10, 10], parts: [part] };
  assert.ok(checkFigure(f).length, `refused: ${name}`);
  assert.throws(() => figurePayload(f), undefined, `never rendered: ${name}`);
}
const t = figurePayload({ view: [10, 10], parts: [{ id: 'a', label: '<b>x</b>', shapes: [{ type: 'text', x: 1, y: 1, text: '<script>x</script>' }] }] });
assert.ok(!t.svg.includes('<script') && t.svg.includes('&lt;script&gt;'), 'text is escaped, never markup');

// ---- the SVG: the whole picture and each part alone, in the overlay's palette
const pay = figurePayload(engine);
assert.deepEqual(pay.view, [300, 240]);
assert.match(pay.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="600" height="480" viewBox="0 0 300 240">/);
assert.ok(!/undefined|NaN|function/.test(pay.svg), 'no undefined, NaN or function in the drawing');
assert.equal((pay.svg.match(/<g data-part=/g) ?? []).length, 5, 'one group per part');
assert.match(pay.svg, /stroke="#ffcf5c"/, 'a part wears its tone');
assert.deepEqual(pay.parts.map((p) => p.id), ['cylinder', 'piston', 'rod', 'crank', 'spark']);
assert.equal(pay.parts[1].label, 'ลูกสูบ', 'the name people read comes with each part');
for (const p of pay.parts) assert.equal((p.svg.match(/<g data-part=/g) ?? []).length, 1, `${p.id} alone, to find where it is`);
assert.match(figureSvg(engine, { scale: 1 }), /width="300" height="240"/);

// ---- through the draw tool: a figure, then a callout per part in later beats
const fig = (figure = engine) => ({ kind: 'figure', title: 'เครื่องยนต์', figure });
const walk = { beats: [
  { say: 'This is a piston engine.', marks: [fig()] },
  { say: 'The piston moves up and down.', marks: [{ kind: 'callout', name: 'piston' }] },
  { say: 'The rod turns the crank.', marks: [{ kind: 'callout', name: 'crank' }] },
  { say: 'All together.', marks: [{ kind: 'callout' }] },
] };
assert.ok(DrawArgs.safeParse(walk).success, 'the schema takes a figure and callouts');
assert.ok(CARDS.includes('figure') && !CARDS.includes('callout'), 'a figure is a card; a callout is not');
assert.deepEqual(checkDraw(walk), []);
assert.match(checkDraw({ beats: [{ say: 'x', marks: [{ kind: 'figure' }] }] })[0], /beat 1 mark 1 \(figure\): needs figure \(\{view/);
assert.match(checkDraw({ beats: [{ say: 'x', marks: [fig({ view: [10, 10], parts: [{ id: 'a', shapes: [{ type: 'circle' }] }] })] }] })[0], /beat 1 mark 1 \(figure\): part 1 \(a\) shape 1: a circle needs cx, cy, r/);
assert.match(checkDraw({ beats: [{ say: 'x', marks: [{ kind: 'callout', name: 'piston' }] }] })[0], /callout points at a part of a figure drawn before it in this same draw call/);
assert.match(checkDraw({ beats: [walk.beats[0], { say: 'x', marks: [{ kind: 'callout', name: 'valve' }] }] })[0], /beat 2 mark 1 \(callout\): no part of the figure has the id "valve" \(parts: "cylinder", "piston", "rod", "crank", "spark"\)/);
assert.ok(!DrawArgs.safeParse({ beats: [{ say: 'x', marks: [fig({ view: [10, 10], parts: [{ id: 'a', tone: 'neon', shapes: [] }] })] }] }).success, 'an unknown tone is refused');

// A figure whose parts are called out opens quiet (no names until each is called out); one nobody calls out opens named.
{
  const beats = linkCallouts(structuredClone(walk.beats));
  assert.equal(beats[0].marks[0].quiet, true);
  const alone = linkCallouts([{ say: 'x', marks: [fig()] }]);
  assert.equal(alone[0].marks[0].quiet, undefined);
  const out = await resolveTargets(beats, {});
  const m = out[0].marks[0];
  assert.equal(m.fig.parts.length, 5, 'the overlay gets the picture and its parts');
  assert.equal(m.figure, undefined, 'and not the spec again');
  assert.equal(m.quiet, true);
  const parts = createParts(), ids = parts.assign(out);
  assert.deepEqual(ids, ['p1'], 'only the figure is a part on screen; callouts are moments on it');
  assert.match(parts.describe(), /p1 figure “เครื่องยนต์”/);
}

// Through the real tool, on to the overlay.
{
  const sent = [], noop = async () => {};
  const made = createTools({ allowActions: false, ui: (m) => { if (m.kind === 'agent' && m.e?.type === 'draw') { sent.push(m.e); setTimeout(() => made.ink.started(m.e.id, m.e.seg), 5); } }, ask: async () => false, openUrl: noop, onCommitments: noop, showList: noop, fmtWhen: String, commitmentsText: () => '', userName: 'Test' });
  const draw = made.tools.find((x) => x.name === 'draw');
  assert.match(draw.description, /figure \(title, figure \{view: \[w, h\], parts: \[\{id, label, tone, fill, shapes\}\]\}\)/, 'the model is told how to write a figure');
  assert.match(draw.description, /callout \(name: a part's id\) points at that part while its say line explains it/, 'and how to call out its parts');
  const res = await draw.execute(walk, { toolCallId: 'f1' });
  assert.match(res, /Drew p1 figure “เครื่องยนต์”/);
  const marks = sent.flatMap((e) => e.beats.flatMap((b) => b.marks));
  assert.deepEqual(marks.map((m) => m.kind), ['figure', 'callout', 'callout', 'callout'], 'each callout goes in its own beat, with its line');
  assert.equal(marks[0].quiet, true);
  assert.equal(marks[1].name, 'piston');
  assert.ok(marks[0].fig.svg.startsWith('<svg'), 'the picture is drawn in here, not on the overlay');
}

// ---- the overlay: a card that draws the parts' pictures, and a callout that points into the newest figure
const ink = readFileSync(new URL('../../../roamies/ink.js', import.meta.url), 'utf8');
assert.match(ink, /figure: \(m\) => drawFigure\(m\),\n\s*callout: \(m\) => callout\(m\),/, 'the overlay draws both');
assert.match(ink, /names: !m\.quiet/, 'a quiet figure waits for its callouts to name its parts');
assert.match(ink, /const nearest = \(pts, x, y\)/, 'leader lines land on the part\'s own ink');
assert.ok(!/innerHTML|insertAdjacentHTML/.test(ink.slice(ink.indexOf('async function drawFigure'), ink.indexOf('async function callout'))), 'the figure never goes into the page as markup');
console.log('figure tests: passed');
process.exit(0);
