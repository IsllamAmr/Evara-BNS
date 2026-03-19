import {
  currentMonthInput as currentBusinessMonthInput,
  departmentLabel,
  escapeHtml,
  todayIso as todayBusinessIso,
} from './shared.js';

export const BUSINESS_TIME_ZONE = 'Africa/Cairo';
export const FULL_SHIFT_MINUTES = 8 * 60;
export const SHIFT_START_MINUTES = 10 * 60;
export const SHIFT_END_MINUTES = SHIFT_START_MINUTES + FULL_SHIFT_MINUTES;
const ON_TIME_THRESHOLD_MINUTES = SHIFT_START_MINUTES;
const BUSINESS_WORKDAY_INDEXES = new Set([0, 1, 2, 3, 4]);

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentMonthInput() {
  return currentBusinessMonthInput();
}

function dateFromIsoDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
}

function isoDateInTimeZone(value = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(date);
}

export function monthRange(monthValue) {
  const [yearValue, monthValuePart] = String(monthValue || currentMonthInput()).split('-');
  const year = Number(yearValue);
  const month = Number(monthValuePart);
  const startDate = new Date(year, month - 1, 1, 12, 0, 0, 0);
  const endDate = new Date(year, month, 0, 12, 0, 0, 0);
  const today = dateFromIsoDate(todayBusinessIso()) || new Date();
  const boundedEnd = endDate > today ? today : endDate;

  return {
    startDate,
    endDate: boundedEnd,
    from: formatDateInput(startDate),
    to: formatDateInput(boundedEnd),
    label: startDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
  };
}

export function isWorkday(date) {
  const day = date.getDay();
  return BUSINESS_WORKDAY_INDEXES.has(day);
}

export function businessStartTimeLabel() {
  return formatAverageTime(SHIFT_START_MINUTES);
}

export function businessEndTimeLabel() {
  return formatAverageTime(SHIFT_END_MINUTES);
}

export function businessScheduleLabel() {
  return `Sunday to Thursday - ${businessStartTimeLabel()} to ${businessEndTimeLabel()}`;
}

export function getBusinessDayContext(now = new Date()) {
  const todayIso = isoDateInTimeZone(now, BUSINESS_TIME_ZONE);
  const businessDate = dateFromIsoDate(todayIso);
  const currentBusinessMinutes = minutesFromTimestamp(now, BUSINESS_TIME_ZONE);
  const isScheduledWorkday = businessDate ? isWorkday(businessDate) : true;
  const hasShiftStarted = Number.isFinite(currentBusinessMinutes) && currentBusinessMinutes >= SHIFT_START_MINUTES;
  const hasShiftEnded = Number.isFinite(currentBusinessMinutes) && currentBusinessMinutes >= SHIFT_END_MINUTES;

  return {
    todayIso,
    businessDate,
    currentBusinessMinutes,
    isScheduledWorkday,
    hasShiftStarted,
    hasShiftEnded,
  };
}

export function deriveMissingAttendanceState({
  attendanceDate,
  employeeStatus = 'active',
  isActive = true,
  now = new Date(),
} = {}) {
  const context = getBusinessDayContext(now);
  const targetDate = attendanceDate || context.todayIso;
  const targetDateObject = dateFromIsoDate(targetDate);

  if (!isActive || employeeStatus === 'inactive') {
    return {
      code: 'inactive',
      label: 'Inactive',
      note: 'Attendance tracking is disabled for this account.',
      badgeType: 'inactive',
      countsAsMissing: false,
      countsAsAbsent: false,
    };
  }

  if (employeeStatus === 'on_leave') {
    return {
      code: 'on_leave',
      label: 'On Leave',
      note: 'This employee is currently marked as on leave.',
      badgeType: 'on_leave',
      countsAsMissing: false,
      countsAsAbsent: false,
    };
  }

  if (!targetDateObject || !isWorkday(targetDateObject)) {
    return {
      code: 'weekend',
      label: 'Weekly Leave',
      note: 'Friday and Saturday are counted as weekly leave.',
      badgeType: 'pending',
      countsAsMissing: false,
      countsAsAbsent: false,
    };
  }

  if (targetDate < context.todayIso) {
    return {
      code: 'absent',
      label: 'Absent',
      note: 'No check-in was recorded for this workday.',
      badgeType: 'absent',
      countsAsMissing: true,
      countsAsAbsent: true,
    };
  }

  if (targetDate > context.todayIso) {
    return {
      code: 'upcoming',
      label: 'Upcoming',
      note: 'This attendance day has not started yet.',
      badgeType: 'pending',
      countsAsMissing: false,
      countsAsAbsent: false,
    };
  }

  if (!context.hasShiftStarted) {
    return {
      code: 'not_checked_in_yet',
      label: 'Not Checked In Yet',
      note: `No check-in has been recorded yet. The shift starts at ${businessStartTimeLabel()}.`,
      badgeType: 'pending',
      countsAsMissing: true,
      countsAsAbsent: false,
    };
  }

  if (!context.hasShiftEnded) {
    return {
      code: 'absent_so_far',
      label: 'Absent So Far',
      note: 'No check-in has been recorded yet for today.',
      badgeType: 'late',
      countsAsMissing: true,
      countsAsAbsent: false,
    };
  }

  return {
    code: 'absent',
    label: 'Absent',
    note: `No check-in was recorded before the workday ended at ${businessEndTimeLabel()}.`,
    badgeType: 'absent',
    countsAsMissing: true,
    countsAsAbsent: true,
  };
}

