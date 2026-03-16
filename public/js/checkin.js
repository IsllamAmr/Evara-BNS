import { getAppConfig, getSupabase, isSupabaseReady } from './supabaseClient.js';
import {
  applyDocumentLanguage,
  getLocale,
  t,
  toggleLanguage,
} from './i18n.js';
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
let currentSession = null;
let currentProfile = null;

boot();

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  clockLabel.textContent = now.toLocaleTimeString(getLocale(), {
    hour: '2-digit',
    minute: '2-digit',
  });
  todayLabel.textContent = formatDate(now);
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
    throw new Error(payload.message || t('common.requestFailed'));
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
    throw new Error(error.message || t('checkin.unableProfile'));
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
    throw new Error(error.message || t('checkin.unableAttendance'));
  }

  return data?.[0] || null;
}

async function renderState(session, profile) {
  const todayRecord = await fetchTodayAttendance(session.user.id);
  setError();
  setNotice(t('checkin.signedInAs', {
    name: profile.full_name,
    department: profile.department ? ` · ${profile.department}` : '',
  }));

  if (!todayRecord || !todayRecord.check_in_time) {
    statusTitle.textContent = t('checkin.readyTitle');
    statusText.textContent = t('checkin.readyText');
    actionButton.disabled = false;
    actionButton.textContent = t('checkin.checkInNow');
    actionButton.onclick = () => submitAttendance(session, 'checkin');
    return;
  }

  if (!todayRecord.check_out_time) {
    statusTitle.textContent = statusLabel(todayRecord.attendance_status);
    statusText.textContent = t('checkin.checkedInText', { time: formatTime(todayRecord.check_in_time) });
    actionButton.disabled = false;
    actionButton.textContent = t('checkin.checkOutNow');
    actionButton.onclick = () => submitAttendance(session, 'checkout');
    return;
  }

  statusTitle.textContent = t('checkin.completedTitle');
  statusText.textContent = t('checkin.completedText', {
    checkIn: formatTime(todayRecord.check_in_time),
    checkOut: formatTime(todayRecord.check_out_time),
  });
  actionButton.disabled = true;
  actionButton.textContent = t('checkin.completedButton');
  actionButton.onclick = null;
}

async function submitAttendance(session, type) {
  try {
    actionButton.disabled = true;
    actionButton.textContent = type === 'checkin' ? t('checkin.checkinLoading') : t('checkin.checkoutLoading');
    await apiRequest(`/attendance/${type}`, session, { method: 'POST' });
    await renderState(session, await fetchProfile(session.user.id));
  } catch (error) {
    setError(error.message);
    actionButton.disabled = false;
    actionButton.textContent = type === 'checkin' ? t('checkin.checkInNow') : t('checkin.checkOutNow');
  }
}

async function boot() {
  applyDocumentLanguage();
  updateClock();
  window.setInterval(updateClock, 1000);
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-language-toggle]');
    if (!trigger) {
      return;
    }

    toggleLanguage();
    updateClock();
    if (currentSession && currentProfile) {
      renderState(currentSession, currentProfile).catch((error) => setError(error.message));
    }
  });

  if (!isSupabaseReady()) {
    setError(t('checkin.configurationMissing'));
    statusTitle.textContent = t('checkin.configurationRequired');
    statusText.textContent = t('checkin.configurationText');
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

    currentSession = session;
    currentProfile = profile;
    await renderState(session, profile);
  } catch (error) {
    setError(error.message);
    statusTitle.textContent = t('checkin.unableToContinue');
    statusText.textContent = t('checkin.returnDashboard');
  }
}
