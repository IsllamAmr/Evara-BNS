const { AppError } = require('../middlewares/errorMiddleware');

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

async function checkIn(userScopedSupabase, payload) {
  const { data, error } = await userScopedSupabase.rpc('check_in', payload).single();

  if (error) {
    throw mapRpcError(error, 'Unable to complete check-in');
  }

  return data;
}

async function checkOut(userScopedSupabase, payload) {
  const { data, error } = await userScopedSupabase.rpc('check_out', payload).single();

  if (error) {
    throw mapRpcError(error, 'Unable to complete check-out');
  }

  return data;
}

module.exports = {
  checkIn,
  checkOut,
};

