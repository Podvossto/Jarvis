// Starts the local voice server for the user, so a local voice needs no window kept open.
// The "VoiceStudio" voice speaks to whatever answers VoiceStudio's protocol on this computer (voicestudio.mjs).
// When the user's settings name a command for it (localTtsCommand: the program and its arguments, e.g. the Python
// of a venv and tools/paxa-tts/server.py for a Thai voice), that command is started once when the local voice is
// picked and nothing is answering yet, and stopped when Roamies quits. No command set: nothing is ever started.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

/** The command from the settings, if it's usable: a non-empty list of strings whose program exists. */
export function localTtsCommand(config, exists = fs.existsSync) {
  const c = config?.localTtsCommand;
  if (!Array.isArray(c) || !c.length || !c.every((s) => typeof s === 'string' && s && s.length < 1024)) return null;
  return exists(c[0]) ? c : null;
}

/**
 * ensure(): start the server unless it's answering or already started here; resolves true once status() says ok
 * (asked every `every` ms for up to `wait` ms), false if it never did. stop(): end the one started here.
 */
export function createLocalTts({ command, status, log = () => {}, logFile = null, spawnImpl = spawn, wait = 120_000, every = 1500 }) {
  let child = null, pending = null;
  const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
  async function run() {
    if ((await status()).ok) return true;
    const cmd = command();
    if (!cmd) return false;
    if (!child) {
      let out = 'ignore';
      try { if (logFile) out = fs.openSync(logFile, 'a'); } catch { /* no log then */ }
      try {
        child = spawnImpl(cmd[0], cmd.slice(1), { stdio: ['ignore', out, out], windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      } catch (e) { log('localtts', { phase: 'spawn_failed', message: String(e.message ?? e).slice(0, 200) }); return false; }
      const mine = child;
      log('localtts', { phase: 'started', pid: mine.pid ?? null });
      mine.on?.('error', (e) => { log('localtts', { phase: 'error', message: String(e.message ?? e).slice(0, 200) }); if (child === mine) child = null; });
      mine.on?.('exit', (code) => { log('localtts', { phase: 'exit', code }); if (child === mine) child = null; });
      if (typeof out === 'number') try { fs.closeSync(out); } catch { /* the child has its own handle */ }
    }
    for (const until = Date.now() + wait; Date.now() < until && child;) {
      await sleep(every);
      if ((await status()).ok) { log('localtts', { phase: 'ready' }); return true; }
    }
    return false;
  }
  return {
    ensure() { return pending ??= run().finally(() => { pending = null; }); },
    stop() { const c = child; child = null; try { c?.kill(); } catch { /* already gone */ } },
    get running() { return !!child; },
  };
}
