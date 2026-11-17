// The figure card's pieces: a detailed picture the model writes as named parts (each a few plain shapes in its own
// units), checked in words it can fix and turned into SVG here, so the overlay can show it whole and then call out one
// part at a time while the voice explains it. No model-written markup reaches the overlay: every element and attribute
// comes from this file, built from checked numbers, a checked path grammar, a fixed palette and escaped text.
export const TONES = { accent: '#78ffe2', teal: '#78ffe2', amber: '#ffcf5c', coral: '#ff8a7a', lilac: '#b9a4ff', sky: '#7cc8ff', lime: '#b6f36b', red: '#ff6b6b', white: '#e8fffa', dim: '#28c4b8', deep: '#0e5c60', none: 'none' };
export const LIMITS = { parts: 24, shapes: 300, pathChars: 4000, totalChars: 40_000, text: 40, label: 40 };
export const SHAPES = ['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text'];
// What each shape can't do without (an absent one was written as "undefined" and the whole picture failed to load).
const NEEDS = { circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'], rect: ['x', 'y', 'w', 'h'], line: ['x1', 'y1', 'x2', 'y2'], text: ['x', 'y'] };
const NUMS = ['x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'w', 'h', 'x1', 'y1', 'x2', 'y2', 'width', 'size', 'opacity'];
// SVG path data: commands and numbers only (no url(), no quotes, nothing outside the path grammar).
const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$/;
export const ID = /^[a-z][a-z0-9_-]{0,19}$/;
const num = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e5;
// Own keys only: "constructor" is `in` every object, and passed as a tone it wrote a function into the SVG.
const isTone = (t) => Object.hasOwn(TONES, t);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Problems, as lines for the model ([] when fine). f: { view: [w, h], parts: [{ id, label, tone, fill, shapes }] } */
export function checkFigure(f) {
  const out = [], ids = new Set();
  if (!Array.isArray(f?.view) || f.view.length !== 2 || !f.view.every((v) => num(v) && v >= 10 && v <= 2000)) out.push('view must be [width, height] in your own units, 10 to 2000 each (e.g. [400, 300]); every shape is placed in that box, y down.');
  if (!f?.parts?.length || f.parts.length > LIMITS.parts) out.push(`parts: 1 to ${LIMITS.parts}, each a named piece of the picture.`);
  let n = 0, chars = 0;
  for (const [i, p] of (f?.parts ?? []).entries()) {
    const who = `part ${i + 1}${p.id ? ` (${p.id})` : ''}`;
    if (!ID.test(p.id ?? '')) out.push(`${who}: id must be lowercase letters, digits, - or _, starting with a letter, up to 20 (e.g. "lens"); put the name people read in label.`);
    else if (ids.has(p.id)) out.push(`${who}: two parts share the id "${p.id}".`);
    ids.add(p.id);
    if (p.label != null && (!String(p.label).trim() || String(p.label).length > LIMITS.label)) out.push(`${who}: label needs 1 to ${LIMITS.label} characters.`);
    for (const k of ['tone', 'fill']) if (p[k] != null && !isTone(p[k])) out.push(`${who}: ${k} must be one of ${Object.keys(TONES).join(', ')}.`);
    if (!p.shapes?.length) out.push(`${who}: needs shapes (a few each: path, circle, ellipse, rect, line, polyline, polygon, text).`);
    for (const [j, s] of (p.shapes ?? []).entries()) {
      n++; const w = `${who} shape ${j + 1}`;
      if (!SHAPES.includes(s.type)) { out.push(`${w}: type must be one of ${SHAPES.join(', ')}.`); continue; }
      const missing = (NEEDS[s.type] ?? []).filter((k) => s[k] == null);
      if (missing.length) out.push(`${w}: a ${s.type} needs ${missing.join(', ')}.`);
      for (const k of NUMS) if (s[k] != null && !num(s[k])) out.push(`${w}: ${k} must be a number.`);
      if (num(s.opacity) && (s.opacity < 0 || s.opacity > 1)) out.push(`${w}: opacity is 0 to 1.`);
      if (s.type === 'path') { if (typeof s.d !== 'string' || !s.d.trim() || !PATH.test(s.d) || s.d.length > LIMITS.pathChars) out.push(`${w}: d must be SVG path data (M, L, C, Q, A, Z … and numbers), under ${LIMITS.pathChars} characters.`); else chars += s.d.length; }
      if (['polyline', 'polygon'].includes(s.type) && !(Array.isArray(s.points) && s.points.length >= 2 && s.points.every((q) => Array.isArray(q) && q.length === 2 && q.every(num)))) out.push(`${w}: points must be [[x, y], …], at least 2.`);
      if (s.type === 'text' && (!s.text || String(s.text).length > LIMITS.text)) out.push(`${w}: text needs 1 to ${LIMITS.text} characters.`);
      for (const k of ['tone', 'fill']) if (s[k] != null && !isTone(s[k])) out.push(`${w}: ${k} must be one of ${Object.keys(TONES).join(', ')}.`);
    }
  }
  if (n > LIMITS.shapes) out.push(`at most ${LIMITS.shapes} shapes in all.`);
  if (chars > LIMITS.totalChars) out.push('the path data is too long in all; simplify.');
  return out;
}

const FONT = "Martian Mono, Leelawadee UI, Noto Sans Thai, Thonburi, monospace";
function shape(s, p) {
  const stroke = TONES[s.tone ?? p.tone ?? 'accent'], fill = s.fill ?? p.fill ?? 'none', f = TONES[fill];
  const common = `stroke="${stroke}" stroke-width="${num(s.width) ? s.width : 1.6}" fill="${f}" fill-opacity="${fill === 'none' ? 0 : num(s.opacity) ? s.opacity : 0.18}" stroke-linecap="round" stroke-linejoin="round"${s.dash ? ' stroke-dasharray="4 3"' : ''}`;
  const pts = (q) => q.map(([x, y]) => `${x},${y}`).join(' ');
  switch (s.type) {
    case 'path': return `<path d="${s.d}" ${common}/>`;
    case 'circle': return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" ${common}/>`;
    case 'ellipse': return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" ${common}/>`;
    case 'rect': return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${num(s.r) ? s.r : 0}" ${common}/>`;
    case 'line': return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" ${common}/>`;
    case 'polyline': return `<polyline points="${pts(s.points)}" ${common}/>`;
    case 'polygon': return `<polygon points="${pts(s.points)}" ${common}/>`;
    case 'text': return `<text x="${s.x}" y="${s.y}" fill="${stroke}" font-size="${num(s.size) ? s.size : 11}" font-family="${FONT}" text-anchor="middle">${esc(s.text)}</text>`;
  }
  return '';
}
/** The figure as SVG at `scale` px per unit. only: just this part (the overlay finds where a part is from it). */
export function figureSvg(f, { only = null, scale = 2 } = {}) {
  const [w, h] = f.view;
  const body = f.parts.filter((p) => !only || p.id === only).map((p) => `<g data-part="${p.id}">${p.shapes.map((s) => shape(s, p)).join('')}</g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}
/** What the overlay gets: the whole picture and each part on its own, with the name people read. */
export function figurePayload(f) {
  const bad = checkFigure(f);
  if (bad.length) throw new Error(bad.join(' '));
  return { view: f.view, svg: figureSvg(f), parts: f.parts.map((p) => ({ id: p.id, label: String(p.label ?? p.id), svg: figureSvg(f, { only: p.id }) })) };
}
