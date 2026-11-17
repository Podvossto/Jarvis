import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { reSegment, cutWords, initThai } from '../thaitext.mjs';

// Speech transcripts in Thai come back with spaces the recogniser inserted at syllable and tone
// boundaries ("สวัสดี ครับผม ยิน ดี" style). Written Thai has no inter-word spaces, so every gap
// between two Thai letters that doesn't fall after a whole clause-final word (ครับ, ค่ะ, นะ…) is
// wrong and goes. Gaps touching Latin text, numbers and punctuation stay, as does their spacing.
assert.equal(reSegment('สวัสดี ครับผม ยิน ดี ที่ ได้ รู้ จัก'), 'สวัสดีครับผมยินดีที่ได้รู้จัก', 'the recogniser\'s syllable gaps go');
assert.equal(reSegment('ผม ชื่อ ป้อง ครับ'), 'ผมชื่อป้องครับ', 'word-level gaps go too: Thai writes no spaces between words');
// A gap that lands after a whole clause-final particle is a real clause break and stays one.
assert.equal(reSegment('สวัสดีครับ ผมชื่อป้อง'), 'สวัสดีครับ ผมชื่อป้อง', 'a break after ครับ is a clause break, kept');
assert.equal(reSegment('ยินดี ที่ได้รู้จัก ครับ ผมชื่อป้อง'), 'ยินดีที่ได้รู้จักครับ ผมชื่อป้อง', 'wrong gaps go, the one after ครับ stays');
// Mixed Thai + English + numbers: only the Thai-Thai gaps move.
assert.equal(reSegment('เปิด Chrome ไปที่ youtube.com'), 'เปิด Chrome ไปที่ youtube.com', 'spacing around Latin text is left alone');
assert.equal(reSegment('เปิด ไฟล์ ใน Downloads ให้ หน่อย'), 'เปิดไฟล์ใน Downloads ให้หน่อย', 'Thai merges up to the Latin word and again after it');
assert.equal(reSegment('ประมาณ 500 บาท'), 'ประมาณ 500 บาท', 'spacing around Arabic numerals is left alone');
assert.equal(reSegment('ปี ๒๕๖๗'), 'ปี๒๕๖๗', 'Thai numerals are Thai script: the gap between Thai letters goes');
// Text with no Thai is returned untouched and without touching the dictionary.
const latin = 'hello world 123, open Chrome at youtube.com now!';
assert.equal(reSegment(latin), latin, 'no Thai: the text comes back as it went in');
let t0 = performance.now();
for (let i = 0; i < 1000; i++) reSegment(latin);
const latinMs = performance.now() - t0;
assert.ok(latinMs < 100, `1000 no-Thai passes took ${latinMs.toFixed(1)} ms; it must skip the dictionary`);
// Already-correct Thai (the way it's written) is left as it is.
assert.equal(reSegment('ผมชื่อป้องครับ'), 'ผมชื่อป้องครับ', 'already-correct Thai is untouched');
assert.equal(reSegment('วันนี้อากาศดีมาก'), 'วันนี้อากาศดีมาก', 'so is a longer correct sentence');
// Punctuation keeps its spacing.
assert.equal(reSegment('อากาศดี วันนี้. ไปเที่ยวกัน'), 'อากาศดีวันนี้. ไปเที่ยวกัน', 'the space after a full stop stays');
assert.equal(reSegment('ครับ, แล้วพบกันใหม่'), 'ครับ, แล้วพบกันใหม่', 'a comma and the space after it stay');
// Repeated spaces: gone inside Thai runs, one space next to Latin.
assert.equal(reSegment('สวัสดี   ครับ'), 'สวัสดีครับ', 'a run of spaces inside Thai still merges to nothing');
assert.equal(reSegment('ยินดี\tดีใจ'), 'ยินดีดีใจ', 'tabs count as the recogniser\'s gaps too');
assert.equal(reSegment('เปิด  Chrome  ใหม่'), 'เปิด Chrome ใหม่', 'double spaces next to Latin collapse to one');
// Empty and non-string input.
assert.equal(reSegment(''), '');
assert.equal(reSegment(undefined), '');
assert.equal(reSegment(null), '');
assert.equal(reSegment(42), '42');
assert.equal(reSegment('   '), '   ', 'no Thai, so not even trimmed');

// The dictionary cuts Thai into words (what word-matching against screen text can use), and the
// words it finds rebuild the text exactly.
initThai();
assert.deepEqual(cutWords('สวัสดีครับ'), ['สวัสดี', 'ครับ']);
assert.deepEqual(cutWords('ยินดีที่ได้รู้จักครับ'), ['ยินดี', 'ที่', 'ได้', 'รู้จัก', 'ครับ']);
assert.deepEqual(cutWords('hello world 123'), ['hello', ' ', 'world', ' ', '123']);

// Latency: the voice pipeline calls reSegment on every transcript (and it cuts inside), so a
// ~100-word utterance must pass through well under 10 ms — as must the raw cut (dictionary loaded
// once, ahead of the timing here).
const sentence = 'ผมชื่อป้องยินดีที่ได้รู้จักครับวันนี้อากาศดีมาก'; // twelve words
const utterance = Array.from({ length: 8 }, () => sentence).join(' '); // ~100 words with the ASR's gaps
const words = cutWords(reSegment(utterance));
assert.ok(words.length > 80, `expected about a hundred words, cut into ${words.length}`);
const merged = reSegment(utterance); // what the cutter sees once the wrong gaps are out
let bestCut = Infinity, bestPass = Infinity;
for (let i = 0; i < 5; i++) {
  t0 = performance.now();
  cutWords(merged);
  bestCut = Math.min(bestCut, performance.now() - t0);
  t0 = performance.now();
  reSegment(utterance);
  bestPass = Math.min(bestPass, performance.now() - t0);
}
assert.ok(bestCut < 10, `cutting a ~100-word utterance took ${bestCut.toFixed(1)} ms (> 10 ms)`);
assert.ok(bestPass < 10, `reSegment alone took ${bestPass.toFixed(1)} ms (> 10 ms)`);

// The wire-in: spoken text is re-segmented before it becomes the request; typed text (ask bar,
// panel) never is — the call lives only on the voice branch.
const side = readFileSync(fileURLToPath(new URL('../sidekick.mjs', import.meta.url)), 'utf8');
assert.match(side, /import \{ reSegment \} from '\.\/thaitext\.mjs';/, 'sidekick imports reSegment from thaitext.mjs');
assert.match(side, /const said = reSegment\(m\.text\.trim\(\)\);\s*onSpoken\(config\.speechLang === 'en' \? said : englishWords\(said\), m\.area\);/, 'voice transcripts pass through reSegment, then English words back to English, on the way in');
assert.equal(side.split('reSegment(').length - 1, 1, 'reSegment is called on the voice path only, never on typed text');
console.log('thaitext tests: passed');
