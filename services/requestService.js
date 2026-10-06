const { AppError } = require('../middlewares/errorMiddleware');
const { getSupabaseAdmin } = require('../config/supabase');

const REQUEST_TYPES = new Set(['late_2_hours', 'annual_leave', 'work_from_home']);
const REQUEST_STATUSES = new Set(['pending', 'approved', 'rejected', 'cancelled']);
const REVIEWABLE_STATUSES = new Set(['approved', 'rejected', 'cancelled']);
const QUOTA_ACTIVE_STATUSES = ['pending', 'approved'];

const MONTHLY_LATE_2_HOURS_LIMIT = 2;
const ANNUAL_LEAVE_DAYS_LIMIT = 21;
const DAY_MS = 24 * 60 * 60 * 1000;
const BUSINESS_TIME_ZONE = 'Africa/Cairo';

function businessToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function parseClockTime(value, fieldName) {
  const normalized = normalizeText(value);
  const match = normalized.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) {
    throw new AppError(`${fieldName} must be a time in HH:MM format`, 422);
  }
  return `${match[1]}:${match[2]}`;
}

// Work from home is a note: no quota and no approval step. It is stored as approved
// so it reaches the timesheet Excel at once; an admin can reject it to remove it.
async function createWorkFromHomeNote(payload, targetUserId, employee) {
  const workDate = parseDateOnly(payload.work_date, 'work_date', { required: true });
  if (workDate > businessToday()) {
    throw new AppError('Work from home can only be noted for today or a past day', 422);
  }
  const workStart = parseClockTime(payload.work_start, 'work_start');
  const workEnd = parseClockTime(payload.work_end, 'work_end');
  if (workEnd <= workStart) {
    throw new AppError('The end time must be after the start time', 422);
  }

  const { data, error } = await getSupabaseAdmin()
    .from('employee_requests')
    .insert({
      user_id: targetUserId,
      request_type: 'work_from_home',
      status: 'approved',
      work_date: workDate,
      work_start: workStart,
      work_end: workEnd,
      reason: normalizeOptionalText(payload.reason),
    })
    .select('*')
    .single();

  if (error) {
    const mapped = mapRequestMutationError(error, 'Unable to save the work from home note');
    throw new AppError(mapped.message, mapped.statusCode);
  }

  return {
    employee,
    request: data,
    allowance: await buildAllowanceSummaryForUser(targetUserId),
  };
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function parseRequestId(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError('request id must be a positive integer', 422);
  }

  return parsed;
}

function parseDateOnly(value, fieldName, { required = false } = {}) {
  const normalized = normalizeText(value);

  if (!normalized) {
    if (required) {
      throw new AppError(`${fieldName} is required`, 422);
    }

    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new AppError(`${fieldName} must be a valid date in YYYY-MM-DD format`, 422);
  }

  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`${fieldName} must be a valid date`, 422);
  }

  return normalized;
}

function formatDateOnlyUtc(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toISOString().slice(0, 10);
}

function monthRangeFromDate(dateOnly) {
  const [yearText, monthText] = String(dateOnly).split('-');
  const year = Number(yearText);
  const month = Number(monthText);

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));

  return {
    year,
    month,
    from: formatDateOnlyUtc(start),
    to: formatDateOnlyUtc(end),
  };
}

function yearRange(year) {
  return {
    from: `${year}-01-01`,
    to: `${year}-12-31`,
  };
}

function inclusiveDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const diff = end.getTime() - start.getTime();
  return Math.floor(diff / DAY_MS) + 1;
}

function ensureRequestType(type) {
  if (!REQUEST_TYPES.has(type)) {
    throw new AppError('request_type is invalid', 422);
  }
}

function ensureStatus(status) {
  if (!REQUEST_STATUSES.has(status)) {
    throw new AppError('status is invalid', 422);
  }
}

function ensureReviewableStatus(status) {
  if (!REVIEWABLE_STATUSES.has(status)) {
    throw new AppError('status must be approved, rejected, or cancelled', 422);
  }
}

async function assertEmployeeProfile(userId) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, employee_code, role, is_active')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new AppError(error.message, 500);
  }

  if (!data) {
    throw new AppError('Employee not found', 404);
  }

  if (data.role !== 'employee') {
    throw new AppError('Requests can only be created for employee accounts', 422);
  }

  if (!data.is_active) {
    throw new AppError('Inactive employees cannot submit requests', 422);
  }

  return data;
}

