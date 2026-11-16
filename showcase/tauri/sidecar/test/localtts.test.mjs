// The local voice server's auto-start: only with a usable command, only when nothing answers, once, and stopped on quit.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createLocalTts, localTtsCommand } from '../localtts.mjs';

// The command: a list of strings whose program exists; anything else is no command.
const yes = () => true, no = () => false;
assert.deepEqual(localTtsCommand({ localTtsCommand: ['py', 'server.py'] }, yes), ['py', 'server.py']);
assert.equal(localTtsCommand({ localTtsCommand: ['py', 'server.py'] }, no), null);
for (const bad of [undefined, null, 'py server.py', [], ['py', 3], ['']]) assert.equal(localTtsCommand({ localTtsCommand: bad }, yes), null);

const fake = () => { const spawned = []; return { spawned, spawnImpl: (cmd, args) => { const c = Object.assign(new EventEmitter(), { pid: 7, killed: false, kill() { this.killed = true; } }); spawned.push({ cmd, args, c }); return c; } }; };

{ // Already answering: nothing is started.
  const f = fake();
  const t = createLocalTts({ command: () => ['py', 's.py'], status: async () => ({ ok: true }), spawnImpl: f.spawnImpl });
  assert.equal(await t.ensure(), true);
  assert.equal(f.spawned.length, 0);
}
{ // No command: nothing is started, and it says so.
  const f = fake();
  const t = createLocalTts({ command: () => null, status: async () => ({ ok: false }), spawnImpl: f.spawnImpl });
  assert.equal(await t.ensure(), false);
  assert.equal(f.spawned.length, 0);
}
{ // Not answering: started once (two calls share it), ready when it answers, stopped on quit.
  const f = fake();
  let asked = 0;
  const t = createLocalTts({ command: () => ['py', 's.py', '--port', '1'], status: async () => ({ ok: ++asked > 3 }), spawnImpl: f.spawnImpl, every: 5 });
  const [a, b] = await Promise.all([t.ensure(), t.ensure()]);
  assert.equal(a, true); assert.equal(b, true);
  assert.equal(f.spawned.length, 1);
  assert.deepEqual([f.spawned[0].cmd, f.spawned[0].args], ['py', ['s.py', '--port', '1']]);
  assert.equal(t.running, true);
  t.stop();
  assert.equal(f.spawned[0].c.killed, true);
  assert.equal(t.running, false);
}
{ // It exits before answering: gives up at once instead of waiting it out.
  const f = fake();
  const t = createLocalTts({ command: () => ['py'], status: async () => ({ ok: false }), spawnImpl: f.spawnImpl, every: 5, wait: 60_000 });
  const p = t.ensure();
  await new Promise((r) => setTimeout(r, 10));
  f.spawned[0].c.emit('exit', 1);
  assert.equal(await p, false);
  assert.equal(t.running, false);
}
{ // It never answers: false after the wait.
  const f = fake();
  const t = createLocalTts({ command: () => ['py'], status: async () => ({ ok: false }), spawnImpl: f.spawnImpl, every: 5, wait: 30 });
  assert.equal(await t.ensure(), false);
}
console.log('local tts tests: passed');
