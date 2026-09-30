const { AppError } = require('../middlewares/errorMiddleware');
const { getSupabaseAdmin } = require('../config/supabase');

function mapRpcError(error, fallbackMessage) {
  if (!error) {
    return new AppError(fallbackMessage, 500);
  }

  const statusCode = error.message && /already/i.test(error.message)
    ? 409
    : error.message && /Authentication required|Inactive accounts/i.test(error.message)
      ? 403
      : 400;

  return new AppError(error.message || fallbackMessage, statusCode);
}

async function checkIn(userId, payload) {
  const { data, error } = await getSupabaseAdmin().rpc('check_in_server', {
    p_user_id: userId,
    ...payload,
  }).single();

  if (error) {
    throw mapRpcError(error, 'Unable to complete check-in');
  }

  return data;
}

async function checkOut(userId, payload) {
  const { data, error } = await getSupabaseAdmin().rpc('check_out_server', {
    p_user_id: userId,
    ...payload,
  }).single();

  if (error) {
    throw mapRpcError(error, 'Unable to complete check-out');
  }

  return data;
}

module.exports = {
  checkIn,
  checkOut,
};

