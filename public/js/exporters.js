import {
  currentMonthInput as currentBusinessMonthInput,
  departmentLabel,
  formatDate,
  formatTime,
  roleLabel,
  statusLabel,
  todayIso as todayBusinessIso,
} from './shared.js';
import { formatDurationPlain as formatDuration } from './reporting.js';
import { buildTimesheetRows, timesheetValues, hoursValue } from './timesheet.js';

function csvValue(value) {
  const str = String(value ?? '');
  // Prevent CSV formula injection by prefixing dangerous values with '
  if (/^\s*[=+@-]/.test(str)) {
    return `"'${str.replace(/"/g, '""')}"`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function downloadCsvFile(filename, headers, rows) {
  const content = ['\uFEFF' + headers.map(csvValue).join(','), ...rows.map((row) => row.map(csvValue).join(','))].join('\r\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function todayIso() {
  return todayBusinessIso();
}

function monthToken(filters) {
  const rawValue = filters?.month || currentBusinessMonthInput();
  return rawValue.replace('-', '_');
}

export function exportEmployeesCsv(list) {
  downloadCsvFile(
    `employees-${todayIso()}.csv`,
    ['Employee Code', 'Full Name', 'Email', 'Phone', 'Department', 'Position', 'Status', 'Role', 'Access'],
    list.map((employee) => [
      employee.employee_code || '',
      employee.full_name,
      employee.email,
      employee.phone || '',
      departmentLabel(employee.department),
      employee.position || '',
      statusLabel(employee.status),
      roleLabel(employee.role),
      employee.is_active ? 'Active' : 'Inactive',
    ])
  );
}

export function exportAttendanceCsv(records, { resolveProfile, fallbackProfile } = {}) {
  downloadCsvFile(
    `attendance-${todayIso()}.csv`,
    ['Employee', 'Email', 'Date', 'Check In', 'Check Out', 'Status', 'IP Address', 'Device Info', 'Place', 'Training Hours', 'Daily Work Notes'],
    records.map((row) => {
      const profile = resolveProfile?.(row.user_id) || fallbackProfile || null;
      return [
        profile?.full_name || '',
        profile?.email || '',
        formatDate(row.attendance_date),
        formatTime(row.check_in_time),
        formatTime(row.check_out_time),
        statusLabel(row.attendance_status),
        row.ip_address || '',
        row.device_info || '',
        row.work_place || '',
        hoursValue(row.training_minutes),
        row.work_notes || '',
      ];
    })
  );
}

export function exportReportsCsv(report, filters) {
  const departmentToken = filters.department && filters.department !== 'all'
    ? filters.department.toLowerCase().replace(/\s+/g, '-')
    : 'all-departments';
  const employeeToken = filters.employeeId && filters.employeeId !== 'all'
    ? 'single-employee'
    : 'all-employees';

  downloadCsvFile(
    `reports-${monthToken(filters)}-${departmentToken}-${employeeToken}.csv`,
    [
      'Name',
      'Email',
      'Department',
      'Days Present',
      'Days Absent',
      'Late Arrivals',
      'Total Hours',
      'Expected Hours',
      'Overtime',
      'Shortfall',
    ],
    report.byEmployee.map((item) => [
      item.employee.full_name,
      item.employee.email || '',
      item.employee.department || departmentLabel(item.employee.department),
      item.presentDays,
      item.absentDays,
      item.lateArrivals,
      formatDuration(item.workedMinutes),
      formatDuration(item.expectedMinutes),
      formatDuration(item.overtimeMinutes),
      formatDuration(item.shortfallMinutes),
    ])
  );
}

export function exportEmployeeTimesheetCsv(employeeReport, filters) {
  if (!employeeReport) {
    return;
  }

  const employeeToken = (employeeReport.employee.employee_code || employeeReport.employee.full_name || 'employee')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'employee';

  const entries = buildTimesheetRows(employeeReport.detailedRows.map((entry) => entry.row), filters?.month || currentBusinessMonthInput());
  const rows = entries.map(timesheetValues);
  rows.push(['Total hours', '', '', '', hoursValue(entries.reduce((sum, entry) => sum + (entry.trainingMinutes || 0), 0)), hoursValue(entries.reduce((sum, entry) => sum + (entry.workMinutes || 0), 0)), '', '']);
  downloadCsvFile(`timesheet-${employeeToken}-${monthToken(filters)}.csv`,
    ['Day', 'Date', 'From', 'To', 'Training', 'Work', 'Place', 'Notes'], rows);
}
