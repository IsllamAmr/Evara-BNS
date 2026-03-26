const { AppError } = require('../middlewares/errorMiddleware');

const ACCESS_MODE = String(process.env.ATTENDANCE_ACCESS_MODE || 'off').trim().toLowerCase();
const GEOFENCE_LAT = Number(process.env.ATTENDANCE_GEOFENCE_LAT || '');
const GEOFENCE_LNG = Number(process.env.ATTENDANCE_GEOFENCE_LNG || '');
const GEOFENCE_RADIUS_METERS = Number(process.env.ATTENDANCE_GEOFENCE_RADIUS_METERS || 0);

function parseCsvEnv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePrefix(prefixValue) {
  const trimmed = String(prefixValue || '').trim().replace(/\*+$/, '');
  if (!trimmed) {
    return '';
  }

  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
}

function isCidrToken(value) {
  return String(value || '').includes('/');
}

function isPrefixToken(value) {
  const token = String(value || '').trim();
  return token.endsWith('.') || token.endsWith('*');
}

function stripIpFormatting(ipAddress) {
  const raw = String(ipAddress || '').trim().replace(/^['"]|['"]$/g, '');
  if (!raw) {
    return '';
  }

  if (raw.startsWith('[')) {
    const closingBracketIndex = raw.indexOf(']');
    if (closingBracketIndex > 0) {
      return raw.slice(1, closingBracketIndex).trim();
    }
  }

  const ipv4WithPortMatch = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPortMatch) {
    return ipv4WithPortMatch[1];
  }

  return raw;
}

function normalizeIp(ipAddress) {
  if (!ipAddress) {
    return '';
  }

  const firstIp = String(ipAddress).split(',')[0];
  const stripped = stripIpFormatting(firstIp);
  if (!stripped) {
    return '';
  }

  if (stripped === '::1') {
    return '127.0.0.1';
  }

  return stripped.replace(/^::ffff:/i, '').trim().toLowerCase();
}

function buildAllowedIpRules() {
  const rawIps = parseCsvEnv(process.env.ATTENDANCE_ALLOWED_IPS);
  const configuredPrefixes = parseCsvEnv(process.env.ATTENDANCE_ALLOWED_IP_PREFIXES)
    .map((item) => normalizePrefix(item))
    .filter(Boolean);
  const configuredCidrs = parseCsvEnv(process.env.ATTENDANCE_ALLOWED_CIDRS);

  const exactIps = [];
  const inlinePrefixes = [];
  const inlineCidrs = [];

  for (const token of rawIps) {
    if (isCidrToken(token)) {
      inlineCidrs.push(token);
      continue;
    }

    if (isPrefixToken(token)) {
      inlinePrefixes.push(normalizePrefix(token));
      continue;
    }

    exactIps.push(normalizeIp(token));
  }

  return {
    allowedIps: Array.from(new Set(exactIps.filter(Boolean))),
    allowedPrefixes: Array.from(new Set([...configuredPrefixes, ...inlinePrefixes].filter(Boolean))),
    allowedCidrs: Array.from(new Set([...configuredCidrs, ...inlineCidrs].filter(Boolean))),
  };
}

const {
  allowedIps: ALLOWED_IPS,
  allowedPrefixes: ALLOWED_IP_PREFIXES,
  allowedCidrs: ALLOWED_CIDRS,
} = buildAllowedIpRules();

function listIps(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item || '').split(','))
    .map((item) => normalizeIp(item))
    .filter(Boolean);
}

function isPrivateOrLoopbackIp(ipAddress) {
  const normalized = normalizeIp(ipAddress);
  if (!normalized) {
    return false;
  }

  const octets = normalized.split('.').map((part) => Number(part));
  if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168);
  }

  return normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80:');
}

