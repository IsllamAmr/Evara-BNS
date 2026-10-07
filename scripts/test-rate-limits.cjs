// Rate limits: the whole office shares one public IP, so limits must be per signed-in user.
const assert = require('assert');
const path = require('path');
const express = require('express');

delete process.env.RATE_LIMIT_MAX;
delete process.env.RATE_LIMIT_MAX_REQUESTS;
delete process.env.RATE_LIMIT_IP_MAX;

// Token "token-<n>" belongs to user "u<n>".
const configPath = path.join(__dirname, '..', 'config', 'supabase.js');
require.cache[require.resolve(configPath)] = {
  id: configPath, filename: configPath, loaded: true,
  exports: {
    createScopedClient: () => ({}),
    getSupabaseAdmin: () => ({
      auth: { getUser: async (token) => ({ data: { user: { id: `u${token.split('-')[1]}` } }, error: null }) },
      from: () => ({ select: () => ({ eq: (_k, id) => ({ maybeSingle: async () => ({ data: { id, role: 'employee', is_active: true }, error: null }) }) }) }),
    }),
  },
};

const { apiLimiter } = require('../middlewares/rateLimiters');
const { protect } = require('../middlewares/authMiddleware');

const app = express();
app.set('trust proxy', false);
app.use('/api', apiLimiter);
app.get('/api/me', protect, (req, res) => res.json({ id: req.user.id }));

(async () => {
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api/me`;
  const call = (n) => fetch(url, { headers: { Authorization: `Bearer token-${n}` } }).then((r) => r.status);

  // 30 employees on the office Wi-Fi (same IP), 20 requests each = 600 requests.
  const statuses = [];
  for (let round = 0; round < 20; round += 1) {
    statuses.push(...await Promise.all(Array.from({ length: 30 }, (_v, i) => call(i))));
  }
  assert.strictEqual(statuses.filter((s) => s === 429).length, 0, 'a busy office is not rate limited');

  // One person alone still has a ceiling (200 per window by default).
  let blocked = 0;
  for (let i = 0; i < 220; i += 1) if (await call(99) === 429) blocked += 1;
  assert.strictEqual(blocked, 20, 'one user: 200 allowed, the next 20 refused');

  server.close();
  console.log('Rate limits: 30 employees behind one IP are not blocked; a single user is still capped.');
})().catch((error) => { console.error(error); process.exit(1); });
