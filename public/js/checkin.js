import { getAppConfig, getSupabase, isSupabaseReady } from './supabaseClient.js';
import { apiRequestWithFallback } from './apiClient.js';
import { requestCheckoutDetails, clearCheckoutDraft } from './checkoutForm.js';
import {
  applyDocumentLanguage,
  getLocale,
  t,
  toggleLanguage,
} from './i18n.js';
import { formatDate, formatTime, statusLabel, todayIso as todayBusinessIso, offsetDate } from './shared.js';
import { buildAttendanceRowMetrics, formatDuration } from './reporting.js';
import { icon } from './employeeViews.js';

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
const orb = document.getElementById('checkinOrb');
const orbIcon = document.getElementById('checkinOrbIcon');
const successOverlay = document.getElementById('checkinSuccess');
let currentSession = null;
let currentProfile = null;
let attendanceActionInFlight = false;

// Attendance is QR-only. The office QR opens /checkin?k=<secret>. The secret is kept
// in this tab for a short time (so it survives the sign-in redirect) and is cleared
// after each successful action, so check-out needs a fresh scan at the office.
const QR_SCAN_STORAGE_KEY = 'evara:qr-scan';
const QR_SCAN_TTL_MS = 15 * 60 * 1000;

function captureScannedQrToken() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('k');
  if (!token) return;
  try {
    window.sessionStorage.setItem(QR_SCAN_STORAGE_KEY, JSON.stringify({ token, at: Date.now() }));
  } catch (_error) {
    // Storage can be blocked (private mode); the in-memory copy below still works for this page view.
  }
  scannedTokenMemory = { token, at: Date.now() };
  openedFromScan = true;
  url.searchParams.delete('k');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

let scannedTokenMemory = null;
// True when this page was opened by scanning the office QR just now. At the end of the
// day that scan should go straight to the mandatory daily notes form.
let openedFromScan = false;
let checkoutAutoPrompted = false;

function getScannedQrToken() {
  let entry = scannedTokenMemory;
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(QR_SCAN_STORAGE_KEY) || 'null');
    if (stored?.token) entry = stored;
  } catch (_error) {
    // ignore unreadable storage
  }
  if (!entry?.token || (Date.now() - Number(entry.at || 0)) > QR_SCAN_TTL_MS) {
    return '';
  }
  return entry.token;
}

function clearScannedQrToken() {
  scannedTokenMemory = null;
  try {
    window.sessionStorage.removeItem(QR_SCAN_STORAGE_KEY);
  } catch (_error) {
    // ignore
  }
}

function attendanceErrorMessage(error) {
  const known = {
    qr_required: 'qrOnly.errors.qrRequired',
    office_network_required: 'qrOnly.errors.officeNetworkRequired',
    office_network_not_configured: 'qrOnly.errors.officeNetworkNotConfigured',
  };
  if (error?.code && known[error.code]) {
    return t(known[error.code], { ip: error.details?.detected_ip || '—' });
  }
  return error?.message || t('common.requestFailed');
}

function configureScanRequired(pendingAction) {
  setNotice('');
  setOrb('scan', 'qr');
  statusText.textContent = t('qrOnly.scanNotice');
  configureActionButton({
    disabled: true,
    label: pendingAction === 'checkout' ? t('qrOnly.scanToCheckOut') : t('qrOnly.scanToCheckIn'),
  });
}

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
  const orbState = { ready: 'ready', progress: 'progress', success: 'success', warning: 'warning' }[tone] || 'loading';
  const orbIconName = { ready: 'login', progress: 'alarm', success: 'check', warning: 'alert' }[tone] || 'refresh';
  setOrb(orbState, orbIconName);
}

function setOrb(stateName, iconName) {
  if (!orb || !orbIcon) return;
  orb.dataset.state = stateName;
  orbIcon.innerHTML = icon(iconName);
}

// Full-screen confirmation after a successful scan, with a short vibration on phones.
function celebrate(type) {
  if (!successOverlay) return;
  document.getElementById('checkinSuccessTitle').textContent = t(type === 'checkin' ? 'mobile.success.checkin' : 'mobile.success.checkout');
  document.getElementById('checkinSuccessText').textContent = t('mobile.success.at', { time: formatTime(new Date()) });
  successOverlay.dataset.type = type;
  successOverlay.classList.remove('hidden');
  try {
    navigator.vibrate?.([35, 50, 70]);
  } catch (_error) {
    // Vibration is optional.
  }
  const hide = () => successOverlay.classList.add('hidden');
  successOverlay.onclick = hide;
  window.setTimeout(hide, 2600);
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
    .select('attendance_date, check_in_time, check_out_time, attendance_status, work_notes')
    .eq('user_id', userId)
    .gte('attendance_date', offsetDate(-1))
    .lte('attendance_date', todayIso())
    .order('attendance_date', { ascending: false })
    .limit(5);

  if (error) {
    throw new Error(error.message || t('checkin.unableAttendance'));
  }

  const openShift = data?.find((row) => row.check_in_time && !row.check_out_time
    && (Date.now() - new Date(row.check_in_time).getTime()) <= 24 * 60 * 60 * 1000);
  return openShift || data?.find((row) => row.attendance_date === todayIso()) || null;
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
    if (!getScannedQrToken()) {
      configureScanRequired('checkin');
      return;
    }
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
      { label: t('mobile.checkinWorked'), value: formatDuration(buildAttendanceRowMetrics(todayRecord).workedMinutes) },
      { label: t('checkin.statusSummaryLabel'), value: statusLabel(todayRecord.attendance_status) },
    ]);
    if (!getScannedQrToken()) {
      configureScanRequired('checkout');
      return;
    }
    setNotice(t('qrOnly.checkoutNotesNotice'));
    configureActionButton({
      disabled: false,
      label: t('checkin.checkOutNow'),
      onClick: () => submitAttendance(session, 'checkout'),
    });
    if (openedFromScan && !checkoutAutoPrompted) {
      // Scanning the QR at the end of the day opens the notes form right away.
      checkoutAutoPrompted = true;
      window.setTimeout(() => submitAttendance(session, 'checkout'), 250);
    }
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
  setNotice(todayRecord.work_notes || '');
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
  if (attendanceActionInFlight) return;
  attendanceActionInFlight = true;
  try {
    actionButton.disabled = true;
    actionButton.textContent = type === 'checkin' ? t('checkin.checkinLoading') : t('checkin.checkoutLoading');
    const qrToken = getScannedQrToken();
    if (!qrToken) {
      configureScanRequired(type);
      return;
    }
    setError();
    const context = type === 'checkout' ? await requestCheckoutDetails({ draftKey: session.user.id }) : {};
    if (context === null) {
      actionButton.disabled = false;
      actionButton.textContent = t('checkin.checkOutNow');
      return;
    }
    await apiRequest(`/attendance/${type}`, session, { method: 'POST', body: { ...context, qr_token: qrToken } });
    if (type === 'checkout') clearCheckoutDraft(session.user.id);
    clearScannedQrToken();
    celebrate(type);
    await renderState(session, currentProfile || await fetchProfile(session.user.id));
  } catch (error) {
    if (error?.code === 'qr_required') clearScannedQrToken();
    setError(attendanceErrorMessage(error));
    setOrb('warning', 'alert');
    actionButton.disabled = false;
    actionButton.textContent = type === 'checkin' ? t('checkin.checkInNow') : t('checkin.checkOutNow');
  } finally {
    attendanceActionInFlight = false;
  }
}

async function boot() {
  captureScannedQrToken();
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
