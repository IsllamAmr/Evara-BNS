import { getAppConfig, getSupabase, isSupabaseReady } from './supabaseClient.js';
import {
  exportAttendanceCsv,
  exportEmployeeTimesheetCsv,
  exportEmployeesCsv,
  exportReportsCsv,
} from './exporters.js';
import {
  average,
  attendanceOutcome,
  buildAttendanceRowMetrics,
  buildReportsDataset,
  drawDepartmentHoursChart,
  drawWorkingHoursTrend,
  enumerateDates,
  formatAverageTime,
  formatDuration,
  isWorkday,
  minutesFromTimestamp,
  monthRange,
  reportEmployeeOptions,
  reportsDepartmentChoices,
  reportsEmployeeChoices,
  trendBadgeMarkup,
} from './reporting.js';
import {
  applyDocumentLanguage,
  getLocale,
  onLanguageChange,
  t,
  toggleLanguage,
} from './i18n.js';
import {
  departmentLabel,
  escapeHtml,
  formatDate,
  formatDateTime,
  formatTime,
  isStrongPassword,
  roleLabel,
  statusLabel,
  toInitials,
} from './shared.js';

const config = getAppConfig();
const supabase = isSupabaseReady() ? getSupabase() : null;
const PROFILE_SELECT = 'id, full_name, email, role, is_active, employee_code, phone, department, position, status, created_at, updated_at';
const ATTENDANCE_SELECT = 'id, user_id, attendance_date, check_in_time, check_out_time, attendance_status, ip_address, device_info, created_at, updated_at';
const DEPARTMENT_OPTIONS = [
  'Administration',
  'Business Development',
  'Customer Support',
  'Finance',
  'Human Resources',
  'Information Technology',
  'Legal',
  'Marketing',
  'Operations',
  'Procurement',
  'Quality Assurance',
  'Sales',
  'Warehouse',
];

const EMPLOYEE_PAGE_SIZE = 10;
const HISTORY_PAGE_SIZE = 12;
const state = {
  session: null,
  profile: null,
  currentPage: 'dashboard',
  employees: [],
  profileMap: new Map(),
  employeeFilters: {
    search: '',
    department: 'all',
    status: 'all',
  },
  employeePagination: {
    page: 1,
    pageSize: EMPLOYEE_PAGE_SIZE,
  },
  historyFilters: {
    from: offsetDate(-14),
    to: todayIso(),
    status: 'all',
  },
  historyPagination: {
    page: 1,
    pageSize: HISTORY_PAGE_SIZE,
  },

  reportsFilters: {
    month: currentMonthInput(),
    department: 'all',
    employeeId: 'all',
  },
  attendanceRestrictions: null,
  liveRefreshTimer: null,
};
const elements = {
  loginScreen: document.getElementById('loginScreen'),
  app: document.getElementById('app'),
  loginForm: document.getElementById('loginForm'),
  loginEmail: document.getElementById('loginEmail'),
  loginPassword: document.getElementById('loginPassword'),
  loginBtn: document.getElementById('loginBtn'),
  loginError: document.getElementById('loginError'),
  loginHint: document.getElementById('loginHint'),
  togglePasswordBtn: document.getElementById('togglePasswordBtn'),
  sidebar: document.getElementById('sidebar'),
  sidebarNav: document.getElementById('sidebarNav'),
  sidebarName: document.getElementById('sidebarName'),
  sidebarRole: document.getElementById('sidebarRole'),
  sidebarAvatar: document.getElementById('sidebarAvatar'),
  logoutBtn: document.getElementById('logoutBtn'),
  menuToggle: document.getElementById('menuToggle'),
  topbarHeadline: document.getElementById('topbarHeadline'),
  topbarSubline: document.getElementById('topbarSubline'),
  topbarClock: document.getElementById('topbarClock'),
  topbarDate: document.getElementById('topbarDate'),
  modal: document.getElementById('modal'),
  modalBackdrop: document.getElementById('modalBackdrop'),
  modalPanel: document.getElementById('modalPanel'),
  toastViewport: document.getElementById('toastViewport'),
  pages: {
    dashboard: document.getElementById('page-dashboard'),
    profile: document.getElementById('page-profile'),
    employees: document.getElementById('page-employees'),
    attendance: document.getElementById('page-attendance'),
    history: document.getElementById('page-history'),
    reports: document.getElementById('page-reports'),
    qr: document.getElementById('page-qr'),
  },
};

let modalCloseHandler = null;
let realtimeChannels = [];

boot();

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayIso() {
  return formatDateInput(new Date());
}

function currentMonthInput() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function offsetDate(days) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + days);
  return formatDateInput(value);
}

function toIsoFromDateTimeLocal(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function isAdmin() {
  return state.profile?.role === 'admin';
}

function allowedPages() {
  return isAdmin()
    ? ['dashboard', 'profile', 'employees', 'attendance', 'history', 'reports', 'qr']
    : ['dashboard', 'profile', 'attendance', 'history'];
}

function pageFromHash() {
  const value = window.location.hash.replace(/^#/, '').trim();
  return value || 'dashboard';
}

function setPageLoading(container, label) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>${escapeHtml(label)}</div></div>`;
}

function setPageError(container, message) {
  container.innerHTML = `<div class="empty-state"><strong>${escapeHtml(t('common.unableToLoadSection'))}</strong><p class="empty-note">${escapeHtml(message)}</p></div>`;
}

function dismissToast(toast) {
  if (!toast || !toast.parentElement) {
    return;
  }

  toast.classList.remove('visible');
  window.setTimeout(() => {
    toast.remove();
  }, 180);
}

function showToast(message, type = 'info') {
  const toast = document.createElement('article');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-copy">
      <strong>${escapeHtml(type === 'success' ? t('common.success') : type === 'error' ? t('common.actionNeeded') : t('common.notice'))}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
    <button type="button" class="toast-close" aria-label="${escapeHtml(t('common.close'))}">${escapeHtml(t('common.close'))}</button>
  `;

  toast.querySelector('.toast-close')?.addEventListener('click', () => dismissToast(toast));
  elements.toastViewport.appendChild(toast);
  window.requestAnimationFrame(() => toast.classList.add('visible'));
  window.setTimeout(() => dismissToast(toast), 4200);
}

function openModal(content, options = {}) {
  modalCloseHandler = typeof options.onClose === 'function' ? options.onClose : null;
  elements.modalPanel.innerHTML = content;
  elements.modal.classList.remove('hidden');
}

function closeModal(payload = null) {
  const handler = modalCloseHandler;
  modalCloseHandler = null;
  elements.modal.classList.add('hidden');
  elements.modalPanel.innerHTML = '';
  if (handler) {
    handler(payload);
  }
}

function syncPasswordToggleLabel() {
  elements.togglePasswordBtn.textContent = elements.loginPassword.type === 'password'
    ? t('login.showPassword')
    : t('login.hidePassword');
}

function setLoginError(message = '') {
  elements.loginError.textContent = message;
  elements.loginError.classList.toggle('hidden', !message);
}

function clearRealtimeSubscriptions() {
  realtimeChannels.forEach((channel) => {
    supabase?.removeChannel(channel);
  });
  realtimeChannels = [];

  if (state.liveRefreshTimer) {
    window.clearTimeout(state.liveRefreshTimer);
    state.liveRefreshTimer = null;
  }
}

function resetSessionState() {
  clearRealtimeSubscriptions();
  state.session = null;
  state.profile = null;
  state.employees = [];
  state.profileMap = new Map();
  state.employeePagination.page = 1;
  state.historyPagination.page = 1;

  state.attendanceRestrictions = null;
}

function showLogin(message = '') {
  elements.app.classList.add('hidden');
  elements.loginScreen.classList.remove('hidden');
  setLoginError(message);
  if (elements.loginHint) {
    elements.loginHint.textContent = '';
  }
}

function showAppShell() {
  elements.loginScreen.classList.add('hidden');
  elements.app.classList.remove('hidden');
}

function startClock() {
  const renderClock = () => {
    const now = new Date();
    elements.topbarClock.textContent = now.toLocaleTimeString(getLocale(), {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    elements.topbarDate.textContent = now.toLocaleDateString(getLocale(), {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  renderClock();
  window.setInterval(renderClock, 1000);
}

async function getAccessToken() {
  if (state.session?.access_token) {
    return state.session.access_token;
  }

  const { data: { session } } = await supabase.auth.getSession();
  state.session = session;
  return session?.access_token || '';
}

async function apiRequest(path, options = {}) {
  const token = await getAccessToken();
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || t('common.requestFailed'));
  }

  return payload;
}

async function fetchMyProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('id', userId)
    .single();

  if (error) {
    throw new Error(error.message || 'Unable to load your profile');
  }

  return data;
}

async function fetchEmployees() {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message || 'Unable to load employees');
  }

  return data || [];
}

async function fetchAttendance(filters = {}) {
  let query = supabase
    .from('attendance')
    .select(ATTENDANCE_SELECT)
    .order('attendance_date', { ascending: false })
    .order('check_in_time', { ascending: false });

  if (filters.userId) {
    query = query.eq('user_id', filters.userId);
  }
  if (filters.date) {
    query = query.eq('attendance_date', filters.date);
  }
  if (filters.from) {
    query = query.gte('attendance_date', filters.from);
  }
  if (filters.to) {
    query = query.lte('attendance_date', filters.to);
  }
  if (filters.status && filters.status !== 'all') {
    query = query.eq('attendance_status', filters.status);
  }
  if (filters.limit) {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || 'Unable to load attendance');
  }

  return data || [];
}

async function fetchSystemHealth() {
  try {
    const payload = await apiRequest('/health');
    return payload.attendance_restrictions || null;
  } catch (_error) {
    return null;
  }
}

function buildQueryString(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' || value === 'all') {
      return;
    }

    query.set(key, String(value));
  });

  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}



function getCurrentPosition(options = {}) {
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
          warning = 'Location permission was denied. If attendance fencing is active, the action may be rejected.';
        } else if (error?.code === error.TIMEOUT) {
          warning = 'Location lookup timed out. We will continue and let the server validate the request.';
        } else if (error?.code === error.POSITION_UNAVAILABLE) {
          warning = 'Location is currently unavailable on this device.';
        }

        resolve({ context: {}, warning });
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: options.maximumAge ?? 60000,
      }
    );
  });
}

async function collectAttendanceContext() {
  const { context, warning } = await getCurrentPosition();

  return {
    context,
    warning,
  };
}

function sumMetrics(items = [], selector) {
  return items.reduce((total, item) => total + Number(selector(item) || 0), 0);
}

function attendanceRestrictionMessage(summary) {
  if (!summary || !summary.access_mode || summary.access_mode === 'off') {
    return '';
  }

  if (summary.access_mode === 'ip') {
    return 'Attendance is limited to the approved company network.';
  }

  if (summary.access_mode === 'geo') {
    return 'Attendance is limited to the approved company location boundary.';
  }

  if (summary.access_mode === 'either') {
    if (summary.ip_restrictions_enabled && summary.geofence_enabled) {
      return 'Attendance requires either the approved company network or the approved company location.';
    }
    if (summary.ip_restrictions_enabled) {
      return 'Attendance requires the approved company network.';
    }
    if (summary.geofence_enabled) {
      return 'Attendance requires the approved company location.';
    }
  }

  if (summary.access_mode === 'both') {
    return 'Attendance requires both the approved company network and the approved company location.';
  }

  return '';
}

