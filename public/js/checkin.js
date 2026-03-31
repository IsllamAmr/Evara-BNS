import { getAppConfig, getSupabase, isSupabaseReady } from './supabaseClient.js';
import { apiRequestWithFallback } from './apiClient.js';
import {
  applyDocumentLanguage,
  getLocale,
  t,
  toggleLanguage,
} from './i18n.js';
import { formatDate, formatTime, statusLabel, todayIso as todayBusinessIso } from './shared.js';

const config = getAppConfig();
const supabase = isSupabaseReady() ? getSupabase() : null;
const notice = document.getElementById('checkinNotice');
const errorBox = document.getElementById('checkinError');
const statePill = document.getElementById('checkinStatePill');
const identityLabel = document.getElementById('checkinIdentity');
const heroTitle = document.getElementById('checkinHeroTitle');
const heroText = document.getElementById('checkinHeroText');
const statusTitle = document.getElementById('checkinStatusTitle');
const statusText = document.getElementById('checkinStatusText');
const statusMeta = document.getElementById('checkinStatusMeta');
const actionButton = document.getElementById('checkinActionBtn');
const secondaryActionButton = document.getElementById('checkinSecondaryBtn');
const todayLabel = document.getElementById('checkinToday');
const clockLabel = document.getElementById('checkinClock');
let currentSession = null;
let currentProfile = null;

boot();

function todayIso() {
  return todayBusinessIso();
}

function setError(message = '') {
  errorBox.textContent = message;
  errorBox.classList.toggle('hidden', !message);
}

function setNotice(message = '') {
  notice.textContent = message;
  notice.classList.toggle('hidden', !message);
}

function setStatePill(label, tone = 'neutral') {
  statePill.textContent = label;
  statePill.className = `status-pill ${tone}`;
}

function setIdentity(profile) {
  identityLabel.textContent = profile?.department
    ? `${profile.full_name} • ${profile.department}`
    : (profile?.full_name || '--');
}

function setHeroCopy(title, text) {
  heroTitle.textContent = title;
  heroText.textContent = text;
}

function renderStatusMeta(items = []) {
  if (!items.length) {
    statusMeta.innerHTML = '';
    statusMeta.classList.add('hidden');
    return;
  }

  statusMeta.innerHTML = items.map((item) => `
    <div class="checkin-status-meta-item">
      <span>${item.label}</span>
      <strong>${item.value}</strong>
    </div>
  `).join('');
  statusMeta.classList.remove('hidden');
}

function configureActionButton({ label, disabled = false, onClick }) {
  actionButton.disabled = disabled;
  actionButton.textContent = label;
  actionButton.onclick = typeof onClick === 'function' ? onClick : null;
}

function configureSecondaryButton({ label, onClick }) {
  secondaryActionButton.textContent = label;
  secondaryActionButton.onclick = typeof onClick === 'function' ? onClick : null;
}

function updateClock() {
  const now = new Date();
  clockLabel.textContent = now.toLocaleTimeString(getLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  todayLabel.textContent = formatDate(todayIso());
}

function getCurrentPosition() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ context: {}, warning: '' });
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          context: {
            latitude: Number(position.coords.latitude),
            longitude: Number(position.coords.longitude),
            accuracy: Number(position.coords.accuracy),
          },
          warning: '',
        });
      },
      (error) => {
        let warning = '';
        if (error?.code === error.PERMISSION_DENIED) {
          warning = t('checkin.locationDeniedWarning');
        } else if (error?.code === error.TIMEOUT) {
          warning = t('checkin.locationTimeoutWarning');
        }

        resolve({ context: {}, warning });
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 60000,
      }
    );
  });
}

