const { AppError } = require('../middlewares/errorMiddleware');

const ACCESS_MODE = String(process.env.ATTENDANCE_ACCESS_MODE || 'off').trim().toLowerCase();
const ALLOWED_IPS = String(process.env.ATTENDANCE_ALLOWED_IPS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const ALLOWED_IP_PREFIXES = String(process.env.ATTENDANCE_ALLOWED_IP_PREFIXES || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const ALLOWED_CIDRS = String(process.env.ATTENDANCE_ALLOWED_CIDRS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const GEOFENCE_LAT = Number(process.env.ATTENDANCE_GEOFENCE_LAT || '');
const GEOFENCE_LNG = Number(process.env.ATTENDANCE_GEOFENCE_LNG || '');
const GEOFENCE_RADIUS_METERS = Number(process.env.ATTENDANCE_GEOFENCE_RADIUS_METERS || 0);

function normalizeIp(ipAddress) {
  if (!ipAddress) {
    return '';
  }

  if (ipAddress === '::1') {
    return '127.0.0.1';
  }

  return String(ipAddress).replace(/^::ffff:/, '').trim();
}

function ipv4ToInt(ipAddress) {
  const octets = String(ipAddress).split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return (((octets[0] * 256) + octets[1]) * 256 + octets[2]) * 256 + octets[3];
}

function matchesCidr(ipAddress, cidr) {
  const [base, maskText] = String(cidr).split('/');
  const ipInt = ipv4ToInt(ipAddress);
  const baseInt = ipv4ToInt(base);
  const maskSize = Number(maskText);

  if (ipInt === null || baseInt === null || !Number.isInteger(maskSize) || maskSize < 0 || maskSize > 32) {
    return false;
  }

  const mask = maskSize === 0 ? 0 : (~0 << (32 - maskSize)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function isIpAllowed(ipAddress) {
  const normalizedIp = normalizeIp(ipAddress);
  if (!normalizedIp) {
    return false;
  }

  if (ALLOWED_IPS.includes(normalizedIp)) {
    return true;
  }

  if (ALLOWED_IP_PREFIXES.some((prefix) => normalizedIp.startsWith(prefix))) {
    return true;
  }

  if (ALLOWED_CIDRS.some((cidr) => matchesCidr(normalizedIp, cidr))) {
    return true;
  }

  return false;
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function distanceInMeters(latA, lngA, latB, lngB) {
  const earthRadius = 6371000;
  const latDistance = toRadians(latB - latA);
  const lngDistance = toRadians(lngB - lngA);
  const a = Math.sin(latDistance / 2) ** 2
    + Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(lngDistance / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function isGeoFenceConfigured() {
  return Number.isFinite(GEOFENCE_LAT)
    && Number.isFinite(GEOFENCE_LNG)
    && Number.isFinite(GEOFENCE_RADIUS_METERS)
    && GEOFENCE_RADIUS_METERS > 0;
}

function isLocationAllowed(latitude, longitude) {
  if (!isGeoFenceConfigured()) {
    return false;
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }

  // Validate coordinate ranges to prevent edge case calculations
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return false;
  }

  return distanceInMeters(latitude, longitude, GEOFENCE_LAT, GEOFENCE_LNG) <= GEOFENCE_RADIUS_METERS;
}

function attendanceRestrictionSummary() {
  return {
    access_mode: ACCESS_MODE,
    ip_restrictions_enabled: ALLOWED_IPS.length > 0 || ALLOWED_IP_PREFIXES.length > 0 || ALLOWED_CIDRS.length > 0,
    geofence_enabled: isGeoFenceConfigured(),
  };
}

function validateAttendanceAccess({ ipAddress, latitude, longitude }) {
  const ipAllowed = isIpAllowed(ipAddress);
  const geoAllowed = isLocationAllowed(latitude, longitude);
  const hasGeoAttempt = Number.isFinite(latitude) && Number.isFinite(longitude);

  if (ACCESS_MODE === 'off' || !ACCESS_MODE) {
    return attendanceRestrictionSummary();
  }

  if (ACCESS_MODE === 'ip') {
    if (!ipAllowed) {
      throw new AppError('Attendance is only allowed from the approved company network', 403);
    }
    return attendanceRestrictionSummary();
  }

  if (ACCESS_MODE === 'geo') {
    if (!isGeoFenceConfigured()) {
      throw new AppError('Attendance geofence is not configured on the server', 500);
    }
    if (!hasGeoAttempt) {
      throw new AppError('Location permission is required to record attendance', 403);
    }
    if (!geoAllowed) {
      throw new AppError('You are outside the approved attendance location boundary', 403);
    }
    return attendanceRestrictionSummary();
  }

  if (ACCESS_MODE === 'either') {
    if (!ipAllowed && !geoAllowed) {
      throw new AppError('Attendance requires either the approved company network or the approved location boundary', 403);
    }
    return attendanceRestrictionSummary();
  }

  if (ACCESS_MODE === 'both') {
    if (!ipAllowed) {
      throw new AppError('Attendance requires the approved company network', 403);
    }
    if (!isGeoFenceConfigured()) {
      throw new AppError('Attendance geofence is not configured on the server', 500);
    }
    if (!hasGeoAttempt) {
      throw new AppError('Location permission is required to record attendance', 403);
    }
    if (!geoAllowed) {
      throw new AppError('You are outside the approved attendance location boundary', 403);
    }
    return attendanceRestrictionSummary();
  }

  throw new AppError(`Unsupported attendance access mode: ${ACCESS_MODE}`, 500);
}

function buildDeviceInfo(req) {
  const agent = req.headers['user-agent'] || 'unknown-device';
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  const accuracy = Number(req.body?.accuracy);
  const parts = [agent];

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const geoSummary = `geo:${latitude.toFixed(6)},${longitude.toFixed(6)}${Number.isFinite(accuracy) ? ` +/-${Math.round(accuracy)}m` : ''}`;
    parts.push(geoSummary);
  }

  return parts.join(' | ');
}

function extractAttendanceContext(req) {
  return {
    ipAddress: normalizeIp(req.ip || req.headers['x-forwarded-for'] || ''),
    latitude: Number(req.body?.latitude),
    longitude: Number(req.body?.longitude),
    accuracy: Number(req.body?.accuracy),
  };
}

module.exports = {
  attendanceRestrictionSummary,
  buildDeviceInfo,
  extractAttendanceContext,
  validateAttendanceAccess,
};
