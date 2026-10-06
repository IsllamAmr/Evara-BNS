// Checks the Excel timesheet: valid ZIP/XLSX structure, month split, Cairo times,
// overnight shifts, training split, leave notes and escaping. Runs without Supabase.
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { crc32 } = require('../utils/xlsxWriter');
const {
  buildTimesheetWorkbook,
  excelDateSerial,
  excelTimeOfDay,
  splitIntoMonthlySegments,
  timesheetFileName,
  workHours,
} = require('../services/timesheetWorkbook');

function readZip(buffer) {
  const files = new Map();
  const endOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4B, 0x05, 0x06]));
  assert.ok(endOffset > 0, 'ZIP end record present');
  const count = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);
  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014B50);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const dataStart = localOffset + 30 + localNameLength;
    const data = zlib.inflateRawSync(buffer.subarray(dataStart, dataStart + compressedSize));
    assert.equal(crc32(data), crc, `CRC matches for ${name}`);
    files.set(name, data.toString('utf8'));
    offset += 46 + nameLength;
  }
  return files;
}

assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926);
assert.equal(excelDateSerial('2026-09-01'), 46266);
assert.equal(excelTimeOfDay('2026-09-01T07:00:00Z') * 24, 10, 'Cairo summer time (UTC+3)');
assert.equal(excelTimeOfDay('2026-12-01T07:00:00Z') * 24, 9, 'Cairo winter time (UTC+2)');
assert.equal(workHours(18 / 24, 1.5 / 24, 0), 7.5, 'Overnight shift wraps past midnight');
assert.equal(workHours(9 / 24, 17 / 24, 1.5), 6.5, 'Training is subtracted from work');
assert.equal(workHours(9 / 24, null, 0), null, 'Open shifts have no final hours');

assert.deepEqual(splitIntoMonthlySegments('2026-08-30', '2026-09-30').map((s) => s.label), ['Sep 2026'], 'Short leading piece joins the next month');
assert.deepEqual(splitIntoMonthlySegments('2026-07-01', '2026-09-15').map((s) => `${s.label}:${s.from}..${s.to}`), [
  'Jul 2026:2026-07-01..2026-07-31', 'Aug 2026:2026-08-01..2026-08-31', 'Sep 2026:2026-09-01..2026-09-15',
]);
assert.deepEqual(splitIntoMonthlySegments('2026-09-30', '2026-09-30').map((s) => s.label), ['Sep 2026']);
assert.throws(() => splitIntoMonthlySegments('2026-09-10', '2026-09-01'));
assert.throws(() => splitIntoMonthlySegments('2026-02-30', '2026-03-01'));
assert.equal(timesheetFileName({ full_name: 'Islam / Amr' }, '2026-09-01', '2026-09-30'), 'Islam Amr - Timesheet 2026-09-01 to 2026-09-30.xlsx');

const { buffer, segments } = buildTimesheetWorkbook({
  employee: { full_name: 'Test <Employee> & Co', employee_code: 'E01' },
  records: [
    { attendance_date: '2026-09-01', check_in_time: '2026-09-01T07:00:00Z', check_out_time: '2026-09-01T15:30:00Z', training_minutes: 60, work_notes: 'Line 1\nتقرير <b> & "done"' },
    { attendance_date: '2026-09-02', check_in_time: '2026-09-02T18:00:00Z', check_out_time: '2026-09-03T01:30:00Z', work_notes: 'Overnight' },
    { attendance_date: '2026-09-03', check_in_time: '2026-09-03T06:00:00Z', check_out_time: null },
  ],
  requests: [
    { request_type: 'annual_leave', status: 'approved', leave_start_date: '2026-09-06', leave_end_date: '2026-09-07' },
    { request_type: 'annual_leave', status: 'pending', leave_start_date: '2026-09-08', leave_end_date: '2026-09-08' },
    { request_type: 'work_from_home', status: 'approved', work_date: '2026-09-01', work_start: '18:30:00', work_end: '21:00:00', reason: 'Client calls' },
    { request_type: 'work_from_home', status: 'approved', work_date: '2026-09-01', work_start: '07:00:00', work_end: '08:15:00', reason: null },
    { request_type: 'work_from_home', status: 'rejected', work_date: '2026-09-02', work_start: '20:00:00', work_end: '22:00:00', reason: 'Removed by admin' },
  ],
  from: '2026-09-01',
  to: '2026-10-05',
  now: new Date('2026-10-05T12:00:00Z'),
});

assert.deepEqual(segments.map((s) => s.label), ['Sep 2026', 'Oct 2026']);
const files = readZip(buffer);
for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
  assert.ok(files.has(part), `${part} present`);
}
const sheet1 = files.get('xl/worksheets/sheet1.xml');
assert.ok(files.get('xl/workbook.xml').includes('name="Sep 2026"'));
assert.ok(sheet1.includes('Test &lt;Employee&gt; &amp; Co'), 'Employee name escaped');
assert.ok(sheet1.includes('تقرير &lt;b&gt; &amp; &quot;done&quot;'), 'Arabic notes kept and escaped');
assert.ok(sheet1.includes('<f>IF(OR(C4=&quot;&quot;,D4=&quot;&quot;),&quot;&quot;,IF(D4&lt;C4,D4+1-C4,D4-C4)*24-N(E4))</f><v>7.5</v>'), '8.5h shift minus 1h training = 7.5');
assert.ok(sheet1.includes('<v>7.5</v>'), 'Overnight 9 PM to 4:30 AM = 7.5h');
assert.ok(sheet1.includes('No check-out recorded'));
assert.ok(sheet1.includes('Annual leave (approved)'));
assert.equal((sheet1.match(/Annual leave \(approved\)/g) || []).length, 2, 'Only approved leave days are annotated');
assert.ok(sheet1.includes('<f>SUM(F4:F33)</f><v>15</v>'), 'Total work hours for September');
assert.ok(sheet1.includes('<mergeCell ref="A1:H1"/>'));
// Work from home: a note on that day (after the daily notes, earliest first); hours unchanged.
assert.ok(sheet1.includes('Worked from home 7:00 am - 8:15 am\nWorked from home 6:30 pm - 9:00 pm: Client calls'), 'Work from home notes, in time order');
assert.ok(!sheet1.includes('Removed by admin'), 'A removed (rejected) work from home note is left out');
assert.ok(/<c r="A7" s="\d+" t="inlineStr"><is><t>Friday<\/t>/.test(sheet1));
console.log('Excel timesheet: ZIP integrity, month split, Cairo times, overnight, training, leave and work-from-home notes and escaping passed.');
