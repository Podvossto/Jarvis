// "Close that": close_card takes down the newest card, named parts or everything, tells the overlay, and forgets them.
import assert from 'node:assert/strict';
import { createTools } from '../tools.mjs';
import { createParts } from '../draw.mjs';

{ // The newest cards, newest first; screen marks don't count.
  const p = createParts();
  p.assign([{ marks: [{ kind: 'note', text: 'a' }, { kind: 'ring', at: { name: 'Export' } }, { kind: 'note', text: 'b' }] }]);
  assert.deepEqual(p.cards(), ['p3']);
  assert.deepEqual(p.cards(2), ['p3', 'p1']);
  assert.deepEqual(p.cards(9), ['p3', 'p1']);
}

const sent = [];
const noop = async () => {};
const made = createTools({ allowActions: () => false, ui: (m) => { if (m.kind !== 'agent') return; if (m.e?.type === 'draw') setTimeout(() => made.ink.started(m.e.id, m.e.seg), 5); else sent.push(m.e); }, ask: async () => false, openUrl: noop, onCommitments: noop, showList: noop, fmtWhen: String, commitmentsText: () => '', userName: 'Test' });
const draw = made.tools.find((t) => t.name === 'draw'), close = made.tools.find((t) => t.name === 'close_card');
assert.ok(close, 'close_card is a tool');
assert.match(close.description, /ปิดอันนี้/, 'the Thai way of asking is named');
assert.match(draw.description, /close_card/, 'draw points at it');

const note = (text) => ({ kind: 'note', text });
assert.equal(await close.execute({}, { toolCallId: 'c0' }), 'Nothing is drawn on screen.');
await draw.execute({ beats: [{ say: 'Three notes.', marks: [note('one'), note('two'), note('three')] }] }, { toolCallId: 'd1' });
assert.match(made.ink.describe(), /p1 .*p2 .*p3 /);

// No arguments: the one just made.
sent.length = 0;
let out = await close.execute({}, { toolCallId: 'c1' });
assert.deepEqual(sent, [{ type: 'ink_close', parts: ['p3'] }]);
assert.match(out, /^Closed p3 note “three”\. On screen now: p1 /);
assert.doesNotMatch(made.ink.describe(), /p3/);

// By name; one that isn't there is an error that says what is.
sent.length = 0;
out = await close.execute({ parts: ['p1'] }, { toolCallId: 'c2' });
assert.deepEqual(sent, [{ type: 'ink_close', parts: ['p1'] }]);
assert.equal(made.ink.describe(), 'p2 note “two”');
await assert.rejects(close.execute({ parts: ['p9'] }, { toolCallId: 'c3' }), /no p9 on screen now \(there is: p2 note “two”\)/);
assert.equal(sent.length, 1, 'nothing was sent for the one that failed');

// Everything.
sent.length = 0;
out = await close.execute({ all: true }, { toolCallId: 'c4' });
assert.equal(sent[0].type, 'ink_clear');
assert.equal(made.ink.describe(), '');
assert.match(out, /On screen now: nothing/);
console.log('close card tests: passed');
