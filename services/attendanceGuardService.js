const crypto = require('crypto');
const { AppError } = require('../middlewares/errorMiddleware');
const { getAttendanceSettings } = require('./attendanceSettingsService');

// Attendance is QR-only: every check-in/check-out must carry the secret from the
// printed office QR, and (when enabled) come from an approved office network.

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

  const stripped = stripIpFormatting(String(ipAddress).split(',')[0]);
  if (!stripped) {
    return '';
  }

  if (stripped === '::1') {
    return '127.0.0.1';
  }

  return stripped.replace(/^::ffff:/i, '').trim().toLowerCase();
}

// req.ip honours TRUST_PROXY_HOPS, so a client cannot spoof it with its own
// X-Forwarded-For / CF-Connecting-IP headers as long as the hop count is correct.
function resolveClientIp(req) {
  return normalizeIp(req.ip || req.socket?.remoteAddress || '');
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
  return ((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0);
}

function matchesNetworkRule(ipAddress, rule) {
  const ip = normalizeIp(ipAddress);
  const normalizedRule = String(rule || '').trim().toLowerCase();
  if (!ip || !normalizedRule) {
    return false;
  }

  if (normalizedRule.includes('/')) {
    return matchesCidr(ip, normalizedRule);
  }

  if (normalizedRule.endsWith('*') || normalizedRule.endsWith('.')) {
    const prefix = `${normalizedRule.replace(/\*+$/, '').replace(/\.+$/, '')}.`;
    return ip.startsWith(prefix);
  }

  return ip === normalizeIp(normalizedRule);
}

function isIpAllowed(ipAddress, rules = []) {
  return rules.some((rule) => matchesNetworkRule(ipAddress, rule));
}

function tokensMatch(provided, expected) {
  const a = Buffer.from(String(provided || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  if (!a.length || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function allNetworkRules(settings) {
  return Array.from(new Set([...(settings.allowedNetworks || []), ...(settings.environmentNetworks || [])]));
}

async function validateAttendanceAccess(req) {
  const settings = await getAttendanceSettings();
  const ipAddress = resolveClientIp(req);

  if (!tokensMatch(req.body?.qr_token, settings.qrToken)) {
    throw new AppError('Scan the office QR code to record attendance.', 403, { code: 'qr_required' });
  }

  if (settings.requireOfficeNetwork) {
    const rules = allNetworkRules(settings);
    if (!rules.length) {
      throw new AppError('The office network has not been configured yet. Ask your administrator.', 403, {
        code: 'office_network_not_configured',
      });
    }

    if (!isIpAllowed(ipAddress, rules)) {
      throw new AppError(`Connect to the office Wi-Fi to record attendance (detected IP: ${ipAddress || 'unknown'}).`, 403, {
        code: 'office_network_required',
        detected_ip: ipAddress || 'unknown',
      });
    }
  }

  return { ipAddress };
}

function attendanceRestrictionSummary() {
  return { mode: 'qr' };
}

function buildDeviceInfo(req) {
  const agent = req.headers['user-agent'] || 'unknown-device';
  return `${String(agent).slice(0, 400)} | via:qr`;
}

module.exports = {
  attendanceRestrictionSummary,
  buildDeviceInfo,
  isIpAllowed,
  matchesNetworkRule,
  normalizeIp,
  resolveClientIp,
  tokensMatch,
  validateAttendanceAccess,
};
