// Notes folder: a folder of the user's own Markdown/text notes (Obsidian vault, project status files, anything)
// that the companion reads from. The files are split into sections and searched by word; each request carries the
// pinned notes (files whose name starts with "_") and the few sections most related to what was just asked, and
// search_notes finds more. Read-only: nothing here writes to the folder.
import fs from 'node:fs/promises';
import path from 'node:path';

export const NOTE_EXT = /\.(md|markdown|txt)$/i;
export const LIMITS = { files: 400, fileBytes: 256 * 1024, depth: 4, section: 1500, pinned: 2000, relevant: 1500, rescanMs: 60_000 };

const STOP = new Set('the a an and or but to of in on at for with is are was were be it this that my me i you your his her its our their what how when where why can do does just like about from have has had will would should could not no yes so if then than now'.split(' '));
// Thai question words and fillers ("ตอนนี้ถึงไหนแล้ว", "ค้างอะไรอยู่"): they say how something is asked, not what about.
const STOP_TH = new Set('ตอน นี้ ตอนนี้ ถึง ไหน แล้ว อะไร ยัง อยู่ ที่ ของ และ ใน ครับ ค่ะ คะ นะ หน่อย บ้าง ไป มา ได้ ไหม มั้ย กับ ให้ ว่า เป็น มี คือ จะ ก็ ช่วย ดู บอก ทำ เรื่อง อัน ตัว'.split(' '));
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'word' });
// Scripts written without spaces between words: matched as text inside a section rather than as whole words,
// because a dictionary word breaker cuts the same word differently depending on the words around it.
const NO_SPACES = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** What a question is about, as search units: [{ text, whole }]. whole: an ordinary word matched as a word;
 *  otherwise (Thai and other scripts without spaces) text found anywhere in a section. Stop words left out.
 *  Neighbouring Thai words are also tried joined (หา|งาน → หางาน), since the word breaker often cuts a compound
 *  the notes use whole; the joined form only counts where it's really in the notes (search weighs by that). */
export function terms(t) {
  const out = new Map();
  let prev = null;
  for (const s of SEGMENTER.segment(String(t).toLowerCase().normalize('NFC'))) {
    if (!s.isWordLike) { prev = null; continue; }
    const w = s.segment;
    if (NO_SPACES.test(w)) {
      if ([...w].length >= 2 && !STOP_TH.has(w)) out.set(w, { text: w, whole: false });
      if (prev && !STOP_TH.has(prev) && !STOP_TH.has(w) && !out.has(prev + w)) out.set(prev + w, { text: prev + w, whole: false, joined: true });
      prev = w;
    } else {
      prev = null;
      if (w.length >= (/^[a-z0-9]+$/.test(w) ? 3 : 2) && !STOP.has(w)) out.set(w, { text: w, whole: true });
    }
  }
  return [...out.values()];
}
/** The ordinary words of a text (the whole-word side of terms()). */
export const words = (t) => new Set(terms(t).filter((x) => x.whole).map((x) => x.text));

/** One file's text → sections: split at headings, long ones cut into pieces of about LIMITS.section characters. Each
 *  section is also searchable by the file's name and its opening lines (title and intro), so "where is X at" finds
 *  X's Status section even when that section never names X. */
export function sections(text, file) {
  const out = [];
  const src = String(text).replace(/\r\n?/g, '\n');
  // The title and intro (before the first sub-heading), without list items or table rows: those are content (an
  // index listing every project isn't *about* each of them).
  const lead = src.split(/\n(?=#{2,6}\s)/)[0].split('\n').filter((l) => !/^\s*([-*+|]|\d+\.)\s/.test(l)).join('\n').slice(0, 400);
  const titleText = `${file.replace(/[-_./\\]+/g, ' ')} ${lead}`;
  const titleHay = titleText.toLowerCase().normalize('NFC'), titleWords = words(titleText);
  let heading = '', buf = [];
  const flush = () => {
    const body = buf.join('\n').trim();
    buf = [];
    if (!body) return;
    for (let i = 0; i < body.length; i += LIMITS.section) {
      const piece = body.slice(i, i + LIMITS.section);
      const all = `${file.replace(/[-_./\\]+/g, ' ')} ${lead} ${heading} ${piece}`;
      out.push({ file, heading, text: piece, words: words(all), hay: all.toLowerCase().normalize('NFC'), titleHay, titleWords });
    }
  };
  for (const line of src.split('\n')) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) { flush(); heading = h[1].trim(); }
    else buf.push(line);
  }
  flush();
  return out;
}

/** The note files under dir (relative paths), skipping hidden folders; capped by LIMITS. */
export async function listNotes(dir) {
  const found = [];
  async function walk(rel, depth) {
    let entries;
    try { entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (found.length >= LIMITS.files) return;
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) { if (depth < LIMITS.depth) await walk(r, depth + 1); }
      else if (e.isFile() && NOTE_EXT.test(e.name)) found.push(r);
    }
  }
  await walk('', 0);
  return found;
}

const isPinned = (file) => path.basename(file).startsWith('_');
const byNewest = (a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file);
const hit = (s, t) => (t.whole ? s.words.has(t.text) : s.hay.includes(t.text));
const inTitle = (s, t) => (t.whole ? s.titleWords.has(t.text) : s.titleHay.includes(t.text));

