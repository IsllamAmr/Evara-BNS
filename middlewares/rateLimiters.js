const rateLimit = require('express-rate-limit');

function buildLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message,
    },
  });
}

const baseWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;

const apiLimiter = buildLimiter({
  windowMs: baseWindowMs,
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS || process.env.RATE_LIMIT_MAX) || 200,
  message: 'Too many requests. Please try again later.',
});

const adminWriteLimiter = buildLimiter({
  windowMs: baseWindowMs,
  max: Number(process.env.ADMIN_RATE_LIMIT_MAX || 80),
  message: 'Too many admin actions. Please wait and try again.',
});

const employeeCreationLimiter = buildLimiter({
  windowMs: 60 * 1000, // 1 minute window
  max: 5, // Max 5 employee creations per minute
  message: 'Too many employee creations. Please wait 1 minute and try again.',
});

const attendanceActionLimiter = buildLimiter({
  windowMs: Number(process.env.ATTENDANCE_RATE_LIMIT_WINDOW_MS) || 5 * 60 * 1000,
  max: Number(process.env.ATTENDANCE_RATE_LIMIT_MAX || 30),
  message: 'Too many attendance requests. Please slow down.',
});

const passwordChangeLimiter = buildLimiter({
  windowMs: Number(process.env.PASSWORD_CHANGE_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.PASSWORD_CHANGE_RATE_LIMIT_MAX || 8),
  message: 'Too many password change attempts. Please wait and try again.',
});

module.exports = {
  adminWriteLimiter,
  apiLimiter,
  attendanceActionLimiter,
  employeeCreationLimiter,
  passwordChangeLimiter,
};
