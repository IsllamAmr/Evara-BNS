import {
  departmentLabel,
  formatDate,
  formatTime,
  roleLabel,
  statusLabel,
  todayIso as todayBusinessIso,
} from './shared.js';
import { hoursValue } from './timesheet.js';

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

