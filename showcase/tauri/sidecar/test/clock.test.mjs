// The clock widget and its countdown: the model shows it or sets a timer by voice, the sidecar keeps the one active
// countdown and fires it; the overlay draws the face. Run: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClock } from '../clock.mjs';
import { createTools } from '../tools.mjs';

const T0 = 1_000_000;

{
  const c = createClock({ now: () => T0 });
  assert.equal(c.active(), null, 'nothing runs at first');
  const t = c.start({ minutes: 5, label: 'ไข่ต้ม' });
  assert.equal(t.endsAt - T0, 5 * 60_000, 'five minutes from now');
  assert.equal(c.active().label, 'ไข่ต้ม');
  assert.equal(c.active().leftMs(T0 + 60_000), 4 * 60_000, 'counting down');
  // A new countdown replaces the one before, and says what it replaced.
  const old = c.start({ seconds: 30, label: 'ชา' });
  assert.equal(old.cancelled.label, 'ไข่ต้ม', 'the replaced timer is cancelled, not forgotten');
  assert.equal(c.active().endsAt - T0, 30_000, 'seconds work too');
  const done = c.fire(T0 + 31_000);
  assert.equal(done.label, 'ชา', 'fire reports the label when the time has passed');
  assert.equal(c.active(), null, 'and the clock is clear');
}

{
  const c = createClock({ now: () => T0 });
  c.start({ minutes: 1, label: 'quick' });
  assert.equal(c.fire(T0 + 1000).fired, false, 'not yet is not done');
  assert.equal(c.cancel().label, 'quick', 'cancel returns the old timer');
  assert.equal(c.active(), null);
  assert.equal(c.cancel(), null, 'cancelling nothing is fine');
  assert.equal(c.fire(T0 + 1000), null, 'firing nothing is fine');
}

// ---- the tool: voice-shaped, flat schema, tells the overlay
const noop = async () => {};
const sent = [];
const made = createTools({ allowActions: false, ui: (m) => { if (m.kind !== 'agent') return; sent.push(m.e); }, ask: async () => false, openUrl: noop, onCommitments: noop, showList: noop, fmtWhen: String, commitmentsText: () => '', userName: 'Test' });
const clock = made.tools.find((t) => t.name === 'clock');
assert.ok(clock, 'clock is a tool');
assert.match(clock.description, /จับเวลา/, 'the Thai way of asking is named');

{
  sent.length = 0;
  const out = await clock.execute({ timer: { minutes: 5, label: 'พาสต้า' } }, { toolCallId: 'c1' });
  assert.deepEqual(sent[0], { type: 'clock', show: null, timer: { endsAt: sent[0].timer.endsAt, label: 'พาสต้า' } }, 'the overlay gets the deadline');
  assert.match(out, /5 min/, 'the model is told what was set');
  assert.match(out, /พาสต้า/);
  assert.ok(sent[0].timer.endsAt > Date.now() + 4.5 * 60_000, 'the deadline is real');
}

{
  sent.length = 0;
  const out = await clock.execute({ show: 'analog' }, { toolCallId: 'c2' });
  assert.deepEqual(sent[0], { type: 'clock', show: 'analog', timer: null });
  assert.match(out, /analog/);
  const hidden = await clock.execute({ hide: true }, { toolCallId: 'c3' });
  assert.deepEqual(sent[1], { type: 'clock', show: null, timer: null, hide: true });
  assert.match(hidden, /Clock hidden/i);
}

// ---- the wiring, read off the source like prompt.test does
const side = readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
assert.match(side, /announce: \(label\) => \{ say\(`Time is up: \$\{label\}\.`\)/, 'the sidecar announces the countdown: a bubble now, a spoken line via the queue');
const draw = readFileSync(new URL('../tools.mjs', import.meta.url), 'utf8');
assert.match(draw, /clock\.fire\(\)/, 'the tool keeps the deadline and fires it');
assert.ok(!/"(oneOf|anyOf|allOf)"/.test(JSON.stringify((await import('@kenkaiiii/gg-ai')).resolveToolSchema(clock))), 'one flat schema, no unions');
console.log('clock tests: passed');