async function ensureProfileDirectory(records = []) {
  const missingIds = [...new Set(records.map((item) => item.user_id).filter((userId) => userId && !state.profileMap.has(userId)))];
  if (!missingIds.length) {
    return;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .in('id', missingIds);

  if (error) {
    throw new Error(error.message || 'Unable to map attendance records');
  }

  (data || []).forEach((profile) => {
    state.profileMap.set(profile.id, profile);
  });
}

function employeeById(id) {
  return state.profileMap.get(id) || state.employees.find((item) => item.id === id) || null;
}

function departmentOptions(selected = '') {
  return [...new Set([
    ...DEPARTMENT_OPTIONS,
    ...state.employees.map((employee) => employee.department).filter(Boolean),
    state.profile?.department,
    selected,
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function syncShell() {
  elements.sidebarName.textContent = state.profile?.full_name || 'EVARA User';
  elements.sidebarRole.textContent = roleLabel(state.profile?.role || 'employee');
  elements.sidebarAvatar.textContent = toInitials(state.profile?.full_name || 'EVARA');

  const pages = allowedPages();
  elements.sidebarNav.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('hidden', !pages.includes(button.dataset.page));
    button.classList.toggle('active', button.dataset.page === state.currentPage);
  });
}

function syncPageFrame(page) {
  state.currentPage = page;
  Object.entries(elements.pages).forEach(([key, value]) => {
    value.classList.toggle('active', key === page);
  });
  syncShell();
  refreshTopbarMessage().catch(() => {
    // Keep the existing copy if the attendance state cannot be loaded right now.
  });
}

async function refreshTopbarMessage() {
  if (!state.profile) {
    return;
  }

  let message = {
    headline: t('topbar.preCheckInHeadline'),
    subline: t('topbar.preCheckInSubline'),
  };

  try {
    const todayRecord = (await fetchAttendance({
      userId: state.profile.id,
      date: todayIso(),
      limit: 1,
    }))[0] || null;

    if (todayRecord?.check_out_time) {
      message = {
        headline: t('topbar.afterCheckOutHeadline'),
        subline: t('topbar.afterCheckOutSubline'),
      };
    } else if (todayRecord?.check_in_time) {
      message = {
        headline: t('topbar.inShiftHeadline'),
        subline: t('topbar.inShiftSubline'),
      };
    }
  } catch (_error) {
    message = {
      headline: t('topbar.preCheckInHeadline'),
      subline: t('topbar.preCheckInSubline'),
    };
  }

  if (elements.topbarHeadline) {
    elements.topbarHeadline.textContent = message.headline;
  }
  if (elements.topbarSubline) {
    elements.topbarSubline.textContent = message.subline;
  }
}

function bindStaticEvents() {
  elements.loginForm.addEventListener('submit', handleLogin);
  elements.togglePasswordBtn.addEventListener('click', () => {
    const nextType = elements.loginPassword.type === 'password' ? 'text' : 'password';
    elements.loginPassword.type = nextType;
    syncPasswordToggleLabel();
  });
  elements.logoutBtn.addEventListener('click', handleLogout);
  elements.menuToggle.addEventListener('click', () => {
    elements.sidebar.classList.toggle('open');
  });
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-language-toggle]');
    if (!trigger) {
      return;
    }

    toggleLanguage();
  });
  elements.modalBackdrop.addEventListener('click', () => closeModal(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.modal.classList.contains('hidden')) {
      closeModal(false);
    }
  });
  elements.sidebarNav.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-page]');
    if (!trigger) {
      return;
    }

    navigate(trigger.dataset.page);
  });
  window.addEventListener('hashchange', () => {
    renderRoute().catch((error) => {
      showToast(error.message, 'error');
    });
  });
}

function scheduleLiveRefresh() {
  if (!state.profile) {
    return;
  }

  window.clearTimeout(state.liveRefreshTimer);
  state.liveRefreshTimer = window.setTimeout(() => {
    renderRoute().catch((error) => showToast(error.message, 'error'));
  }, 450);
}

function setupRealtimeSubscriptions() {
  clearRealtimeSubscriptions();

  if (!supabase || !state.profile) {
    return;
  }

  const attendanceChannel = supabase
    .channel(`attendance-feed-${state.profile.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, scheduleLiveRefresh)
    .subscribe();

  realtimeChannels.push(attendanceChannel);

  const profileChannel = supabase
    .channel(`profiles-feed-${state.profile.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, scheduleLiveRefresh)
    .subscribe();

  realtimeChannels.push(profileChannel);
}

async function boot() {
  applyDocumentLanguage();
  syncPasswordToggleLabel();
  bindStaticEvents();
  startClock();
  onLanguageChange(async () => {
    syncPasswordToggleLabel();
    syncShell();
    await refreshTopbarMessage().catch(() => {});
    if (state.profile) {
      await renderRoute().catch((error) => showToast(error.message, 'error'));
    }
  });

  if (!isSupabaseReady()) {
    elements.loginBtn.disabled = true;
    setLoginError('Supabase configuration is missing. Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.');
    return;
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(async () => {
      if (!session) {
        resetSessionState();
        showLogin();
        return;
      }

      try {
        await handleAuthenticatedSession(session);
      } catch (error) {
        setLoginError(error.message);
      }
    }, 0);
  });

  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await handleAuthenticatedSession(session);
  } else {
    showLogin();
  }
}

async function handleAuthenticatedSession(session) {
  const profile = await fetchMyProfile(session.user.id);

  if (!profile) {
    await supabase.auth.signOut();
    throw new Error('Your profile is missing. Contact an administrator.');
  }

  if (!profile.is_active) {
    await supabase.auth.signOut();
    throw new Error('Your account is inactive. Contact an administrator.');
  }

  state.session = session;
  state.profile = profile;
  state.profileMap.set(profile.id, profile);
  syncShell();
  showAppShell();
  setupRealtimeSubscriptions();

  const nextTarget = new URLSearchParams(window.location.search).get('next');
  if (nextTarget === 'checkin') {
    window.location.replace('/checkin');
    return;
  }

  await renderRoute();
}

async function handleLogin(event) {
  event.preventDefault();
  setLoginError();
  elements.loginBtn.disabled = true;
  elements.loginBtn.textContent = t('login.signingIn');

  try {
    const { error, data } = await supabase.auth.signInWithPassword({
      email: elements.loginEmail.value.trim(),
      password: elements.loginPassword.value,
    });

    if (error) {
      throw new Error(error.message || t('login.unableToSignIn'));
    }

    await handleAuthenticatedSession(data.session);
  } catch (error) {
    setLoginError(error.message || t('login.unableToSignIn'));
  } finally {
    elements.loginBtn.disabled = false;
    elements.loginBtn.textContent = t('login.signIn');
  }
}

async function handleLogout() {
  clearRealtimeSubscriptions();
  await supabase.auth.signOut();
  resetSessionState();
  showLogin();
}

function navigate(page) {
  if (!allowedPages().includes(page)) {
    page = 'dashboard';
  }

  if (window.location.hash.replace(/^#/, '') === page) {
    renderRoute().catch((error) => showToast(error.message, 'error'));
    return;
  }

  window.location.hash = page;
}

async function renderRoute() {
  if (!state.profile) {
    return;
  }

  const requestedPage = pageFromHash();
  const page = allowedPages().includes(requestedPage) ? requestedPage : 'dashboard';
  if (requestedPage !== page) {
    window.location.hash = page;
    return;
  }

  syncPageFrame(page);
  elements.sidebar.classList.remove('open');

  if (page === 'dashboard') {
    await renderDashboardPage();
    return;
  }
  if (page === 'profile') {
    await renderProfilePage();
    return;
  }
  if (page === 'employees') {
    await renderEmployeesPage();
    return;
  }
  if (page === 'attendance') {
    await renderAttendancePage();
    return;
  }

  if (page === 'history') {
    await renderHistoryPage();
    return;
  }
  if (page === 'reports') {
    await renderReportsPage();
    return;
  }
  if (page === 'qr') {
    await renderQrPage();
  }
}

function buildSummaryCard(label, value, meta = '') {
  return `
    <article class="summary-card">
      <span class="story-label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <p class="inline-note">${escapeHtml(meta)}</p>
    </article>
  `;
}

function buildUserCell(profile) {
  return `
    <div class="table-user">
      <div class="avatar-badge">${escapeHtml(toInitials(profile?.full_name || 'EV'))}</div>
      <div>
        <strong>${escapeHtml(profile?.full_name || 'Unknown user')}</strong>
        <span>${escapeHtml(profile?.email || '-')}</span>
      </div>
    </div>
  `;
}

function badgeMarkup(type, value, label = null) {
  return `<span class="badge ${escapeHtml(type)}">${escapeHtml(label || statusLabel(value))}</span>`;
}

function paginateItems(items, paginationState) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / paginationState.pageSize));
  const currentPage = Math.min(Math.max(paginationState.page, 1), totalPages);
  paginationState.page = currentPage;

  const startIndex = (currentPage - 1) * paginationState.pageSize;
  const endIndex = startIndex + paginationState.pageSize;

  return {
    items: items.slice(startIndex, endIndex),
    totalItems,
    totalPages,
    currentPage,
    pageSize: paginationState.pageSize,
    startItem: totalItems ? startIndex + 1 : 0,
    endItem: totalItems ? Math.min(endIndex, totalItems) : 0,
  };
}

function buildPaginationMarkup(id, meta) {
  if (meta.totalItems <= meta.pageSize) {
    return `
      <div class="pagination compact">
        <span class="pagination-summary">Showing ${escapeHtml(String(meta.totalItems))} record(s)</span>
      </div>
    `;
  }

  return `
    <div class="pagination" data-pagination="${escapeHtml(id)}">
      <span class="pagination-summary">Showing ${escapeHtml(String(meta.startItem))}-${escapeHtml(String(meta.endItem))} of ${escapeHtml(String(meta.totalItems))}</span>
      <div class="inline-actions">
        <button type="button" class="btn btn-secondary" data-page-action="prev" ${meta.currentPage === 1 ? 'disabled' : ''}>Previous</button>
        <span class="pagination-pill">Page ${escapeHtml(String(meta.currentPage))} / ${escapeHtml(String(meta.totalPages))}</span>
        <button type="button" class="btn btn-secondary" data-page-action="next" ${meta.currentPage === meta.totalPages ? 'disabled' : ''}>Next</button>
      </div>
    </div>
  `;
}

function bindPagination(container, paginationId, paginationState, rerender) {
  container.querySelector(`[data-pagination="${paginationId}"]`)?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page-action]');
    if (!button) {
      return;
    }

    if (button.dataset.pageAction === 'prev') {
      paginationState.page = Math.max(1, paginationState.page - 1);
    }
    if (button.dataset.pageAction === 'next') {
      paginationState.page += 1;
    }

    rerender();
  });
}

function confirmAction({ eyebrow = 'Please confirm', title, message, confirmLabel = 'Confirm', tone = 'danger' }) {
  return new Promise((resolve) => {
    openModal(`
      <div class="modal-header">
        <div>
          <p class="eyebrow">${escapeHtml(eyebrow)}</p>
          <h2>${escapeHtml(title)}</h2>
        </div>
        <button id="closeModalBtn" type="button" class="ghost-inline">Close</button>
      </div>
      <div class="form-alert info">${escapeHtml(message)}</div>
      <div class="modal-footer">
        <div></div>
        <div class="inline-actions">
          <button id="cancelConfirmBtn" type="button" class="btn btn-secondary">Cancel</button>
          <button id="submitConfirmBtn" type="button" class="btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `, {
      onClose: (payload) => resolve(Boolean(payload)),
    });

    document.getElementById('closeModalBtn')?.addEventListener('click', () => closeModal(false));
    document.getElementById('cancelConfirmBtn')?.addEventListener('click', () => closeModal(false));
    document.getElementById('submitConfirmBtn')?.addEventListener('click', () => closeModal(true));
  });
}