/**
 * The index of one folder. getDir() names the folder (empty: none). refresh() rescans when the folder changed or a
 * minute has passed; pinned(), relevant() and search() answer from the last scan, so the request path never waits.
 */
export function createNotes({ getDir, now = () => Date.now() }) {
  const empty = (dir = '', error = null) => ({ dir, at: dir ? now() : 0, files: [], sections: [], error });
  let index = empty();
  let scanning = null;
  async function scan(dir) {
    const files = [];
    for (const file of await listNotes(dir)) {
      const full = path.join(dir, file);
      try {
        const st = await fs.stat(full);
        if (st.size > LIMITS.fileBytes) continue;
        files.push({ file, mtime: st.mtimeMs, text: await fs.readFile(full, 'utf8') });
      } catch { /* gone or unreadable: skip */ }
    }
    files.sort(byNewest);
    return {
      dir, at: now(), error: null,
      files: files.map(({ file, mtime, text }) => ({ file, mtime, chars: text.length, text: isPinned(file) ? text : '' })),
      sections: files.flatMap((f) => sections(f.text, f.file).map((s) => ({ ...s, mtime: f.mtime }))),
    };
  }
  function refresh({ force = false } = {}) {
    const dir = getDir() || '';
    if (!dir) { index = empty(); return Promise.resolve(index); }
    if (scanning) return scanning;
    if (!force && index.dir === dir && now() - index.at < LIMITS.rescanMs) return Promise.resolve(index);
    scanning = fs.stat(dir).then((st) => (st.isDirectory() ? scan(dir) : Promise.reject(new Error('not a folder'))))
      .then((next) => (index = next))
      .catch((e) => (index = empty(dir, e?.code === 'ENOENT' ? "the folder isn't there right now" : String(e?.message ?? e).slice(0, 80))))
      .finally(() => { scanning = null; });
    return scanning;
  }
  /** The pinned notes (files named _something), newest first, trimmed to `budget` characters in all. */
  function pinned(budget = LIMITS.pinned) {
    let left = budget;
    const out = [];
    for (const f of index.files.filter((x) => isPinned(x.file))) {
      if (left <= 80) break;
      const body = f.text.trim().slice(0, left - f.file.length - 10);
      out.push(`### ${f.file}\n${body}`);
      left -= body.length + f.file.length + 10;
    }
    return out.join('\n\n');
  }
  /**
   * The sections that best match `query`, best first: [{ file, heading, text, score }]. Each word of the question
   * counts once, weighted by how rare it is in the notes: a project's name (in few sections) outweighs a word every
   * status note has. A section needs a fair share of the question's weight to count, so one common word isn't
   * "related", and the overview (pinned) ranks below the note it points to.
   */
  function search(query, limit = 6) {
    const q = terms(query);
    const N = index.sections.length;
    if (!q.length || !N) return [];
    // Weight: rarer is stronger. A word of the question the notes never mention still counts in the total (as rare as
    // can be), so "สูตรต้มยำกุ้ง" isn't "related" to a note that only shares สูตร; a Thai join the breaker might have
    // missed (หา|งาน → หางาน) counts only where it's really in the notes.
    const weight = q.map((t) => { let df = 0; for (const s of index.sections) if (hit(s, t)) df++; return df ? Math.log(1 + N / df) : t.joined ? 0 : Math.log(1 + N / 0.5); });
    const total = weight.reduce((a, b) => a + b, 0);
    if (!total) return [];
    // A word in the name or title of only a few notes names something ("Cinema", "ฝึกงาน"): the notes it names get its
    // weight again, so they outrank a note that merely mentions it, by as much as that word matters in the question.
    const titles = [...new Map(index.sections.map((s) => [s.file, s])).values()];
    const nameLimit = Math.max(2, Math.ceil(titles.length * 0.2));
    const names = q.map((t) => { const n = titles.filter((s) => inTitle(s, t)).length; return n > 0 && n <= nameLimit; });
    const hits = [];
    for (const s of index.sections) {
      let got = 0, own = 0;
      q.forEach((t, i) => {
        if (!weight[i] || !hit(s, t)) return;
        got += weight[i];
        if (names[i] && inTitle(s, t)) own += weight[i];
      });
      // A note the question names gets a fixed lift over notes that only mention its words; the overview that lists
      // every project is named by all of them, so it never outranks the project's own note.
      if (own > 0 || got >= total * 0.3) hits.push({ s, score: got / total + (own > 0 ? 0.6 + 0.4 * (own / total) : 0) - (isPinned(s.file) ? 1.2 : 0) + (s.mtime ?? 0) / 1e15 });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit).map(({ s, score }) => ({ file: s.file, heading: s.heading, text: s.text, score }));
  }
  /** The related sections for the live block, unpinned files only, within `budget` characters. */
  function relevant(query, budget = LIMITS.relevant) {
    let left = budget;
    const out = [];
    for (const h of search(query, 8)) {
      if (isPinned(h.file) || left < 200) continue;
      const head = `### ${h.file}${h.heading ? ` › ${h.heading}` : ''}`;
      const body = h.text.slice(0, Math.min(h.text.length, left - head.length - 1));
      out.push(`${head}\n${body}`);
      left -= head.length + body.length + 2;
    }
    return out.join('\n\n');
  }
  const status = () => ({ dir: index.dir, files: index.files.length, sections: index.sections.length, error: index.error, at: index.at || null });
  return { refresh, pinned, search, relevant, status };
}
