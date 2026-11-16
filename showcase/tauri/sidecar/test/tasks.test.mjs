// The parallel-task queue: a new request while one is running waits in line instead of cancelling it, with a cap,
// a cancel-all for an explicit stop, and the list the overlay shows. Run: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTasks } from '../tasks.mjs';

{
  const t = createTasks({ max: 3 });
  assert.equal(t.size, 0);
  assert.ok(t.add('first', { byVoice: true }), 'a job takes a slot');
  assert.ok(t.add('second'), 'and another');
  assert.equal(t.size, 2);
  assert.deepEqual(t.list().map((j) => j.text), ['first', 'second'], 'oldest first');
  assert.deepEqual(t.list()[0], { id: 1, text: 'first', state: 'queued', byVoice: true }, 'the list is what the overlay shows');
  const job = t.take();
  assert.equal(job.text, 'first', 'take runs the oldest');
  assert.equal(t.size, 1, 'taken jobs leave the list');
  assert.deepEqual(t.list().map((j) => j.text), ['second']);
}

{ // full queue: the newest request is refused, nothing is dropped
  const t = createTasks({ max: 2 });
  t.add('a'); t.add('b');
  assert.equal(t.add('c'), null, 'the queue has a cap');
  assert.deepEqual(t.list().map((j) => j.text), ['a', 'b']);
  t.take();
  assert.ok(t.add('c'), 'a slot opens again after a take');
}

{ // an explicit stop cancels everything waiting; the queue empties
  const t = createTasks({ max: 3 });
  t.add('a'); t.add('b');
  const dropped = t.cancelAll();
  assert.deepEqual(dropped.map((j) => j.text), ['a', 'b'], 'cancelAll returns what it dropped');
  assert.equal(t.size, 0);
  assert.equal(t.take(), null);
  assert.deepEqual(t.cancelAll(), [], 'cancelling an empty queue is fine');
}

{ // empty queue takes null
  const t = createTasks({ max: 1 });
  assert.equal(t.take(), null);
}

// ---- the wiring, read off the source like prompt.test does
const side = readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
assert.match(side, /createTasks\(/, 'the sidecar runs its requests through the task queue');
assert.ok(!/interrupt: true/.test(side), 'a new request never cancels the running one');
assert.match(side, /m\.state === 'listening'\) \{ speech\.stop\(\); warmUp\(\); \}/, 'starting to talk no longer stops the reply');
assert.match(side, /tasks\.cancelAll\(\)/, 'an explicit stop clears the queue');
assert.match(side, /STOP_WORDS/, 'a spoken stop word still stops everything');
assert.match(side, /type: 'tasks'/, 'the overlay is told about the tasks');
assert.match(side, /send_agent so the queue stays short/, 'the prompt prefers background agents for long work');
console.log('tasks tests: passed');
