const { AppError } = require('../middlewares/errorMiddleware');
const { getSupabaseAdmin } = require('../config/supabase');

const ALLOWED_STATUSES = new Set(['present', 'absent', 'late', 'checked_out']);

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeIsoValue(value, fieldName) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(`${fieldName} must be a valid ISO date/time`, 422);
  }

  return parsed.toISOString();
}

async function assertEmployeeProfile(userId) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, role, email')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new AppError(error.message, 500);
  }

  if (!data) {
    throw new AppError('Employee not found', 404);
  }

  return data;
}

async function createOrUpdateManualAttendance(payload, actorProfile) {
  const supabaseAdmin = getSupabaseAdmin();
  const userId = normalizeText(payload.user_id);
  const attendanceDate = normalizeText(payload.attendance_date);
  const attendanceStatus = normalizeText(payload.attendance_status || 'present');
  const checkInTime = normalizeIsoValue(payload.check_in_time, 'check_in_time');
  const checkOutTime = normalizeIsoValue(payload.check_out_time, 'check_out_time');

  if (!userId) {
    throw new AppError('user_id is required', 422);
  }

  if (!attendanceDate) {
    throw new AppError('attendance_date is required', 422);
  }

  if (!ALLOWED_STATUSES.has(attendanceStatus)) {
    throw new AppError('attendance_status is invalid', 422);
  }

  if (checkOutTime && !checkInTime) {
    throw new AppError('check_in_time is required before check_out_time', 422);
  }

  if (checkInTime && checkOutTime && new Date(checkOutTime) < new Date(checkInTime)) {
    throw new AppError('check_out_time must be after check_in_time', 422);
  }

  const employee = await assertEmployeeProfile(userId);

  const upsertPayload = {
    user_id: userId,
    attendance_date: attendanceDate,
    check_in_time: checkInTime,
    check_out_time: checkOutTime,
    attendance_status: attendanceStatus,
    ip_address: normalizeOptionalText(payload.ip_address) || 'manual-entry',
    device_info: normalizeOptionalText(payload.device_info) || `Admin manual entry by ${actorProfile.full_name}`,
  };

  const { data, error } = await supabaseAdmin
    .from('attendance')
    .upsert(upsertPayload, { onConflict: 'user_id,attendance_date' })
    .select('*')
    .single();

  if (error) {
    throw new AppError(error.message, 400);
  }

  return {
    employee,
    attendance: data,
  };
}

module.exports = {
  createOrUpdateManualAttendance,
};
