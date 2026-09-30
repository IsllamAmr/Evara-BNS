const assert = require('node:assert/strict');
const express = require('express');
const config = require('../config/supabase');
const calls = [];
const userId = '11111111-1111-4111-8111-111111111111';
const QR_TOKEN = 'office-qr-secret-token-1234567890';
const client = {
  auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  from: (table) => ({ select() { return this; }, eq() { return this; }, async maybeSingle() {
    if (table === 'attendance_settings') {
      return { data: { id: 1, qr_token: QR_TOKEN, require_office_network: true, allowed_networks: ['127.0.0.1'] }, error: null };
    }
    return { data: { id: userId, role: 'employee', is_active: true }, error: null };
  } }),
  rpc: (name, payload) => ({ single: async () => { calls.push({ name, payload }); return { data: { id: 1, work_notes: payload.p_work_notes }, error: null }; } }),
};
config.getSupabaseAdmin = () => client;
config.createScopedClient = () => client;
const { sanitizeRequest } = require('../middlewares/sanitizeMiddleware');
const { errorHandler } = require('../middlewares/errorMiddleware');
const router = require('../routes/attendanceRoutes');
const app = express();
app.use(express.json(), sanitizeRequest);
app.use('/attendance', router);
app.use(errorHandler);

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (body) => fetch(`${base}/attendance/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' }, body: JSON.stringify({ qr_token: QR_TOKEN, ...body }) });
  try {
    for (const body of [{}, { work_notes: ' \n\t ' }, { work_notes: 'a'.repeat(4001) }, { work_notes: 'done', training_minutes: -1 }, { work_notes: 'done', work_place: 'a'.repeat(121) }]) {
      const response = await send(body);
      assert.equal(response.status, 422);
    }
    assert.equal(calls.length, 0, 'Invalid checkout must never reach the write RPC');
    const response = await send({ work_notes: '  Plan < 5\n\nDelivered drawings  ', work_place: ' Office ', training_minutes: 30, p_user_id: 'forged-id' });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'check_out_server');
    assert.equal(calls[0].payload.p_user_id, userId);
    assert.equal(calls[0].payload.p_work_notes, 'Plan < 5\n\nDelivered drawings');
    assert.equal(calls[0].payload.p_work_place, 'Office');
    assert.equal(calls[0].payload.p_training_minutes, 30);
    console.log('Checkout API rejects missing/invalid notes and forwards authenticated identity and intact daily notes.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