function resolveTargetUserId(actorProfile, payloadUserId) {
  const requestedUserId = normalizeText(payloadUserId);

  if (actorProfile?.role === 'admin' && requestedUserId) {
    return requestedUserId;
  }

  return actorProfile.id;
}

async function countLateRequestsForMonth({ userId, lateDate, excludeRequestId = null, statuses = QUOTA_ACTIVE_STATUSES }) {
  const supabaseAdmin = getSupabaseAdmin();
  const range = monthRangeFromDate(lateDate);

  let query = supabaseAdmin
    .from('employee_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('request_type', 'late_2_hours')
    .gte('late_date', range.from)
    .lte('late_date', range.to)
    .in('status', statuses);

  if (excludeRequestId) {
    query = query.neq('id', excludeRequestId);
  }

  const { count, error } = await query;

  if (error) {
    throw new AppError(error.message, 500);
  }

  return {
    count: count || 0,
    year: range.year,
    month: range.month,
    from: range.from,
    to: range.to,
  };
}

async function sumAnnualLeaveDaysForYear({ userId, year, excludeRequestId = null, statuses = QUOTA_ACTIVE_STATUSES }) {
  const supabaseAdmin = getSupabaseAdmin();
  const range = yearRange(year);

  let query = supabaseAdmin
    .from('employee_requests')
    .select('leave_days')
    .eq('user_id', userId)
    .eq('request_type', 'annual_leave')
    .gte('leave_start_date', range.from)
    .lte('leave_start_date', range.to)
    .in('status', statuses);

  if (excludeRequestId) {
    query = query.neq('id', excludeRequestId);
  }

  const { data, error } = await query;

  if (error) {
    throw new AppError(error.message, 500);
  }

  const usedDays = (data || []).reduce((sum, row) => sum + Number(row.leave_days || 0), 0);

  return {
    usedDays,
    from: range.from,
    to: range.to,
  };
}

async function buildAllowanceSummaryForUser(userId, referenceDate = formatDateOnlyUtc(new Date())) {
  const lateDate = parseDateOnly(referenceDate, 'reference_date', { required: true });
  const { count: lateUsed, year, month } = await countLateRequestsForMonth({ userId, lateDate });
  const { usedDays: leaveUsed } = await sumAnnualLeaveDaysForYear({ userId, year });

  return {
    user_id: userId,
    reference_month: `${String(year)}-${String(month).padStart(2, '0')}`,
    reference_year: year,
    late_2_hours: {
      limit: MONTHLY_LATE_2_HOURS_LIMIT,
      used: lateUsed,
      remaining: Math.max(MONTHLY_LATE_2_HOURS_LIMIT - lateUsed, 0),
    },
    annual_leave_days: {
      limit: ANNUAL_LEAVE_DAYS_LIMIT,
      used: leaveUsed,
      remaining: Math.max(ANNUAL_LEAVE_DAYS_LIMIT - leaveUsed, 0),
    },
  };
}

function mapDuplicateLateDayError(error) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();

  if (
    message.includes('idx_employee_requests_unique_late_day')
    || details.includes('idx_employee_requests_unique_late_day')
    || hint.includes('idx_employee_requests_unique_late_day')
  ) {
    return 'A two-hour delay request already exists for this employee on the selected date';
  }

  return error?.message || 'Unable to save request';
}

function mapRequestMutationError(error, fallbackMessage = 'Unable to save request') {
  const message = mapDuplicateLateDayError(error);
  const normalized = String(message || '').toLowerCase();

  if (normalized.includes('request not found')) {
    return { message, statusCode: 404 };
  }

  if (
    normalized.includes('limit')
    || normalized.includes('required')
    || normalized.includes('invalid')
    || normalized.includes('cannot')
    || normalized.includes('span multiple')
    || normalized.includes('already exists')
    || normalized.includes('employee')
  ) {
    return { message, statusCode: 422 };
  }

  return {
    message: message || fallbackMessage,
    statusCode: 400,
  };
}

