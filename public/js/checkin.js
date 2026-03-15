import { getAppConfig, getSupabase, isSupabaseReady } from './supabaseClient.js';
import { formatDate, formatTime, statusLabel } from './shared.js';

const config = getAppConfig();
const supabase = isSupabaseReady() ? getSupabase() : null;
const notice = document.getElementById('checkinNotice');
const errorBox = document.getElementById('checkinError');
const statusTitle = document.getElementById('checkinStatusTitle');
const statusText = document.getElementById('checkinStatusText');
const actionButton = document.getElementById('checkinActionBtn');
const todayLabel = document.getElementById('checkinToday');
const clockLabel = document.getElementById('checkinClock');

boot();

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function setError(message = '') {
  errorBox.textContent = message;
  errorBox.classList.toggle('hidden', !message);
}

function setNotice(message = '') {
  notice.textContent = message;
  notice.classList.toggle('hidden', !message);
}

function updateClock() {
  const now = new Date();
  clockLabel.textContent = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
  todayLabel.textContent = formatDate(now.toISOString());
}

async function apiRequest(path, session, options = {}) {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${session.access_token}`,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || 'Request failed');
  }

  return payload;
}

async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, is_active, department, status')
    .eq('id', userId)
    .single();

  if (error) {
    throw new Error(error.message || 'Unable to load your profile');
  }

  return data;
}

async function fetchTodayAttendance(userId) {
  const { data, error } = await supabase
    .from('attendance')
    .select('attendance_date, check_in_time, check_out_time, attendance_status')
    .eq('user_id', userId)
    .eq('attendance_date', todayIso())
    .limit(1);

  if (error) {
    throw new Error(error.message || 'Unable to load attendance');
  }

  return data?.[0] || null;
}

async function renderState(session, profile) {
  const todayRecord = await fetchTodayAttendance(session.user.id);
  setError();
  setNotice(`Signed in as ${profile.full_name}${profile.department ? ` · ${profile.department}` : ''}`);

  if (!todayRecord || !todayRecord.check_in_time) {
    statusTitle.textContent = 'Ready to check in';
    statusText.textContent = 'Your attendance has not been recorded yet for today.';
    actionButton.disabled = false;
    actionButton.textContent = 'Check In Now';
    actionButton.onclick = () => submitAttendance(session, 'checkin');
    return;
  }

  if (!todayRecord.check_out_time) {
    statusTitle.textContent = statusLabel(todayRecord.attendance_status);
    statusText.textContent = `Checked in at ${formatTime(todayRecord.check_in_time)}. You can check out when your workday ends.`;
    actionButton.disabled = false;
    actionButton.textContent = 'Check Out Now';
    actionButton.onclick = () => submitAttendance(session, 'checkout');
    return;
  }

  statusTitle.textContent = 'Completed for today';
  statusText.textContent = `Checked in at ${formatTime(todayRecord.check_in_time)} and checked out at ${formatTime(todayRecord.check_out_time)}.`;
  actionButton.disabled = true;
  actionButton.textContent = 'Attendance Completed';
  actionButton.onclick = null;
}

async function submitAttendance(session, type) {
  try {
    actionButton.disabled = true;
    actionButton.textContent = type === 'checkin' ? 'Checking In' : 'Checking Out';
    await apiRequest(`/attendance/${type}`, session, { method: 'POST' });
    await renderState(session, await fetchProfile(session.user.id));
  } catch (error) {
    setError(error.message);
    actionButton.disabled = false;
    actionButton.textContent = type === 'checkin' ? 'Check In Now' : 'Check Out Now';
  }
}

async function boot() {
  updateClock();
  window.setInterval(updateClock, 1000);

  if (!isSupabaseReady()) {
    setError('Supabase configuration is missing. Set SUPABASE_URL and SUPABASE_ANON_KEY first.');
    statusTitle.textContent = 'Configuration required';
    statusText.textContent = 'This page cannot connect to Supabase until the runtime configuration is available.';
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.replace('/?next=checkin');
    return;
  }

  try {
    const profile = await fetchProfile(session.user.id);
    if (!profile.is_active) {
      await supabase.auth.signOut();
      window.location.replace('/?next=checkin');
      return;
    }

    await renderState(session, profile);
  } catch (error) {
    setError(error.message);
    statusTitle.textContent = 'Unable to continue';
    statusText.textContent = 'Please return to the dashboard and try again.';
  }
}