async function apiRequest(path, session, options = {}) {
  const requestOptions = {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${session.access_token}`,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  };

  return apiRequestWithFallback({
    path,
    baseUrl: config.apiBaseUrl,
    requestOptions,
    requestFailedMessage: t('common.requestFailed'),
    apiEndpointMisconfiguredMessage: t('errors.apiEndpointMisconfigured'),
  });
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
  setNotice();
  setIdentity(profile);
  configureSecondaryButton({
    label: t('common.openDashboard'),
    onClick: () => window.location.assign('/'),
  });

  if (!todayRecord || !todayRecord.check_in_time) {
    setNotice('');
    setHeroCopy(t('checkin.heroReadyTitle'), t('checkin.heroReadyText'));
    setStatePill(t('checkin.readyBadge'), 'ready');
    statusTitle.textContent = t('checkin.readyTitle');
    statusText.textContent = t('checkin.readyText');
    renderStatusMeta([]);
    configureActionButton({
      disabled: false,
      label: t('checkin.checkInNow'),
      onClick: () => submitAttendance(session, 'checkin'),
    });
    return;
  }

  if (!todayRecord.check_out_time) {
    setNotice('');
    setHeroCopy(t('checkin.heroCheckedInTitle'), t('checkin.heroCheckedInText'));
    setStatePill(t('checkin.checkedInBadge'), 'progress');
    statusTitle.textContent = t('checkin.checkedInTitle');
    statusText.textContent = t('checkin.checkedInText', { time: formatTime(todayRecord.check_in_time) });
    renderStatusMeta([
      { label: t('checkin.checkInTimeLabel'), value: formatTime(todayRecord.check_in_time) },
      { label: t('checkin.statusSummaryLabel'), value: statusLabel(todayRecord.attendance_status) },
    ]);
    configureActionButton({
      disabled: false,
      label: t('checkin.checkOutNow'),
      onClick: () => submitAttendance(session, 'checkout'),
    });
    return;
  }

  setNotice('');
  setHeroCopy(t('checkin.heroCompletedTitle'), t('checkin.heroCompletedText'));
  setStatePill(t('checkin.completedBadge'), 'success');
  statusTitle.textContent = t('checkin.completedTitle');
  statusText.textContent = t('checkin.completedText');
  renderStatusMeta([
    { label: t('checkin.checkInTimeLabel'), value: formatTime(todayRecord.check_in_time) },
    { label: t('checkin.checkOutTimeLabel'), value: formatTime(todayRecord.check_out_time) },
  ]);
  configureActionButton({
    disabled: false,
    label: t('common.openDashboard'),
    onClick: () => window.location.assign('/'),
  });
  configureSecondaryButton({
    label: t('checkin.refreshStatus'),
    onClick: () => renderState(session, profile).catch((error) => setError(error.message)),
  });
}

async function submitAttendance(session, type) {
  try {
    actionButton.disabled = true;
    actionButton.textContent = type === 'checkin' ? t('checkin.checkinLoading') : t('checkin.checkoutLoading');
    const context = {};
    await apiRequest(`/attendance/${type}`, session, { method: 'POST', body: context });
    await renderState(session, currentProfile || await fetchProfile(session.user.id));
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
    setHeroCopy(t('checkin.heroUnavailableTitle'), t('checkin.heroUnavailableText'));
    setStatePill(t('common.actionNeeded'), 'warning');
    setIdentity(null);
    renderStatusMeta([]);
    statusTitle.textContent = t('checkin.configurationRequired');
    statusText.textContent = t('checkin.configurationText');
    configureActionButton({
      disabled: true,
      label: t('checkin.loadingButton'),
    });
    configureSecondaryButton({
      label: t('common.openDashboard'),
      onClick: () => window.location.assign('/'),
    });
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
    setHeroCopy(t('checkin.heroUnavailableTitle'), t('checkin.heroUnavailableText'));
    setStatePill(t('common.actionNeeded'), 'warning');
    statusTitle.textContent = t('checkin.unableToContinue');
    statusText.textContent = t('checkin.returnDashboard');
    renderStatusMeta([]);
    configureActionButton({
      disabled: false,
      label: t('common.openDashboard'),
      onClick: () => window.location.assign('/'),
    });
    configureSecondaryButton({
      label: t('checkin.refreshStatus'),
      onClick: () => window.location.reload(),
    });
  }
}
