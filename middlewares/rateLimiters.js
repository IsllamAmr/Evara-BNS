const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { createClient } = require('redis');

const REDIS_URL = String(process.env.REDIS_URL || '').trim();
const REDIS_PREFIX = String(process.env.RATE_LIMIT_REDIS_PREFIX || 'evara:rate-limit:').trim() || 'evara:rate-limit:';
const REDIS_ENABLED = /^(1|true|yes)$/i.test(String(process.env.RATE_LIMIT_REDIS_ENABLED || '').trim());
const IPV6_SUBNET = Number.parseInt(process.env.RATE_LIMIT_IPV6_SUBNET || '56', 10);

let redisStore = null;
let redisClient = null;
let redisUnavailable = false;

function resolveIpv6Subnet() {
  if (Number.isInteger(IPV6_SUBNET) && IPV6_SUBNET >= 32 && IPV6_SUBNET <= 64) {
    return IPV6_SUBNET;
  }

  return 56;
}

function initializeRedisStore() {
  if (!REDIS_ENABLED || !REDIS_URL || redisUnavailable) {
    return null;
  }

  if (redisStore) {
    return redisStore;
  }

  try {
    redisClient = createClient({ url: REDIS_URL });

    redisClient.on('error', (error) => {
      console.error('Redis rate limiter error:', error.message);
    });

    redisClient.connect()
      .then(() => {
        console.log('Redis rate limiter connected');
      })
      .catch((error) => {
        redisUnavailable = true;
        console.error('Redis rate limiter connection failed, falling back to in-memory limiter:', error.message);
      });

    redisStore = new RedisStore({
      sendCommand: (...command) => redisClient.sendCommand(command),
      prefix: REDIS_PREFIX,
    });

    return redisStore;
  } catch (error) {
    redisUnavailable = true;
    console.error('Unable to initialize Redis rate limiter, falling back to in-memory limiter:', error.message);
    return null;
  }
}

const sharedStore = initializeRedisStore();

// Attendance only works from the office network, so everyone in the office shares one
// public IP. Per-IP limits therefore pooled the whole office into one quota and locked
// everybody out at 9:00. Limits are now per signed-in user (falling back to the IP for
// anonymous requests), plus one generous per-IP ceiling against floods.
// The name keeps each limiter's counters separate when they share a Redis store.
function buildLimiter({ name, windowMs, max, message, perUser = true }) {
  const limiterOptions = {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (perUser && req.user?.id
      ? `${name}:user:${req.user.id}`
      : `${name}:ip:${ipKeyGenerator(req.ip || '', resolveIpv6Subnet())}`),
    message: {
      success: false,
      message,
    },
  };

  if (sharedStore) {
    limiterOptions.store = sharedStore;
  }

  return rateLimit(limiterOptions);
}

const baseWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;

// Whole office behind one IP: a ceiling for flooding, not for normal use.
const apiLimiter = buildLimiter({
  name: 'api-ip',
  perUser: false,
  windowMs: baseWindowMs,
  max: Number(process.env.RATE_LIMIT_IP_MAX) || 2000,
  message: 'Too many requests. Please try again later.',
});

// Each signed-in person's own budget (applied by `protect` once the user is known).
const userApiLimiter = buildLimiter({
  name: 'api-user',
  windowMs: baseWindowMs,
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS || process.env.RATE_LIMIT_MAX) || 200,
  message: 'Too many requests. Please try again later.',
});

const adminWriteLimiter = buildLimiter({
  name: 'admin-write',
  windowMs: baseWindowMs,
  max: Number(process.env.ADMIN_RATE_LIMIT_MAX || 80),
  message: 'Too many admin actions. Please wait and try again.',
});

const employeeCreationLimiter = buildLimiter({
  name: 'employee-create',
  windowMs: 60 * 1000, // 1 minute window
  max: 5, // Max 5 employee creations per minute
  message: 'Too many employee creations. Please wait 1 minute and try again.',
});

const attendanceActionLimiter = buildLimiter({
  name: 'attendance',
  windowMs: Number(process.env.ATTENDANCE_RATE_LIMIT_WINDOW_MS) || 5 * 60 * 1000,
  max: Number(process.env.ATTENDANCE_RATE_LIMIT_MAX || 30),
  message: 'Too many attendance requests. Please slow down.',
});

const passwordChangeLimiter = buildLimiter({
  name: 'password-change',
  windowMs: Number(process.env.PASSWORD_CHANGE_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.PASSWORD_CHANGE_RATE_LIMIT_MAX || 8),
  message: 'Too many password change attempts. Please wait and try again.',
});

function rateLimitBackend() {
  return sharedStore ? 'redis' : 'memory';
}

module.exports = {
  adminWriteLimiter,
  apiLimiter,
  attendanceActionLimiter,
  employeeCreationLimiter,
  passwordChangeLimiter,
  rateLimitBackend,
  userApiLimiter,
};
