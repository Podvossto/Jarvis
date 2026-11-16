// Thai speech transcripts, post-processed. Thai ASR (Typhoon on Windows, and any other source) breaks
// utterances into syllables and inserts a space at each break, so "สวัสดีครับ" arrives as
// "สวัสดี ครับผม ยิน ดี" — but written Thai has no inter-word spaces, so the text reads badly and
// never matches the words on screen. reSegment() is what the voice path runs every transcript through:
// within a run of Thai letters every gap goes, except one that falls right after a whole clause-final
// word (ครับ, ค่ะ, นะ…), which is a real clause break and stays. Gaps touching Latin text, Arabic
// numerals and punctuation are left alone (those carry their own spacing rules), and a run of spaces
// next to Latin collapses to one.
//
// Whether a gap landed after a whole word is the cutter's call: wordcut (the Thai word breaker, its
// dictionary travels with it, no network) cuts the merged run once, and a gap survives only where a
// cut-word ends exactly at the gap and that word is clause-final. The same cut is exposed as
// cutWords() for matching words against screen text. The dictionary loads once, on the first Thai
// text (initThai() can force it earlier); a cut is a few ms, and text without Thai skips it all.
import { createRequire } from 'node:module';
import path from 'node:path';

const THAI = /[\u0E00-\u0E7F]/;
// One run of Thai letters, with whatever gaps the recogniser put inside it.
const RUN = /[\u0E00-\u0E7F]+(?:[ \t]+[\u0E00-\u0E7F]+)*/g;
const GAP = /[ \t]+/;
// Words that end a clause: a gap after one is how written Thai separates sentences.
const CLAUSE_ENDERS = new Set(['ครับ', 'ค่ะ', 'คะ', 'นะ', 'จ้า', 'จ้ะ', 'จ๊ะ', 'เถอะ', 'สิ']);

let cutter = null, cutFailed = false;
const require_ = createRequire(import.meta.url);

/** Load the dictionary once (a few hundred ms); afterwards every cut is milliseconds. */
export function initThai() {
  if (cutter || cutFailed) return;
  try {
    // wordcut stays out of the bundle on purpose: its dictionary is read from its own folder at run
    // time (bundle.sh copies the package to dist/node_modules), like web_fetch's readers.
    const wordcut = require_('wordcut');
    wordcut.init(path.join(path.dirname(require_.resolve('wordcut/package.json')), 'data', 'tdict-*.txt'));
    cutter = wordcut;
  } catch (e) {
    cutFailed = true; // no dictionary: reSegment still merges, it just can't tell clauses apart
    console.error('thaitext:', e.message ?? e);
  }
}

/** The words of `text` as wordcut cut them (rebuilding the text exactly when joined). */
export function cutWords(text) {
  initThai();
  if (!cutter) return [String(text ?? '')];
  return cutter.cutIntoArray(String(text ?? ''));
}

// One Thai run: drop the gaps, keeping only those that sit after a whole clause-final word (one
// space each, however many the recogniser typed). Without a dictionary, all of them go.
function fixRun(run) {
  if (!GAP.test(run)) return run;
  const chunks = run.split(GAP);
  let words = null;
  try { words = cutWords(chunks.join('')); } catch { words = null; }
  const ends = new Map(); // where a cut-word ends → that word
  if (words) {
    let at = 0;
    for (const w of words) { at += w.length; ends.set(at, w); }
  }
  let out = '', at = 0;
  for (let i = 0; i < chunks.length - 1; i++) {
    at += chunks[i].length;
    out += chunks[i];
    if (ends.get(at) && CLAUSE_ENDERS.has(ends.get(at))) out += ' ';
  }
  return out + chunks[chunks.length - 1];
}

/** Thai speech transcript → written Thai: the recogniser's wrong spaces out, sane spacing kept. */
export function reSegment(text) {
  const s = text == null ? '' : typeof text === 'string' ? text : String(text);
  if (!THAI.test(s)) return s; // no Thai: untouched, the dictionary never loads for it
  let out = '', last = 0;
  for (const m of s.matchAll(RUN)) {
    out += s.slice(last, m.index) + fixRun(m[0]);
    last = m.index + m[0].length;
  }
  out += s.slice(last);
  return out
    .replace(/([\u0E00-\u0E7F])[ \t]{2,}(?=\S)/g, '$1 ') // Thai  ␣␣  Latin → one space
    .replace(/(\S)[ \t]{2,}(?=[\u0E00-\u0E7F])/g, '$1 '); // Latin ␣␣  Thai  → one space
}
