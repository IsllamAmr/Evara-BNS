// Check-out reminders: due rules, one reminder per shift, dead devices, cron auth.
const assert = require('assert');
const path = require('path');

process.env.VAPID_PUBLIC_KEY = 'BOrc2kFbB3c9Q0J1ZbYk8WcY6v7j2mH1dZ8sTnq4pX3rA5uKx9eL0fVw2yN6hG4iJ7kM1oP3qR5sT8uV0wX2yZ4';
process.env.VAPID_PRIVATE_KEY = 'x'.repeat(43);
process.env.CRON_SECRET = 'test-cron-secret-123456';

// ---- stubs: web-push and the Supabase admin client ----
const sent = [];
let failEndpoint = null;
const webpushPath = require.resolve('web-push');
require.cache[webpushPath] = {
  id: webpushPath, filename: webpushPath, loaded: true,
  exports: {
    setVapidDetails() {},
    async sendNotification(subscription, payload) {
      if (subscription.endpoint === failEndpoint) {
        const error = new Error('gone'); error.statusCode = 410; throw error;
      }
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
    },
  },
};

const db = { attendance: [], push_subscriptions: [] };
function query(table) {
  const filters = []; let patch = null; let remove = false; let selectAfter = false; let upsertRow = null;
  const api = {
    select() { selectAfter = true; return api; },
    eq(k, v) { filters.push((r) => r[k] === v); return api; },
    is(k, v) { filters.push((r) => (r[k] ?? null) === v); return api; },
    not(k, _op, v) { filters.push((r) => (r[k] ?? null) !== v); return api; },
    in(k, v) { filters.push((r) => v.includes(r[k])); return api; },
    order() { return api; },
    update(values) { patch = values; return api; },
    delete() { remove = true; return api; },
    upsert(row) { upsertRow = row; return api; },
    then(resolve) {
      let rows = db[table];
      if (upsertRow) {
        const existing = rows.find((r) => r.endpoint === upsertRow.endpoint);
        if (existing) Object.assign(existing, upsertRow);
        else rows.push({ id: rows.length + 100, created_at: new Date().toISOString(), ...upsertRow });
        return resolve({ data: null, error: null });
      }
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      if (remove) { db[table] = rows.filter((r) => !matched.includes(r)); return resolve({ data: null, error: null }); }
      if (patch) { matched.forEach((r) => Object.assign(r, patch)); return resolve({ data: selectAfter ? matched.map((r) => ({ id: r.id })) : null, error: null }); }
      return resolve({ data: matched.map((r) => ({ ...r })), error: null });
    },
  };
  return api;
}
const configPath = path.join(__dirname, '..', 'config', 'supabase.js');
require.cache[require.resolve(configPath)] = {
  id: configPath, filename: configPath, loaded: true,
  exports: { getSupabaseAdmin: () => ({ from: query }), createScopedClient: () => ({}) },
};

const pushService = require('../services/pushService');

(async () => {
  assert.ok(pushService.isPushConfigured());

  // 12:00 Cairo (UTC+3) on a working day.
  const now = new Date('2026-10-06T09:00:00Z');
  const today = '2026-10-06';
  db.attendance = [
    { id: 1, user_id: 'a', attendance_date: today, check_in_time: '2026-10-05T23:30:00Z', check_out_time: null }, // 9.5 h in -> due
    { id: 2, user_id: 'b', attendance_date: today, check_in_time: '2026-10-06T05:00:00Z', check_out_time: null }, // 4 h in -> not yet
    { id: 3, user_id: 'c', attendance_date: today, check_in_time: '2026-10-05T23:00:00Z', check_out_time: '2026-10-06T07:00:00Z' }, // checked out
    { id: 4, user_id: 'd', attendance_date: today, check_in_time: '2026-10-05T23:00:00Z', check_out_time: null }, // due, no device
    { id: 5, user_id: 'e', attendance_date: today, check_in_time: '2026-10-05T23:00:00Z', check_out_time: null }, // due, dead device
  ];
  db.push_subscriptions = [
    { id: 10, user_id: 'a', endpoint: 'https://push.example/a1', p256dh: 'k', auth: 'x' },
    { id: 11, user_id: 'a', endpoint: 'https://push.example/a2', p256dh: 'k', auth: 'x' },
    { id: 12, user_id: 'b', endpoint: 'https://push.example/b', p256dh: 'k', auth: 'x' },
    { id: 13, user_id: 'e', endpoint: 'https://push.example/dead', p256dh: 'k', auth: 'x' },
  ];
  failEndpoint = 'https://push.example/dead';

  const first = await pushService.sendCheckoutReminders(now);
  assert.deepStrictEqual({ open: first.openShifts, due: first.due, reminded: first.reminded, devices: first.devices, removed: first.removedDevices },
    { open: 4, due: 3, reminded: 1, devices: 2, removed: 1 });
  assert.strictEqual(sent.length, 2, 'both of the employee\'s devices get it');
  assert.match(sent[0].payload.body, /checked in at 2:30 am/);
  assert.ok(db.attendance.find((r) => r.id === 1).checkout_reminder_sent_at, 'shift marked reminded');
  assert.strictEqual(db.attendance.find((r) => r.id === 5).checkout_reminder_sent_at, null, 'failed delivery releases the claim');
  assert.ok(!db.push_subscriptions.some((s) => s.id === 13), 'dead device removed');

  const second = await pushService.sendCheckoutReminders(new Date(now.getTime() + 30 * 60000));
  assert.strictEqual(second.reminded, 0, 'never reminded twice');
  assert.strictEqual(sent.length, 2);

  // Evening sweep: 21:10 Cairo reminds a short shift too.
  assert.ok(pushService.isReminderDue({ check_in_time: '2026-10-06T16:00:00Z' }, new Date('2026-10-06T18:10:00Z')));
  assert.ok(!pushService.isReminderDue({ check_in_time: '2026-10-06T16:00:00Z' }, new Date('2026-10-06T17:00:00Z')));

  // Cron endpoint rejects a missing or wrong secret.
  const express = require('express');
  const { cronRouter } = require('../routes/notificationRoutes');
  const app = express();
  app.use('/api/cron', cronRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/cron/checkout-reminders`;
  assert.strictEqual((await fetch(base, { method: 'POST' })).status, 401);
  assert.strictEqual((await fetch(base, { method: 'POST', headers: { Authorization: 'Bearer wrong-secret-0000000' } })).status, 401);
  assert.strictEqual((await fetch(base, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } })).status, 200);
  server.close();

  console.log('Check-out reminders: due rules, single reminder per shift, multi-device, dead devices, claim release and cron auth passed.');
})().catch((error) => { console.error(error); process.exit(1); });
