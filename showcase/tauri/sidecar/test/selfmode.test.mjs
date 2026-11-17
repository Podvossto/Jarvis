// self_mode: where the Sidekick sits (a pinned spot, or following the cursor) and the always-listening mic, by asking.
// The sidecar does the work (setMode); the tool only passes what was asked. Run: npm test
import assert from 'node:assert/strict';
import { createTools, PLACES } from '../tools.mjs';

const noop = () => {};
const asked = [];
const made = createTools({
  setMode: (m) => { asked.push(m); return 'done'; },
  allowActions: false, ui: noop, ask: async () => false, openUrl: noop, onCommitments: noop, showList: noop, fmtWhen: String, commitmentsText: () => '', userName: 'Test',
});
const tool = made.tools.find((t) => t.name === 'self_mode');
assert.ok(tool, 'self_mode is a tool');
assert.match(tool.description, /เปิดไมค์รอฟังตลอด/, 'the Thai way of asking for the open mic is named');

// Every place the tool takes, except "follow", is a spot on the screen, from 0 to 1 each way.
const places = tool.parameters.shape.place.unwrap().options;
for (const p of places.filter((p) => p !== 'follow')) {
  assert.ok(PLACES[p], `${p} has a spot`);
  for (const v of [PLACES[p].fx, PLACES[p].fy]) assert.ok(v >= 0 && v <= 1, `${p} is on the screen`);
}
assert.deepEqual(PLACES['top-right'], { fx: 1, fy: 0 }, 'top right is the right edge, at the top');

assert.equal(await tool.execute({ place: 'top-right' }), 'done');
assert.equal(await tool.execute({ openMic: true }), 'done');
assert.deepEqual(asked, [{ place: 'top-right', openMic: undefined }, { place: undefined, openMic: true }]);
assert.ok(tool.parameters.safeParse({ place: 'follow' }).success, 'follow the cursor again');
assert.ok(!tool.parameters.safeParse({ place: 'under the desk' }).success, 'only the known places');

// Without the sidecar's setMode (an agent's own tools), it says so instead of failing.
const bare = createTools({ allowActions: false, ui: noop, ask: async () => false, openUrl: noop, onCommitments: noop, showList: noop, fmtWhen: String, commitmentsText: () => '', userName: 'Test' });
assert.equal(await bare.tools.find((t) => t.name === 'self_mode').execute({ openMic: true }), 'Not available here.');

console.log('self mode tests: passed');
