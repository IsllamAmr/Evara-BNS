const { AppError } = require('../middlewares/errorMiddleware');
const { getSupabaseAdmin } = require('../config/supabase');

const ALLOWED_REQUEST_TYPES = new Set(['annual_leave', 'sick_leave', 'unpaid_leave', 'permission']);
const ALLOWED_SCOPES = new Set(['full_day', 'partial_day']);
const REVIEW_STATUSES = new Set(['approved', 'rejected']);

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeDate(value, fieldName) {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new AppError(`${fieldName} is required`, 422);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new AppError(`${fieldName} must be a valid date`, 422);
  }

  return normalized;
}

function normalizeTime(value, fieldName, required = false) {
  const normalized = normalizeText(value);
  if (!normalized) {
    if (required) {
      throw new AppError(`${fieldName} is required`, 422);
    }

    return null;
  }

  if (!/^\d{2}:\d{2}$/.test(normalized)) {
    throw new AppError(`${fieldName} must be a valid time`, 422);
  }

  return normalized;
}

function validatePayload(payload) {
  const requestType = normalizeText(payload.request_type);
  const requestScope = normalizeText(payload.request_scope || 'full_day');
  const startDate = normalizeDate(payload.start_date, 'start_date');
  const endDate = normalizeDate(payload.end_date || payload.start_date, 'end_date');
  const reason = normalizeText(payload.reason);
  const startTime = normalizeTime(payload.start_time, 'start_time', requestScope === 'partial_day');
  const endTime = normalizeTime(payload.end_time, 'end_time', requestScope === 'partial_day');

  if (!ALLOWED_REQUEST_TYPES.has(requestType)) {
    throw new AppError('request_type is invalid', 422);
  }

  if (!ALLOWED_SCOPES.has(requestScope)) {
    throw new AppError('request_scope is invalid', 422);
  }

  if (!reason) {
    throw new AppError('reason is required', 422);
  }

  if (endDate < startDate) {
    throw new AppError('end_date must be the same as or later than start_date', 422);
  }

  if (requestScope === 'partial_day') {
    if (startDate !== endDate) {
      throw new AppError('partial_day requests must start and end on the same date', 422);
    }

    if (endTime <= startTime) {
      throw new AppError('end_time must be later than start_time', 422);
    }
  }

  if (requestType === 'permission' && requestScope !== 'partial_day') {
    throw new AppError('permission requests must use partial_day scope', 422);
  }

  return {
    request_type: requestType,
    request_scope: requestScope,
    start_date: startDate,
    end_date: endDate,
    start_time: requestScope === 'partial_day' ? startTime : null,
    end_time: requestScope === 'partial_day' ? endTime : null,
    reason,
  };
}

function selectLeaveRequestColumns(query) {
  return query.select(`
    *,
    requester:profiles!leave_requests_user_id_fkey (
      id,
      full_name,
      employee_code,
      department,
      position,
      email
    ),
    reviewer:profiles!leave_requests_reviewed_by_fkey (
      id,
      full_name
    )
  `);
}

async function assertNoOverlap(userId, requestData, excludeId = null) {
  const supabaseAdmin = getSupabaseAdmin();
  let query = supabaseAdmin
    .from('leave_requests')
    .select('id')
    .eq('user_id', userId)
    .in('status', ['pending', 'approved'])
    .lte('start_date', requestData.end_date)
    .gte('end_date', requestData.start_date);

  if (excludeId) {
    query = query.neq('id', excludeId);
  }

  const { data, error } = await query.limit(1);
  if (error) {
    throw new AppError(error.message, 500);
  }

  if ((data || []).length > 0) {
    throw new AppError('There is already a pending or approved leave request overlapping this period', 409);
  }
}

async function fetchRequestById(requestId) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await selectLeaveRequestColumns(
    supabaseAdmin.from('leave_requests')
  )
    .eq('id', requestId)
    .maybeSingle();

  if (error) {
    throw new AppError(error.message, 500);
  }

  return data;
}

