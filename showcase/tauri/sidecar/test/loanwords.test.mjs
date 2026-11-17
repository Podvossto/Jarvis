// English words the Thai recogniser spelled in Thai go back to English; Thai and everyday loanwords stay.
import assert from 'node:assert/strict';
import { englishWords } from '../loanwords.mjs';

for (const [heard, want] of [
  ['เปิดโครมแล้วกดเซฟให้หน่อย', 'เปิด Chrome แล้วกด Save ให้หน่อย'],
  ['กดแคนเซิลแล้วกลับไปหน้าเซตติ้ง', 'กด Cancel แล้วกลับไปหน้า Settings'],
  ['ดีพลอยขึ้นโปรดักชันได้เลย', 'deploy ขึ้น production ได้เลย'],
  ['เปิด Google Drive แล้วดาวน์โหลด', 'เปิด Google Drive แล้ว Download'],
  ['คอมมิตแล้วพุชขึ้นกิตฮับ', 'commit แล้ว push ขึ้น GitHub'],
  ['เปิดยูทูบ', 'เปิด YouTube'],
  ['กดเซฟ.', 'กด Save.'],
]) assert.equal(englishWords(heard), want, heard);

// Left alone: plain Thai, everyday loanwords Thai is written with, and a table word inside a longer Thai word.
for (const same of [
  'ส่งอีเมลหาแม่หน่อย', 'เปิดไฟล์นี้แล้วคลิกลิงก์', 'วาดกราฟให้ดูหน่อย', 'วันนี้อากาศดีมาก', 'ช่วยรีวิวหน่อย',
]) assert.equal(englishWords(same), same, same);
assert.equal(englishWords('Save the file'), 'Save the file', 'no Thai: untouched');
assert.equal(englishWords(''), '');
assert.equal(englishWords(null), '');
assert.equal(englishWords('เบคอน'), 'เบคอน', 'no entry');
// Regression guard: a table spelling must not be cut out of the middle of a syllable.
assert.equal(englishWords('เพสต์'), 'paste');
assert.equal(englishWords('ใส่เซฟตี้ด้วย'), 'ใส่เซฟตี้ด้วย', 'a longer Thai word that starts with a table spelling stays whole');
assert.equal(englishWords('ไปเพส'), 'ไป paste', 'a lead vowel before it belongs to the word before');
assert.equal(englishWords('เวอร์ชันใหม่'), 'version ใหม่');
assert.equal(englishWords('บั๊กกี้'), 'บั๊กกี้', 'a word that runs on past the table word is left alone');
console.log('loanwords tests: passed');
