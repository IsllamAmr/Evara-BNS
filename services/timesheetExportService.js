const { AppError } = require('../middlewares/errorMiddleware');
const { getSupabaseAdmin } = require('../config/supabase');
const {
  addDays,
  assertIsoDate,
  buildTimesheetWorkbook,
  businessDateOf,
  daysBetweenInclusive,
  timesheetFileName,
  todayInBusinessZone,
} = require('./timesheetWorkbook');

const MAX_EXPORT_DAYS = 366;
const ATTENDANCE_COLUMNS = 'attendance_date, check_in_time, check_out_time, attendance_status, ip_address, work_notes, work_place, training_minutes';

async function findEmployee(userId) {
  const { data, error } = await getSupabaseAdmin()
    .from('profiles')
    .select('id, full_name, email, employee_code, department, role, created_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);
  if (!data) throw new AppError('Employee not found', 404);
  return data;
}

async function findLastExport(userId) {
  const { data, error } = await getSupabaseAdmin()
    .from('timesheet_exports')
    .select('id, period_from, period_to, exported_at, exported_by')
    .eq('user_id', userId)
    .order('exported_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new AppError(`Export history is unavailable: ${error.message}. Apply migration 010.`, 500);
  }
  return data || null;
}

async function findFirstAttendanceDate(userId) {
  const { data, error } = await getSupabaseAdmin()
    .from('attendance')
    .select('attendance_date')
    .eq('user_id', userId)
    .order('attendance_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);
  return data?.attendance_date || null;
}

/**
 * Default export window: the day after the previous export ended, up to today.
 * The first export starts at the employee's first attendance day (or join date).
 */
async function getExportSummary(userId, now = new Date()) {
  const employee = await findEmployee(userId);
  const lastExport = await findLastExport(userId);
  const today = todayInBusinessZone(now);

  let suggestedFrom;
  if (lastExport) {
    suggestedFrom = addDays(lastExport.period_to, 1);
  } else {
    suggestedFrom = await findFirstAttendanceDate(userId)
      || businessDateOf(employee.created_at)
      || `${today.slice(0, 8)}01`;
  }

  const upToDate = suggestedFrom > today;
  if (upToDate) suggestedFrom = today;
  if (daysBetweenInclusive(suggestedFrom, today) > MAX_EXPORT_DAYS) {
    suggestedFrom = addDays(today, -(MAX_EXPORT_DAYS - 1));
  }

  return {
    employee: { id: employee.id, full_name: employee.full_name, employee_code: employee.employee_code },
    last_export: lastExport,
    suggested_from: suggestedFrom,
    suggested_to: today,
    up_to_date: upToDate,
    max_days: MAX_EXPORT_DAYS,
  };
}

function validateRange(from, to) {
  try {
    assertIsoDate(from, 'from');
    assertIsoDate(to, 'to');
  } catch (error) {
    throw new AppError(error.message, 422);
  }
  if (to < from) throw new AppError('"to" must be on or after "from"', 422);
  if (daysBetweenInclusive(from, to) > MAX_EXPORT_DAYS) {
    throw new AppError(`An export can cover at most ${MAX_EXPORT_DAYS} days`, 422);
  }
}

async function exportTimesheet(userId, { from, to }, actorProfile, now = new Date()) {
  validateRange(from, to);
  const supabaseAdmin = getSupabaseAdmin();
  const employee = await findEmployee(userId);

  const [attendanceResult, requestsResult] = await Promise.all([
    supabaseAdmin
      .from('attendance')
      .select(ATTENDANCE_COLUMNS)
      .eq('user_id', userId)
      .gte('attendance_date', from)
      .lte('attendance_date', to)
      .order('attendance_date', { ascending: true })
      .range(0, MAX_EXPORT_DAYS + 10),
    supabaseAdmin
      .from('employee_requests')
      .select('request_type, status, late_date, leave_start_date, leave_end_date')
      .eq('user_id', userId)
      .eq('status', 'approved'),
  ]);

  if (attendanceResult.error) throw new AppError(attendanceResult.error.message, 500);
  if (requestsResult.error) throw new AppError(requestsResult.error.message, 500);

  const { buffer, segments } = buildTimesheetWorkbook({
    employee,
    records: attendanceResult.data || [],
    requests: (requestsResult.data || []).filter((request) => (
      request.request_type === 'late_2_hours'
        ? request.late_date >= from && request.late_date <= to
        : request.leave_start_date <= to && request.leave_end_date >= from
    )),
    from,
    to,
    now,
  });

  const { error: logError } = await supabaseAdmin.from('timesheet_exports').insert({
    user_id: userId,
    period_from: from,
    period_to: to,
    exported_by: actorProfile?.id || null,
  });
  if (logError) {
    throw new AppError(`Unable to record the export: ${logError.message}. Apply migration 010.`, 500);
  }

  const { error: auditError } = await supabaseAdmin.from('logs').insert({
    user_id: actorProfile?.id || null,
    action: 'timesheet_exported',
    details: JSON.stringify({ target_id: userId, from, to, sheets: segments.length }),
  });
  if (auditError) console.error('Failed to write timesheet export audit log:', auditError.message);

  return {
    buffer,
    fileName: timesheetFileName(employee, from, to),
    segments,
  };
}

module.exports = {
  MAX_EXPORT_DAYS,
  exportTimesheet,
  getExportSummary,
};
