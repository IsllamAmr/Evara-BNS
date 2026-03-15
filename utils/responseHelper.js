function sendSuccess(res, payload = {}, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    ...payload,
  });
}

function sendError(res, message, statusCode = 400, extra = {}) {
  return res.status(statusCode).json({
    success: false,
    message,
    ...extra,
  });
}

module.exports = {
  sendError,
  sendSuccess,
};