async function renderDashboardPage() {
  const container = elements.pages.dashboard;
  setPageLoading(container, 'Loading dashboard');

  try {
    const today = todayIso();

    if (isAdmin()) {
      const [employees, todayAttendance] = await Promise.all([
        fetchEmployees(),
        fetchAttendance({ date: today, limit: 250 }),
      ]);
      state.employees = employees;
      state.profileMap = new Map(employees.map((employee) => [employee.id, employee]));

      const activeEmployees = employees.filter((employee) => employee.is_active);
      const onLeave = employees.filter((employee) => employee.status === 'on_leave').length;
      const todayDetailed = todayAttendance.map((row) => ({
        row,
        profile: employeeById(row.user_id),
        metrics: buildAttendanceRowMetrics(row),
      }));
      const presentToday = todayDetailed.filter((entry) => entry.metrics.isPresent).length;
      const absentToday = Math.max(activeEmployees.length - presentToday, 0);
      const lateToday = todayDetailed.filter((entry) => entry.metrics.isLateArrival || entry.row.attendance_status === 'late').length;
      const fullShiftCount = todayDetailed.filter((entry) => entry.metrics.isCompleteShift && entry.metrics.shortfallMinutes === 0 && entry.metrics.overtimeMinutes === 0).length;
      const openShiftCount = todayDetailed.filter((entry) => entry.metrics.isOpenShift).length;
      const workedMinutesToday = sumMetrics(todayDetailed, (entry) => entry.metrics.workedMinutes);
      const overtimeMinutesToday = sumMetrics(todayDetailed, (entry) => entry.metrics.overtimeMinutes);
      const shortfallMinutesToday = sumMetrics(todayDetailed, (entry) => entry.metrics.shortfallMinutes);
      const recentRows = todayAttendance.slice(0, 8);
      const accountabilityRows = todayDetailed
        .slice()
        .sort((left, right) => {
          const leftRank = left.metrics.isOpenShift ? 0 : left.metrics.shortfallMinutes > 0 ? 1 : left.metrics.overtimeMinutes > 0 ? 2 : 3;
          const rightRank = right.metrics.isOpenShift ? 0 : right.metrics.shortfallMinutes > 0 ? 1 : right.metrics.overtimeMinutes > 0 ? 2 : 3;
          if (leftRank !== rightRank) {
            return leftRank - rightRank;
          }

          return right.metrics.workedMinutes - left.metrics.workedMinutes;
        })
        .slice(0, 10);

      container.innerHTML = `
        <div class="page-shell">
          <div class="section-header">
            <div>
              <p class="eyebrow">Overview</p>
              <h1>Operations dashboard</h1>
              <p>Live employee and attendance data connected directly to Supabase.</p>
            </div>
            <button id="dashboardRefreshBtn" type="button" class="btn btn-secondary">Refresh</button>
          </div>
          <div class="summary-grid">
            ${buildSummaryCard('Total Employees', String(employees.length), 'All profiles in the workspace')}
            ${buildSummaryCard('Active Employees', String(activeEmployees.length), 'Ready for attendance today')}
            ${buildSummaryCard('On Leave', String(onLeave), 'Employees currently on leave')}
            ${buildSummaryCard('Present Today', String(presentToday), 'Attendance records created today')}
            ${buildSummaryCard('Absent Today', String(absentToday), 'Active employees with no check-in yet')}
            ${buildSummaryCard('Late Today', String(lateToday), 'Computed from check-in time')}
            ${buildSummaryCard('Worked Today', formatDuration(workedMinutesToday), 'Combined completed and open shift minutes')}
            ${buildSummaryCard('8-Hour Actuals', `${fullShiftCount} full / ${openShiftCount} open`, `${formatDuration(overtimeMinutesToday)} overtime · ${formatDuration(shortfallMinutesToday)} shortfall`)}
          </div>
          <section class="card-block">
            <div class="card-head">
              <div>
                <h3>8-hour actuals today</h3>
                <p class="card-subtle">Track who completed a full shift, who is still active, and where shortfall or overtime needs attention.</p>
              </div>
            </div>
            <div class="table-shell">
              <table>
                <thead>
                  <tr><th>Employee</th><th>Worked</th><th>Overtime</th><th>Shortfall</th><th>Shift Outcome</th></tr>
                </thead>
                <tbody>
                  ${accountabilityRows.length ? accountabilityRows.map((entry) => `
                    <tr>
                      <td>${buildUserCell(entry.profile)}</td>
                      <td><strong>${escapeHtml(formatDuration(entry.metrics.workedMinutes))}</strong></td>
                      <td>${escapeHtml(formatDuration(entry.metrics.overtimeMinutes))}</td>
                      <td>${escapeHtml(formatDuration(entry.metrics.shortfallMinutes || entry.metrics.projectedRemainingMinutes))}</td>
                      <td>${escapeHtml(attendanceOutcome(entry.metrics))}</td>
                    </tr>
                  `).join('') : '<tr><td colspan="5"><div class="empty-state">No attendance rows have been recorded yet for today.</div></td></tr>'}
                </tbody>
              </table>
            </div>
          </section>
          <div class="content-grid">
            <section class="card-block">
              <div class="card-head">
                <div>
                  <h3>Recent attendance activity</h3>
                  <p class="card-subtle">Most recent activity for ${escapeHtml(formatDate(today))}</p>
                </div>
              </div>
              <div class="table-shell">
                <table>
                  <thead>
                    <tr><th>Employee</th><th>Department</th><th>Check In</th><th>Check Out</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    ${recentRows.length ? recentRows.map((row) => {
                      const profile = employeeById(row.user_id);
                      return `
                        <tr>
                          <td>${buildUserCell(profile)}</td>
                          <td>${escapeHtml(departmentLabel(profile?.department))}</td>
                          <td>${escapeHtml(formatTime(row.check_in_time))}</td>
                          <td>${escapeHtml(formatTime(row.check_out_time))}</td>
                          <td>${badgeMarkup(row.attendance_status, row.attendance_status)}</td>
                        </tr>
                      `;
                    }).join('') : '<tr><td colspan="5"><div class="empty-state">No attendance records have been created yet for today.</div></td></tr>'}
                  </tbody>
                </table>
              </div>
            </section>
            <aside class="card-block">
              <div class="card-head">
                <div>
                  <h3>Department pulse</h3>
                  <p class="card-subtle">Current employee distribution</p>
                </div>
              </div>
              <div class="page-shell">
                ${Object.entries(employees.reduce((acc, employee) => {
                  const key = departmentLabel(employee.department);
                  acc[key] = (acc[key] || 0) + 1;
                  return acc;
                }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([department, count]) => `
                  <div class="status-card compact">
                    <div>
                      <span class="status-label">Department</span>
                      <strong>${escapeHtml(department)}</strong>
                      <p class="inline-note">${escapeHtml(String(count))} team member(s)</p>
                    </div>
                  </div>
                `).join('') || '<div class="empty-state">No department data available yet.</div>'}
              </div>
            </aside>
          </div>
        </div>
      `;

      container.querySelector('#dashboardRefreshBtn')?.addEventListener('click', () => {
        renderDashboardPage().catch((error) => setPageError(container, error.message));
      });
      return;
    }

    const currentMonth = monthRange(currentMonthInput());
    const [todayAttendance, recentAttendance, monthAttendance] = await Promise.all([
      fetchAttendance({ date: today, limit: 1 }),
      fetchAttendance({ from: offsetDate(-14), to: today, limit: 14 }),
      fetchAttendance({ from: currentMonth.from, to: currentMonth.to, limit: 60 }),
    ]);
    const todayRecord = todayAttendance[0] || null;
    const todayMetrics = todayRecord ? buildAttendanceRowMetrics(todayRecord) : null;
    const checkedDays = recentAttendance.filter((row) => row.check_in_time).length;
    const lateDays = recentAttendance.filter((row) => row.attendance_status === 'late').length;
    const monthDetailed = monthAttendance.map((row) => ({
      row,
      metrics: buildAttendanceRowMetrics(row),
    }));
    const fullShiftDays = monthDetailed.filter((entry) => entry.metrics.isCompleteShift && entry.metrics.shortfallMinutes === 0).length;
    const monthOvertimeMinutes = sumMetrics(monthDetailed, (entry) => entry.metrics.overtimeMinutes);
    const monthShortfallMinutes = sumMetrics(monthDetailed, (entry) => entry.metrics.shortfallMinutes);
    let balanceLabel = '8-hour target waiting to begin';
    let balanceMeta = 'No attendance recorded yet for today.';

    if (todayMetrics?.isOpenShift) {
      balanceLabel = `${formatDuration(todayMetrics.projectedRemainingMinutes)} remaining`;
      balanceMeta = 'Live estimate until you reach the full 8-hour target.';
    } else if (todayMetrics?.overtimeMinutes) {
      balanceLabel = `+${formatDuration(todayMetrics.overtimeMinutes)}`;
      balanceMeta = 'You exceeded the 8-hour target today.';
    } else if (todayMetrics?.shortfallMinutes) {
      balanceLabel = formatDuration(todayMetrics.shortfallMinutes);
      balanceMeta = 'Below the 8-hour target for the current shift.';
    } else if (todayMetrics?.isCompleteShift) {
      balanceLabel = 'Full shift reached';
      balanceMeta = 'You completed the 8-hour target today.';
    }

    container.innerHTML = `
      <div class="page-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">Welcome</p>
            <h1>${escapeHtml(state.profile.full_name)}</h1>
            <p>Your attendance overview is ready with live 8-hour tracking and attendance actions.</p>
          </div>
          <div class="inline-actions">
            <button id="employeeAttendanceShortcut" type="button" class="btn btn-secondary">Open attendance</button>
          </div>
        </div>
        <div class="summary-grid">
          ${buildSummaryCard('Today Status', todayRecord ? statusLabel(todayRecord.attendance_status) : 'Pending', todayRecord ? `Checked in ${formatTime(todayRecord.check_in_time)}` : 'No attendance recorded yet')}
          ${buildSummaryCard('Worked Today', formatDuration(todayMetrics?.workedMinutes || 0), todayMetrics ? attendanceOutcome(todayMetrics) : 'No attendance recorded yet')}
          ${buildSummaryCard('Today Balance', balanceLabel, balanceMeta)}
          ${buildSummaryCard('Full Shifts This Month', String(fullShiftDays), `${checkedDays} checked day(s) in your recent history`)}
          ${buildSummaryCard('Overtime This Month', formatDuration(monthOvertimeMinutes), 'Minutes above the daily 8-hour baseline')}
          ${buildSummaryCard('Shortfall This Month', formatDuration(monthShortfallMinutes), `${lateDays} late day(s) in your recent history`)}
        </div>
        <section class="card-block">
          <div class="card-head">
            <div>
              <h3>Recent personal history</h3>
              <p class="card-subtle">Your latest attendance records and 8-hour outcomes.</p>
            </div>
          </div>
          <div class="table-shell">
            <table>
              <thead>
                <tr><th>Date</th><th>Check In</th><th>Check Out</th><th>Status</th><th>Worked</th><th>Outcome</th></tr>
              </thead>
              <tbody>
                ${recentAttendance.length ? recentAttendance.map((row) => {
                  const metrics = buildAttendanceRowMetrics(row);
                  return `
                  <tr>
                    <td>${escapeHtml(formatDate(row.attendance_date))}</td>
                    <td>${escapeHtml(formatTime(row.check_in_time))}</td>
                    <td>${escapeHtml(formatTime(row.check_out_time))}</td>
                    <td>${badgeMarkup(row.attendance_status, row.attendance_status)}</td>
                    <td>${escapeHtml(formatDuration(metrics.workedMinutes))}</td>
                    <td>${escapeHtml(attendanceOutcome(metrics))}</td>
                  </tr>
                `;
                }).join('') : '<tr><td colspan="6"><div class="empty-state">No attendance records available yet.</div></td></tr>'}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    container.querySelector('#employeeAttendanceShortcut')?.addEventListener('click', () => navigate('attendance'));
  } catch (error) {
    setPageError(container, error.message);
  }
}
function filteredEmployees() {
  return state.employees.filter((employee) => {
    const matchesSearch = `${employee.full_name} ${employee.employee_code || ''} ${employee.email} ${employee.department || ''} ${employee.position || ''}`
      .toLowerCase()
      .includes(state.employeeFilters.search.toLowerCase());
    const matchesDepartment = state.employeeFilters.department === 'all'
      || departmentLabel(employee.department) === state.employeeFilters.department;
    const matchesStatus = state.employeeFilters.status === 'all'
      || employee.status === state.employeeFilters.status;
    return matchesSearch && matchesDepartment && matchesStatus;
  });
}

async function renderEmployeesPage() {
  const container = elements.pages.employees;
  if (!isAdmin()) {
    setPageError(container, 'Only admins can access employee management.');
    return;
  }

  setPageLoading(container, 'Loading employees');

  try {
    state.employees = await fetchEmployees();
    state.profileMap = new Map(state.employees.map((employee) => [employee.id, employee]));
    drawEmployeesPage();
  } catch (error) {
    setPageError(container, error.message);
  }
}

async function renderProfilePage() {
  const container = elements.pages.profile;
  setPageLoading(container, 'Loading profile');

  try {
    const records = await fetchAttendance({
      userId: state.profile.id,
      from: offsetDate(-30),
      to: todayIso(),
      limit: 30,
    });
    const currentMonth = monthRange(currentMonthInput());
    const monthRecords = records.filter((row) => row.attendance_date >= currentMonth.from && row.attendance_date <= currentMonth.to);
    const latestRecord = records[0] || null;
    const checkedDays = records.filter((row) => row.check_in_time).length;
    const completedDays = records.filter((row) => row.check_out_time).length;
    const lateDays = records.filter((row) => row.attendance_status === 'late').length;
    const monthlyPresentDays = new Set(monthRecords.filter((row) => row.check_in_time).map((row) => row.attendance_date)).size;
    const monthlyRatio = currentMonth ? Math.round((monthlyPresentDays / Math.max(enumerateDates(currentMonth.startDate, currentMonth.endDate).filter(isWorkday).length, 1)) * 100) : 0;
    const monthlyAverageCheckIn = formatAverageTime(average(monthRecords.map((row) => minutesFromTimestamp(row.check_in_time))));

    container.innerHTML = `
      <div class="page-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">Identity</p>
            <h1>${escapeHtml(state.profile.full_name)}</h1>
            <p>Keep your account details, attendance status, and access information in one place.</p>
          </div>
          <div class="inline-actions">
            <button id="openHistoryFromProfileBtn" type="button" class="btn btn-secondary">Open history</button>
            <button id="openAttendanceFromProfileBtn" type="button" class="btn btn-primary">Open attendance</button>
          </div>
        </div>
        <div class="summary-grid">
          ${buildSummaryCard('Role', roleLabel(state.profile.role), state.profile.is_active ? 'Access enabled' : 'Access disabled')}
          ${buildSummaryCard('Department', departmentLabel(state.profile.department), state.profile.position || 'No position assigned')}
          ${buildSummaryCard('Checked Days', String(checkedDays), 'Last 30 calendar days')}
          ${buildSummaryCard('Late Days', String(lateDays), latestRecord ? `Latest ${statusLabel(latestRecord.attendance_status)}` : 'No attendance yet')}
          ${buildSummaryCard('This Month', `${monthlyRatio}%`, `${monthlyPresentDays} present day(s) in ${currentMonth.label}`)}
          ${buildSummaryCard('Avg Check In', monthlyAverageCheckIn, 'Current month average')}
        </div>
        <div class="content-grid">
          <section class="card-block">
            <div class="card-head">
              <div>
                <h3>Profile details</h3>
                <p class="card-subtle">Live profile data from Supabase</p>
              </div>
            </div>
            <div class="form-grid profile-grid">
              <div class="status-card compact"><div><span class="status-label">Employee Code</span><strong>${escapeHtml(state.profile.employee_code || '-')}</strong></div></div>
              <div class="status-card compact"><div><span class="status-label">Email</span><strong>${escapeHtml(state.profile.email)}</strong></div></div>
              <div class="status-card compact"><div><span class="status-label">Phone</span><strong>${escapeHtml(state.profile.phone || '-')}</strong></div></div>
              <div class="status-card compact"><div><span class="status-label">Position</span><strong>${escapeHtml(state.profile.position || '-')}</strong></div></div>
              <div class="status-card compact"><div><span class="status-label">Status</span><strong>${escapeHtml(statusLabel(state.profile.status))}</strong></div></div>
              <div class="status-card compact"><div><span class="status-label">Account Access</span><strong>${escapeHtml(state.profile.is_active ? 'Active' : 'Inactive')}</strong></div></div>
              <div class="status-card compact"><div><span class="status-label">Created</span><strong>${escapeHtml(formatDateTime(state.profile.created_at))}</strong></div></div>
              <div class="status-card compact"><div><span class="status-label">Updated</span><strong>${escapeHtml(formatDateTime(state.profile.updated_at))}</strong></div></div>
            </div>
          </section>
          <section class="card-block">
            <div class="card-head">
              <div>
                <h3>Recent attendance snapshot</h3>
                <p class="card-subtle">Your latest 8 attendance rows</p>
              </div>
            </div>
            <div class="summary-grid compact-grid">
              ${buildSummaryCard('Completed Days', String(completedDays), 'Rows with check-out time')}
              ${buildSummaryCard('Latest Check In', latestRecord?.check_in_time ? formatTime(latestRecord.check_in_time) : '-', latestRecord ? formatDate(latestRecord.attendance_date) : 'No row yet')}
            </div>
            <div class="table-shell">
              <table>
                <thead>
                  <tr><th>Date</th><th>Check In</th><th>Check Out</th><th>Status</th></tr>
                </thead>
                <tbody>
                  ${records.slice(0, 8).length ? records.slice(0, 8).map((row) => `
                    <tr>
                      <td>${escapeHtml(formatDate(row.attendance_date))}</td>
                      <td>${escapeHtml(formatTime(row.check_in_time))}</td>
                      <td>${escapeHtml(formatTime(row.check_out_time))}</td>
                      <td>${badgeMarkup(row.attendance_status, row.attendance_status)}</td>
                    </tr>
                  `).join('') : '<tr><td colspan="4"><div class="empty-state">Your attendance rows will appear here as soon as they are recorded.</div></td></tr>'}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    `;

    container.querySelector('#openAttendanceFromProfileBtn')?.addEventListener('click', () => navigate('attendance'));
    container.querySelector('#openHistoryFromProfileBtn')?.addEventListener('click', () => navigate('history'));
  } catch (error) {
    setPageError(container, error.message);
  }
}

async function renderReportsPage() {
  const container = elements.pages.reports;
  if (!isAdmin()) {
    setPageError(container, 'Only admins can access reports and analytics.');
    return;
  }

  setPageLoading(container, 'Loading reports');

  try {
    if (!state.employees.length) {
      state.employees = await fetchEmployees();
      state.profileMap = new Map(state.employees.map((employee) => [employee.id, employee]));
      state.profileMap.set(state.profile.id, state.profile);
    }

    const eligibleEmployees = state.employees.filter((employee) => employee.is_active && employee.status !== 'inactive');
    const scopedEmployees = reportsEmployeeChoices(eligibleEmployees, state.reportsFilters.department);
    if (state.reportsFilters.employeeId !== 'all' && !scopedEmployees.some((employee) => employee.id === state.reportsFilters.employeeId)) {
      state.reportsFilters.employeeId = 'all';
    }

    const range = monthRange(state.reportsFilters.month);
    const attendanceRows = await fetchAttendance({
      from: range.from,
      to: range.to,
    });
    await ensureProfileDirectory(attendanceRows);

    const report = buildReportsDataset(state.employees, attendanceRows, state.reportsFilters);
    const peakWeekday = report.weekdayRows[0];
    const departmentChoices = reportsDepartmentChoices(eligibleEmployees);
    const employeeChoices = reportsEmployeeChoices(eligibleEmployees, state.reportsFilters.department);
    const selectedEmployee = report.selectedEmployeeReport;

    container.innerHTML = `
      <div class="page-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">Insights</p>
            <h1>Reports & Analytics</h1>
            <p>Track worked hours, overtime, shortfall, punctuality, and department-level performance from one control page.</p>
          </div>
          <div class="inline-actions">
            <button id="reportsExportBtn" type="button" class="btn btn-secondary">Export Report CSV</button>
            ${selectedEmployee ? '<button id="reportsTimesheetExportBtn" type="button" class="btn btn-primary">Export Timesheet CSV</button>' : ''}
          </div>
        </div>
        <section class="card-block">
          <div class="toolbar toolbar-wide">
            <input id="reportsMonth" type="month" value="${escapeHtml(state.reportsFilters.month)}" />
            <select id="reportsDepartment">
              <option value="all">All Departments</option>
              ${departmentChoices.map((department) => `<option value="${escapeHtml(department)}" ${state.reportsFilters.department === department ? 'selected' : ''}>${escapeHtml(department)}</option>`).join('')}
            </select>
            <select id="reportsEmployee">
              ${reportEmployeeOptions(employeeChoices, state.reportsFilters.employeeId)}
            </select>
            <button id="reportsApplyBtn" type="button" class="btn btn-secondary">Apply</button>
            <button id="reportsRefreshBtn" type="button" class="btn btn-secondary">Refresh</button>
          </div>
          <p class="inline-note">Reporting period: ${escapeHtml(report.range.label)} · Employees in scope: ${escapeHtml(String(report.filteredEmployees.length))}</p>
        </section>
        <div class="summary-grid">
          ${buildSummaryCard('Total Hours Worked', formatDuration(report.totals.totalHoursWorkedMinutes), 'Across the current report scope')}
          ${buildSummaryCard('Total Overtime', formatDuration(report.totals.totalOvertimeMinutes), 'Minutes above the 8-hour daily baseline')}
          ${buildSummaryCard('Total Shortfall', formatDuration(report.totals.totalShortfallMinutes), 'Missing time below the 8-hour daily target')}
          ${buildSummaryCard('Attendance Rate', `${report.totals.attendanceRate}%`, `${report.totals.totalPresentDays} present day(s) out of ${report.totals.totalExpectedDays || 0}`)}
          ${buildSummaryCard('On-Time Arrival', `${report.totals.onTimeArrivalRate}%`, 'Arrivals at or before 09:15 Africa/Cairo')}
          ${buildSummaryCard('Peak Absence Day', peakWeekday ? peakWeekday.weekday : 'N/A', peakWeekday ? `${peakWeekday.absentCount} total absences` : 'No absence trend yet')}
        </div>
        <div class="content-grid">
          <section class="card-block">
            <div class="card-head">
              <div>
                <h3>Working hours trend</h3>
                <p class="card-subtle">Daily worked hours and overtime across the selected month.</p>
              </div>
            </div>
            ${report.dailyTrend.length ? `
              <div class="chart-shell">
                <canvas id="reportsHoursCanvas" aria-label="Working hours trend chart"></canvas>
              </div>
            ` : '<div class="empty-state">No working-hours data is available for this period.</div>'}
          </section>
          <section class="card-block">
            <div class="card-head">
              <div>
                <h3>Department hours comparison</h3>
                <p class="card-subtle">Actual hours versus expected hours for each department in scope.</p>
              </div>
            </div>
            ${report.departmentHours.length ? `
              <div class="chart-shell">
                <canvas id="reportsDepartmentCanvas" aria-label="Department hours comparison chart"></canvas>
              </div>
            ` : '<div class="empty-state">No department comparison is available for this scope.</div>'}
          </section>
        </div>
        <section class="card-block">
          <div class="card-head">
            <div>
              <h3>Detailed monthly employee report</h3>
              <p class="card-subtle">Attendance days, hours, overtime, and trend classification for each employee in scope.</p>
            </div>
          </div>
          <div class="table-shell">
            <table>
              <thead>
                <tr><th>Employee Name</th><th>Days Present</th><th>Days Absent</th><th>Late Arrivals</th><th>Total Hours</th><th>Expected Hours</th><th>Overtime</th><th>Status/Trend</th></tr>
              </thead>
              <tbody>
                ${report.byEmployee.length ? report.byEmployee.map((item) => `
                  <tr>
                    <td>${buildUserCell(item.employee)}</td>
                    <td>${escapeHtml(String(item.presentDays))}</td>
                    <td>${escapeHtml(String(item.absentDays))}</td>
                    <td>${escapeHtml(String(item.lateArrivals))}</td>
                    <td><strong>${escapeHtml(formatDuration(item.workedMinutes))}</strong></td>
                    <td>${escapeHtml(formatDuration(item.expectedMinutes))}</td>
                    <td>${escapeHtml(formatDuration(item.overtimeMinutes))}</td>
                    <td>
                      <div class="report-trend-cell">
                        ${trendBadgeMarkup(item.trend)}
                        <span class="inline-note">${escapeHtml(`${item.attendanceRate}% attendance · ${item.onTimeArrivalRate}% on-time`)}</span>
                      </div>
                    </td>
                  </tr>
                `).join('') : '<tr><td colspan="8"><div class="empty-state">No employee attendance data is available for this period.</div></td></tr>'}
              </tbody>
            </table>
          </div>
        </section>
        <div class="content-grid">
          <section class="card-block">
            <div class="card-head">
              <div>
                <h3>Top attendance ranking</h3>
                <p class="card-subtle">Employees ranked by attendance rate, on-time arrivals, and completed hours.</p>
              </div>
            </div>
            <div class="page-shell">
              ${report.topPerformers.length ? report.topPerformers.map((item, index) => `
                <div class="status-card compact">
                  <div>
                    <span class="status-label">Rank ${index + 1}</span>
                    <strong>${escapeHtml(item.employee.full_name)}</strong>
                    <p class="inline-note">${escapeHtml(`${item.attendanceRate}% attendance · ${item.onTimeArrivalRate}% on-time · ${formatDuration(item.workedMinutes)}`)}</p>
                  </div>
                </div>
              `).join('') : '<div class="empty-state">No ranking is available yet.</div>'}
            </div>
          </section>
          <section class="card-block">
            <div class="card-head">
              <div>
                <h3>Peak absence weekdays</h3>
                <p class="card-subtle">Total absences grouped by weekday for the selected month.</p>
              </div>
            </div>
            <div class="table-shell">
              <table>
                <thead>
                  <tr><th>Weekday</th><th>Total Absences</th><th>Occurrences</th></tr>
                </thead>
                <tbody>
                  ${report.weekdayRows.length ? report.weekdayRows.map((item) => `
                    <tr>
                      <td>${escapeHtml(item.weekday)}</td>
                      <td>${escapeHtml(String(item.absentCount))}</td>
                      <td>${escapeHtml(String(item.occurrences))}</td>
                    </tr>
                  `).join('') : '<tr><td colspan="3"><div class="empty-state">No weekday absence trend is available yet.</div></td></tr>'}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <section class="card-block">
          <div class="card-head">
            <div>
              <h3>Average check-in and check-out times</h3>
              <p class="card-subtle">Average times are based on attendance rows with recorded timestamps in Africa/Cairo.</p>
            </div>
          </div>
          <div class="table-shell">
            <table>
              <thead>
                <tr><th>Employee</th><th>Average Check In</th><th>Average Check Out</th><th>On-Time Arrival</th><th>Complete Shifts</th></tr>
              </thead>
              <tbody>
                ${report.byEmployee.length ? report.byEmployee.map((item) => `
                  <tr>
                    <td>${buildUserCell(item.employee)}</td>
                    <td>${escapeHtml(formatAverageTime(item.averageCheckIn))}</td>
                    <td>${escapeHtml(formatAverageTime(item.averageCheckOut))}</td>
                    <td>${escapeHtml(`${item.onTimeArrivalRate}%`)}</td>
                    <td>${escapeHtml(String(item.detailedRows.filter((entry) => entry.metrics.isCompleteShift).length))}</td>
                  </tr>
                `).join('') : '<tr><td colspan="5"><div class="empty-state">No time analytics are available for this period.</div></td></tr>'}
              </tbody>
            </table>
          </div>
        </section>
        <section class="card-block">
          <div class="card-head">
            <div>
              <h3>Employee timesheet</h3>
              <p class="card-subtle">Choose a specific employee from the filter above to inspect daily hours and shift outcomes.</p>
            </div>
          </div>
          ${selectedEmployee ? `
            <div class="summary-grid compact-grid">
              ${buildSummaryCard('Selected Employee', selectedEmployee.employee.full_name, departmentLabel(selectedEmployee.employee.department))}
              ${buildSummaryCard('Total Hours', formatDuration(selectedEmployee.workedMinutes), `${selectedEmployee.presentDays} present day(s)`)}
              ${buildSummaryCard('Overtime', formatDuration(selectedEmployee.overtimeMinutes), `${selectedEmployee.lateArrivals} late arrival(s)`)}
              ${buildSummaryCard('Shortfall', formatDuration(selectedEmployee.shortfallMinutes), `${selectedEmployee.absentDays} absence day(s)`)}
            </div>
            <div class="table-shell">
              <table>
                <thead>
                  <tr><th>Date</th><th>Arrival</th><th>Check In</th><th>Check Out</th><th>Total Hours</th><th>Overtime</th><th>Shortfall</th><th>Shift Result</th></tr>
                </thead>
                <tbody>
                  ${selectedEmployee.detailedRows.length ? selectedEmployee.detailedRows.map((entry) => `
                    <tr>
                      <td>${escapeHtml(formatDate(entry.row.attendance_date))}</td>
                      <td>${entry.metrics.isPresent ? trendBadgeMarkup(entry.metrics.isLateArrival ? { label: 'Late', className: 'trend-focus' } : { label: 'On Time', className: 'trend-exceptional' }) : '<span class="badge trend-risk">No Check-in</span>'}</td>
                      <td>${escapeHtml(formatTime(entry.row.check_in_time))}</td>
                      <td>${escapeHtml(formatTime(entry.row.check_out_time))}</td>
                      <td>${escapeHtml(formatDuration(entry.metrics.workedMinutes))}</td>
                      <td>${escapeHtml(formatDuration(entry.metrics.overtimeMinutes))}</td>
                      <td>${escapeHtml(formatDuration(entry.metrics.shortfallMinutes))}</td>
                      <td>${escapeHtml(attendanceOutcome(entry.metrics))}</td>
                    </tr>
                  `).join('') : '<tr><td colspan="8"><div class="empty-state">No attendance rows are available for this employee in the selected period.</div></td></tr>'}
                </tbody>
              </table>
            </div>
          ` : '<div class="empty-state">Select a specific employee to view a detailed timesheet for the selected month.</div>'}
        </section>
      </div>
    `;

    const syncEmployeeOptions = () => {
      const departmentValue = container.querySelector('#reportsDepartment')?.value || 'all';
      const employeeSelect = container.querySelector('#reportsEmployee');
      if (!employeeSelect) {
        return;
      }

      const currentValue = employeeSelect.value || state.reportsFilters.employeeId;
      const allowedEmployees = reportsEmployeeChoices(eligibleEmployees, departmentValue);
      const nextValue = allowedEmployees.some((employee) => employee.id === currentValue) ? currentValue : 'all';
      employeeSelect.innerHTML = reportEmployeeOptions(allowedEmployees, nextValue);
    };

    container.querySelector('#reportsDepartment')?.addEventListener('change', syncEmployeeOptions);
    container.querySelector('#reportsApplyBtn')?.addEventListener('click', () => {
      state.reportsFilters.month = container.querySelector('#reportsMonth').value || currentMonthInput();
      state.reportsFilters.department = container.querySelector('#reportsDepartment').value || 'all';
      state.reportsFilters.employeeId = container.querySelector('#reportsEmployee').value || 'all';
      renderReportsPage().catch((error) => setPageError(container, error.message));
    });
    container.querySelector('#reportsRefreshBtn')?.addEventListener('click', () => {
      renderReportsPage().catch((error) => setPageError(container, error.message));
    });
    container.querySelector('#reportsExportBtn')?.addEventListener('click', () => {
      exportReportsCsv(report, state.reportsFilters);
      showToast('Reports CSV exported successfully.', 'success');
    });
    container.querySelector('#reportsTimesheetExportBtn')?.addEventListener('click', () => {
      if (!selectedEmployee) {
        return;
      }
      exportEmployeeTimesheetCsv(selectedEmployee, state.reportsFilters);
      showToast('Employee timesheet CSV exported successfully.', 'success');
    });
    drawWorkingHoursTrend(container.querySelector('#reportsHoursCanvas'), report.dailyTrend);
    drawDepartmentHoursChart(container.querySelector('#reportsDepartmentCanvas'), report.departmentHours);
  } catch (error) {
    setPageError(container, error.message);
  }
}

function drawEmployeesPage() {
  const container = elements.pages.employees;
  const list = filteredEmployees();
  const paginated = paginateItems(list, state.employeePagination);
  const departments = [...new Set(state.employees.map((employee) => departmentLabel(employee.department)))].sort();
  const activeCount = state.employees.filter((employee) => employee.is_active).length;
  const onLeaveCount = state.employees.filter((employee) => employee.status === 'on_leave').length;
  const activeAdminCount = state.employees.filter((employee) => employee.role === 'admin' && employee.is_active).length;

  container.innerHTML = `
    <div class="page-shell">
      <div class="section-header">
        <div>
          <p class="eyebrow">Administration</p>
          <h1>Employee Management</h1>
          <p>Manage employees, departments, and account access without leaving the workspace.</p>
        </div>
        <button id="openAddEmployeeBtn" type="button" class="btn btn-primary">Add Employee</button>
      </div>
      <div class="summary-grid">
        ${buildSummaryCard('Total Employees', String(state.employees.length), 'All employee and admin profiles')}
        ${buildSummaryCard('Active Employees', String(activeCount), 'Profiles with active access')}
        ${buildSummaryCard('On Leave', String(onLeaveCount), 'Profiles marked as on leave')}
        ${buildSummaryCard('Departments', String(departments.length), 'Distinct departments represented')}
      </div>
      <section class="card-block">
        <div class="toolbar toolbar-wide">
          <input id="employeeSearch" type="search" placeholder="Search by code, name, email, or department" value="${escapeHtml(state.employeeFilters.search)}" />
          <select id="departmentFilter">
            <option value="all">All Departments</option>
            ${departments.map((department) => `<option value="${escapeHtml(department)}" ${state.employeeFilters.department === department ? 'selected' : ''}>${escapeHtml(department)}</option>`).join('')}
          </select>
          <select id="statusFilter">
            <option value="all">All Statuses</option>
            ${['active', 'inactive', 'on_leave'].map((status) => `<option value="${status}" ${state.employeeFilters.status === status ? 'selected' : ''}>${escapeHtml(statusLabel(status))}</option>`).join('')}
          </select>
          <button id="refreshEmployeesBtn" type="button" class="btn btn-secondary">Refresh</button>
          <button id="exportEmployeesBtn" type="button" class="btn btn-secondary">Export CSV</button>
        </div>
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                <th>Employee Code</th>
                <th>Full Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Department</th>
                <th>Position</th>
                <th>Status</th>
                <th>Role</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${paginated.items.length ? paginated.items.map((employee) => {
                const isSelf = employee.id === state.profile?.id;
                const isLastActiveAdmin = employee.role === 'admin' && employee.is_active && activeAdminCount <= 1;
                const protectionReason = isSelf
                  ? 'You cannot disable or delete your own account.'
                  : isLastActiveAdmin
                    ? 'At least one active admin account must remain in the system.'
                    : '';

                return `
                <tr>
                  <td>${escapeHtml(employee.employee_code || '-')}</td>
                  <td>${escapeHtml(employee.full_name)}</td>
                  <td>${escapeHtml(employee.email)}</td>
                  <td>${escapeHtml(employee.phone || '-')}</td>
                  <td>${escapeHtml(departmentLabel(employee.department))}</td>
                  <td>${escapeHtml(employee.position || '-')}</td>
                  <td>${badgeMarkup(employee.status, employee.status)}</td>
                  <td>${badgeMarkup(employee.role, employee.role)}</td>
                  <td>
                    <div class="table-actions">
                      <button class="btn btn-secondary" data-action="view" data-id="${employee.id}">View</button>
                      <button class="btn btn-secondary" data-action="edit" data-id="${employee.id}">Edit</button>
                      <button class="btn btn-secondary" data-action="toggle" data-id="${employee.id}" ${isSelf || isLastActiveAdmin ? 'disabled' : ''} title="${escapeHtml(protectionReason)}">${employee.is_active ? 'Deactivate' : 'Activate'}</button>
                      <button class="btn btn-danger" data-action="delete" data-id="${employee.id}" ${isSelf || isLastActiveAdmin ? 'disabled' : ''} title="${escapeHtml(protectionReason)}">Delete</button>
                    </div>
                  </td>
                </tr>
              `;
              }).join('') : '<tr><td colspan="9"><div class="empty-state">No employees match the current filters.</div></td></tr>'}
            </tbody>
          </table>
        </div>
        ${buildPaginationMarkup('employeesPager', paginated)}
      </section>
    </div>
  `;

  container.querySelector('#employeeSearch')?.addEventListener('input', (event) => {
    state.employeeFilters.search = event.target.value;
    state.employeePagination.page = 1;
    drawEmployeesPage();
  });
  container.querySelector('#departmentFilter')?.addEventListener('change', (event) => {
    state.employeeFilters.department = event.target.value;
    state.employeePagination.page = 1;
    drawEmployeesPage();
  });
  container.querySelector('#statusFilter')?.addEventListener('change', (event) => {
    state.employeeFilters.status = event.target.value;
    state.employeePagination.page = 1;
    drawEmployeesPage();
  });
  container.querySelector('#openAddEmployeeBtn')?.addEventListener('click', () => {
    openEmployeeForm('create');
  });
  container.querySelector('#refreshEmployeesBtn')?.addEventListener('click', () => {
    renderEmployeesPage().catch((error) => setPageError(container, error.message));
  });
  container.querySelector('#exportEmployeesBtn')?.addEventListener('click', () => {
    exportEmployeesCsv(list);
    showToast('Employees CSV exported successfully.', 'success');
  });
  bindPagination(container, 'employeesPager', state.employeePagination, drawEmployeesPage);
  container.querySelector('tbody')?.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) {
      return;
    }

    const employee = employeeById(action.dataset.id);
    if (!employee) {
      return;
    }

    if (action.dataset.action === 'view') {
      openEmployeeView(employee);
      return;
    }
    if (action.dataset.action === 'edit') {
      openEmployeeForm('edit', employee);
      return;
    }
    if (action.dataset.action === 'toggle') {
      handleEmployeeToggle(employee).catch((error) => showToast(error.message, 'error'));
      return;
    }
    if (action.dataset.action === 'delete') {
      handleEmployeeDelete(employee).catch((error) => showToast(error.message, 'error'));
    }
  });
}

function employeeFormMarkup(mode, employee = null) {
  const isEdit = mode === 'edit';
  const departments = departmentOptions(employee?.department || '');
  return `
    <div class="modal-header">
      <div>
        <p class="eyebrow">${isEdit ? 'Update employee' : 'Create employee'}</p>
        <h2>${isEdit ? escapeHtml(employee.full_name) : 'Add Employee'}</h2>
      </div>
      <button id="closeModalBtn" type="button" class="ghost-inline">Close</button>
    </div>
    <form id="employeeForm" class="stack-form">
      <div class="form-grid">
        <div class="form-group">
          <label for="employee_full_name">Full Name</label>
          <input id="employee_full_name" name="full_name" value="${escapeHtml(employee?.full_name || '')}" required />
        </div>
        <div class="form-group">
          <label for="employee_code">Employee Code</label>
          <input id="employee_code" name="employee_code" value="${escapeHtml(employee?.employee_code || '')}" required />
        </div>
        <div class="form-group">
          <label for="employee_email">Email</label>
          <input id="employee_email" name="email" type="email" value="${escapeHtml(employee?.email || '')}" required />
        </div>
        <div class="form-group">
          <label for="employee_phone">Phone</label>
          <input id="employee_phone" name="phone" value="${escapeHtml(employee?.phone || '')}" />
        </div>
        <div class="form-group">
          <label for="employee_department">Department</label>
          <select id="employee_department" name="department">
            <option value="">Select Department</option>
            ${departments.map((department) => `<option value="${escapeHtml(department)}" ${(employee?.department || '') === department ? 'selected' : ''}>${escapeHtml(department)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="employee_position">Position</label>
          <input id="employee_position" name="position" value="${escapeHtml(employee?.position || '')}" />
        </div>
        <div class="form-group">
          <label for="employee_role">Role</label>
          <select id="employee_role" name="role">
            ${['employee', 'admin'].map((role) => `<option value="${role}" ${(employee?.role || 'employee') === role ? 'selected' : ''}>${escapeHtml(roleLabel(role))}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="employee_status">Status</label>
          <select id="employee_status" name="status">
            ${['active', 'inactive', 'on_leave'].map((status) => `<option value="${status}" ${(employee?.status || 'active') === status ? 'selected' : ''}>${escapeHtml(statusLabel(status))}</option>`).join('')}
          </select>
        </div>
        ${isEdit ? '' : `
          <div class="form-group">
            <label for="employee_password">Password</label>
            <input id="employee_password" name="password" type="password" required />
          </div>
          <div class="form-group">
            <label for="employee_password_confirm">Confirm Password</label>
            <input id="employee_password_confirm" name="password_confirm" type="password" required />
          </div>
        `}
      </div>
      <div id="employeeFormError" class="form-alert error hidden"></div>
      <div class="modal-footer">
        <div class="inline-actions">
          ${isEdit ? `<button id="resetEmployeePasswordBtn" type="button" class="btn btn-secondary">Reset Password</button>` : ''}
        </div>
        <div class="inline-actions">
          <button type="button" id="cancelEmployeeFormBtn" class="btn btn-secondary">Cancel</button>
          <button id="submitEmployeeFormBtn" type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Create Employee'}</button>
        </div>
      </div>
    </form>
  `;
}
function collectEmployeeForm(form) {
  return {
    full_name: form.full_name.value.trim(),
    employee_code: form.employee_code.value.trim(),
    email: form.email.value.trim().toLowerCase(),
    phone: form.phone.value.trim(),
    department: form.department.value.trim(),
    position: form.position.value.trim(),
    role: form.role.value,
    status: form.status.value,
  };
}

function showFormError(targetId, message = '') {
  const element = document.getElementById(targetId);
  if (!element) {
    return;
  }

  element.textContent = message;
  element.classList.toggle('hidden', !message);
}



function openEmployeeView(employee) {
  openModal(`
    <div class="modal-header">
      <div>
        <p class="eyebrow">Employee profile</p>
        <h2>${escapeHtml(employee.full_name)}</h2>
      </div>
      <button id="closeModalBtn" type="button" class="ghost-inline">Close</button>
    </div>
    <div class="form-grid">
      <div class="status-card compact"><div><span class="status-label">Employee Code</span><strong>${escapeHtml(employee.employee_code || '-')}</strong></div></div>
      <div class="status-card compact"><div><span class="status-label">Role</span><strong>${escapeHtml(roleLabel(employee.role))}</strong></div></div>
      <div class="status-card compact"><div><span class="status-label">Email</span><strong>${escapeHtml(employee.email)}</strong></div></div>
      <div class="status-card compact"><div><span class="status-label">Phone</span><strong>${escapeHtml(employee.phone || '-')}</strong></div></div>
      <div class="status-card compact"><div><span class="status-label">Department</span><strong>${escapeHtml(departmentLabel(employee.department))}</strong></div></div>
      <div class="status-card compact"><div><span class="status-label">Position</span><strong>${escapeHtml(employee.position || '-')}</strong></div></div>
      <div class="status-card compact"><div><span class="status-label">Status</span><strong>${escapeHtml(statusLabel(employee.status))}</strong></div></div>
      <div class="status-card compact"><div><span class="status-label">Created</span><strong>${escapeHtml(formatDateTime(employee.created_at))}</strong></div></div>
    </div>
    <div class="modal-footer">
      <div class="inline-actions">
        <button id="viewEditEmployeeBtn" type="button" class="btn btn-secondary">Edit</button>
        ${isAdmin() ? '<button id="viewManualAttendanceBtn" type="button" class="btn btn-secondary">Add Manual Record</button>' : ''}
      </div>
      <div class="inline-actions">
        <button id="closeEmployeeViewBtn" type="button" class="btn btn-primary">Done</button>
      </div>
    </div>
  `);

  document.getElementById('closeModalBtn')?.addEventListener('click', closeModal);
  document.getElementById('closeEmployeeViewBtn')?.addEventListener('click', closeModal);
  document.getElementById('viewEditEmployeeBtn')?.addEventListener('click', () => {
    openEmployeeForm('edit', employee);
  });
  document.getElementById('viewManualAttendanceBtn')?.addEventListener('click', () => {
    openManualAttendanceForm({
      userId: employee.id,
      attendanceDate: todayIso(),
      onSaved: async () => {
        await renderAttendancePage();
      },
    });
  });
}

function openEmployeeForm(mode, employee = null) {
  openModal(employeeFormMarkup(mode, employee));
  const form = document.getElementById('employeeForm');
  const submitButton = document.getElementById('submitEmployeeFormBtn');
  document.getElementById('closeModalBtn')?.addEventListener('click', closeModal);
  document.getElementById('cancelEmployeeFormBtn')?.addEventListener('click', closeModal);
  document.getElementById('resetEmployeePasswordBtn')?.addEventListener('click', () => openResetPasswordModal(employee));

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFormError('employeeFormError');

    const payload = collectEmployeeForm(form);
    if (!payload.full_name || !payload.employee_code || !payload.email) {
      showFormError('employeeFormError', 'Full name, employee code, and email are required.');
      return;
    }

    if (mode === 'create') {
      const password = form.password.value;
      const confirmPassword = form.password_confirm.value;
      if (!isStrongPassword(password)) {
        showFormError('employeeFormError', 'Password must be at least 8 characters and include upper, lower, number, and symbol.');
        return;
      }
      if (password !== confirmPassword) {
        showFormError('employeeFormError', 'Password confirmation does not match.');
        return;
      }
      payload.password = password;
    }

    submitButton.disabled = true;
    submitButton.textContent = mode === 'create' ? 'Creating' : 'Saving';

    try {
      await apiRequest(mode === 'create' ? '/admin/employees' : `/admin/employees/${employee.id}`, {
        method: mode === 'create' ? 'POST' : 'PUT',
        body: payload,
      });
      closeModal();
      showToast(mode === 'create' ? 'Employee created successfully.' : 'Employee updated successfully.', 'success');
      await renderEmployeesPage();
    } catch (error) {
      showFormError('employeeFormError', error.message);
      submitButton.disabled = false;
      submitButton.textContent = mode === 'create' ? 'Create Employee' : 'Save Changes';
    }
  });
}

function openResetPasswordModal(employee) {
  openModal(`
    <div class="modal-header">
      <div>
        <p class="eyebrow">Reset password</p>
        <h2>${escapeHtml(employee.full_name)}</h2>
      </div>
      <button id="closeModalBtn" type="button" class="ghost-inline">Close</button>
    </div>
    <form id="resetPasswordForm" class="stack-form">
      <div class="form-group">
        <label for="reset_password">New Password</label>
        <input id="reset_password" type="password" required />
      </div>
      <div class="form-group">
        <label for="reset_password_confirm">Confirm Password</label>
        <input id="reset_password_confirm" type="password" required />
      </div>
      <div id="resetPasswordError" class="form-alert error hidden"></div>
      <div class="modal-footer">
        <div></div>
        <div class="inline-actions">
          <button id="cancelResetPasswordBtn" type="button" class="btn btn-secondary">Cancel</button>
          <button id="submitResetPasswordBtn" type="submit" class="btn btn-primary">Reset Password</button>
        </div>
      </div>
    </form>
  `);

  document.getElementById('closeModalBtn')?.addEventListener('click', closeModal);
  document.getElementById('cancelResetPasswordBtn')?.addEventListener('click', closeModal);
  document.getElementById('resetPasswordForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFormError('resetPasswordError');
    const password = document.getElementById('reset_password').value;
    const confirmPassword = document.getElementById('reset_password_confirm').value;

    if (!isStrongPassword(password)) {
      showFormError('resetPasswordError', 'Password must be at least 8 characters and include upper, lower, number, and symbol.');
      return;
    }
    if (password !== confirmPassword) {
      showFormError('resetPasswordError', 'Password confirmation does not match.');
      return;
    }

    const submitButton = document.getElementById('submitResetPasswordBtn');
    submitButton.disabled = true;
    submitButton.textContent = 'Resetting';

    try {
      await apiRequest(`/admin/employees/${employee.id}/reset-password`, {
        method: 'PATCH',
        body: { new_password: password },
      });
      closeModal();
      showToast('Password reset successfully.', 'success');
    } catch (error) {
      showFormError('resetPasswordError', error.message);
      submitButton.disabled = false;
      submitButton.textContent = 'Reset Password';
    }
  });
}

function openManualAttendanceForm(options = {}) {
  const employees = [...state.employees].sort((a, b) => a.full_name.localeCompare(b.full_name));
  const defaultUserId = options.userId || '';
  const defaultAttendanceDate = options.attendanceDate || todayIso();
  const onSaved = typeof options.onSaved === 'function' ? options.onSaved : async () => {
    await renderAttendancePage();
  };

  openModal(`
    <div class="modal-header">
      <div>
        <p class="eyebrow">Manual attendance</p>
        <h2>Add attendance record</h2>
      </div>
      <button id="closeModalBtn" type="button" class="ghost-inline">Close</button>
    </div>
    <form id="manualAttendanceForm" class="stack-form">
      <div class="form-grid">
        <div class="form-group full">
          <label for="manual_user_id">Employee</label>
          <select id="manual_user_id" name="user_id" required>
            <option value="">Select employee</option>
            ${employees.map((employee) => `<option value="${employee.id}" ${defaultUserId === employee.id ? 'selected' : ''}>${escapeHtml(employee.full_name)}${employee.employee_code ? ` - ${escapeHtml(employee.employee_code)}` : ''}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="manual_attendance_date">Attendance Date</label>
          <input id="manual_attendance_date" name="attendance_date" type="date" value="${escapeHtml(defaultAttendanceDate)}" required />
        </div>
        <div class="form-group">
          <label for="manual_attendance_status">Status</label>
          <select id="manual_attendance_status" name="attendance_status">
            ${['present', 'late', 'checked_out', 'absent'].map((status) => `<option value="${status}">${escapeHtml(statusLabel(status))}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="manual_check_in_time">Check In</label>
          <input id="manual_check_in_time" name="check_in_time" type="datetime-local" />
        </div>
        <div class="form-group">
          <label for="manual_check_out_time">Check Out</label>
          <input id="manual_check_out_time" name="check_out_time" type="datetime-local" />
        </div>
        <div class="form-group full">
          <label for="manual_device_info">Notes / Device Info</label>
          <textarea id="manual_device_info" name="device_info" rows="3" placeholder="Optional note for this manual update"></textarea>
        </div>
      </div>
      <div id="manualAttendanceError" class="form-alert error hidden"></div>
      <div class="modal-footer">
        <div></div>
        <div class="inline-actions">
          <button id="cancelManualAttendanceBtn" type="button" class="btn btn-secondary">Cancel</button>
          <button id="submitManualAttendanceBtn" type="submit" class="btn btn-primary">Save Attendance</button>
        </div>
      </div>
    </form>
  `);

  document.getElementById('closeModalBtn')?.addEventListener('click', () => closeModal(false));
  document.getElementById('cancelManualAttendanceBtn')?.addEventListener('click', () => closeModal(false));
  document.getElementById('manualAttendanceForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFormError('manualAttendanceError');

    const form = event.currentTarget;
    const checkInTime = toIsoFromDateTimeLocal(form.check_in_time.value);
    const checkOutTime = toIsoFromDateTimeLocal(form.check_out_time.value);

    if (!form.user_id.value || !form.attendance_date.value) {
      showFormError('manualAttendanceError', 'Employee and attendance date are required.');
      return;
    }
    if (checkOutTime && !checkInTime) {
      showFormError('manualAttendanceError', 'Check-out cannot be saved before check-in.');
      return;
    }
    if (checkInTime && checkOutTime && new Date(checkOutTime) < new Date(checkInTime)) {
      showFormError('manualAttendanceError', 'Check-out must be later than check-in.');
      return;
    }

    const submitButton = document.getElementById('submitManualAttendanceBtn');
    submitButton.disabled = true;
    submitButton.textContent = 'Saving';

    try {
      await apiRequest('/attendance/manual', {
        method: 'POST',
        body: {
          user_id: form.user_id.value,
          attendance_date: form.attendance_date.value,
          attendance_status: form.attendance_status.value,
          check_in_time: checkInTime,
          check_out_time: checkOutTime,
          device_info: form.device_info.value.trim(),
        },
      });
      closeModal(true);
      showToast('Manual attendance saved successfully.', 'success');
      await onSaved();
    } catch (error) {
      showFormError('manualAttendanceError', error.message);
      submitButton.disabled = false;
      submitButton.textContent = 'Save Attendance';
    }
  });
}

async function handleEmployeeToggle(employee) {
  const activeAdminCount = state.employees.filter((item) => item.role === 'admin' && item.is_active).length;
  if (employee.id === state.profile?.id) {
    showToast('You cannot disable your own account.', 'error');
    return;
  }
  if (employee.role === 'admin' && employee.is_active && activeAdminCount <= 1) {
    showToast('At least one active admin account must remain in the system.', 'error');
    return;
  }

  const confirmed = await confirmAction({
    eyebrow: 'Account access',
    title: `${employee.is_active ? 'Deactivate' : 'Activate'} ${employee.full_name}?`,
    message: employee.is_active
      ? 'This employee will lose access to the system until you reactivate the account.'
      : 'This employee will regain access and can sign in again.',
    confirmLabel: employee.is_active ? 'Deactivate account' : 'Activate account',
  });
  if (!confirmed) {
    return;
  }

  await apiRequest(`/admin/employees/${employee.id}/toggle-status`, {
    method: 'PATCH',
  });
  showToast(`${employee.full_name} status updated.`, 'success');
  await renderEmployeesPage();
}

async function handleEmployeeDelete(employee) {
  const activeAdminCount = state.employees.filter((item) => item.role === 'admin' && item.is_active).length;
  if (employee.id === state.profile?.id) {
    showToast('You cannot delete your own account.', 'error');
    return;
  }
  if (employee.role === 'admin' && employee.is_active && activeAdminCount <= 1) {
    showToast('At least one active admin account must remain in the system.', 'error');
    return;
  }

  const confirmed = await confirmAction({
    eyebrow: 'Delete employee',
    title: `Delete ${employee.full_name}?`,
    message: 'This permanently removes the auth account, profile, and linked attendance rows.',
    confirmLabel: 'Delete permanently',
  });
  if (!confirmed) {
    return;
  }

  await apiRequest(`/admin/employees/${employee.id}`, {
    method: 'DELETE',
  });
  showToast(`${employee.full_name} deleted successfully.`, 'success');
  await renderEmployeesPage();
}
async function renderAttendancePage() {
  const container = elements.pages.attendance;
  setPageLoading(container, 'Loading attendance');

  try {
    const today = todayIso();
    const [todayRecords, recentRecords, restrictionSummary] = await Promise.all([
      fetchAttendance({ date: today, ...(isAdmin() ? {} : { userId: state.profile.id }) }),
      fetchAttendance({ from: offsetDate(-14), to: today, limit: 14, ...(isAdmin() ? {} : { userId: state.profile.id }) }),
      fetchSystemHealth(),
    ]);
    const restrictionNote = attendanceRestrictionMessage(restrictionSummary);

    if (isAdmin()) {
      if (!state.employees.length) {
        state.employees = await fetchEmployees();
        state.profileMap = new Map(state.employees.map((employee) => [employee.id, employee]));
      }
      await ensureProfileDirectory(todayRecords);
      const checkedOut = todayRecords.filter((item) => item.check_out_time).length;
      const stillInside = todayRecords.filter((item) => item.check_in_time && !item.check_out_time).length;
      const lateCount = todayRecords.filter((item) => item.attendance_status === 'late').length;

      container.innerHTML = `
        <div class="page-shell">
          <div class="section-header">
            <div>
              <p class="eyebrow">Live operations</p>
              <h1>Attendance for ${escapeHtml(formatDate(today))}</h1>
              <p>Monitor check-ins and check-outs as they happen, export records, and add manual entries when needed.</p>
              ${restrictionNote ? `<p class="inline-note attention-note">${escapeHtml(restrictionNote)}</p>` : ''}
            </div>
            <div class="inline-actions">
              <button id="manualAttendanceBtn" type="button" class="btn btn-primary">Add Manual Record</button>
              <button id="exportAttendanceBtn" type="button" class="btn btn-secondary">Export CSV</button>
              <button id="attendanceRefreshBtn" type="button" class="btn btn-secondary">Refresh</button>
            </div>
          </div>
          <div class="summary-grid">
            ${buildSummaryCard('Present', String(todayRecords.length), 'Attendance rows recorded today')}
            ${buildSummaryCard('Checked Out', String(checkedOut), 'Completed workdays today')}
            ${buildSummaryCard('In Office', String(stillInside), 'Checked in without check-out')}
            ${buildSummaryCard('Late', String(lateCount), 'Rows marked late by RPC logic')}
          </div>
          <section class="card-block">
            <div class="table-shell">
              <table>
                <thead>
                  <tr><th>Employee</th><th>Department</th><th>Check In</th><th>Check Out</th><th>Status</th><th>Device</th></tr>
                </thead>
                <tbody>
                  ${todayRecords.length ? todayRecords.map((row) => {
                    const profile = employeeById(row.user_id);
                    return `
                      <tr>
                        <td>${buildUserCell(profile)}</td>
                        <td>${escapeHtml(departmentLabel(profile?.department))}</td>
                        <td>${escapeHtml(formatTime(row.check_in_time))}</td>
                        <td>${escapeHtml(formatTime(row.check_out_time))}</td>
                        <td>${badgeMarkup(row.attendance_status, row.attendance_status)}</td>
                        <td>${escapeHtml(row.device_info ? row.device_info.slice(0, 48) : '-')}</td>
                      </tr>
                    `;
                  }).join('') : '<tr><td colspan="6"><div class="empty-state">No attendance records recorded today.</div></td></tr>'}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      `;

      container.querySelector('#attendanceRefreshBtn')?.addEventListener('click', () => renderAttendancePage().catch((error) => setPageError(container, error.message)));
      container.querySelector('#manualAttendanceBtn')?.addEventListener('click', () => {
        openManualAttendanceForm({
          onSaved: async () => {
            await renderAttendancePage();
          },
        });
      });
      container.querySelector('#exportAttendanceBtn')?.addEventListener('click', () => {
        exportAttendanceCsv(todayRecords, { resolveProfile: employeeById, fallbackProfile: state.profile });
        showToast('Attendance CSV exported successfully.', 'success');
      });
      return;
    }

    const todayRecord = todayRecords[0] || null;
    const canCheckIn = !todayRecord?.check_in_time;
    const canCheckOut = Boolean(todayRecord?.check_in_time) && !todayRecord?.check_out_time;

    container.innerHTML = `
      <div class="page-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">Personal attendance</p>
            <h1>Check in and check out</h1>
            <p>Your attendance actions are written securely through Supabase.</p>
            ${restrictionNote ? `<p class="inline-note attention-note">${escapeHtml(restrictionNote)}</p>` : ''}
          </div>
        </div>
        <section class="status-card">
          <div>
            <span class="status-label">Today status</span>
            <strong>${escapeHtml(todayRecord ? statusLabel(todayRecord.attendance_status) : 'Pending')}</strong>
            <p class="inline-note">${escapeHtml(todayRecord ? `Check in ${formatTime(todayRecord.check_in_time)}${todayRecord.check_out_time ? `, check out ${formatTime(todayRecord.check_out_time)}` : ''}` : 'No attendance has been submitted yet.')}</p>
          </div>
          <div class="inline-actions">
            ${canCheckIn ? '<button id="employeeCheckInBtn" type="button" class="btn btn-primary">Check In</button>' : ''}
            ${canCheckOut ? '<button id="employeeCheckOutBtn" type="button" class="btn btn-secondary">Check Out</button>' : ''}
            <button id="attendanceRefreshBtn" type="button" class="btn btn-secondary">Refresh</button>
          </div>
        </section>
        <section class="card-block">
          <div class="card-head">
            <div>
              <h3>Recent history</h3>
              <p class="card-subtle">Your last 14 attendance rows</p>
            </div>
          </div>
          <div class="table-shell">
            <table>
              <thead>
                <tr><th>Date</th><th>Check In</th><th>Check Out</th><th>Status</th></tr>
              </thead>
              <tbody>
                ${recentRecords.length ? recentRecords.map((row) => `
                  <tr>
                    <td>${escapeHtml(formatDate(row.attendance_date))}</td>
                    <td>${escapeHtml(formatTime(row.check_in_time))}</td>
                    <td>${escapeHtml(formatTime(row.check_out_time))}</td>
                    <td>${badgeMarkup(row.attendance_status, row.attendance_status)}</td>
                  </tr>
                `).join('') : '<tr><td colspan="4"><div class="empty-state">No attendance history found yet.</div></td></tr>'}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    container.querySelector('#attendanceRefreshBtn')?.addEventListener('click', () => renderAttendancePage().catch((error) => setPageError(container, error.message)));
    container.querySelector('#employeeCheckInBtn')?.addEventListener('click', () => submitAttendanceAction('checkin'));
    container.querySelector('#employeeCheckOutBtn')?.addEventListener('click', () => submitAttendanceAction('checkout'));
  } catch (error) {
    setPageError(container, error.message);
  }
}

async function submitAttendanceAction(type) {
  try {
    const { context, warning } = await collectAttendanceContext();
    if (warning) {
      showToast(warning, 'info');
    }

    await apiRequest(`/attendance/${type}`, { method: 'POST', body: context });
    showToast(type === 'checkin' ? 'Check-in recorded successfully.' : 'Check-out recorded successfully.', 'success');
    await renderAttendancePage();
    await refreshTopbarMessage();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function renderHistoryPage() {
  const container = elements.pages.history;
  setPageLoading(container, 'Loading history');

  try {
    const records = await fetchAttendance({
      from: state.historyFilters.from,
      to: state.historyFilters.to,
      status: state.historyFilters.status,
      ...(isAdmin() ? {} : { userId: state.profile.id }),
    });
    await ensureProfileDirectory(records);
    const paginated = paginateItems(records, state.historyPagination);

    container.innerHTML = `
      <div class="page-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">Records</p>
            <h1>Attendance History</h1>
            <p>Filter live attendance rows by date range and status.</p>
          </div>
          ${isAdmin() ? '<button id="historyManualAttendanceBtn" type="button" class="btn btn-primary">Add Manual Record</button>' : ''}
        </div>
        <section class="card-block">
          <div class="toolbar toolbar-wide">
            <input id="historyFrom" type="date" value="${escapeHtml(state.historyFilters.from)}" />
            <input id="historyTo" type="date" value="${escapeHtml(state.historyFilters.to)}" />
            <select id="historyStatus">
              <option value="all">All Statuses</option>
              ${['present', 'late', 'checked_out', 'absent'].map((status) => `<option value="${status}" ${state.historyFilters.status === status ? 'selected' : ''}>${escapeHtml(statusLabel(status))}</option>`).join('')}
            </select>
            <button id="historySearchBtn" type="button" class="btn btn-secondary">Apply</button>
            <button id="historyExportBtn" type="button" class="btn btn-secondary">Export CSV</button>
          </div>
          <div class="table-shell">
            <table>
              <thead>
                <tr><th>Employee</th><th>Date</th><th>Check In</th><th>Check Out</th><th>Status</th><th>IP Address</th></tr>
              </thead>
              <tbody>
                ${paginated.items.length ? paginated.items.map((row) => {
                  const profile = employeeById(row.user_id) || state.profile;
                  return `
                    <tr>
                      <td>${isAdmin() ? buildUserCell(profile) : escapeHtml(state.profile.full_name)}</td>
                      <td>${escapeHtml(formatDate(row.attendance_date))}</td>
                      <td>${escapeHtml(formatTime(row.check_in_time))}</td>
                      <td>${escapeHtml(formatTime(row.check_out_time))}</td>
                      <td>${badgeMarkup(row.attendance_status, row.attendance_status)}</td>
                      <td>${escapeHtml(row.ip_address || '-')}</td>
                    </tr>
                  `;
                }).join('') : '<tr><td colspan="6"><div class="empty-state">No attendance rows found for the current filters.</div></td></tr>'}
              </tbody>
            </table>
          </div>
          ${buildPaginationMarkup('historyPager', paginated)}
        </section>
      </div>
    `;

    container.querySelector('#historySearchBtn')?.addEventListener('click', () => {
      state.historyFilters.from = container.querySelector('#historyFrom').value;
      state.historyFilters.to = container.querySelector('#historyTo').value;
      state.historyFilters.status = container.querySelector('#historyStatus').value;
      state.historyPagination.page = 1;
      renderHistoryPage().catch((error) => setPageError(container, error.message));
    });
    container.querySelector('#historyManualAttendanceBtn')?.addEventListener('click', () => {
      openManualAttendanceForm({
        attendanceDate: state.historyFilters.to || todayIso(),
        onSaved: async () => {
          await renderHistoryPage();
        },
      });
    });
    container.querySelector('#historyExportBtn')?.addEventListener('click', () => {
      exportAttendanceCsv(records, { resolveProfile: employeeById, fallbackProfile: state.profile });
      showToast('Attendance history CSV exported successfully.', 'success');
    });
    bindPagination(container, 'historyPager', state.historyPagination, () => {
      renderHistoryPage().catch((error) => setPageError(container, error.message));
    });
  } catch (error) {
    setPageError(container, error.message);
  }
}

async function renderQrPage() {
  const container = elements.pages.qr;
  if (!isAdmin()) {
    setPageError(container, 'Only admins can open the QR access page.');
    return;
  }

  setPageLoading(container, 'Generating QR code');

  try {
    const payload = await apiRequest('/attendance/qr');
    const qr = payload.data;
    container.innerHTML = `
      <div class="page-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">QR attendance</p>
            <h1>Share mobile check-in access</h1>
            <p>Employees can scan this code to open the online attendance route directly.</p>
          </div>
          <button id="qrRefreshBtn" type="button" class="btn btn-secondary">Regenerate</button>
        </div>
        <section class="card-block">
          <div class="page-shell">
            <div class="qr-frame">
              <img src="${escapeHtml(qr.qr_image)}" alt="EVARA BNS attendance QR code" />
            </div>
            <div class="status-card compact">
              <div>
                <span class="status-label">Check-in URL</span>
                <strong>${escapeHtml(qr.checkin_url)}</strong>
                <p class="inline-note">Generated ${escapeHtml(formatDateTime(qr.generated_at))}</p>
              </div>
            </div>
            <div class="inline-actions">
              <button id="downloadQrBtn" type="button" class="btn btn-primary">Download QR</button>
            </div>
          </div>
        </section>
      </div>
    `;

    container.querySelector('#qrRefreshBtn')?.addEventListener('click', () => renderQrPage().catch((error) => setPageError(container, error.message)));
    container.querySelector('#downloadQrBtn')?.addEventListener('click', () => {
      const anchor = document.createElement('a');
      anchor.href = qr.qr_image;
      anchor.download = 'evara-bns-qr.png';
      anchor.click();
    });
  } catch (error) {
    setPageError(container, error.message);
  }
}





