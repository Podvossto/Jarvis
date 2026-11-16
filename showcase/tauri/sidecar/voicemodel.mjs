// The speech model for voice on Windows and Linux: NVIDIA Parakeet TDT 0.6B v3, int8 ONNX export (CC-BY-4.0,
// huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx), pinned to one commit and checked by SHA-256.
// Downloaded once into the user's local app data; interrupted downloads resume where they stopped.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

export const MODEL = {
  id: 'parakeet-tdt-0.6b-v3-int8',
  base: 'https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce/',
  files: [
    { name: 'encoder-model.int8.onnx', size: 652183999, sha256: '6139d2fa7e1b086097b277c7149725edbab89cc7c7ae64b23c741be4055aff09' },
    { name: 'decoder_joint-model.int8.onnx', size: 18202004, sha256: 'eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70' },
    { name: 'vocab.txt', size: 93939, sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d' },
  ],
};

// Thai (and Thai mixed with English): Typhoon ASR Real-time by SCB 10X (CC-BY-4.0), a 115M FastConformer RNN-T, in
// the ONNX export huggingface.co/wannaphong/typhoon-asr-realtime-onnx. `from` is the file's name there; `name` is
// what the voice helper looks for (typhoon.rs).
export const TYPHOON = {
  id: 'typhoon-asr-realtime',
  base: 'https://huggingface.co/wannaphong/typhoon-asr-realtime-onnx/resolve/04af3e7b6d822cb2807bc539301669d4f84691e7/',
  files: [
    { name: 'encoder-model.onnx', from: 'encoder-fastconformer-quran-ar.onnx', size: 456050599, sha256: '9573e8224cbad1be622b779e780cccc5638a4dd19097fd6c7258d8ec1c21cf91' },
    { name: 'decoder_joint-model.onnx', from: 'decoder_joint-fastconformer-quran-ar.onnx', size: 26584368, sha256: 'c445e567e1133506c1ff5e4722ee61b8adf830243e0449de3b796a3205ea1e4a' },
    { name: 'vocab.json', from: 'tokenizer/vocab.json', size: 36196, sha256: 'a7277aeb7b08f6c8a1ed7838b55d204cf6766dbe583d690bbb9fb0d42de0c2b1' },
  ],
};

// The wake word on Windows ("Hey Jarvis"): openWakeWord's pretrained hey_jarvis model with its two shared feature
// models (github.com/dscripka/openWakeWord, release v0.5.1; the models are CC BY-NC-SA 4.0, non-commercial use only).
// About 3.7 MB, fetched when the wake word is first turned on. Release files can be replaced, so the checksums matter.
export const WAKE = {
  id: 'openwakeword-hey-jarvis-0.5.1',
  base: 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/',
  files: [
    { name: 'melspectrogram.onnx', size: 1087958, sha256: 'ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f' },
    { name: 'embedding_model.onnx', size: 1326578, sha256: '70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f' },
    { name: 'hey_jarvis_v0.1.onnx', size: 1271370, sha256: '94a13cfe60075b132f6a472e7e462e8123ee70861bc3fb58434a73712ee0d2cb' },
  ],
};
export const WAKE_PHRASE = 'Hey Jarvis';

// The language spoken to it picks the model: each hears one language well, and neither hears the other's.
export const SPEECH_LANGS = [{ id: 'th', name: 'ไทย (Thai)' }, { id: 'en', name: 'English' }];
export const MODELS = { th: TYPHOON, en: MODEL };
export const DEFAULT_SPEECH_LANG = 'th';
export const speechModel = (lang) => MODELS[lang] ?? MODELS[DEFAULT_SPEECH_LANG];

export const totalBytes = (model = MODEL) => model.files.reduce((n, f) => n + f.size, 0);
export const sizeLabel = (model = MODEL) => `${Math.round(totalBytes(model) / 1e6)} MB`;

export function modelDir(model = MODEL) {
  const root = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Roamies') : path.join(os.homedir(), '.gg', 'sidekick');
  return path.join(root, 'models', model.id);
}

const READY = 'ready.json';

/** Downloaded and verified: the marker is written only after every file's checksum matched. */
export function isReady(dir, model = MODEL) {
  try {
    if (JSON.parse(readFileSync(path.join(dir, READY), 'utf8')).id !== model.id) return false;
    return model.files.every((f) => statSync(path.join(dir, f.name)).size === f.size);
  } catch { return false; }
}

async function sha256(file) {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

const fail = (code, message) => Object.assign(new Error(message), { code });

/**
 * Fetches every missing file, verifies it and writes the ready marker.
 * onProgress({ done, total }) runs often; throttle it in the caller.
 * Errors carry a code: 'disk' (not enough space), 'checksum', 'network' or 'aborted'.
 */
export async function downloadModel(dir, { model = MODEL, onProgress = () => {}, signal, fetchImpl = fetch, retries = 4, retryDelay = 2000 } = {}) {
  await fs.mkdir(dir, { recursive: true });
  const total = totalBytes(model);
  const have = async (f) => {
    for (const p of [path.join(dir, f.name), path.join(dir, `${f.name}.part`)]) {
      try { return Math.min((await fs.stat(p)).size, f.size); } catch {}
    }
    return 0;
  };
  const counts = await Promise.all(model.files.map(have));
  let done = counts.reduce((a, b) => a + b, 0);
  try {
    const free = await fs.statfs(dir);
    // Room for what's left plus a little slack.
    if (free.bavail * free.bsize < total - done + 50e6) throw fail('disk', `Not enough free disk space: the voice model needs ${sizeLabel(model)}.`);
  } catch (e) { if (e.code === 'disk') throw e; }
  onProgress({ done, total });

  for (const f of model.files) {
    const final = path.join(dir, f.name), part = `${final}.part`;
    if (existsSync(final) && statSync(final).size === f.size) {
      if (await sha256(final) === f.sha256) continue;
      await fs.rm(final, { force: true });
      done -= f.size; onProgress({ done, total });
    }
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw fail('aborted', 'Download stopped.');
      let start = 0;
      try { start = (await fs.stat(part)).size; } catch {}
      if (start > f.size) { await fs.rm(part, { force: true }); done -= start; start = 0; }
      try {
        if (start < f.size) {
          const res = await fetchImpl(model.base + (f.from ?? f.name), { headers: start ? { Range: `bytes=${start}-` } : {}, signal, redirect: 'follow' });
          // 206: resuming. 200: the server sent it all, so start over. 416: what's there is already complete or wrong.
          if (res.status === 416) { await fs.rm(part, { force: true }); done -= start; onProgress({ done, total }); throw fail('network', 'Range not satisfiable'); }
          if (!res.ok || !res.body) throw fail('network', `HTTP ${res.status}`);
          const resumed = res.status === 206 && start > 0;
          if (!resumed && start) { done -= start; start = 0; }
          // Each chunk is written before the next is read, so a dropped connection keeps everything that arrived.
          const fh = await fs.open(part, resumed ? 'a' : 'w');
          try {
            for await (const chunk of res.body) { await fh.write(chunk); done += chunk.length; onProgress({ done, total }); }
          } finally { await fh.close(); }
        }
        if ((await fs.stat(part)).size !== f.size) throw fail('network', 'Download ended early');
        if (await sha256(part) !== f.sha256) {
          await fs.rm(part, { force: true });
          done -= f.size; onProgress({ done, total });
          throw fail('checksum', `${f.name} didn't match its checksum`);
        }
        await fs.rename(part, final);
        break;
      } catch (e) {
        if (signal?.aborted || e.name === 'AbortError') throw fail('aborted', 'Download stopped.');
        if (attempt >= retries) throw e.code === 'checksum' ? e : fail('network', `Couldn't download the voice model (${e.message}).`);
        await new Promise((r) => setTimeout(r, retryDelay * (attempt + 1)));
      }
    }
  }
  await fs.writeFile(path.join(dir, READY), JSON.stringify({ id: model.id, at: new Date().toISOString() }));
  onProgress({ done: total, total });
}
