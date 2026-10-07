// Editing an employee: the Status chosen in the form decides sign-in access (is_active).
const assert = require('assert');
const path = require('path');

const profiles = new Map();
const updates = [];
const configPath = path.join(__dirname, '..', 'config', 'supabase.js');

function query() {
  const filters = [];
  let patch = null;
  const api = {
    select() { return api; },
    eq(k, v) { filters.push((r) => r[k] === v); return api; },
    neq(k, v) { filters.push((r) => r[k] !== v); return api; },
    limit() { return api; },
    update(values) { patch = values; return api; },
    insert() { return Promise.resolve({ error: null }); },
    maybeSingle() { return api; },
    single() { return api; },
    then(resolve) {
      const rows = [...profiles.values()].filter((r) => filters.every((f) => f(r)));
      if (patch) {
        rows.forEach((r) => { updates.push({ id: r.id, ...patch }); Object.assign(r, patch); });
        return resolve({ data: null, error: null });
      }
      return resolve({ data: rows[0] ? { ...rows[0] } : null, error: null, count: rows.length });
    },
  };
  return api;
}

require.cache[require.resolve(configPath)] = {
  id: configPath, filename: configPath, loaded: true,
  exports: {
    createScopedClient: () => ({}),
    getSupabaseAdmin: () => ({ from: query, auth: { admin: { updateUserById: async () => ({ error: null }) } } }),
  },
};

const { updateEmployee } = require('../services/adminService');
const admin = { id: 'admin-1', role: 'admin', is_active: true, status: 'active', full_name: 'Admin', email: 'a@x.test', employee_code: 'ADM001' };
const base = { role: 'employee', full_name: 'Sara', email: 's@x.test', employee_code: 'EMP001', updated_at: 't' };

(async () => {
  profiles.set('admin-1', { ...admin });
  profiles.set('e1', { id: 'e1', ...base, is_active: true, status: 'active' });
  await updateEmployee('e1', { status: 'inactive' }, admin);
  assert.strictEqual(profiles.get('e1').is_active, false, 'Inactive in the form blocks sign-in');

  await updateEmployee('e1', { status: 'active' }, admin);
  assert.strictEqual(profiles.get('e1').is_active, true, 'Active in the form restores sign-in');

  await updateEmployee('e1', { status: 'on_leave' }, admin);
  assert.strictEqual(profiles.get('e1').is_active, true, 'On leave can still sign in');

  await updateEmployee('e1', { phone: '0100' }, admin);
  assert.strictEqual(profiles.get('e1').is_active, true, 'An edit without status keeps access as it was');

  await assert.rejects(updateEmployee('admin-1', { status: 'inactive' }, admin), /cannot deactivate your own account/);

  console.log('Employee status: Inactive/Active/On leave in the edit form now control sign-in; self-deactivation blocked.');
})().catch((error) => { console.error(error); process.exit(1); });
