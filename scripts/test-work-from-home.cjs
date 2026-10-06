// Work from home notes: validation, saved as approved with no approval step, admin can remove.
const assert = require('assert');
const path = require('path');

const inserted = [];
const configPath = path.join(__dirname, '..', 'config', 'supabase.js');
const chain = (result) => {
  const api = new Proxy({}, { get: (_t, key) => (key === 'then' ? (resolve) => resolve(result()) : (key === 'single' || key === 'maybeSingle' ? () => api : () => api)) });
  return api;
};
require.cache[require.resolve(configPath)] = {
  id: configPath, filename: configPath, loaded: true,
  exports: {
    createScopedClient: () => ({}),
    getSupabaseAdmin: () => ({
      from: (table) => ({
        insert(row) { inserted.push({ table, row }); return chain(() => ({ data: { id: 1, ...row }, error: null })); },
        select() { return chain(() => ({ data: table === 'profiles' ? { id: 'u1', role: 'employee', is_active: true, full_name: 'Test' } : [], error: null, count: 0 })); },
      }),
      rpc: () => chain(() => ({ data: null, error: { message: 'rpc must not be used for work from home' } })),
    }),
  },
};

const { createRequest } = require('../services/requestService');
const employee = { id: 'u1', role: 'employee' };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const future = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);

(async () => {
  await assert.rejects(createRequest({ request_type: 'work_from_home', work_date: future, work_start: '16:00', work_end: '18:00' }, employee), /today or a past day/);
  await assert.rejects(createRequest({ request_type: 'work_from_home', work_date: today, work_start: '18:00', work_end: '16:00' }, employee), /after the start time/);
  await assert.rejects(createRequest({ request_type: 'work_from_home', work_date: today, work_start: '25:00', work_end: '26:00' }, employee), /HH:MM/);
  await assert.rejects(createRequest({ request_type: 'work_from_home', work_date: '', work_start: '16:00', work_end: '18:00' }, employee), /work_date is required/);

  const result = await createRequest({ request_type: 'work_from_home', work_date: today, work_start: '16:00', work_end: '20:30', reason: '  Client calls  ' }, employee);
  const row = inserted.find((item) => item.table === 'employee_requests').row;
  assert.deepStrictEqual(
    { type: row.request_type, status: row.status, date: row.work_date, from: row.work_start, to: row.work_end, reason: row.reason, user: row.user_id },
    { type: 'work_from_home', status: 'approved', date: today, from: '16:00', to: '20:30', reason: 'Client calls', user: 'u1' },
  );
  assert.strictEqual(result.request.status, 'approved', 'no approval step');
  console.log('Work from home: future day, time order and format rejected; saved as a recorded note with no approval step.');
})().catch((error) => { console.error(error); process.exit(1); });
