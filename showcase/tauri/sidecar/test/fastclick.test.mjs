// The quick click: only a plain one-click request, and only when exactly one safe control matches.
import assert from 'node:assert/strict';
import { clickIntent, pickControl } from '../fastclick.mjs';

for (const [said, label] of [
  ['กดปุ่มบันทึก', 'บันทึก'], ['ช่วยกดปุ่ม ตั้งค่า ให้หน่อยครับ', 'ตั้งค่า'], ['คลิกที่ ถัดไป', 'ถัดไป'], ['กด Save หน่อย', 'Save'],
  ['จิ้มตรงคำว่า ดาวน์โหลด นะครับ', 'ดาวน์โหลด'], ['click Save', 'Save'], ['Please click on the Settings button.', 'Settings'],
  ['press "Next"', 'Next'], ['tap the Downloads tab please', 'Downloads'], ['กดแท็บ ประวัติ', 'ประวัติ'],
]) assert.equal(clickIntent(said), label, said);

for (const said of [
  'กดบันทึกแล้วปิดหน้าต่าง', 'click Save and close the window', 'กด Enter', 'press Ctrl+S', 'press escape', 'เปิด Chrome', 'what does the Save button do',
  'กดทุกปุ่ม', 'click every link', 'กดปุ่มบันทึก, แล้วบอกผม', '', 'กด', 'click ' + 'x'.repeat(50), 'ถ้ามีปุ่มบันทึกให้กด',
]) assert.equal(clickIntent(said), null, said);

const controls = [
  { id: 1, role: 'button', label: 'Save' }, { id: 2, role: 'button', label: 'Save As…' }, { id: 3, role: 'link', label: 'Settings' },
  { id: 4, role: 'text', label: 'Downloads' }, { id: 5, role: 'button', label: 'Delete' }, { id: 6, role: 'button', label: 'บันทึก' },
  { id: 7, role: 'tab', label: 'History', offscreen: true }, { id: 8, role: 'button', label: 'Open file' }, { id: 9, role: 'button', label: 'Open folder' },
  { id: 10, role: 'menu item', label: 'ตั้งค่าขั้นสูง' },
];
assert.equal(pickControl('save', controls)?.id, 1, 'exact words win over a longer label that contains them');
assert.equal(pickControl('Settings', controls)?.id, 3);
assert.equal(pickControl('บันทึก', controls)?.id, 6);
assert.equal(pickControl('ตั้งค่า', controls)?.id, 10, 'part of one label, when only one has it');
assert.equal(pickControl('Open', controls), null, 'two controls have it: the model decides');
assert.equal(pickControl('Downloads', controls), null, 'plain text is not something to click');
assert.equal(pickControl('History', controls), null, 'scrolled out of view: the model scrolls');
assert.equal(pickControl('Delete', controls), null, 'a risky click always goes through the model, which asks first');
assert.equal(pickControl('ลบ', [{ id: 1, role: 'button', label: 'ลบ' }]), null, 'Thai risky words too');
assert.equal(pickControl('fil', [{ id: 1, role: 'button', label: 'Delete file' }]), null, 'a safe-sounding part of a risky label is still risky');
assert.equal(pickControl('ok', [{ id: 1, role: 'button', label: 'Books' }]), null, 'two letters never match inside a longer label');
assert.equal(pickControl('Nope', controls), null);
assert.equal(pickControl('Save', null), null);
console.log('fast click tests: passed');
