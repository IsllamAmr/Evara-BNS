import { departmentLabel, formatDate, formatTime, roleLabel, statusLabel } from './shared.js';
import { attendanceOutcome, formatAverageTime, formatDuration, FULL_SHIFT_MINUTES } from './reporting.js';

function csvValue(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
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
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthToken(filters) {
  const rawValue = filters?.month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
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
    ['Employee', 'Email', 'Date', 'Check In', 'Check Out', 'Status', 'IP Address', 'Device Info'],
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
      'Employee Name',
      'Employee Code',
      'Email',
      'Department',
      'Position',
      'Days Present',
      'Days Absent',
      'Late Arrivals',
      'Total Hours',
      'Expected Hours',
      'Overtime',
      'Shortfall',
      'Attendance Rate (%)',
      'On-Time Arrival (%)',
      'Average Check In',
      'Average Check Out',
      'Complete Shifts',
      'Trend',
      'Trend Note',
    ],
    report.byEmployee.map((item) => [
      item.employee.full_name,
      item.employee.employee_code || '',
      item.employee.email || '',
      departmentLabel(item.employee.department),
      item.employee.position || '',
      item.presentDays,
      item.absentDays,
      item.lateArrivals,
      formatDuration(item.workedMinutes),
      formatDuration(item.expectedMinutes),
      formatDuration(item.overtimeMinutes),
      formatDuration(item.shortfallMinutes),
      item.attendanceRate,
      item.onTimeArrivalRate,
      formatAverageTime(item.averageCheckIn),
      formatAverageTime(item.averageCheckOut),
      item.detailedRows.filter((entry) => entry.metrics.isCompleteShift).length,
      item.trend.label,
      item.trend.note,
    ])
  );
}

export function exportEmployeeTimesheetCsv(employeeReport, filters) {
  if (!employeeReport) {
    return;
  }

  const employeeToken = (employeeReport.employee.full_name || 'employee')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'employee';

  downloadCsvFile(
    `timesheet-${employeeToken}-${monthToken(filters)}.csv`,
    [
      'Employee Name',
      'Employee Code',
      'Department',
      'Date',
      'Arrival',
      'Check In',
      'Check Out',
      'Total Hours',
      'Expected Hours',
      'Overtime',
      'Shortfall',
      'Shift Result',
      'Attendance Status',
    ],
    employeeReport.detailedRows.map((entry) => [
      employeeReport.employee.full_name,
      employeeReport.employee.employee_code || '',
      departmentLabel(employeeReport.employee.department),
      formatDate(entry.row.attendance_date),
      entry.metrics.isPresent ? (entry.metrics.isLateArrival ? 'Late' : 'On Time') : 'No Check-in',
      formatTime(entry.row.check_in_time),
      formatTime(entry.row.check_out_time),
      formatDuration(entry.metrics.workedMinutes),
      formatDuration(FULL_SHIFT_MINUTES),
      formatDuration(entry.metrics.overtimeMinutes),
      formatDuration(entry.metrics.shortfallMinutes),
      attendanceOutcome(entry.metrics),
      statusLabel(entry.row.attendance_status),
    ])
  );
}
