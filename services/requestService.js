const { AppError } = require('../middlewares/errorMiddleware');
const { getSupabaseAdmin } = require('../config/supabase');

const REQUEST_TYPES = new Set(['late_2_hours', 'annual_leave']);
const REQUEST_STATUSES = new Set(['pending', 'approved', 'rejected', 'cancelled']);
const REVIEWABLE_STATUSES = new Set(['approved', 'rejected', 'cancelled']);
const QUOTA_ACTIVE_STATUSES = ['pending', 'approved'];

const MONTHLY_LATE_2_HOURS_LIMIT = 2;
const ANNUAL_LEAVE_DAYS_LIMIT = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function shouldFallbackToLegacyRequestMutation(error, rpcName) {
  const normalizedMessage = String(error?.message || '').toLowerCase();
  const normalizedDetails = String(error?.details || '').toLowerCase();
  const rpcLower = String(rpcName || '').toLowerCase();

  const missingFunction = (
    normalizedMessage.includes('could not find the function')
    && (normalizedMessage.includes(rpcLower) || normalizedDetails.includes(rpcLower))
  );

  const permissionDenied = (
    normalizedMessage.includes('permission denied')
    && (normalizedMessage.includes(rpcLower) || normalizedDetails.includes(rpcLower))
  );

  return missingFunction || permissionDenied;
}

async function createRequestLegacy({
  targetUserId,
  requestType,
  reason,
  lateDate,
  leaveStartDate,
  leaveEndDate,
}) {
  const supabaseAdmin = getSupabaseAdmin();

  if (requestType === 'late_2_hours') {
    const lateUsage = await countLateRequestsForMonth({ userId: targetUserId, lateDate });
    if (lateUsage.count >= MONTHLY_LATE_2_HOURS_LIMIT) {
      throw new AppError('Monthly limit reached: each employee can submit only 2 two-hour delay requests per month', 422);
    }
  }

  let leaveDays = null;
  if (requestType === 'annual_leave') {
    leaveDays = inclusiveDays(leaveStartDate, leaveEndDate);
    const leaveYear = Number(leaveStartDate.slice(0, 4));
    const leaveUsage = await sumAnnualLeaveDaysForYear({ userId: targetUserId, year: leaveYear });
    if ((leaveUsage.usedDays + leaveDays) > ANNUAL_LEAVE_DAYS_LIMIT) {
      throw new AppError('Annual leave limit exceeded: each employee can request up to 21 days per year', 422);
    }
  }

  const insertPayload = {
    user_id: targetUserId,
    request_type: requestType,
    status: 'pending',
    late_date: requestType === 'late_2_hours' ? lateDate : null,
    leave_start_date: requestType === 'annual_leave' ? leaveStartDate : null,
    leave_end_date: requestType === 'annual_leave' ? leaveEndDate : null,
    leave_days: requestType === 'annual_leave' ? leaveDays : null,
    reason,
  };

  const { data, error } = await supabaseAdmin
    .from('employee_requests')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error) {
    const mapped = mapRequestMutationError(error, 'Unable to save request');
    throw new AppError(mapped.message, mapped.statusCode);
  }

  return data;
}

async function updateRequestStatusLegacy({
  requestId,
  nextStatus,
  adminNote,
  reviewedBy,
}) {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('employee_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();

  if (existingError) {
    throw new AppError(existingError.message, 500);
  }

  if (!existing) {
    throw new AppError('Request not found', 404);
  }

  if (nextStatus === 'approved' && existing.request_type === 'late_2_hours') {
    const lateDate = formatDateOnlyUtc(existing.late_date);
    const lateUsage = await countLateRequestsForMonth({
      userId: existing.user_id,
      lateDate,
      excludeRequestId: requestId,
    });

    if (lateUsage.count >= MONTHLY_LATE_2_HOURS_LIMIT) {
      throw new AppError('Cannot approve: monthly two-hour delay limit (2) has already been reached', 422);
    }
  }

  if (nextStatus === 'approved' && existing.request_type === 'annual_leave') {
    const leaveYear = Number(formatDateOnlyUtc(existing.leave_start_date).slice(0, 4));
    const leaveUsage = await sumAnnualLeaveDaysForYear({
      userId: existing.user_id,
      year: leaveYear,
      excludeRequestId: requestId,
    });

    if ((leaveUsage.usedDays + Number(existing.leave_days || 0)) > ANNUAL_LEAVE_DAYS_LIMIT) {
      throw new AppError('Cannot approve: annual leave limit (21 days) would be exceeded', 422);
    }
  }

  const { data, error } = await supabaseAdmin
    .from('employee_requests')
    .update({
      status: nextStatus,
      admin_note: adminNote,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .select('*')
    .single();

  if (error) {
    const mapped = mapRequestMutationError(error, 'Unable to update request status');
    throw new AppError(mapped.message, mapped.statusCode);
  }

  return data;
}

async function createRequest(payload, actorProfile) {
  const supabaseAdmin = getSupabaseAdmin();
  const requestType = normalizeText(payload.request_type);
  ensureRequestType(requestType);

  const targetUserId = resolveTargetUserId(actorProfile, payload.user_id);
  const employee = await assertEmployeeProfile(targetUserId);
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

  let requestRow = data;
  if (error && shouldFallbackToLegacyRequestMutation(error, 'create_employee_request_atomic')) {
    console.warn('create_employee_request_atomic RPC unavailable; using legacy non-atomic request creation path');
    requestRow = await createRequestLegacy({
      targetUserId,
      requestType,
      reason,
      lateDate,
      leaveStartDate,
      leaveEndDate,
    });
  } else if (error) {
    const mapped = mapRequestMutationError(error, 'Unable to save request');
    throw new AppError(mapped.message, mapped.statusCode);
  }

  const allowance = await buildAllowanceSummaryForUser(targetUserId);

  return {
    employee,
    request: requestRow,
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

  let requestRow = data;
  if (error && shouldFallbackToLegacyRequestMutation(error, 'update_employee_request_status_atomic')) {
    console.warn('update_employee_request_status_atomic RPC unavailable; using legacy non-atomic status update path');
    requestRow = await updateRequestStatusLegacy({
      requestId,
      nextStatus,
      adminNote,
      reviewedBy: actorProfile.id,
    });
  } else if (error) {
    const mapped = mapRequestMutationError(error, 'Unable to update request status');
    throw new AppError(mapped.message, mapped.statusCode);
  }

  const allowance = await buildAllowanceSummaryForUser(requestRow.user_id);

  return {
    request: requestRow,
    allowance,
  };
}

module.exports = {
  createRequest,
  getAllowanceSummary,
  listRequests,
  updateRequestStatus,
};
