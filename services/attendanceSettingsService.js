const crypto = require('crypto');
const { AppError } = require('../middlewares/errorMiddleware');
const { getSupabaseAdmin } = require('../config/supabase');

const SETTINGS_CACHE_TTL_MS = 15 * 1000;
const MAX_NETWORK_RULES = 50;

let cachedSettings = null;
let cachedAt = 0;

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

// Optional static rules from the environment, merged with the rules saved by the admin.
function environmentNetworkRules() {
  return [
    ...parseCsv(process.env.ATTENDANCE_ALLOWED_IPS),
    ...parseCsv(process.env.ATTENDANCE_ALLOWED_IP_PREFIXES),
    ...parseCsv(process.env.ATTENDANCE_ALLOWED_CIDRS),
  ];
}

function isIpv4(value) {
  const parts = String(value).split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isIpv6(value) {
  return /^[0-9a-f:]+$/i.test(value) && value.includes(':') && value.length <= 45;
}

// Accepted forms: 41.33.10.5 | 192.168.1.* | 192.168.1. | 10.0.0.0/24 | 2001:db8::1
function normalizeNetworkRule(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase();
  if (!value) {
    return '';
  }

  if (value.includes('/')) {
    const [base, mask] = value.split('/');
    if (isIpv4(base) && /^\d{1,2}$/.test(mask) && Number(mask) <= 32) {
      return `${base}/${Number(mask)}`;
    }
    return null;
  }

  if (value.endsWith('*') || value.endsWith('.')) {
    const prefix = value.replace(/\*+$/, '').replace(/\.+$/, '');
    const parts = prefix.split('.');
    if (parts.length >= 1 && parts.length <= 3 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
      return `${prefix}.*`;
    }
    return null;
  }

  if (isIpv4(value) || isIpv6(value)) {
    return value;
  }

  return null;
}

function normalizeNetworkRules(values) {
  const list = Array.isArray(values) ? values : parseCsv(values);
  const normalized = [];
  const invalid = [];

  for (const item of list) {
    const rule = normalizeNetworkRule(item);
    if (rule === null) {
      invalid.push(String(item));
    } else if (rule) {
      normalized.push(rule);
    }
  }

  return { rules: Array.from(new Set(normalized)), invalid };
}

function generateQrToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function mapSettingsRow(row) {
  return {
    qrToken: row.qr_token,
    requireOfficeNetwork: row.require_office_network !== false,
    allowedNetworks: Array.isArray(row.allowed_networks) ? row.allowed_networks : [],
    environmentNetworks: normalizeNetworkRules(environmentNetworkRules()).rules,
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null,
  };
}

function invalidateSettingsCache() {
  cachedSettings = null;
  cachedAt = 0;
}

async function loadSettingsRow() {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('attendance_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    throw new AppError(`Attendance settings are unavailable: ${error.message}. Apply migration 010.`, 500);
  }

  if (data) {
    return data;
  }

  // The migration seeds the row; recreate it if someone deleted it.
  const { data: created, error: createError } = await supabaseAdmin
    .from('attendance_settings')
    .upsert({ id: 1, qr_token: generateQrToken() }, { onConflict: 'id' })
    .select('*')
    .single();

  if (createError) {
    throw new AppError(`Unable to initialize attendance settings: ${createError.message}`, 500);
  }

  return created;
}

async function getAttendanceSettings({ force = false } = {}) {
  if (!force && cachedSettings && (Date.now() - cachedAt) < SETTINGS_CACHE_TTL_MS) {
    return cachedSettings;
  }

  const row = await loadSettingsRow();
  cachedSettings = mapSettingsRow(row);
  cachedAt = Date.now();
  return cachedSettings;
}

async function logSettingsChange(actorProfile, action, details) {
  const { error } = await getSupabaseAdmin().from('logs').insert({
    user_id: actorProfile?.id || null,
    action,
    details: JSON.stringify(details),
  });
  if (error) {
    console.error(`Failed to write audit log for ${action}:`, error.message);
  }
}

async function updateAttendanceSettings(payload, actorProfile) {
  const update = { updated_by: actorProfile?.id || null, updated_at: new Date().toISOString() };

  if (typeof payload.require_office_network === 'boolean') {
    update.require_office_network = payload.require_office_network;
  }

  if (payload.allowed_networks !== undefined) {
    const { rules, invalid } = normalizeNetworkRules(payload.allowed_networks);
    if (invalid.length) {
      throw new AppError(`Invalid network rule: ${invalid.join(', ')}`, 422, { code: 'invalid_network_rule', invalid });
    }
    if (rules.length > MAX_NETWORK_RULES) {
      throw new AppError(`At most ${MAX_NETWORK_RULES} network rules are allowed`, 422);
    }
    update.allowed_networks = rules;
  }

  await loadSettingsRow();
  const { error } = await getSupabaseAdmin()
    .from('attendance_settings')
    .update(update)
    .eq('id', 1);

  if (error) {
    throw new AppError(error.message, 400);
  }

  invalidateSettingsCache();
  const settings = await getAttendanceSettings({ force: true });
  await logSettingsChange(actorProfile, 'attendance_settings_updated', {
    require_office_network: settings.requireOfficeNetwork,
    allowed_networks: settings.allowedNetworks,
  });
  return settings;
}

async function rotateQrToken(actorProfile) {
  await loadSettingsRow();
  const { error } = await getSupabaseAdmin()
    .from('attendance_settings')
    .update({
      qr_token: generateQrToken(),
      updated_by: actorProfile?.id || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);

  if (error) {
    throw new AppError(error.message, 400);
  }

  invalidateSettingsCache();
  const settings = await getAttendanceSettings({ force: true });
  await logSettingsChange(actorProfile, 'attendance_qr_rotated', {});
  return settings;
}

module.exports = {
  generateQrToken,
  getAttendanceSettings,
  invalidateSettingsCache,
  normalizeNetworkRule,
  normalizeNetworkRules,
  rotateQrToken,
  updateAttendanceSettings,
};
