import { escapeHtml, formatDate, BUSINESS_TIME_ZONE } from './shared.js';
import { getLocale, t } from './i18n.js';

export function buildTimesheetRows(records, month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid timesheet month');
  const [year, monthNumber] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const byDate = new Map(records.map((row) => [row.attendance_date, row]));
  return Array.from({ length: days }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, '0')}`;
    const record = byDate.get(date) || null;
    const elapsed = record?.check_in_time && record?.check_out_time
      ? (new Date(record.check_out_time) - new Date(record.check_in_time)) / 60000 : null;
    const totalMinutes = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
    const trainingMinutes = record?.training_minutes == null ? null : Number(record.training_minutes);
    return {
      date, record, totalMinutes, trainingMinutes,
      workMinutes: totalMinutes == null ? null : Math.max(totalMinutes - (trainingMinutes || 0), 0),
      notes: record?.work_notes || '',
      place: record?.work_place || '',
    };
  });
}

export function hoursValue(minutes) {
  return minutes == null ? '' : Number((minutes / 60).toFixed(2));
}

function timesheetTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(getLocale(), {
    timeZone: BUSINESS_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(date);
}

export function timesheetValues(entry) {
  return [
    new Date(`${entry.date}T12:00:00Z`).toLocaleDateString(getLocale(), { weekday: 'long', timeZone: 'UTC' }),
    formatDate(entry.date),
    timesheetTime(entry.record?.check_in_time),
    timesheetTime(entry.record?.check_out_time),
    hoursValue(entry.trainingMinutes), hoursValue(entry.workMinutes), entry.place, entry.notes,
  ];
}

export function renderTimesheet(records, month, employeeName) {
  const rows = buildTimesheetRows(records, month);
  const totalTraining = rows.reduce((sum, row) => sum + (row.trainingMinutes || 0), 0);
  const totalWork = rows.reduce((sum, row) => sum + (row.workMinutes || 0), 0);
  return `<div class="table-shell"><table class="work-timesheet">
    <caption>${escapeHtml(employeeName)} · ${escapeHtml(month)}<span>${escapeHtml(t('timesheet.hoursHint'))}</span></caption>
    <thead><tr>
      <th rowspan="2" scope="col">${escapeHtml(t('timesheet.day'))}</th>
      <th rowspan="2" scope="col">${escapeHtml(t('common.date'))}</th>
      <th colspan="2" scope="colgroup">${escapeHtml(t('timesheet.time'))}</th>
      <th colspan="2" scope="colgroup">${escapeHtml(t('timesheet.hours'))}</th>
      <th rowspan="2" scope="col">${escapeHtml(t('timesheet.place'))}</th>
      <th rowspan="2" scope="col">${escapeHtml(t('timesheet.notes'))}</th>
    </tr><tr>${['from', 'to', 'training', 'work'].map((key) => `<th scope="col">${escapeHtml(t(`timesheet.${key}`))}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${timesheetValues(row).map((value, index) => `<td${index === 7 ? ' class="work-notes-cell"' : ''}>${escapeHtml(value === '' ? '—' : value)}</td>`).join('')}</tr>`).join('')}</tbody>
    <tfoot><tr><th colspan="4" scope="row">${escapeHtml(t('timesheet.total'))}</th><td>${hoursValue(totalTraining)}</td><td>${hoursValue(totalWork)}</td><td colspan="2"></td></tr></tfoot>
  </table></div>`;
}
