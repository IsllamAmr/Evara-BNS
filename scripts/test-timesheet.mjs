import assert from 'node:assert/strict';
import { buildTimesheetRows, renderTimesheet, timesheetValues } from '../public/js/timesheet.js';

const notes = 'Task A\nTask B <script>alert(1)</script>';
const records = [{ attendance_date: '2026-09-02', check_in_time: '2026-09-02T19:00:00Z', check_out_time: '2026-09-03T03:30:00Z', training_minutes: 30, work_place: 'Office', work_notes: notes },
  { attendance_date: '2026-09-04', check_in_time: '2026-09-04T06:00:00Z', check_out_time: null }];
const rows = buildTimesheetRows(records, '2026-09');
assert.equal(rows.length, 30);
assert.equal(rows[1].totalMinutes, 510);
assert.equal(rows[1].workMinutes, 480);
assert.equal(rows[1].notes, notes);
assert.deepEqual(timesheetValues(rows[1]).slice(4), [0.5, 8, 'Office', notes]);
assert.equal(rows[3].workMinutes, null, 'Do not invent finalized hours for an open shift');
assert.equal(rows[0].workMinutes, null, 'No attendance is not zero hours');
assert.equal(buildTimesheetRows([], '2028-02').length, 29);
assert.throws(() => buildTimesheetRows([], '2026-13'));
const html = renderTimesheet(records, '2026-09', 'Employee <test>');
assert.ok(html.includes('Task A\nTask B &lt;script&gt;'));
assert.ok(!html.includes('<script>'));
assert.ok(html.includes('Employee &lt;test&gt;'));
console.log('Timesheet dates, overnight duration, training split, blank shifts and escaped notes passed.');
