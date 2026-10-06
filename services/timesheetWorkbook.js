// Builds the employee "Work Hours Time Sheet" workbook in the same layout as the
// company's manual Excel file: Day | Date | From | To | Training | Work | Place | Notes,
// one sheet per month, weekly days off highlighted, and a live SUM total row.
const { buildXlsx } = require('../utils/xlsxWriter');

const BUSINESS_TIME_ZONE = 'Africa/Cairo';
const WEEKEND_DAY_INDEXES = new Set([5, 6]); // Friday, Saturday
const MIN_LEADING_SEGMENT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const COLORS = {
  weekend: 'FFFF7D7D',
  header: 'FFD9E1F2',
  title: 'FF1F3864',
  total: 'FFE5AAA9',
  leave: 'FFFFF2CC',
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value, name) {
  if (!DATE_PATTERN.test(String(value || ''))) {
    throw new Error(`${name} must be YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} is not a valid date`);
  }
}

function dateUtc(iso) {
  return new Date(`${iso}T00:00:00Z`);
}

function addDays(iso, days) {
  return new Date(dateUtc(iso).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetweenInclusive(from, to) {
  return Math.round((dateUtc(to).getTime() - dateUtc(from).getTime()) / DAY_MS) + 1;
}

function enumerateDates(from, to) {
  const dates = [];
  for (let current = from; current <= to; current = addDays(current, 1)) {
    dates.push(current);
  }
  return dates;
}

function lastDayOfMonth(iso) {
  const date = dateUtc(iso);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function monthLabel(iso) {
  const date = dateUtc(iso);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function displayDate(iso) {
  const date = dateUtc(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function todayInBusinessZone(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function businessDateOf(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : todayInBusinessZone(date);
}

/**
 * Splits [from, to] into one segment per calendar month. A short leading piece
 * (for example 30-31 Aug when exporting "since the last export") is folded into
 * the next month so the file does not start with a 2-day sheet.
 */
function splitIntoMonthlySegments(from, to) {
  assertIsoDate(from, 'from');
  assertIsoDate(to, 'to');
  if (to < from) {
    throw new Error('to must be on or after from');
  }

  const segments = [];
  let start = from;
  while (start <= to) {
    const monthEnd = lastDayOfMonth(start);
    const end = monthEnd < to ? monthEnd : to;
    segments.push({ from: start, to: end });
    start = addDays(end, 1);
  }

  if (segments.length > 1 && daysBetweenInclusive(segments[0].from, segments[0].to) < MIN_LEADING_SEGMENT_DAYS) {
    const [first, second, ...rest] = segments;
    return [{ from: first.from, to: second.to }, ...rest].map((segment) => ({ ...segment, label: monthLabel(segment.to) }));
  }

  return segments.map((segment) => ({ ...segment, label: monthLabel(segment.to) }));
}

// Excel stores dates as days since 1899-12-30 and times as a fraction of a day.
function excelDateSerial(iso) {
  return Math.round((dateUtc(iso).getTime() - Date.UTC(1899, 11, 30)) / DAY_MS);
}

const timePartsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function excelTimeOfDay(timestamp) {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(timePartsFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  const minutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  return minutes / (24 * 60);
}

function roundTo(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function workHours(fromFraction, toFraction, trainingHours) {
  if (fromFraction === null || toFraction === null) return null;
  const span = toFraction < fromFraction ? toFraction + 1 - fromFraction : toFraction - fromFraction;
  return span * 24 - (trainingHours || 0);
}

function requestCoversDate(request, iso) {
  if (request.request_type === 'annual_leave') {
    return request.leave_start_date <= iso && iso <= request.leave_end_date;
  }
  return request.request_type === 'late_2_hours' && request.late_date === iso;
}

// "16:00:00" -> "4:00 pm"
function clockLabel(value) {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return '';
  const suffix = hours >= 12 ? 'pm' : 'am';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function workFromHomeNote(request) {
  const span = `Worked from home ${clockLabel(request.work_start)} - ${clockLabel(request.work_end)}`;
  return request.reason ? `${span}: ${String(request.reason).trim()}` : span;
}

function estimateRowHeight(text, columnWidth) {
  if (!text) return null;
  const charsPerLine = Math.max(Math.floor(columnWidth * 1.1), 10);
  const lines = String(text).split('\n').reduce((sum, line) => sum + Math.max(Math.ceil(line.length / charsPerLine), 1), 0);
  return lines > 1 ? Math.min(lines * 15, 409) : null;
}

const NOTES_COLUMN_WIDTH = 76.71;
const COLUMNS = [
  { width: 12.57 }, { width: 14 }, { width: 12.14 }, { width: 12.14 },
  { width: 13.14 }, { width: 16.43 }, { width: 12.71 }, { width: NOTES_COLUMN_WIDTH },
];

function baseStyle(extra = {}) {
  return { border: true, ...extra, align: { v: 'center', ...(extra.align || {}) } };
}

function buildDayRow({ iso, rowNumber, record, requests, today }) {
  const weekday = dateUtc(iso).getUTCDay();
  const isWeekend = WEEKEND_DAY_INDEXES.has(weekday);
  const leave = requests.find((request) => request.request_type === 'annual_leave' && requestCoversDate(request, iso));
  const delay = requests.find((request) => request.request_type === 'late_2_hours' && requestCoversDate(request, iso));
  const fill = isWeekend ? COLORS.weekend : (leave && !record?.check_in_time ? COLORS.leave : undefined);

  const from = excelTimeOfDay(record?.check_in_time);
  const to = excelTimeOfDay(record?.check_out_time);
  const training = record?.training_minutes == null ? null : roundTo(Number(record.training_minutes) / 60, 2);
  const work = workHours(from, to, training);

  const notes = [];
  if (record?.work_notes) notes.push(String(record.work_notes).trim());
  if (leave && !record?.check_in_time) notes.push('Annual leave (approved)');
  if (delay) notes.push('Approved 2-hour delay');
  requests
    .filter((request) => request.request_type === 'work_from_home' && request.work_date === iso)
    .sort((left, right) => String(left.work_start).localeCompare(String(right.work_start)))
    .forEach((request) => notes.push(workFromHomeNote(request)));
  if (record?.attendance_status === 'absent') notes.push('Absent');
  if (record?.check_in_time && !record?.check_out_time && iso < today) notes.push('No check-out recorded');
  if (record?.ip_address === 'manual-entry') notes.push('Manual entry by admin');
  const notesText = notes.join('\n');

  const place = record?.check_in_time ? (record.work_place || 'Office') : '';
  const r = rowNumber;
  const cells = [
    { value: WEEKDAYS[weekday], style: baseStyle({ fill }) },
    { value: excelDateSerial(iso), style: baseStyle({ fill, numFmt: 'd-mmm', align: { h: 'center' } }) },
    { value: from, style: baseStyle({ fill, numFmt: 'h:mm AM/PM', align: { h: 'center' } }) },
    { value: to, style: baseStyle({ fill, numFmt: 'h:mm AM/PM', align: { h: 'center' } }) },
    { value: training, style: baseStyle({ fill, numFmt: '0.00', align: { h: 'center' } }) },
    {
      formula: `IF(OR(C${r}="",D${r}=""),"",IF(D${r}<C${r},D${r}+1-C${r},D${r}-C${r})*24-N(E${r}))`,
      value: work === null ? '' : roundTo(work, 6),
      style: baseStyle({ fill, numFmt: '0.00', align: { h: 'center' } }),
    },
    { value: place, style: baseStyle({ fill, align: { h: 'center' } }) },
    { value: notesText, style: baseStyle({ fill, align: { v: 'top', wrap: true } }) },
  ];

  return {
    row: { cells, height: estimateRowHeight(notesText, NOTES_COLUMN_WIDTH) },
    work: work || 0,
    training: training || 0,
    attended: Boolean(record?.check_in_time),
  };
}

function buildSheet({ segment, employee, recordsByDate, requests, today, generatedAt }) {
  const headerStyle = baseStyle({ bold: true, fill: COLORS.header, align: { h: 'center' } });
  const rows = [
    {
      cells: [{ value: `EVARA BNS - Work Hours Time Sheet - ${segment.label} - ${employee.full_name}`, style: { bold: true, size: 14, color: COLORS.title, align: { h: 'center', v: 'center' } } }],
      height: 26,
    },
    [
      { value: 'Day', style: headerStyle }, { value: 'Date', style: headerStyle },
      { value: 'Time', style: headerStyle }, { value: null, style: headerStyle },
      { value: 'No. of Hours', style: headerStyle }, { value: null, style: headerStyle },
      { value: 'Place', style: headerStyle }, { value: 'Notes', style: headerStyle },
    ],
    [
      { value: null, style: headerStyle }, { value: null, style: headerStyle },
      { value: 'From', style: headerStyle }, { value: 'To', style: headerStyle },
      { value: 'Training', style: headerStyle }, { value: 'Work', style: headerStyle },
      { value: null, style: headerStyle }, { value: null, style: headerStyle },
    ],
  ];

  const firstDataRow = rows.length + 1;
  let totalWork = 0;
  let totalTraining = 0;
  let attendedDays = 0;
  for (const iso of enumerateDates(segment.from, segment.to)) {
    const built = buildDayRow({ iso, rowNumber: rows.length + 1, record: recordsByDate.get(iso) || null, requests, today });
    rows.push(built.row);
    totalWork += built.work;
    totalTraining += built.training;
    if (built.attended) attendedDays += 1;
  }
  const lastDataRow = rows.length;
  const totalRowNumber = rows.length + 1;
  const totalStyle = baseStyle({ bold: true, fill: COLORS.total, align: { h: 'center' } });

  rows.push({
    cells: [
      null,
      { value: 'Total', style: totalStyle }, { value: null, style: totalStyle }, { value: null, style: totalStyle },
      { formula: `SUM(E${firstDataRow}:E${lastDataRow})`, value: roundTo(totalTraining, 6), style: { ...totalStyle, numFmt: '0.00' } },
      { formula: `SUM(F${firstDataRow}:F${lastDataRow})`, value: roundTo(totalWork, 6), style: { ...totalStyle, numFmt: '0.00' } },
      null,
      { value: `Attended days: ${attendedDays}`, style: totalStyle },
    ],
    height: 20,
  });
  rows.push(null);
  rows.push([
    {
      value: `Employee: ${employee.full_name}${employee.employee_code ? ` (${employee.employee_code})` : ''}  |  Period: ${displayDate(segment.from)} - ${displayDate(segment.to)}  |  Generated: ${generatedAt}`,
      style: { italic: true, size: 9, color: 'FF595959' },
    },
  ]);

  return {
    name: segment.label,
    columns: COLUMNS,
    rows,
    merges: ['A1:H1', 'A2:A3', 'B2:B3', 'C2:D2', 'E2:F2', 'G2:G3', 'H2:H3', `B${totalRowNumber}:D${totalRowNumber}`, `A${totalRowNumber + 2}:H${totalRowNumber + 2}`],
    freeze: { rows: 3 },
    landscape: true,
  };
}

/**
 * @param {{ employee: object, records: object[], requests?: object[], from: string, to: string, now?: Date }} input
 * @returns {{ buffer: Buffer, segments: Array<{from:string,to:string,label:string}> }}
 */
function buildTimesheetWorkbook({ employee, records, requests = [], from, to, now = new Date() }) {
  const segments = splitIntoMonthlySegments(from, to);
  const today = todayInBusinessZone(now);
  const recordsByDate = new Map();
  for (const record of records || []) {
    if (record?.attendance_date) recordsByDate.set(record.attendance_date, record);
  }
  const approved = (requests || []).filter((request) => request.status === 'approved');
  const nowMinutes = excelTimeOfDay(now) * 24 * 60;
  const generatedAt = `${displayDate(todayInBusinessZone(now))}, ${String(Math.floor(nowMinutes / 60)).padStart(2, '0')}:${String(Math.round(nowMinutes % 60)).padStart(2, '0')}`;

  const sheets = segments.map((segment) => buildSheet({ segment, employee, recordsByDate, requests: approved, today, generatedAt }));
  return { buffer: buildXlsx({ sheets, creator: 'EVARA BNS' }), segments };
}

function timesheetFileName(employee, from, to) {
  const safeName = String(employee?.full_name || 'Employee').replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim() || 'Employee';
  return `${safeName} - Timesheet ${from} to ${to}.xlsx`;
}

module.exports = {
  addDays,
  assertIsoDate,
  buildTimesheetWorkbook,
  businessDateOf,
  daysBetweenInclusive,
  excelDateSerial,
  excelTimeOfDay,
  splitIntoMonthlySegments,
  timesheetFileName,
  todayInBusinessZone,
  workHours,
};