function extractClientIpCandidates(req) {
  const directIps = listIps([
    req.ip,
    req.connection?.remoteAddress,
    req.socket?.remoteAddress,
  ]);
  const forwardedIps = listIps([
    req.ips,
    req.headers['cf-connecting-ip'],
    req.headers['true-client-ip'],
    req.headers['x-real-ip'],
    req.headers['x-forwarded-for'],
  ]);

  const trustProxy = req.app?.get('trust proxy');
  const directPrimary = directIps[0] || '';
  const shouldUseForwardedIps = Boolean(trustProxy) || !directPrimary || isPrivateOrLoopbackIp(directPrimary);
  const orderedCandidates = shouldUseForwardedIps
    ? [...forwardedIps, ...directIps]
    : [...directIps];

  return Array.from(new Set(orderedCandidates.filter(Boolean)));
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
  const ipInt = ipv4ToInt(normalizeIp(ipAddress));
  const baseInt = ipv4ToInt(normalizeIp(base));
  const maskSize = Number(maskText);

  if (ipInt === null || baseInt === null || !Number.isInteger(maskSize) || maskSize < 0 || maskSize > 32) {
    return false;
  }

  const mask = maskSize === 0 ? 0 : (~0 << (32 - maskSize)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function isSingleIpAllowed(ipAddress) {
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

function isIpAllowed(ipAddressOrCandidates) {
  const candidates = Array.isArray(ipAddressOrCandidates)
    ? ipAddressOrCandidates
    : [ipAddressOrCandidates];

  return candidates.some((candidate) => isSingleIpAllowed(candidate));
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

function hasIpRestrictionsConfigured() {
  return ALLOWED_IPS.length > 0 || ALLOWED_IP_PREFIXES.length > 0 || ALLOWED_CIDRS.length > 0;
}

function buildIpDeniedError(baseMessage, candidateIps) {
  const primaryIp = Array.isArray(candidateIps) && candidateIps.length ? candidateIps[0] : '';
  const printableIp = primaryIp || 'unknown';
  const suffix = ` (detected IP: ${printableIp})`;

  return new AppError(`${baseMessage}${suffix}`, 403, {
    detected_ip: printableIp,
    ip_candidates: Array.isArray(candidateIps) ? candidateIps : [],
  });
}

function validateAttendanceAccess({ ipAddress, ipCandidates, latitude, longitude }) {
  const candidateIps = Array.isArray(ipCandidates) && ipCandidates.length ? ipCandidates : [ipAddress];
  const ipAllowed = isIpAllowed(candidateIps);
  const geoAllowed = isLocationAllowed(latitude, longitude);
  const hasGeoAttempt = Number.isFinite(latitude) && Number.isFinite(longitude);

  if (ACCESS_MODE === 'off' || !ACCESS_MODE) {
    return attendanceRestrictionSummary();
  }

  if (ACCESS_MODE === 'ip') {
    if (!hasIpRestrictionsConfigured()) {
      throw new AppError('Attendance IP restriction mode is enabled, but no allowed IP rules are configured on the server', 500);
    }
    if (!ipAllowed) {
      throw buildIpDeniedError('Attendance is only allowed from the approved company network', candidateIps);
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
    if (!hasIpRestrictionsConfigured() && !isGeoFenceConfigured()) {
      throw new AppError('Attendance access mode "either" is enabled, but neither IP nor geofence rules are configured on the server', 500);
    }
    if (!ipAllowed && !geoAllowed) {
      throw new AppError('Attendance requires either the approved company network or the approved location boundary', 403);
    }
    return attendanceRestrictionSummary();
  }

  if (ACCESS_MODE === 'both') {
    if (!hasIpRestrictionsConfigured()) {
      throw new AppError('Attendance access mode "both" is enabled, but no allowed IP rules are configured on the server', 500);
    }
    if (!ipAllowed) {
      throw buildIpDeniedError('Attendance requires the approved company network', candidateIps);
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
  const ipCandidates = extractClientIpCandidates(req);

  return {
    ipAddress: ipCandidates[0] || '',
    ipCandidates,
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
