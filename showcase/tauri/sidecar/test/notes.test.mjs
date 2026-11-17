// The notes folder (notes.mjs): splitting into sections, Thai words, pinned notes, relevance, budgets, a missing
// folder, and rescans. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LIMITS, createNotes, listNotes, sections, terms, words } from '../notes.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-notes-test-'));
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(TMP, rel)), { recursive: true }); fs.writeFileSync(path.join(TMP, rel), text); };

// Terms: English stop words dropped; Thai fillers dropped; Thai words kept as text to find, not whole words.
assert.deepEqual([...words('What is the Rain Route status now?')].sort(), ['rain', 'route', 'status']);
const th = terms('งานฝึกงานค้างอะไรอยู่');
assert.ok(th.some((t) => t.text === 'ฝึก' || t.text.includes('ฝึก')), `Thai topic kept: ${JSON.stringify(th)}`);
assert.ok(!th.some((t) => ['อะไร', 'อยู่'].includes(t.text)), 'Thai question words dropped');
assert.ok(th.every((t) => !t.whole), 'Thai terms are matched as text');
assert.ok(terms('โปรเจค Jarvis').some((t) => t.text === 'jarvis' && t.whole), 'Latin words next to Thai stay whole');

// Sections: split at headings; text before the first heading is kept; long sections are cut.
const s = sections('intro\n# A\none\n## B\ntwo', 'x.md');
assert.deepEqual(s.map((x) => [x.heading, x.text]), [['', 'intro'], ['A', 'one'], ['B', 'two']]);
assert.equal(sections(`# Long\n${'word '.repeat(1000)}`, 'y.md').length, Math.ceil('word '.repeat(1000).trim().length / LIMITS.section));
assert.equal(sections('# Only a heading\n\n', 'z.md').length, 0, 'empty sections are dropped');

put('_now.md', '# Now\nWorking on the Jarvis notes folder this week.');
put('rain-route/SOT.md', '# Rain Route\n## Status\nDeployed, waiting for rain data from the weather API.\n## Roadmap\nAdd push alerts.');
put('roblox/SOT.md', '# Critter Ranch\n## สถานะ\nกำลังทำระบบไข่และร้านค้า');
put('.obsidian/workspace.md', 'hidden: should be skipped');
put('photo.png', 'not a note');
put('deep/a/b/c/d/e/too-deep.md', 'too deep');

const files = await listNotes(TMP);
assert.deepEqual(files.sort(), ['_now.md', path.join('rain-route', 'SOT.md'), path.join('roblox', 'SOT.md')].sort(), 'hidden folders, other file types and very deep files are skipped');

let dir = TMP, clock = 1_000_000;
const notes = createNotes({ getDir: () => dir, now: () => clock });
await notes.refresh();
assert.equal(notes.status().files, 3);
assert.equal(notes.status().error, null);

// Pinned: files named _something, always sent.
assert.match(notes.pinned(), /_now\.md[\s\S]*Jarvis notes folder/);
assert.ok(!notes.pinned().includes('Rain Route'), 'only _ files are pinned');

// Relevance: the section that matches, with its file and heading; pinned files aren't repeated there.
const hits = notes.search('what is the rain route status');
assert.equal(hits[0].file, path.join('rain-route', 'SOT.md'));
assert.match(notes.relevant('rain route status'), /rain-route.SOT\.md › (Status|Rain Route)/);
assert.ok(!notes.relevant('Jarvis notes folder').includes('_now.md'), 'pinned notes are not repeated in the related part');
assert.match(notes.relevant('ระบบไข่ ร้านค้า'), /Critter Ranch|สถานะ/, 'Thai questions find Thai notes');
assert.equal(notes.relevant('completely unrelated zebra'), '', 'nothing related: nothing sent');

// Regressions from a real notes folder: a question naming one project, padded with Thai filler, finds that project
// first, not a note full of the filler's common words; and the pinned overview listing every project ranks below the
// project's own note.
put('_overview.md', '# Projects\n- rain-route: Rain Route ฝนระหว่างทาง\n- dashboard: แดชบอร์ด\n- internship: Wispy Internship ฝึกงาน');
put('dashboard/SOT.md', '# Dashboard\n## สถานะปัจจุบัน\nตอนนี้ถึงขั้นทำหน้า Providers แล้ว ยังอยู่ระหว่างทำ ที่ไหนก็ได้ ตอนนี้ แล้ว แล้ว');
put('internship/SOT.md', '# Wispy Internship\n> ฝึกงาน สหกิจ\n## สถานะปัจจุบัน\nรอส่งรายงานสัปดาห์ที่ 8');
await notes.refresh({ force: true });
assert.equal(notes.search('เว็บ rain route ตอนนี้ถึงไหนแล้ว')[0]?.file, path.join('rain-route', 'SOT.md'), 'Thai filler does not outweigh the project name');
assert.equal(notes.search('งานฝึกงานค้างอะไรอยู่')[0]?.file, path.join('internship', 'SOT.md'), 'a Thai-only question finds its project by its Thai name');
assert.notEqual(notes.search('rain route status')[0]?.file, '_overview.md', 'the overview ranks below the project note');

// Budgets hold.
put('big.md', `# Big\n${'rain route '.repeat(2000)}`);
await notes.refresh({ force: true });
assert.ok(notes.relevant('rain route', 900).length <= 900, 'related part fits its budget');
put('_long.md', 'x'.repeat(5000));
await notes.refresh({ force: true });
assert.ok(notes.pinned(1200).length <= 1200, 'pinned part fits its budget');

// Rescans: not again within a minute unless forced; a new file shows up after the minute.
put('new.md', '# Fresh\nbrand new kangaroo note');
await notes.refresh();
assert.equal(notes.search('kangaroo').length, 0, 'no rescan within a minute');
clock += LIMITS.rescanMs + 1;
await notes.refresh();
assert.equal(notes.search('kangaroo')[0]?.file, 'new.md', 'picked up after the minute');

// A folder that's gone: an error, no notes, no throw.
dir = path.join(TMP, 'missing');
await notes.refresh({ force: true });
assert.equal(notes.status().files, 0);
assert.match(notes.status().error, /isn't there/);
assert.equal(notes.pinned(), '');

// No folder set: nothing at all.
dir = '';
await notes.refresh();
assert.deepEqual(notes.status(), { dir: '', files: 0, sections: 0, error: null, at: null });

console.log('notes tests: passed');
