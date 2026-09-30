import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = String(process.env.SUPABASE_URL || '').trim();
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const adminEmail = String(process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
const adminPassword = String(process.env.INITIAL_ADMIN_PASSWORD || '');
const adminName = String(process.env.INITIAL_ADMIN_FULL_NAME || 'System Admin').trim();
const execute = process.argv.includes('--execute');
const projectArgument = process.argv.find((argument) => argument.startsWith('--project='));

if (!url || !serviceKey) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env before running this script.');
}

const projectHost = new URL(url).hostname;
if (execute && projectArgument !== `--project=${projectHost}`) {
  throw new Error(`To execute, pass --project=${projectHost} so the target is explicit.`);
}

if (execute && (!adminEmail || !adminPassword)) {
  throw new Error('Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD before deleting users, so the administrator can be recreated.');
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function listAllUsers() {
  const users = [];
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length === 0) return users;
  }
}

async function countRows(table) {
  const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true });
  if (error) throw new Error(`Cannot count ${table}: ${error.message}`);
  return count;
}

async function deleteRows(table) {
  const { error } = await supabase.from(table).delete().not('id', 'is', null);
  if (error) throw new Error(`Cannot clear ${table}: ${error.message}`);
}

const tables = ['employee_requests', 'attendance', 'logs', 'profiles'];
const users = await listAllUsers();
const counts = Object.fromEntries(await Promise.all(tables.map(async (table) => [table, await countRows(table)])));
console.log(JSON.stringify({ project: projectHost, authUsers: users.length, tables: counts, mode: execute ? 'execute' : 'preview' }, null, 2));

if (!execute) {
  console.log(`Preview only. To reset this project, run: npm run reset:supabase -- --execute --project=${projectHost}`);
  process.exit(0);
}

for (const user of users) {
  const { error } = await supabase.auth.admin.deleteUser(user.id);
  if (error) throw new Error(`Could not delete auth user ${user.id}: ${error.message}`);
}

for (const table of tables) {
  await deleteRows(table);
}

const { data: created, error: createError } = await supabase.auth.admin.createUser({
  email: adminEmail,
  password: adminPassword,
  email_confirm: true,
  user_metadata: {
    full_name: adminName,
    role: 'admin',
    status: 'active',
    is_active: true,
  },
});
if (createError || !created?.user?.id) {
  throw new Error(`Data cleared, but administrator recreation failed: ${createError?.message || 'missing user ID'}`);
}

const { error: profileError } = await supabase.from('profiles').upsert({
  id: created.user.id,
  full_name: adminName,
  email: adminEmail,
  role: 'admin',
  is_active: true,
  status: 'active',
}, { onConflict: 'id' });
if (profileError) throw new Error(`Administrator auth user exists, but profile creation failed: ${profileError.message}`);

const remainingUsers = await listAllUsers();
const remainingCounts = Object.fromEntries(await Promise.all(tables.map(async (table) => [table, await countRows(table)])));
if (remainingUsers.length !== 1 || remainingCounts.profiles !== 1
  || remainingCounts.attendance !== 0 || remainingCounts.employee_requests !== 0 || remainingCounts.logs !== 0) {
  throw new Error(`Reset finished with unexpected counts: ${JSON.stringify({ authUsers: remainingUsers.length, tables: remainingCounts })}`);
}

console.log(JSON.stringify({ project: projectHost, authUsers: 1, tables: remainingCounts, administrator: adminEmail }, null, 2));