export function enumerateDates(startDate, endDate) {
  const dates = [];
  const cursor = new Date(startDate);
  cursor.setHours(12, 0, 0, 0);
  const finalDate = new Date(endDate);
  finalDate.setHours(12, 0, 0, 0);

  while (cursor <= finalDate) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function timePartsInZone(value, timeZone = BUSINESS_TIME_ZONE) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  return { hour, minute };
}

export function minutesFromTimestamp(value, timeZone = BUSINESS_TIME_ZONE) {
  if (!value) {
    return null;
  }

  const parts = timePartsInZone(value, timeZone);
  if (!parts) {
    return null;
  }

  return (parts.hour * 60) + parts.minute;
}

export function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) {
    return null;
  }

  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

export function formatAverageTime(minutes) {
  if (!Number.isFinite(minutes)) {
    return '-';
  }

  const normalizedMinutes = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hours24 = Math.floor(normalizedMinutes / 60);
  const mins = String(normalizedMinutes % 60).padStart(2, '0');
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${mins} ${meridiem}`;
}

export function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return '0h 00m';
  }

  const hours = Math.floor(minutes / 60);
  const mins = String(minutes % 60).padStart(2, '0');
  return `${hours}h ${mins}m`;
}

function durationToHours(minutes) {
  return Math.round((minutes / 60) * 10) / 10;
}

function workingMinutesBetween(checkInTime, checkOutTime) {
  if (!checkInTime || !checkOutTime) {
    return 0;
  }

  const start = new Date(checkInTime);
  const end = new Date(checkOutTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }

  return Math.max(Math.round((end.getTime() - start.getTime()) / 60000), 0);
}

function sumBy(items, selector) {
  return items.reduce((total, item) => total + selector(item), 0);
}

export function buildAttendanceRowMetrics(row) {
  const checkInMinutes = minutesFromTimestamp(row.check_in_time);
  const checkOutMinutes = minutesFromTimestamp(row.check_out_time);
  const todayBusinessIso = isoDateInTimeZone(new Date(), BUSINESS_TIME_ZONE);
  const currentBusinessMinutes = minutesFromTimestamp(new Date(), BUSINESS_TIME_ZONE);
  const rowBusinessDate = row.attendance_date ? new Date(`${row.attendance_date}T12:00:00`) : null;
  const isScheduledWorkday = rowBusinessDate ? isWorkday(rowBusinessDate) : true;
  let workedMinutes = workingMinutesBetween(row.check_in_time, row.check_out_time);
  let overtimeMinutes = Math.max(workedMinutes - FULL_SHIFT_MINUTES, 0);
  let shortfallMinutes = row.check_in_time && row.check_out_time
    ? Math.max(FULL_SHIFT_MINUTES - workedMinutes, 0)
    : 0;
  let projectedRemainingMinutes = 0;
  const isPresent = Boolean(row.check_in_time);
  const isLateArrival = isScheduledWorkday && Number.isFinite(checkInMinutes) && checkInMinutes > ON_TIME_THRESHOLD_MINUTES;
  const isOpenShift = Boolean(row.check_in_time && !row.check_out_time);
  let isPastDue = false;

  if (isOpenShift && Number.isFinite(checkInMinutes)) {
    if (row.attendance_date === todayBusinessIso && Number.isFinite(currentBusinessMinutes) && currentBusinessMinutes < SHIFT_END_MINUTES) {
      workedMinutes = Math.min(Math.max(currentBusinessMinutes - checkInMinutes, 0), FULL_SHIFT_MINUTES);
      overtimeMinutes = 0;
      shortfallMinutes = 0;
      projectedRemainingMinutes = Math.max(FULL_SHIFT_MINUTES - workedMinutes, 0);
    } else {
      workedMinutes = Math.min(Math.max(SHIFT_END_MINUTES - checkInMinutes, 0), FULL_SHIFT_MINUTES);
      overtimeMinutes = 0;
      shortfallMinutes = Math.max(FULL_SHIFT_MINUTES - workedMinutes, 0);
      projectedRemainingMinutes = 0;
      isPastDue = true;
    }
  }

  return {
    checkInMinutes,
    checkOutMinutes,
    workedMinutes,
    overtimeMinutes,
    shortfallMinutes,
    projectedRemainingMinutes,
    isPresent,
    isLateArrival,
    isOnTimeArrival: isPresent && !isLateArrival,
    isCompleteShift: Boolean(row.check_in_time && row.check_out_time),
    isOpenShift,
    isPastDue,
  };
}

export function attendanceOutcome(metrics) {
  if (!metrics.isPresent) {
    return 'No Check-in';
  }
  if (!metrics.isCompleteShift) {
    if (metrics.isPastDue) {
      return metrics.shortfallMinutes > 0
        ? `Incomplete Shift - ${formatDuration(metrics.shortfallMinutes)} short`
        : 'Incomplete Shift - Review Needed';
    }
    return metrics.projectedRemainingMinutes > 0
      ? `Open Shift - ${formatDuration(metrics.projectedRemainingMinutes)} remaining`
      : 'Open Shift';
  }
  if (metrics.overtimeMinutes > 0) {
    return `Overtime +${formatDuration(metrics.overtimeMinutes)}`;
  }
  if (metrics.shortfallMinutes > 0) {
    return `Shortfall ${formatDuration(metrics.shortfallMinutes)}`;
  }
  return 'Full Shift';
}

function classifyEmployeeTrend(employeeReport) {
  if (employeeReport.attendanceRate >= 96 && employeeReport.onTimeArrivalRate >= 90 && employeeReport.shortfallMinutes <= FULL_SHIFT_MINUTES) {
    return { label: 'Exceptional', className: 'trend-exceptional', note: 'Consistent attendance with strong shift completion.' };
  }
  if (employeeReport.attendanceRate >= 85 && employeeReport.onTimeArrivalRate >= 75 && employeeReport.shortfallMinutes <= FULL_SHIFT_MINUTES * 2) {
    return { label: 'Committed', className: 'trend-committed', note: 'Reliable attendance and healthy punctuality.' };
  }
  if (employeeReport.attendanceRate >= 70 && employeeReport.onTimeArrivalRate >= 60) {
    return { label: 'Needs Focus', className: 'trend-focus', note: 'Watch punctuality and shift completion more closely.' };
  }
  return { label: 'Needs Attention', className: 'trend-risk', note: 'Attendance or punctuality is below target.' };
}

export function trendBadgeMarkup(trend) {
  return `<span class="badge ${escapeHtml(trend.className)}">${escapeHtml(trend.label)}</span>`;
}

export function reportsDepartmentChoices(employees) {
  return [...new Set(
    employees
      .map((employee) => departmentLabel(employee.department))
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right));
}

export function reportsEmployeeChoices(employees, departmentFilter = 'all') {
  return employees
    .filter((employee) => departmentFilter === 'all' || departmentLabel(employee.department) === departmentFilter)
    .sort((left, right) => left.full_name.localeCompare(right.full_name));
}

export function reportEmployeeOptions(employees, selectedEmployeeId = 'all') {
  return [
    '<option value="all">All Employees</option>',
    ...employees.map((employee) => `
      <option value="${escapeHtml(employee.id)}" ${selectedEmployeeId === employee.id ? 'selected' : ''}>
        ${escapeHtml(employee.full_name)}${employee.employee_code ? ` (${escapeHtml(employee.employee_code)})` : ''}
      </option>
    `),
  ].join('');
}

export function buildReportsDataset(employees, attendanceRows, filters) {
  const range = monthRange(filters.month);
  const workdays = enumerateDates(range.startDate, range.endDate).filter(isWorkday);
  const workdaySet = new Set(workdays.map((date) => formatDateInput(date)));
  const eligibleEmployees = employees.filter((employee) => employee.role === 'employee' && employee.is_active && employee.status !== 'inactive');
  const filteredEmployees = eligibleEmployees.filter((employee) => {
    if (filters.department !== 'all' && departmentLabel(employee.department) !== filters.department) {
      return false;
    }
    if (filters.employeeId !== 'all' && employee.id !== filters.employeeId) {
      return false;
    }
    return true;
  });
  const employeeIds = new Set(filteredEmployees.map((employee) => employee.id));
  const relevantRows = attendanceRows.filter((row) => employeeIds.has(row.user_id));
  const rowsByEmployee = new Map(filteredEmployees.map((employee) => [employee.id, []]));

  relevantRows.forEach((row) => {
    rowsByEmployee.get(row.user_id)?.push(row);
  });

  const byEmployee = filteredEmployees.map((employee) => {
    const rows = (rowsByEmployee.get(employee.id) || [])
      .slice()
      .sort((left, right) => right.attendance_date.localeCompare(left.attendance_date));
    const detailedRows = rows.map((row) => ({
      row,
      metrics: buildAttendanceRowMetrics(row),
    }));
    const workdayRows = detailedRows.filter((item) => workdaySet.has(item.row.attendance_date));
    const presentDays = new Set(workdayRows.filter((item) => item.metrics.isPresent).map((item) => item.row.attendance_date)).size;
    const absentDays = Math.max(workdays.length - presentDays, 0);
    const lateArrivals = workdayRows.filter((item) => item.metrics.isLateArrival).length;
    const onTimeArrivals = workdayRows.filter((item) => item.metrics.isOnTimeArrival).length;
    const workedMinutes = sumBy(detailedRows, (item) => item.metrics.workedMinutes);
    const overtimeMinutes = sumBy(detailedRows, (item) => item.metrics.overtimeMinutes);
    const shortfallMinutes = sumBy(workdayRows.filter((item) => item.metrics.isPresent), (item) => item.metrics.shortfallMinutes)
      + (absentDays * FULL_SHIFT_MINUTES);
    const expectedMinutes = workdays.length * FULL_SHIFT_MINUTES;
    const averageCheckIn = average(workdayRows.map((item) => item.metrics.checkInMinutes));
    const averageCheckOut = average(detailedRows.map((item) => item.metrics.checkOutMinutes));
    const attendanceRate = workdays.length ? Math.round((presentDays / workdays.length) * 100) : 0;
    const onTimeArrivalRate = presentDays ? Math.round((onTimeArrivals / presentDays) * 100) : 0;

    const employeeReport = {
      employee,
      rows,
      detailedRows,
      presentDays,
      absentDays,
      lateArrivals,
      onTimeArrivals,
      workedMinutes,
      overtimeMinutes,
      shortfallMinutes,
      expectedMinutes,
      attendanceRate,
      onTimeArrivalRate,
      averageCheckIn,
      averageCheckOut,
    };

    return {
      ...employeeReport,
      trend: classifyEmployeeTrend(employeeReport),
    };
  }).sort((left, right) => {
    if (right.attendanceRate !== left.attendanceRate) {
      return right.attendanceRate - left.attendanceRate;
    }
    if (right.onTimeArrivalRate !== left.onTimeArrivalRate) {
      return right.onTimeArrivalRate - left.onTimeArrivalRate;
    }
    return right.workedMinutes - left.workedMinutes;
  });

  const totalExpectedDays = filteredEmployees.length * workdays.length;
  const totalPresentDays = sumBy(byEmployee, (item) => item.presentDays);
  const totalOnTimeArrivals = sumBy(byEmployee, (item) => item.onTimeArrivals);
  const totalHoursWorkedMinutes = sumBy(byEmployee, (item) => item.workedMinutes);
  const totalOvertimeMinutes = sumBy(byEmployee, (item) => item.overtimeMinutes);
  const totalShortfallMinutes = sumBy(byEmployee, (item) => item.shortfallMinutes);
  const attendanceRate = totalExpectedDays ? Math.round((totalPresentDays / totalExpectedDays) * 100) : 0;
  const onTimeArrivalRate = totalPresentDays ? Math.round((totalOnTimeArrivals / totalPresentDays) * 100) : 0;

  const weekdayTotals = workdays
    .map((date) => {
      const isoDate = formatDateInput(date);
      const presentCount = new Set(
        relevantRows
          .filter((row) => row.attendance_date === isoDate && row.check_in_time)
          .map((row) => row.user_id)
      ).size;

      return {
        weekday: date.toLocaleDateString('en-GB', { weekday: 'long' }),
        absentCount: Math.max(filteredEmployees.length - presentCount, 0),
        occurrences: 1,
      };
    })
    .reduce((accumulator, item) => {
      const existing = accumulator.get(item.weekday) || { weekday: item.weekday, absentCount: 0, occurrences: 0 };
      existing.absentCount += item.absentCount;
      existing.occurrences += 1;
      accumulator.set(item.weekday, existing);
      return accumulator;
    }, new Map());

  const weekdayRows = [...weekdayTotals.values()].sort((left, right) => right.absentCount - left.absentCount);
  const dailyTrend = workdays.map((date) => {
    const isoDate = formatDateInput(date);
    const rowsForDate = relevantRows
      .filter((row) => row.attendance_date === isoDate)
      .map((row) => buildAttendanceRowMetrics(row));
    const presentCount = relevantRows.filter((row) => row.attendance_date === isoDate && row.check_in_time).length;

    return {
      label: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      presentCount,
      absentCount: Math.max(filteredEmployees.length - presentCount, 0),
      workedHours: durationToHours(sumBy(rowsForDate, (item) => item.workedMinutes)),
      overtimeHours: durationToHours(sumBy(rowsForDate, (item) => item.overtimeMinutes)),
    };
  });

  const departmentHours = [...byEmployee.reduce((accumulator, item) => {
    const key = departmentLabel(item.employee.department);
    const current = accumulator.get(key) || {
      department: key,
      employeeCount: 0,
      actualMinutes: 0,
      expectedMinutes: 0,
    };
    current.employeeCount += 1;
    current.actualMinutes += item.workedMinutes;
    current.expectedMinutes += item.expectedMinutes;
    accumulator.set(key, current);
    return accumulator;
  }, new Map()).values()]
    .map((item) => ({
      ...item,
      actualHours: durationToHours(item.actualMinutes),
      expectedHours: durationToHours(item.expectedMinutes),
    }))
    .sort((left, right) => right.actualMinutes - left.actualMinutes);

  return {
    range,
    workdays,
    eligibleEmployees,
    filteredEmployees,
    attendanceRows: relevantRows,
    byEmployee,
    weekdayRows,
    topPerformers: byEmployee.slice(0, 5),
    dailyTrend,
    departmentHours,
    selectedEmployeeReport: filters.employeeId === 'all'
      ? null
      : byEmployee.find((item) => item.employee.id === filters.employeeId) || null,
    totals: {
      totalHoursWorkedMinutes,
      totalOvertimeMinutes,
      totalShortfallMinutes,
      totalExpectedMinutes: sumBy(byEmployee, (item) => item.expectedMinutes),
      totalPresentDays,
      totalExpectedDays,
      attendanceRate,
      onTimeArrivalRate,
    },
  };
}

function prepareChartCanvas(canvas, height = 260) {
  const context = canvas?.getContext('2d');
  if (!canvas || !context) {
    return null;
  }

  const width = canvas.clientWidth || 720;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  return {
    context,
    width,
    height,
  };
}

export function drawWorkingHoursTrend(canvas, points) {
  if (!canvas || !points.length) {
    return;
  }

  const prepared = prepareChartCanvas(canvas);
  if (!prepared) {
    return;
  }

  const { context, width, height } = prepared;
  const padding = { top: 26, right: 18, bottom: 44, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...points.map((point) => Math.max(point.workedHours, point.overtimeHours)), 1);
  const stepX = points.length > 1 ? chartWidth / (points.length - 1) : chartWidth;
  const yForValue = (value) => padding.top + chartHeight - ((value / maxValue) * chartHeight);

  context.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  context.lineWidth = 1;
  for (let step = 0; step <= 4; step += 1) {
    const y = padding.top + ((chartHeight / 4) * step);
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();

    const labelValue = Math.round(maxValue - ((maxValue / 4) * step));
    context.fillStyle = 'rgba(237, 242, 247, 0.72)';
    context.font = '12px Inter, sans-serif';
    context.fillText(`${labelValue}h`, 8, y + 4);
  }

  context.fillStyle = 'rgba(59, 130, 246, 0.12)';
  context.beginPath();
  points.forEach((point, index) => {
    const x = padding.left + (stepX * index);
    const y = yForValue(point.workedHours);
    if (index === 0) {
      context.moveTo(x, height - padding.bottom);
      context.lineTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.lineTo(padding.left + (stepX * (points.length - 1)), height - padding.bottom);
  context.closePath();
  context.fill();

  context.beginPath();
  points.forEach((point, index) => {
    const x = padding.left + (stepX * index);
    const y = yForValue(point.workedHours);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.strokeStyle = '#60a5fa';
  context.lineWidth = 3;
  context.stroke();

  context.beginPath();
  points.forEach((point, index) => {
    const x = padding.left + (stepX * index);
    const y = yForValue(point.overtimeHours);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.strokeStyle = 'rgba(191, 219, 254, 0.78)';
  context.setLineDash([6, 4]);
  context.lineWidth = 2;
  context.stroke();
  context.setLineDash([]);

  context.fillStyle = '#dbeafe';
  points.forEach((point, index) => {
    const x = padding.left + (stepX * index);
    const y = yForValue(point.workedHours);
    context.beginPath();
    context.arc(x, y, 4, 0, Math.PI * 2);
    context.fill();

    if (index === 0 || index === points.length - 1 || index % Math.max(Math.round(points.length / 6), 2) === 0) {
      context.fillStyle = 'rgba(237, 242, 247, 0.72)';
      context.font = '12px Inter, sans-serif';
      context.fillText(point.label, x - 18, height - 16);
      context.fillStyle = '#dbeafe';
    }
  });

  context.fillStyle = '#60a5fa';
  context.fillRect(width - 176, 16, 12, 12);
  context.fillStyle = '#dbeafe';
  context.font = '12px Inter, sans-serif';
  context.fillText('Hours Worked', width - 156, 26);
  context.strokeStyle = 'rgba(191, 219, 254, 0.78)';
  context.setLineDash([6, 4]);
  context.beginPath();
  context.moveTo(width - 176, 42);
  context.lineTo(width - 164, 42);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = 'rgba(237, 242, 247, 0.72)';
  context.fillText('Overtime', width - 156, 46);
}

export function drawDepartmentHoursChart(canvas, points) {
  if (!canvas || !points.length) {
    return;
  }

  const prepared = prepareChartCanvas(canvas, 280);
  if (!prepared) {
    return;
  }

  const { context, width, height } = prepared;
  const rows = points.slice(0, 6);
  const padding = { top: 26, right: 18, bottom: 62, left: 52 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...rows.map((item) => Math.max(item.actualHours, item.expectedHours)), 1);
  const groupWidth = chartWidth / Math.max(rows.length, 1);
  const barWidth = Math.min(22, Math.max(10, (groupWidth / 3)));
  const yForValue = (value) => padding.top + chartHeight - ((value / maxValue) * chartHeight);

  context.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  context.lineWidth = 1;
  for (let step = 0; step <= 4; step += 1) {
    const y = padding.top + ((chartHeight / 4) * step);
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();

    const labelValue = Math.round(maxValue - ((maxValue / 4) * step));
    context.fillStyle = 'rgba(237, 242, 247, 0.72)';
    context.font = '12px Inter, sans-serif';
    context.fillText(`${labelValue}h`, 8, y + 4);
  }

  rows.forEach((item, index) => {
    const groupX = padding.left + (groupWidth * index) + (groupWidth / 2);
    const expectedHeight = chartHeight * (item.expectedHours / maxValue);
    const actualHeight = chartHeight * (item.actualHours / maxValue);
    const expectedX = groupX - barWidth - 4;
    const actualX = groupX + 4;
    const expectedY = yForValue(item.expectedHours);
    const actualY = yForValue(item.actualHours);
    const shortLabel = item.department.length > 11 ? `${item.department.slice(0, 11)}...` : item.department;

    context.fillStyle = 'rgba(148, 163, 184, 0.45)';
    context.fillRect(expectedX, expectedY, barWidth, expectedHeight);

    context.fillStyle = '#3b82f6';
    context.fillRect(actualX, actualY, barWidth, actualHeight);

    context.fillStyle = 'rgba(237, 242, 247, 0.72)';
    context.font = '11px Inter, sans-serif';
    context.save();
    context.translate(groupX, height - 22);
    context.rotate(-0.18);
    context.fillText(shortLabel, -20, 0);
    context.restore();
  });

  context.fillStyle = 'rgba(148, 163, 184, 0.45)';
  context.fillRect(width - 178, 16, 12, 12);
  context.fillStyle = '#dbeafe';
  context.font = '12px Inter, sans-serif';
  context.fillText('Expected', width - 158, 26);
  context.fillStyle = '#3b82f6';
  context.fillRect(width - 98, 16, 12, 12);
  context.fillStyle = '#dbeafe';
  context.fillText('Actual', width - 78, 26);
}