async function listLeaveRequests(actorProfile, filters = {}) {
  const supabaseAdmin = getSupabaseAdmin();
  let query = selectLeaveRequestColumns(
    supabaseAdmin.from('leave_requests')
  ).order('created_at', { ascending: false });

  if (actorProfile.role !== 'admin') {
    query = query.eq('user_id', actorProfile.id);
  } else if (filters.user_id) {
    query = query.eq('user_id', normalizeText(filters.user_id));
  }

  if (filters.status && filters.status !== 'all') {
    query = query.eq('status', normalizeText(filters.status));
  }

  if (filters.request_type && filters.request_type !== 'all') {
    query = query.eq('request_type', normalizeText(filters.request_type));
  }

  if (filters.from) {
    query = query.gte('end_date', normalizeText(filters.from));
  }

  if (filters.to) {
    query = query.lte('start_date', normalizeText(filters.to));
  }

  const { data, error } = await query;
  if (error) {
    throw new AppError(error.message, 500);
  }

  return data || [];
}

async function createLeaveRequest(payload, actorProfile) {
  const supabaseAdmin = getSupabaseAdmin();
  const requestData = validatePayload(payload);

  await assertNoOverlap(actorProfile.id, requestData);

  const insertPayload = {
    user_id: actorProfile.id,
    ...requestData,
    status: 'pending',
    admin_note: null,
    reviewed_by: null,
    reviewed_at: null,
  };

  const { data, error } = await selectLeaveRequestColumns(
    supabaseAdmin
      .from('leave_requests')
      .insert(insertPayload)
  ).single();

  if (error) {
    throw new AppError(error.message, 400);
  }

  return data;
}

async function reviewLeaveRequest(requestId, payload, actorProfile) {
  if (actorProfile.role !== 'admin') {
    throw new AppError('Only admins can review leave requests', 403);
  }

  const status = normalizeText(payload.status);
  if (!REVIEW_STATUSES.has(status)) {
    throw new AppError('status must be approved or rejected', 422);
  }

  const existingRequest = await fetchRequestById(requestId);
  if (!existingRequest) {
    throw new AppError('Leave request not found', 404);
  }

  if (existingRequest.status !== 'pending') {
    throw new AppError('Only pending leave requests can be reviewed', 400);
  }

  const note = normalizeOptionalText(payload.admin_note);
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await selectLeaveRequestColumns(
    supabaseAdmin
      .from('leave_requests')
      .update({
        status,
        admin_note: note,
        reviewed_by: actorProfile.id,
        reviewed_at: new Date().toISOString(),
      })
  )
    .eq('id', requestId)
    .single();

  if (error) {
    throw new AppError(error.message, 400);
  }

  return data;
}

async function cancelLeaveRequest(requestId, actorProfile) {
  const existingRequest = await fetchRequestById(requestId);
  if (!existingRequest) {
    throw new AppError('Leave request not found', 404);
  }

  if (actorProfile.role !== 'admin' && existingRequest.user_id !== actorProfile.id) {
    throw new AppError('You are not allowed to cancel this leave request', 403);
  }

  if (existingRequest.status !== 'pending') {
    throw new AppError('Only pending leave requests can be cancelled', 400);
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await selectLeaveRequestColumns(
    supabaseAdmin
      .from('leave_requests')
      .update({
        status: 'cancelled',
        reviewed_by: actorProfile.role === 'admin' ? actorProfile.id : null,
        reviewed_at: actorProfile.role === 'admin' ? new Date().toISOString() : null,
      })
  )
    .eq('id', requestId)
    .single();

  if (error) {
    throw new AppError(error.message, 400);
  }

  return data;
}

module.exports = {
  cancelLeaveRequest,
  createLeaveRequest,
  listLeaveRequests,
  reviewLeaveRequest,
};
