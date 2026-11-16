// The free-form HTML card: the model's own markup, shown in a sandboxed frame on the overlay — no network, no files,
// no navigation; it stays until close_card closes it. Run: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTools } from '../tools.mjs';
import { DrawArgs, LIMITS, checkDraw } from '../draw.mjs';

// ---- the schema and its checker
const ok = (a) => DrawArgs.safeParse(a).success;
const mark = (html) => ({ kind: 'html', html });
assert.ok(ok({ beats: [{ marks: [mark('<p>hi</p>')] }] }), 'an html card needs no say line');
assert.match(checkDraw({ beats: [{ marks: [{ kind: 'html' }] }] })[0], /needs html/, 'it needs its markup, in words the model can fix');
assert.ok(!ok({ beats: [{ marks: [mark('x'.repeat(LIMITS.htmlChars + 1))] }] }), 'huge markup is refused');
assert.deepEqual(checkDraw({ beats: [{ marks: [mark('<b>x</b>')] }] }), []);
assert.match(checkDraw({ beats: [{ marks: [{ kind: 'html', html: '   ' }] }] })[0], /needs html/);

// ---- the tool routes through the same card pipeline, so close_card closes it
const noop = async () => {};
const sent = [];
const made = createTools({ allowActions: false, ui: (m) => { if (m.kind !== 'agent') return; if (m.e?.type === 'draw') setTimeout(() => made.ink.started(m.e.id, m.e.seg), 5); else sent.push(m.e); }, ask: async () => false, openUrl: noop, onCommitments: noop, showList: noop, fmtWhen: String, commitmentsText: () => '', userName: 'Test' });
const show = made.tools.find((t) => t.name === 'show_html'), close = made.tools.find((t) => t.name === 'close_card');
assert.ok(show && close, 'show_html is a tool next to close_card');
await show.execute({ html: '<canvas id="c"></canvas><script>for (let i = 0; i < 30; i++) console.log(i)</script>', title: 'waves' }, { toolCallId: 'h1' });
assert.match(made.ink.describe(), /html “waves”/, 'the card is a part with a title, closable by name');
await close.execute({ last: 1 }, { toolCallId: 'h2' });
assert.equal(made.ink.describe(), '', 'and it closes');
await assert.rejects(show.execute({ html: 'x'.repeat(LIMITS.htmlChars + 1) }, { toolCallId: 'h3' }), /too much/i, 'the cap is enforced at execution too');

// ---- the sandbox, read off the overlay's source: no network, no files, no way out of the frame
const ink = readFileSync(new URL('../../../roamies/ink.js', import.meta.url), 'utf8');
assert.match(ink, /setAttribute\('sandbox', 'allow-scripts'\)/, 'the frame is sandboxed: scripts yes, same-origin no');
assert.ok(!/allow-same-origin|allow-top-navigation|allow-popups/.test(ink), 'and none of the exits are granted');
assert.match(ink, /Content-Security-Policy" content="default-src 'none'/, 'a CSP keeps the frame off the network');
assert.match(ink, /m\.iframe\?\.remove\?\.\(\)/, 'the frame goes when the card fades');
assert.match(ink, /async html\(m\)/, 'the overlay draws it as a card');
const tools = readFileSync(new URL('../tools.mjs', import.meta.url), 'utf8');
assert.match(tools, /name: 'show_html'/, 'show_html exists');
assert.match(tools, /beats: \[\{ marks: \[\{ kind: 'html'/, 'it rides the same pipeline as the other cards');
console.log('html card tests: passed');
