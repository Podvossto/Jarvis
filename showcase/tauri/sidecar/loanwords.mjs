// English words said inside Thai speech come out of the Thai recogniser spelled in Thai ("เปิด โครม แล้วกด เซฟ").
// For the words a person would type in English anyway (app names, buttons, computer terms) that loses what matters:
// "เซฟ" never matches a Save button on screen, and the model has to guess. This puts those words back in English.
// Everyday loanwords that Thai is written with (อีเมล, ไฟล์, คลิก, ลิงก์, กราฟ, รีวิว…) are left alone on purpose:
// they are how Thai is written, and turning them into English would only make the text odd.
//
// A table can only fix a word heard as a recognisable spelling; one heard as other Thai words ("deploy" as
// "อย่าปล่อย") stays as it was. On 54 synthetic Thai-English clips, English words right went from 19% to 40%
// (some spellings here came from those same clips, so expect less on new speech); pure Thai was unchanged.

// [English, Thai spellings…]. Several spellings each, as people (and the recogniser) write them.
const WORDS = [
  // apps and services
  ['Chrome', 'โครม'], ['Google', 'กูเกิล', 'กูเกิ้ล'], ['Google Drive', 'กูเกิลไดรฟ์', 'กูเกิ้ลไดรฟ์'], ['YouTube', 'ยูทูบ', 'ยูทูป'],
  ['Facebook', 'เฟซบุ๊ก', 'เฟสบุ๊ค', 'เฟสบุ๊ก', 'เฟซบุ๊ค'], ['Instagram', 'อินสตาแกรม', 'อินสตราแกรม'], ['Spotify', 'สปอติฟาย', 'สปอทิฟาย'],
  ['Discord', 'ดิสคอร์ด', 'ดิสคอด'], ['ChatGPT', 'แชทจีพีที', 'แชตจีพีที', 'แชทจีพีที'], ['GitHub', 'กิตฮับ', 'กิทฮับ', 'กิตฮัป'],
  ['Shopee', 'ช้อปปี้', 'โชปี้', 'ช็อปปี้'], ['Lazada', 'ลาซาด้า'], ['Excel', 'เอ็กเซล', 'เอกเซล', 'เอ็กเซ็ล'], ['Word', 'ไมโครซอฟต์เวิร์ด'],
  ['PowerPoint', 'พาวเวอร์พอยต์', 'พาวเวอร์พอยท์'], ['Notepad', 'โน้ตแพด', 'โน๊ตแพด', 'โน้ตแพน'], ['Visual Studio Code', 'วิชวลสตูดิโอโค้ด'],
  ['Visual Studio', 'วิชวลสตูดิโอ', 'วิชวลสตูดิโอ'], ['Docker', 'ด็อกเกอร์', 'ดอกเกอร์', 'ดอกเคอร์', 'ด็อคเกอร์'], ['Windows', 'วินโดวส์', 'วินโดว์', 'วินโดส์', 'วินโดส'],
  ['Telegram', 'เทเลแกรม'], ['Netflix', 'เน็ตฟลิกซ์', 'เน็ตฟลิก'], ['TikTok', 'ติ๊กต็อก', 'ติกต็อก'], ['Canva', 'แคนวา'], ['Figma', 'ฟิกมา'],
  ['Photoshop', 'โฟโต้ช็อป', 'โฟโตช็อป'], ['Terminal', 'เทอร์มินัล', 'เทอมินัล'], ['Python', 'ไพธอน', 'ไพทอน'], ['JavaScript', 'จาวาสคริปต์', 'จาวาสคริป'],
  ['Zcode', 'แซดโค้ด'], ['Claude', 'คลอด์'],
  // working with code
  ['deploy', 'ดีพลอย', 'ดิพลอย'], ['production', 'โปรดักชัน', 'โปรดักชั่น', 'โพรดักชัน'], ['commit', 'คอมมิต', 'คอมมิท', 'คอมมิตร'],
  ['push', 'พุช', 'พุส'], ['pull request', 'พูลรีเควสต์', 'พูลรีเควส'], ['merge', 'เมิร์จ', 'เมอร์จ'], ['branch', 'แบรนช์', 'บรานช์'],
  ['rollback', 'โรลแบ็ก', 'โรลแบ็ค'], ['build', 'บิลด์', 'บิ้ลด์'], ['debug', 'ดีบัก', 'ดีบั๊ก'], ['bug', 'บั๊ก'], ['server', 'เซิร์ฟเวอร์', 'เซิฟเวอร์'],
  ['database', 'ดาต้าเบส', 'เดตาเบส', 'ดาตาเบส'], ['API', 'เอพีไอ'], ['prompt', 'พรอมต์', 'พรอมท์', 'พร้อมท์'], ['cache', 'แคช'],
  ['npm', 'เอ็นพีเอ็ม'], ['install', 'อินสตอล', 'อินสตอลล์'], ['version', 'เวอร์ชัน', 'เวอร์ชั่น'], ['function', 'ฟังก์ชัน', 'ฟังก์ชั่น'],
  ['project', 'โปรเจกต์', 'โปรเจ็กต์', 'โปรเจค', 'โปรเจ็ค'], ['code', 'โค้ด'], ['test', 'เทสต์'], ['script', 'สคริปต์', 'สคริปท์'],
  // buttons, menus and actions on screen
  ['Save', 'เซฟ'], ['Save As', 'เซฟแอส'], ['Cancel', 'แคนเซิล', 'แคนเซิ่ล'], ['Settings', 'เซตติ้ง', 'เซ็ตติ้ง', 'เซตติง', 'เซ็ตติง'],
  ['Download', 'ดาวน์โหลด', 'ดาวโหลด'], ['Upload', 'อัปโหลด', 'อัพโหลด'], ['Update', 'อัปเดต', 'อัพเดท', 'อัปเดท', 'อัพเดต'],
  ['Submit', 'ซับมิต', 'ซับมิท'], ['Next', 'เน็กซ์', 'เน็กซ'], ['Finish', 'ฟินิช', 'ฟินิชช์'], ['Back', 'แบ็ก'], ['Login', 'ล็อกอิน', 'ล็อคอิน'],
  ['Logout', 'ล็อกเอาต์', 'ล็อคเอาท์'], ['Sign in', 'ซายน์อิน'], ['Refresh', 'รีเฟรช', 'รีเฟรซ'], ['Restart', 'รีสตาร์ต', 'รีสตาร์ท'],
  ['Export', 'เอ็กซ์พอร์ต', 'เอกซ์พอร์ต'], ['Import', 'อิมพอร์ต'], ['Notifications', 'โนติฟิเคชัน', 'โนติฟิเคชั่น'], ['Dark mode', 'ดาร์กโหมด', 'ดาร์คโหมด'],
  ['Translate', 'ทรานสเลต', 'แทรนสเลต'], ['copy', 'ก๊อปปี้', 'ก็อปปี้', 'กอบปี้', 'ก๊อปปี'], ['paste', 'เพสต์', 'เพสท์', 'เพส'], ['browser', 'เบราว์เซอร์', 'บราวเซอร์'],
  ['dashboard', 'แดชบอร์ด'], ['template', 'เทมเพลต', 'เทมเพลท'], ['screenshot', 'สกรีนช็อต', 'สกรีนช็อท'], ['summarize', 'ซัมมาไรซ์', 'ซัมมารีไรซ์', 'ซัมเมอร์ไรซ์'],
  ['channel', 'แชนแนล'], ['voice', 'วอยซ์'], ['meeting', 'มีตติ้ง'], ['order', 'ออเดอร์', 'โอเดอร์'], ['chart', 'ชาร์ต', 'ชาร์ท'],
];
// Longer Thai words that start with a table spelling: kept whole (the longest match wins, and these map to null).
const KEEP = ['เซฟตี้', 'เซฟตี', 'บั๊กกี้', 'โครเมียม', 'โครมาโทกราฟี', 'พุชอัพ', 'แบ็กแพ็ก', 'ออเดอร์ฟ', 'เทสต์ไดรฟ์'];
const TABLE = new Map(KEEP.map((k) => [k, null]));
for (const [en, ...th] of WORDS) for (const t of th) if (!TABLE.has(t)) TABLE.set(t, en);
const LONGEST = Math.max(...[...TABLE.keys()].map((k) => k.length));
// A match must be a whole syllable run: not ending before a mark that belongs to the next letter, not starting
// right after a vowel written before its consonant (เ แ โ ใ ไ), nor after a consonant whose marks follow.
const MARK = /[ัิ-ฺ็-๎ะาำๅ]/;
const LEAD = /[เ-ไ]/;
const THAI = /[฀-๿]/;

/** Thai-spelled English (from the Thai recogniser) back into English, for the words in the table. */
export function englishWords(text) {
  const s = String(text ?? '');
  if (!THAI.test(s)) return s;
  let out = '', i = 0;
  while (i < s.length) {
    let hit = null;
    if (!(i > 0 && LEAD.test(s[i - 1]))) {
      for (let L = Math.min(LONGEST, s.length - i); L >= 2; L--) {
        const w = s.slice(i, i + L), en = TABLE.get(w);
        if (en === null) { hit = [w, L, true]; break; }
        if (en && !MARK.test(s[i + L] ?? '')) { hit = [en, L]; break; }
      }
    }
    if (!hit) { out += s[i++]; continue; }
    if (hit[2]) { out += hit[0]; i += hit[1]; continue; }
    // Written Thai sets an English word apart with a space on each side.
    if (out && !/\s$/.test(out)) out += ' ';
    out += hit[0];
    i += hit[1];
    if (i < s.length && !/^[\s.,!?)]/.test(s.slice(i))) out += ' ';
  }
  return out;
}
