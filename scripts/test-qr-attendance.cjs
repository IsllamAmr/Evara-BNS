// QR-only attendance: the office QR secret is required, and when enabled the
// request must come from an approved office network. Runs without Supabase.
const assert = require('node:assert/strict');
const express = require('express');
const config = require('../config/supabase');

const userId = '22222222-2222-4222-8222-222222222222';
const QR_TOKEN = 'office-qr-secret-token-abcdefghij';
const settingsRow = { id: 1, qr_token: QR_TOKEN, require_office_network: true, allowed_networks: [] };
const rpcCalls = [];
const client = {
  auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  from: (table) => ({
    select() { return this; },
    eq() { return this; },
    async maybeSingle() {
      if (table === 'attendance_settings') return { data: { ...settingsRow }, error: null };
      return { data: { id: userId, role: 'employee', is_active: true }, error: null };
    },
  }),
  rpc: (name, payload) => ({ single: async () => { rpcCalls.push({ name, payload }); return { data: { id: 7 }, error: null }; } }),
};
config.getSupabaseAdmin = () => client;
config.createScopedClient = () => client;

const { invalidateSettingsCache, normalizeNetworkRules } = require('../services/attendanceSettingsService');
const { matchesNetworkRule, tokensMatch } = require('../services/attendanceGuardService');
const { sanitizeRequest } = require('../middlewares/sanitizeMiddleware');
const { errorHandler } = require('../middlewares/errorMiddleware');
const router = require('../routes/attendanceRoutes');

// Pure helpers
assert.equal(matchesNetworkRule('41.33.10.5', '41.33.10.5'), true);
assert.equal(matchesNetworkRule('41.33.10.6', '41.33.10.5'), false);
assert.equal(matchesNetworkRule('192.168.1.40', '192.168.1.*'), true);
assert.equal(matchesNetworkRule('192.168.10.40', '192.168.1.*'), false, 'prefix must stop at an octet boundary');
assert.equal(matchesNetworkRule('10.0.0.200', '10.0.0.0/24'), true);
assert.equal(matchesNetworkRule('10.0.1.1', '10.0.0.0/24'), false);
assert.equal(matchesNetworkRule('200.1.2.3', '128.0.0.0/1'), true, 'high-bit CIDR masks compare as unsigned');
assert.equal(matchesNetworkRule('::ffff:41.33.10.5', '41.33.10.5'), true);
assert.equal(tokensMatch('abc', 'abc'), true);
assert.equal(tokensMatch('abd', 'abc'), false);
assert.equal(tokensMatch('', ''), false);
const normalized = normalizeNetworkRules([' 41.33.10.5 ', '192.168.1.', '10.0.0.0/24', 'not-an-ip', '999.1.1.1']);
assert.deepEqual(normalized.rules, ['41.33.10.5', '192.168.1.*', '10.0.0.0/24']);
assert.deepEqual(normalized.invalid, ['not-an-ip', '999.1.1.1']);

const app = express();
app.use(express.json(), sanitizeRequest);
app.use('/attendance', router);
app.use(errorHandler);

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const checkIn = async (body, headers = {}) => {
    invalidateSettingsCache();
    const response = await fetch(`${base}/attendance/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test', ...headers },
      body: JSON.stringify(body),
    });
    return { status: response.status, payload: await response.json() };
  };

  try {
    let result = await checkIn({});
    assert.equal(result.status, 422, 'Dashboard-style requests without a QR token are rejected');

    result = await checkIn({ qr_token: 'x'.repeat(33) });
    assert.equal(result.status, 403);
    assert.equal(result.payload.details.code, 'qr_required');

    result = await checkIn({ qr_token: QR_TOKEN });
    assert.equal(result.status, 403);
    assert.equal(result.payload.details.code, 'office_network_not_configured');

    settingsRow.allowed_networks = ['41.33.10.5'];
    result = await checkIn({ qr_token: QR_TOKEN }, { 'X-Forwarded-For': '41.33.10.5' });
    assert.equal(result.status, 403, 'A spoofed X-Forwarded-For header must not bypass the office network check');
    assert.equal(result.payload.details.code, 'office_network_required');
    assert.equal(result.payload.details.detected_ip, '127.0.0.1');

    settingsRow.allowed_networks = ['127.0.0.0/8'];
    result = await checkIn({ qr_token: QR_TOKEN });
    assert.equal(result.status, 201);

    settingsRow.allowed_networks = [];
    settingsRow.require_office_network = false;
    result = await checkIn({ qr_token: QR_TOKEN });
    assert.equal(result.status, 201, 'Network check can be switched off by the admin; the QR is still required');

    assert.equal(rpcCalls.length, 2, 'Only fully validated requests reach the write RPC');
    assert.equal(rpcCalls[0].name, 'check_in_server');
    assert.equal(rpcCalls[0].payload.p_user_id, userId);
    assert.equal(rpcCalls[0].payload.p_ip_address, '127.0.0.1');
    assert.ok(!('qr_token' in rpcCalls[0].payload), 'The QR secret is never stored with attendance');
    console.log('QR-only attendance: token, office network, spoofing and toggle checks passed.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