async function createRequest(payload, actorProfile) {
  const supabaseAdmin = getSupabaseAdmin();
  const requestType = normalizeText(payload.request_type);
  ensureRequestType(requestType);

  const targetUserId = resolveTargetUserId(actorProfile, payload.user_id);
  const employee = await assertEmployeeProfile(targetUserId);
  if (requestType === 'work_from_home') {
    return createWorkFromHomeNote(payload, targetUserId, employee);
  }
  const reason = normalizeOptionalText(payload.reason);
  let lateDate = null;
  let leaveStartDate = null;
  let leaveEndDate = null;

  if (requestType === 'late_2_hours') {
    lateDate = parseDateOnly(payload.late_date, 'late_date', { required: true });
  }

  if (requestType === 'annual_leave') {
    leaveStartDate = parseDateOnly(payload.leave_start_date, 'leave_start_date', { required: true });
    leaveEndDate = parseDateOnly(payload.leave_end_date, 'leave_end_date', { required: true });

    if (leaveEndDate < leaveStartDate) {
      throw new AppError('leave_end_date must be on or after leave_start_date', 422);
    }

    const leaveStartYear = Number(leaveStartDate.slice(0, 4));
    const leaveEndYear = Number(leaveEndDate.slice(0, 4));
    if (leaveStartYear !== leaveEndYear) {
      throw new AppError('Annual leave request cannot span multiple calendar years', 422);
    }

    if (inclusiveDays(leaveStartDate, leaveEndDate) <= 0) {
      throw new AppError('leave_days must be greater than zero', 422);
    }
  }

  const { data, error } = await supabaseAdmin
    .rpc('create_employee_request_atomic', {
      p_target_user_id: targetUserId,
      p_request_type: requestType,
      p_reason: reason,
      p_late_date: lateDate,
      p_leave_start_date: leaveStartDate,
      p_leave_end_date: leaveEndDate,
    })
    .single();

  if (error) {
    const mapped = mapRequestMutationError(error, 'Unable to save request');
    throw new AppError(mapped.message, mapped.statusCode);
  }

  const allowance = await buildAllowanceSummaryForUser(targetUserId);

  return {
    employee,
    request: data,
    allowance,
  };
}

async function listRequests(actorProfile, filters = {}) {
  const supabaseAdmin = getSupabaseAdmin();

  const filterType = normalizeText(filters.type || 'all');
  const filterStatus = normalizeText(filters.status || 'all');
  const filterUserId = normalizeText(filters.user_id);

  if (filterType !== 'all') {
    ensureRequestType(filterType);
  }

  if (filterStatus !== 'all') {
    ensureStatus(filterStatus);
  }

  let query = supabaseAdmin
    .from('employee_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (actorProfile?.role === 'admin') {
    if (filterUserId) {
      query = query.eq('user_id', filterUserId);
    }
  } else {
    query = query.eq('user_id', actorProfile.id);
  }

  if (filterType !== 'all') {
    query = query.eq('request_type', filterType);
  }

  if (filterStatus !== 'all') {
    query = query.eq('status', filterStatus);
  }

  const { data, error } = await query;

  if (error) {
    throw new AppError(error.message, 500);
  }

  return data || [];
}

async function getAllowanceSummary(actorProfile, query = {}) {
  const requestedUserId = normalizeText(query.user_id);

  if (requestedUserId && actorProfile?.role !== 'admin' && requestedUserId !== actorProfile.id) {
    throw new AppError('You are not allowed to view another employee allowance', 403);
  }

  const targetUserId = requestedUserId || actorProfile.id;
  await assertEmployeeProfile(targetUserId);

  const referenceDate = parseDateOnly(query.reference_date, 'reference_date') || formatDateOnlyUtc(new Date());
  return buildAllowanceSummaryForUser(targetUserId, referenceDate);
}

async function updateRequestStatus(id, payload, actorProfile) {
  if (actorProfile?.role !== 'admin') {
    throw new AppError('Only admins can update request status', 403);
  }

  const supabaseAdmin = getSupabaseAdmin();
  const requestId = parseRequestId(id);
  const nextStatus = normalizeText(payload.status);
  const adminNote = normalizeOptionalText(payload.admin_note);

  ensureReviewableStatus(nextStatus);

  const { data, error } = await supabaseAdmin
    .rpc('update_employee_request_status_atomic', {
      p_request_id: requestId,
      p_next_status: nextStatus,
      p_admin_note: adminNote,
      p_reviewed_by: actorProfile.id,
    })
    .single();

  if (error) {
    const mapped = mapRequestMutationError(error, 'Unable to update request status');
    throw new AppError(mapped.message, mapped.statusCode);
  }

  const allowance = await buildAllowanceSummaryForUser(data.user_id);

  return {
    request: data,
    allowance,
  };
}

module.exports = {
  createRequest,
  getAllowanceSummary,
  listRequests,
  updateRequestStatus,
};
