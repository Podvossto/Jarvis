// The quick way to click: "กดปุ่มบันทึก", "click Save". When the whole request is one plain click and exactly one
// control in the front window carries those words, it is clicked at once, with no model call (seconds saved on
// the most common hands request). Anything less certain (no match, two matches, a risky label, more than a click)
// returns null and the request goes to the model as before, so the quick way can only be skipped, never wrong
// in a way the model's way wouldn't be.
import { isRiskyClick } from './safety.mjs';

// What may follow the verb before the label, and the polite tails after it.
const TH = /^(?:ช่วย|รบกวน)?\s*(?:กด|คลิก|คลิ๊ก|คลิ้ก|จิ้ม|แตะ)(?:ที่|ตรง|ไปที่)?\s*(?:ปุ่ม|ลิงก์|ลิงค์|แท็บ|เมนู|คำว่า)?\s*(.+?)\s*(?:ให้หน่อย|ให้ที|หน่อย|ที|ด้วย|เลย)?\s*(?:ครับ|ค่ะ|คะ|นะ|จ้ะ|จ้า)*[.!?。]*$/u;
const EN = /^(?:please\s+|can you\s+|could you\s+)?(?:click|press|tap|hit)(?:\s+on)?(?:\s+the)?\s+(.+?)(?:\s+(?:button|link|tab|menu))?(?:\s+please)?[.!?]*$/i;
// More than one thing asked, or something that needs thought: not a plain click.
const MORE = /แล้ว|จากนั้น|และ|หรือ|ถ้า|ก่อน|หลัง|ทุก|ทั้งหมด|\b(?:and|then|or|if|after|before|every|all|twice|times)\b|[,;:\n]/i;
// Keys are pressed, not clicked ("กด Enter"): the model's job.
const KEYS = /^(?:enter|return|esc|escape|tab|space|spacebar|delete|backspace|ctrl|control|alt|shift|cmd|win|f\d{1,2}|เอ็นเทอร์|เอนเทอร์|สเปซบาร์)\b/i;

/** The label a plain click request names, or null when the request is anything else. */
export function clickIntent(text) {
  const s = String(text ?? '').trim().replace(/\s+/g, ' ');
  if (!s || s.length > 60) return null;
  const m = TH.exec(s) ?? EN.exec(s);
  const label = m?.[1]?.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  if (!label || label.length > 40 || MORE.test(label) || KEYS.test(label) || /[+]/.test(label)) return null;
  return label;
}

const CLICKABLE = /button|link|tab|menu ?item|checkbox|radio|switch|option/i;
const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s​…._\-–—:()[\]"'“”‘’]+/g, '');

/**
 * The one control a label means, or null. Exact words win; otherwise the label must be at least three characters
 * and sit in exactly one clickable control's label. Controls scrolled out of view and risky ones are never picked.
 */
export function pickControl(label, controls) {
  const want = norm(label);
  if (!want || isRiskyClick(label)) return null;
  const can = (controls ?? []).filter((c) => !c.offscreen && c.label && CLICKABLE.test(c.role ?? ''));
  const exact = can.filter((c) => norm(c.label) === want);
  const hit = exact.length ? exact : want.length >= 3 ? can.filter((c) => norm(c.label).includes(want)) : [];
  if (hit.length !== 1 || isRiskyClick(hit[0].label)) return null;
  return hit[0];
}
