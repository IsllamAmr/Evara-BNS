import { getAppConfig, getSupabase, isSupabaseReady } from './supabaseClient.js';
import { apiRequestWithFallback } from './apiClient.js';
import { createQueryCache, fetchAllRows } from './dataStore.js';
import { renderTimesheet } from './timesheet.js';
import { initRotatingQuotes } from './rotatingQuotes.js';
import {
  bindMonthStrip,
  detailRowMarkup,
  firstName,
  greeting,
  icon,
  monthStripMarkup,
  quotaCardMarkup,
  rateRingMarkup,
  recordListMarkup,
  requestCardMarkup,
  shiftHeroMarkup,
  skeletonMarkup,
  startLiveShift,
  statTileMarkup,
} from './employeeViews.js';
import {
  average,
  attendanceOutcome,
  businessScheduleLabel,
  buildAttendanceRowMetrics,
  buildReportsDataset,
  deriveMissingAttendanceState,
  drawDepartmentHoursChart,
  drawWorkingHoursTrend,
  enumerateDates,
  FULL_SHIFT_MINUTES,
  formatAverageTime,
  formatDuration,
  getBusinessDayContext,
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
  setLanguageLock,
  ensureLanguageLoaded,
  getCurrentLanguage,
  t,
  toggleLanguage,
} from './i18n.js';
import {
  currentMonthInput as currentBusinessMonthInput,
  departmentLabel,
  escapeHtml,
  formatDate,
  formatDateInput,
  formatDateTime,
  formatTime,
  isStrongPassword,
  offsetDate as offsetBusinessDate,
  roleLabel,
  statusLabel,
  todayIso as todayBusinessIso,
  toInitials,
} from './shared.js';

const config = getAppConfig();
const supabase = isSupabaseReady() ? getSupabase() : null;
const PROFILE_SELECT = 'id, full_name, email, role, is_active, employee_code, phone, department, position, status, created_at, updated_at';
const ATTENDANCE_SELECT = 'id, user_id, attendance_date, check_in_time, check_out_time, attendance_status, ip_address, device_info, work_notes, work_place, training_minutes, created_at, updated_at';
const DEPARTMENT_OPTIONS = [
  'Architectural Engineering',
  'Civil Engineering',
  'Software Engineering',
  'Information Technology',
];

const EMPLOYEE_PAGE_SIZE = 10;
const HISTORY_PAGE_SIZE = 12;
const REQUEST_MONTHLY_DELAY_LIMIT = 2;
const REQUEST_ANNUAL_LEAVE_LIMIT = 21;
const REQUEST_TYPES = ['late_2_hours', 'annual_leave'];
const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];
const EMPLOYEE_CACHE_TTL_MS = 30 * 1000; // Reduced from 60s to improve cache freshness
const HEALTH_CACHE_TTL_MS = 5 * 60 * 1000;
const INPUT_DEBOUNCE_MS = 220;
// Employees stay signed in on their phones so the office QR works every morning
// without a new sign-in. Admin sessions keep the stricter 8-hour inactivity limit.
const ADMIN_SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours
const EMPLOYEE_SESSION_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_WARNING_MS = 5 * 60 * 1000; // 5 minutes before timeout
const SESSION_ACTIVITY_STORAGE_KEY = 'evara:session:last_activity';
const SESSION_ACTIVITY_THROTTLE_MS = 15 * 1000;
const QUERY_CACHE_TTL_MS = {
  employees: EMPLOYEE_CACHE_TTL_MS,
  employeeDirectory: 20 * 1000,
  employeeStats: 30 * 1000,
  attendance: 12 * 1000,
  attendancePage: 12 * 1000,
  requests: 12 * 1000,
  requestAllowance: 20 * 1000,
  reports: 20 * 1000,
  profile: 20 * 1000,
  qr: 60 * 1000,
};
const state = {
  session: null,
  profile: null,
  sessionLastActivity: Date.now(),
  sessionWarningShown: false,
  currentPage: 'dashboard',
  employees: [],
  employeesFetchedAt: 0,
  profileMap: new Map(),
  employeeDirectoryItems: [],
  employeeDirectoryMeta: {
    totalItems: 0,
    totalPages: 1,
    currentPage: 1,
    pageSize: EMPLOYEE_PAGE_SIZE,
    startItem: 0,
    endItem: 0,
  },
  employeeDirectoryStats: {
    totalEmployees: 0,
    activeCount: 0,
    onLeaveCount: 0,
    activeAdminCount: 0,
    departments: [],
  },
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
  historyPageData: {
    items: [],
    totalItems: 0,
    totalPages: 1,
    currentPage: 1,
    pageSize: HISTORY_PAGE_SIZE,
    startItem: 0,
    endItem: 0,
  },
  requestFilters: {
    type: 'all',
    status: 'all',
  },

  reportsFilters: {
    month: currentMonthInput(),
    department: 'all',
    employeeId: 'all',
  },
  attendanceRestrictions: null,
  attendanceRestrictionsFetchedAt: 0,
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
  sidebarBackdrop: document.getElementById('sidebarBackdrop'),
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
  topbarAvatar: document.getElementById('topbarAvatar'),
  tabbar: document.getElementById('tabbar'),
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
    requests: document.getElementById('page-requests'),
    reports: document.getElementById('page-reports'),
    qr: document.getElementById('page-qr'),
  },
};

let modalCloseHandler = null;
// Stops the ticking shift ring of the page that was rendered last.
let stopLiveShift = () => {};
let realtimeChannels = [];
let employeeSearchDebounceId = null;
const { buildCacheKey, getFreshCachedValue, getCachedQuery, invalidateQueryCache } = createQueryCache();
let prefetchTimerId = null;
let lastActivityWriteAt = 0;
let routeRenderInFlight = false;
let routeRenderQueued = false;
// Collapses concurrent opens of the same user (boot, sign-in and auth events can overlap).
let sessionOpening = null;

boot();

function updateSessionActivity() {
  const now = Date.now();
  state.sessionLastActivity = now;
  state.sessionWarningShown = false;

  if ((now - lastActivityWriteAt) < SESSION_ACTIVITY_THROTTLE_MS) {
    return;
  }

  lastActivityWriteAt = now;
  try {
    window.localStorage.setItem(SESSION_ACTIVITY_STORAGE_KEY, String(now));
  } catch (_error) {
    // Ignore storage failures (e.g. privacy mode) and keep in-memory tracking.
  }
}

function syncSessionActivityFromStorage() {
  try {
    const stored = Number(window.localStorage.getItem(SESSION_ACTIVITY_STORAGE_KEY));
    if (Number.isFinite(stored) && stored > state.sessionLastActivity) {
      state.sessionLastActivity = stored;
      state.sessionWarningShown = false;
    }
  } catch (_error) {
    // Ignore storage read failures and continue with in-memory tracking.
  }
}

function clearSessionActivityStorage() {
  try {
    window.localStorage.removeItem(SESSION_ACTIVITY_STORAGE_KEY);
  } catch (_error) {
    // Ignore storage cleanup failures.
  }
}

function updateSessionActivityThrottled() {
  if ((Date.now() - state.sessionLastActivity) < SESSION_ACTIVITY_THROTTLE_MS) {
    return;
  }

  updateSessionActivity();
}

function currentSessionTimeoutMs() {
  return isAdmin() ? ADMIN_SESSION_TIMEOUT_MS : EMPLOYEE_SESSION_TIMEOUT_MS;
}

function checkSessionTimeout() {
  if (!state.session) return;

  syncSessionActivityFromStorage();

  const now = Date.now();
  const timeSinceActivity = now - state.sessionLastActivity;
  const SESSION_TIMEOUT_MS = currentSessionTimeoutMs();

  if (timeSinceActivity < 0) {
    updateSessionActivity();
    return;
  }

  if (timeSinceActivity >= SESSION_TIMEOUT_MS) {
    // Session expired
    handleLogout().catch(() => {});
    showToast(t('session.expired'), 'warning');
    return;
  }

  if (!state.sessionWarningShown && timeSinceActivity >= (SESSION_TIMEOUT_MS - SESSION_WARNING_MS)) {
    // Show warning 5 minutes before expiry
    const remainingMinutes = Math.ceil((SESSION_TIMEOUT_MS - timeSinceActivity) / 60000);
    showToast(t('session.expiringSoon', { minutes: String(remainingMinutes) }), 'warning');
    state.sessionWarningShown = true;
  }
}

// Check session timeout every minute
setInterval(checkSessionTimeout, 60 * 1000);

// Update activity on user interactions
document.addEventListener('click', updateSessionActivity);
document.addEventListener('keydown', updateSessionActivity);
document.addEventListener('touchstart', updateSessionActivity, { passive: true });
document.addEventListener('scroll', updateSessionActivityThrottled, { passive: true });
document.addEventListener('mousemove', updateSessionActivityThrottled, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    syncSessionActivityFromStorage();
    updateSessionActivity();
  }
});
window.addEventListener('storage', (event) => {
  if (event.key !== SESSION_ACTIVITY_STORAGE_KEY || !event.newValue) {
    return;
  }

  const stored = Number(event.newValue);
  if (Number.isFinite(stored) && stored > state.sessionLastActivity) {
    state.sessionLastActivity = stored;
    state.sessionWarningShown = false;
  }
});

function todayIso() {
  return todayBusinessIso();
}

function currentMonthInput() {
  return currentBusinessMonthInput();
}

function offsetDate(days) {
  return offsetBusinessDate(days);
}

// ISO timestamp -> the browser-local "YYYY-MM-DDTHH:mm" a datetime-local input takes.
function toDateTimeLocalValue(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
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
    ? ['dashboard', 'profile', 'employees', 'attendance', 'history', 'requests', 'reports', 'qr']
    : ['dashboard', 'profile', 'attendance', 'history', 'requests'];
}

function pageFromHash() {
  const value = window.location.hash.replace(/^#/, '').trim();
  return value || 'dashboard';
}

function setPageLoading(container, label) {
  if (state.profile && !isAdmin()) {
    container.innerHTML = `${skeletonMarkup()}<span class="sr-only">${escapeHtml(label)}</span>`;
    return;
  }
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
  const visible = elements.loginPassword.type !== 'password';
  const label = t(visible ? 'login.hidePasswordLabel' : 'login.showPasswordLabel');
  elements.togglePasswordBtn.setAttribute('aria-label', label);
  elements.togglePasswordBtn.setAttribute('title', label);
  elements.togglePasswordBtn.setAttribute('aria-pressed', String(visible));
}

function setLoginError(message = '') {
  elements.loginError.textContent = message;
  elements.loginError.classList.toggle('config-notice', !isSupabaseReady());
  elements.loginError.classList.toggle('hidden', !message);
}

function clearRealtimeSubscriptions() {
  hideLiveUpdatePill();
  realtimeChannels.forEach((channel) => {
    supabase?.removeChannel(channel);
  });
  realtimeChannels = [];

  // Ensure all subscriptions are cleaned up
  supabase?.removeAllChannels();

  if (state.liveRefreshTimer) {
    window.clearTimeout(state.liveRefreshTimer);
    state.liveRefreshTimer = null;
  }
}

function resetSessionState() {
  clearRealtimeSubscriptions();
  state.session = null;
  state.profile = null;
  state.sessionLastActivity = Date.now();
  lastActivityWriteAt = 0;
  state.sessionWarningShown = false;
  clearSessionActivityStorage();
  state.employees = [];
  state.employeesFetchedAt = 0;
  state.profileMap = new Map();
  state.employeeDirectoryItems = [];
  state.employeeDirectoryMeta = {
    totalItems: 0,
    totalPages: 1,
    currentPage: 1,
    pageSize: EMPLOYEE_PAGE_SIZE,
    startItem: 0,
    endItem: 0,
  };
  state.employeeDirectoryStats = {
    totalEmployees: 0,
    activeCount: 0,
    onLeaveCount: 0,
    activeAdminCount: 0,
    departments: [],
  };
  state.employeePagination.page = 1;
  state.historyPagination.page = 1;
  state.historyPageData = {
    items: [],
    totalItems: 0,
    totalPages: 1,
    currentPage: 1,
    pageSize: HISTORY_PAGE_SIZE,
    startItem: 0,
    endItem: 0,
  };

  state.attendanceRestrictions = null;
  state.attendanceRestrictionsFetchedAt = 0;
  invalidateQueryCache();

  if (employeeSearchDebounceId) {
    window.clearTimeout(employeeSearchDebounceId);
    employeeSearchDebounceId = null;
  }
  if (prefetchTimerId) {
    window.clearTimeout(prefetchTimerId);
    prefetchTimerId = null;
  }
}

// When the office QR sends a signed-out employee here (/?next=checkin), explain
// that one sign-in is enough and attendance continues right after it.
function syncLoginHint() {
  if (!elements.loginHint) {
    return;
  }
  const fromQr = new URLSearchParams(window.location.search).get('next') === 'checkin';
  elements.loginHint.textContent = fromQr ? t('login.qrSignInHint') : '';
  elements.loginHint.classList.toggle('hidden', !fromQr);
}

function showLogin(message = '') {
  setLanguageLock('en');
  applyDocumentLanguage();
  hideBootSplash();
  elements.app.classList.add('hidden');
  elements.loginScreen.classList.remove('hidden');
  setLoginError(message);
  syncLoginHint();
}

function hideBootSplash() {
  document.getElementById('bootSplash')?.remove();
}

function showAppShell() {
  hideBootSplash();
  elements.loginScreen.classList.add('hidden');
  elements.app.classList.remove('hidden');
}

function startClock() {
  // Ticks every second so the minute flips on time, but only touches the DOM when the
  // shown text changes; rewriting it each second forced a style/layout pass for nothing.
  const renderClock = () => {
    const now = new Date();
    setTextIfChanged(elements.topbarClock, now.toLocaleTimeString(getLocale(), {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }));
    setTextIfChanged(elements.topbarDate, now.toLocaleDateString(getLocale(), {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }));
  };

  renderClock();
  window.setInterval(renderClock, 1000);
}

function setTextIfChanged(element, text) {
  if (element && element.textContent !== text) {
    element.textContent = text;
  }
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
  if (options.method && options.method !== 'GET') {
    lastLocalWriteAt = Date.now();
  }
  const token = await getAccessToken();
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const requestOptions = {
    method: options.method || 'GET',
    headers,
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


async function fetchMyProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || t('errors.loadProfile'));
  }

  return data;
}

async function fetchEmployees(options = {}) {
  const key = buildCacheKey('employees', { all: true });
  return getCachedQuery(key, QUERY_CACHE_TTL_MS.employees, async () => {
    try {
      return await fetchAllRows(() => supabase
        .from('profiles')
        .select(PROFILE_SELECT)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true }));
    } catch (error) {
      throw new Error(error.message || t('errors.loadEmployees'));
    }
  }, options);
}

function escapeLikeValue(value) {
  return String(value || '').replace(/[,%()]/g, ' ').trim();
}

function applyEmployeeFilters(query, filters = {}) {
  const search = escapeLikeValue(filters.search);
  if (search) {
    const token = `%${search}%`;
    query = query.or([
      `full_name.ilike.${token}`,
      `employee_code.ilike.${token}`,
      `email.ilike.${token}`,
      `department.ilike.${token}`,
      `position.ilike.${token}`,
    ].join(','));
  }

  if (filters.department && filters.department !== 'all') {
    query = query.eq('department', filters.department);
  }

  if (filters.status && filters.status !== 'all') {
    query = query.eq('status', filters.status);
  }

  return query;
}

async function loadEmployees(options = {}) {
  const force = Boolean(options.force);
  const now = Date.now();
  if (!force && state.employees.length && (now - state.employeesFetchedAt) < EMPLOYEE_CACHE_TTL_MS) {
    return state.employees;
  }

  const employees = await fetchEmployees();
  state.employees = employees;
  state.employeesFetchedAt = now;
  state.profileMap = new Map(employees.map((employee) => [employee.id, employee]));
  if (state.profile) {
    state.profileMap.set(state.profile.id, state.profile);
  }
  return employees;
}

function invalidateEmployeeCache() {
  state.employees = [];
  state.employeesFetchedAt = 0;
  state.employeeDirectoryItems = [];
  state.employeeDirectoryMeta = buildPaginationMeta(0, state.employeePagination);
  state.employeeDirectoryStats = {
    totalEmployees: 0,
    activeCount: 0,
    onLeaveCount: 0,
    activeAdminCount: 0,
    departments: [],
  };
  invalidateQueryCache(['employees:', 'employeeDirectoryPage:', 'employeeDirectoryStats:']);
}

function invalidateAttendanceCache() {
  state.historyPageData = {
    items: [],
    totalItems: 0,
    totalPages: 1,
    currentPage: 1,
    pageSize: HISTORY_PAGE_SIZE,
    startItem: 0,
    endItem: 0,
  };
  state.attendanceRestrictionsFetchedAt = 0;
  invalidateQueryCache(['attendance:', 'attendancePage:', 'health:', 'qr:']);
}

function invalidateRequestsCache() {
  invalidateQueryCache(['requests:', 'requestAllowance:']);
}

async function fetchEmployeeDirectoryPage(filters, paginationState, options = {}) {
  const requestedPage = paginationState.page;
  const pageSize = paginationState.pageSize;
  const key = buildCacheKey('employeeDirectoryPage', {
    filters,
    requestedPage,
    pageSize,
  });

  return getCachedQuery(key, QUERY_CACHE_TTL_MS.employeeDirectory, async () => {
    const fetchPage = async (pageNumber) => {
      let query = supabase
        .from('profiles')
        .select(PROFILE_SELECT, { count: 'exact' })
        .order('created_at', { ascending: false });
      query = applyEmployeeFilters(query, filters);
      const fromIndex = Math.max((pageNumber - 1) * pageSize, 0);
      const toIndex = fromIndex + pageSize - 1;
      return query.range(fromIndex, toIndex);
    };

    let { data, error, count } = await fetchPage(requestedPage);
    if (error) {
      throw new Error(error.message || t('errors.loadEmployees'));
    }

    let meta = buildPaginationMeta(count || 0, paginationState);
    if (meta.currentPage !== requestedPage) {
      const retry = await fetchPage(meta.currentPage);
      if (retry.error) {
        throw new Error(retry.error.message || t('errors.loadEmployees'));
      }
      data = retry.data;
      count = retry.count;
      meta = buildPaginationMeta(count || 0, paginationState);
    }

    return {
      items: data || [],
      ...meta,
    };
  }, options);
}

async function fetchEmployeeDirectoryStats(options = {}) {
  const key = buildCacheKey('employeeDirectoryStats', { all: true });
  return getCachedQuery(key, QUERY_CACHE_TTL_MS.employeeStats, async () => {
    const [
      totalResult,
      activeResult,
      onLeaveResult,
      activeAdminResult,
      departmentsResult,
    ] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'employee'),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'employee').eq('is_active', true),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'employee').eq('status', 'on_leave'),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('is_active', true),
      supabase.from('profiles').select('department').eq('role', 'employee').not('department', 'is', null).order('department', { ascending: true }),
    ]);

    const firstError = [totalResult.error, activeResult.error, onLeaveResult.error, activeAdminResult.error, departmentsResult.error].find(Boolean);
    if (firstError) {
      throw new Error(firstError.message || t('errors.loadEmployeeMetrics'));
    }

    const departments = [...new Set((departmentsResult.data || []).map((item) => departmentLabel(item.department)).filter(Boolean))];

    return {
      totalEmployees: totalResult.count || 0,
      activeCount: activeResult.count || 0,
      onLeaveCount: onLeaveResult.count || 0,
      activeAdminCount: activeAdminResult.count || 0,
      departments,
    };
  }, options);
}

async function fetchAttendance(filters = {}) {
  const { force, ...queryFilters } = filters;
  const key = buildCacheKey('attendance', queryFilters);
  return getCachedQuery(key, QUERY_CACHE_TTL_MS.attendance, async () => {
    const buildQuery = () => {
      let query = supabase
        .from('attendance')
        .select(ATTENDANCE_SELECT)
        .order('attendance_date', { ascending: false })
        .order('check_in_time', { ascending: false })
        .order('id', { ascending: false });

      if (queryFilters.userId) query = query.eq('user_id', queryFilters.userId);
      if (queryFilters.date) query = query.eq('attendance_date', queryFilters.date);
      if (queryFilters.from) query = query.gte('attendance_date', queryFilters.from);
      if (queryFilters.to) query = query.lte('attendance_date', queryFilters.to);
      if (queryFilters.status && queryFilters.status !== 'all') query = query.eq('attendance_status', queryFilters.status);
      return query;
    };

    try {
      if (queryFilters.limit) {
        const { data, error } = await buildQuery().limit(queryFilters.limit);
        if (error) throw error;
        return data || [];
      }
      return await fetchAllRows(buildQuery);
    } catch (error) {
      throw new Error(error.message || t('errors.loadAttendance'));
    }
  }, { force });
}

async function fetchAttendancePage(filters = {}, paginationState = state.historyPagination, options = {}) {
  const requestedPage = paginationState.page;
  const pageSize = paginationState.pageSize;
  const key = buildCacheKey('attendancePage', { filters, requestedPage, pageSize });
  return getCachedQuery(key, QUERY_CACHE_TTL_MS.attendancePage, async () => {
    const fetchPage = async (pageNumber) => {
      let query = supabase
        .from('attendance')
        .select(ATTENDANCE_SELECT, { count: 'exact' })
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

      const fromIndex = Math.max((pageNumber - 1) * pageSize, 0);
      const toIndex = fromIndex + pageSize - 1;
      return query.range(fromIndex, toIndex);
    };

    let { data, error, count } = await fetchPage(requestedPage);
    if (error) {
      throw new Error(error.message || t('errors.loadAttendance'));
    }

    let meta = buildPaginationMeta(count || 0, paginationState);
    if (meta.currentPage !== requestedPage) {
      const retry = await fetchPage(meta.currentPage);
      if (retry.error) {
        throw new Error(retry.error.message || t('errors.loadAttendance'));
      }
      data = retry.data;
      count = retry.count;
      meta = buildPaginationMeta(count || 0, paginationState);
    }

    return {
      items: data || [],
      ...meta,
    };
  }, options);
}

async function fetchSystemHealth(options = {}) {
  const force = Boolean(options.force);
  const key = buildCacheKey('health', { restrictions: true });
  const now = Date.now();
  if (!force && state.attendanceRestrictions && (now - state.attendanceRestrictionsFetchedAt) < HEALTH_CACHE_TTL_MS) {
    return state.attendanceRestrictions;
  }

  return getCachedQuery(key, HEALTH_CACHE_TTL_MS, async () => {
    try {
      const payload = await apiRequest('/health');
      state.attendanceRestrictions = payload.attendance_restrictions || null;
      state.attendanceRestrictionsFetchedAt = Date.now();
      return state.attendanceRestrictions;
    } catch (_error) {
      return null;
    }
  }, { force });
}

async function fetchRequests(filters = {}, options = {}) {
  const key = buildCacheKey('requests', filters);
  return getCachedQuery(key, QUERY_CACHE_TTL_MS.requests, async () => {
    const payload = await apiRequest(`/requests${buildQueryString(filters)}`);
    return payload?.data?.items || [];
  }, options);
}

async function fetchRequestAllowanceSummary(filters = {}, options = {}) {
  const key = buildCacheKey('requestAllowance', filters);
  return getCachedQuery(key, QUERY_CACHE_TTL_MS.requestAllowance, async () => {
    const payload = await apiRequest(`/requests/allowance${buildQueryString(filters)}`);
    return payload?.data || null;
  }, options);
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

function schedulePagePrefetch() {
  if (!state.profile) return;
  if (prefetchTimerId) window.clearTimeout(prefetchTimerId);

  // Warm only the most likely next screen. Previously every navigation sent
  // many concurrent reads, including reports and QR data that may never be used.
  const runner = () => {
    prefetchTimerId = null;
    if (!state.profile) return;
    let nextQuery = null;
    if (state.currentPage === 'dashboard') {
      nextQuery = isAdmin()
        ? fetchEmployeeDirectoryPage(state.employeeFilters, state.employeePagination)
        : fetchRequests(state.requestFilters);
    } else if (state.currentPage === 'attendance') {
      nextQuery = fetchAttendancePage({
        ...state.historyFilters,
        ...(!isAdmin() ? { userId: state.profile.id } : {}),
      }, state.historyPagination);
    }
    Promise.resolve(nextQuery).catch(() => {});
  };

  prefetchTimerId = window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(runner, { timeout: 1500 });
    } else {
      runner();
    }
  }, 350);
}



function sumMetrics(items = [], selector) {
  return items.reduce((total, item) => total + Number(selector(item) || 0), 0);
}

function attendanceRestrictionMessage() {
  return t('qrOnly.attendanceNote');
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
    throw new Error(error.message || t('errors.mapAttendance'));
  }

  (data || []).forEach((profile) => {
    state.profileMap.set(profile.id, profile);
  });
}

// "Mozilla/5.0 (Linux; Android 10; K) ... Chrome/.. | via:qr" -> "Android · Chrome · QR"
function shortDeviceLabel(deviceInfo) {
  const value = String(deviceInfo || '');
  if (/manual entry/i.test(value)) return t('timesheetExport.manualDevice');
  const os = /iPhone|iPad|iOS/i.test(value) ? 'iPhone'
    : /Android/i.test(value) ? 'Android'
      : /Windows/i.test(value) ? 'Windows'
        : /Mac OS X|Macintosh/i.test(value) ? 'Mac'
          : /Linux/i.test(value) ? 'Linux' : '';
  const browser = /Edg\//i.test(value) ? 'Edge'
    : /SamsungBrowser/i.test(value) ? 'Samsung'
      : /Firefox|FxiOS/i.test(value) ? 'Firefox'
        : /Chrome|CriOS/i.test(value) ? 'Chrome'
          : /Safari/i.test(value) ? 'Safari' : '';
  const parts = [os, browser].filter(Boolean);
  if (/via:qr/i.test(value)) parts.push('QR');
  return parts.length ? parts.join(' · ') : value.slice(0, 40);
}

function employeeById(id) {
  return state.profileMap.get(id) || state.employees.find((item) => item.id === id) || null;
}

// Only the company's four departments are offered. An employee still on an old
// department keeps it listed (so saving their form does not silently clear it)
// until an admin moves them to one of the four.
function departmentOptions(selected = '') {
  return [...new Set([...DEPARTMENT_OPTIONS, selected].filter(Boolean))];
}
function syncShell() {
  elements.sidebarName.textContent = state.profile?.full_name || 'EVARA User';
  elements.sidebarRole.textContent = roleLabel(state.profile?.role || 'employee');
  elements.sidebarAvatar.textContent = toInitials(state.profile?.full_name || 'EVARA');
  if (elements.topbarAvatar) {
    elements.topbarAvatar.textContent = toInitials(state.profile?.full_name || 'EVARA');
  }
  document.body.classList.toggle('role-employee', Boolean(state.profile) && !isAdmin());
  document.body.classList.toggle('role-admin', isAdmin());

  const pages = allowedPages();
  elements.sidebarNav.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('hidden', !pages.includes(button.dataset.page));
    button.classList.toggle('active', button.dataset.page === state.currentPage);
  });
  elements.tabbar?.querySelectorAll('.tab-item').forEach((button) => {
    const active = button.dataset.page === state.currentPage;
    button.classList.toggle('active', active);
    if (active) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.removeAttribute('aria-current');
    }
  });
}

function syncPageFrame(page) {
  state.currentPage = page;
  Object.entries(elements.pages).forEach(([key, value]) => {
    value.classList.toggle('active', key === page);
  });
  syncShell();
  refreshTopbarMessage();
}

function refreshTopbarMessage() {
  if (!state.profile) {
    return;
  }
  const employeeHome = !isAdmin() && state.currentPage === 'dashboard';
  if (elements.topbarHeadline) {
    elements.topbarHeadline.textContent = employeeHome
      ? `${greeting()}${getLocale().startsWith('ar') ? '،' : ','} ${firstName(state.profile.full_name)}`
      : t(`nav.${state.currentPage}`);
  }
  if (elements.topbarSubline) {
    elements.topbarSubline.textContent = isAdmin()
      ? t('meta.description')
      : new Date().toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  }
}

// Rarely used modules are fetched only when needed, keeping the first load small.
function exportAttendanceCsv(...args) {
  return import('./exporters.js').then((module) => module.exportAttendanceCsv(...args)).catch((error) => showToast(error.message, 'error'));
}

function exportEmployeesCsv(...args) {
  return import('./exporters.js').then((module) => module.exportEmployeesCsv(...args)).catch((error) => showToast(error.message, 'error'));
}

async function scanOfficeQr() {
  const module = await import('./qrScanner.js');
  return module.scanOfficeQr();
}

function bindStaticEvents() {
  document.addEventListener('click', async (event) => {
    if (!event.target.closest('[data-open-qr-scanner]')) return;
    event.preventDefault();
    const destination = await scanOfficeQr();
    if (destination) window.location.assign(destination);
  });
  elements.loginForm.addEventListener('submit', handleLogin);
  elements.togglePasswordBtn.addEventListener('click', () => {
    const nextType = elements.loginPassword.type === 'password' ? 'text' : 'password';
    elements.loginPassword.type = nextType;
    syncPasswordToggleLabel();
  });
  elements.logoutBtn.addEventListener('click', handleLogout);
  elements.menuToggle.addEventListener('click', () => setMobileMenuOpen(!elements.sidebar.classList.contains('open')));
  elements.sidebarBackdrop.addEventListener('click', () => setMobileMenuOpen(false));
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-language-toggle]');
    if (!trigger) {
      return;
    }

    toggleLanguage();
  });
  elements.modalBackdrop.addEventListener('click', () => closeModal(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && elements.sidebar.classList.contains('open')) {
      setMobileMenuOpen(false);
      elements.menuToggle.focus();
    }
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
  elements.tabbar?.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-page]');
    if (trigger) {
      navigate(trigger.dataset.page);
    }
  });
  elements.topbarAvatar?.addEventListener('click', () => navigate('profile'));
  window.addEventListener('hashchange', () => {
    renderRoute().catch((error) => {
      showToast(error.message, 'error');
    });
  });
}

function setMobileMenuOpen(open) {
  elements.sidebar.classList.toggle('open', open);
  elements.sidebarBackdrop.classList.toggle('open', open);
  elements.menuToggle.setAttribute('aria-expanded', String(open));
}

// Live updates. A change from someone else no longer rebuilds the whole page:
// the cached data is dropped, admins get a small "new updates" button, and an
// employee's own screen refreshes only when it is safe (not typing, no dialog open).
let liveUpdateCount = 0;
let liveRefreshPending = false;
let lastLocalWriteAt = 0;
let liveUpdatePill = null;

function invalidateCacheForTable(table) {
  if (table === 'attendance') invalidateAttendanceCache();
  else if (table === 'profiles') invalidateEmployeeCache();
  else if (table === 'employee_requests') invalidateRequestsCache();
  else invalidateQueryCache();
}

function isUserBusy() {
  const active = document.activeElement;
  const typing = active && (active.matches?.('input, textarea, select') || active.isContentEditable);
  return Boolean(typing || !elements.modal.classList.contains('hidden') || document.querySelector('dialog[open]'));
}

function hideLiveUpdatePill() {
  liveUpdateCount = 0;
  liveUpdatePill?.classList.add('hidden');
}

function showLiveUpdatePill() {
  if (!liveUpdatePill) {
    liveUpdatePill = document.createElement('button');
    liveUpdatePill.type = 'button';
    liveUpdatePill.className = 'live-update-pill hidden';
    liveUpdatePill.setAttribute('aria-live', 'polite');
    liveUpdatePill.addEventListener('click', () => {
      hideLiveUpdatePill();
      refreshCurrentPageKeepingScroll();
    });
    document.body.append(liveUpdatePill);
  }
  liveUpdatePill.textContent = t('liveUpdates.available', { count: String(liveUpdateCount) });
  liveUpdatePill.classList.remove('hidden');
}

function refreshCurrentPageKeepingScroll() {
  const scrollTop = window.scrollY;
  const main = document.querySelector('.app-main');
  const mainScrollTop = main?.scrollTop || 0;
  liveRefreshPending = false;
  return renderRoute()
    .then(() => {
      window.scrollTo({ top: scrollTop });
      if (main) main.scrollTop = mainScrollTop;
    })
    .catch((error) => showToast(error.message, 'error'));
}

function scheduleLiveRefresh(payload = {}) {
  if (!state.profile) {
    return;
  }

  invalidateCacheForTable(payload.table);

  // The admin's own action already refreshed the screen; ignore its echo.
  if (Date.now() - lastLocalWriteAt < 4000) {
    return;
  }

  if (isAdmin()) {
    liveUpdateCount += 1;
    showLiveUpdatePill();
    return;
  }

  liveRefreshPending = true;
  window.clearTimeout(state.liveRefreshTimer);
  state.liveRefreshTimer = window.setTimeout(() => {
    if (!document.hidden && !isUserBusy()) {
      refreshCurrentPageKeepingScroll();
    }
  }, 600);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && liveRefreshPending && state.profile && !isAdmin() && !isUserBusy()) {
    refreshCurrentPageKeepingScroll();
  }
});

function setupRealtimeSubscriptions() {
  clearRealtimeSubscriptions();

  if (!supabase || !state.profile) {
    return;
  }

  // Admins watch every row; an employee only needs their own rows, so one person's
  // check-in does not re-render every employee's screen.
  const ownRows = (column) => (isAdmin() ? {} : { filter: `${column}=eq.${state.profile.id}` });

  const attendanceChannel = supabase
    .channel(`attendance-feed-${state.profile.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance', ...ownRows('user_id') }, scheduleLiveRefresh)
    .subscribe();

  realtimeChannels.push(attendanceChannel);

  const profileChannel = supabase
    .channel(`profiles-feed-${state.profile.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', ...ownRows('id') }, scheduleLiveRefresh)
    .subscribe();

  realtimeChannels.push(profileChannel);

  const requestChannel = supabase
    .channel(`requests-feed-${state.profile.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_requests', ...ownRows('user_id') }, scheduleLiveRefresh)
    .subscribe();

  realtimeChannels.push(requestChannel);
}

async function boot() {
  applyDocumentLanguage();
  initRotatingQuotes();
  syncPasswordToggleLabel();
  bindStaticEvents();
  startClock();
  onLanguageChange(async () => {
    syncPasswordToggleLabel();
    syncLoginHint();
    syncShell();
    refreshTopbarMessage();
    if (!isSupabaseReady()) {
      setLoginError(t('errors.supabaseFrontendConfigMissing'));
    }
    if (state.profile) {
      await renderRoute().catch((error) => showToast(error.message, 'error'));
    }
  });

  if (!isSupabaseReady()) {
    elements.loginBtn.disabled = true;
    showLogin(t('errors.supabaseFrontendConfigMissing'));
    return;
  }

  // Deferred so Supabase finishes its own bookkeeping before we query with the session.
  supabase.auth.onAuthStateChange((event, session) => {
    window.setTimeout(() => handleAuthEvent(event, session), 0);
  });

  try {
    const { data: { session } } = await supabase.auth.getSession();
    await openSession(session);
  } catch (error) {
    showLogin(error.message);
  }
}

// Supabase also reports INITIAL_SESSION on load, TOKEN_REFRESHED about hourly and
// SIGNED_IN again when the tab regains focus. Re-opening the whole app on each of those
// refetched the profile, re-rendered the page and re-subscribed realtime, so only a real
// sign-out or a different user changes what is on screen; the rest just keep the token fresh.
function handleAuthEvent(event, session) {
  if (event === 'SIGNED_OUT' || !session) {
    if (state.profile || sessionOpening) {
      resetSessionState();
      showLogin();
    }
    return;
  }

  if (event === 'INITIAL_SESSION') {
    return;
  }

  if (state.profile?.id === session.user.id) {
    state.session = session;
    return;
  }

  openSession(session);
}

async function openSession(session) {
  if (!session) {
    showLogin();
    return;
  }

  try {
    await handleAuthenticatedSession(session);
  } catch (error) {
    resetSessionState();
    showLogin(error.message);
  }
}

function handleAuthenticatedSession(session) {
  if (sessionOpening?.userId === session.user.id) {
    return sessionOpening.promise;
  }

  const promise = loadAuthenticatedSession(session).finally(() => {
    if (sessionOpening?.promise === promise) {
      sessionOpening = null;
    }
  });
  sessionOpening = { userId: session.user.id, promise };
  return promise;
}

async function loadAuthenticatedSession(session) {
  const profile = await fetchMyProfile(session.user.id);

  if (!profile) {
    await supabase.auth.signOut();
    throw new Error(t('errors.missingProfile'));
  }

  if (!profile.is_active) {
    await supabase.auth.signOut();
    throw new Error(t('errors.inactiveAccount'));
  }

  state.session = session;
  state.profile = profile;
  // Only admins may switch to Arabic; employees always see English.
  setLanguageLock(profile.role === 'admin' ? null : 'en');
  // Arabic strings are downloaded only now, and only for an admin who uses Arabic.
  await ensureLanguageLoaded(getCurrentLanguage()).catch(() => {});
  applyDocumentLanguage();
  updateSessionActivity();
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
    return;
  }

  window.location.hash = page;
}

async function renderRoute() {
  if (!state.profile) {
    return;
  }

  if (routeRenderInFlight) {
    routeRenderQueued = true;
    return;
  }

  routeRenderInFlight = true;
  try {
    do {
      routeRenderQueued = false;

      const requestedPage = pageFromHash();
      const page = allowedPages().includes(requestedPage) ? requestedPage : 'dashboard';
      if (requestedPage !== page) {
        window.location.hash = page;
        continue;
      }

      const pageChanged = state.currentPage !== page;
      stopLiveShift();
      stopLiveShift = () => {};
      syncPageFrame(page);
      setMobileMenuOpen(false);
      hideLiveUpdatePill();
      if (pageChanged && !isAdmin()) {
        window.scrollTo({ top: 0 });
      }
      if (page === 'dashboard') {
        await renderDashboardPage();
      } else if (page === 'profile') {
        await renderProfilePage();
      } else if (page === 'employees') {
        await renderEmployeesPage();
      } else if (page === 'attendance') {
        await renderAttendancePage();
      } else if (page === 'history') {
        await renderHistoryPage();
      } else if (page === 'requests') {
        await renderRequestsPage();
      } else if (page === 'reports') {
        await renderReportsPage();
      } else if (page === 'qr') {
        await renderQrPage();
      }

      schedulePagePrefetch();
    } while (routeRenderQueued);
  } finally {
    routeRenderInFlight = false;
  }
}

// Shifts left open on past days, listed so the admin can add the real check-out
// before payroll (until then their hours are an end-of-shift estimate).
function missingCheckoutMarkup(report) {
  const items = report.byEmployee.filter((item) => item.missingCheckoutRows.length);
  if (!items.length) return '';
  const count = items.reduce((sum, item) => sum + item.missingCheckoutRows.length, 0);
  return `
    <section class="card-block missing-checkout" role="status">
      <div class="missing-checkout-head">
        <span class="missing-checkout-icon" aria-hidden="true">!</span>
        <div>
          <h3>${escapeHtml(t('reportsPage.missingCheckoutTitle', { count: String(count) }))}</h3>
          <p>${escapeHtml(t('reportsPage.missingCheckoutText'))}</p>
        </div>
      </div>
      <ul class="missing-checkout-list">
        ${items.flatMap((item) => item.missingCheckoutRows.map((row) => `
          <li>
            <span class="missing-checkout-name">${escapeHtml(item.employee.full_name)}</span>
            <span class="missing-checkout-date">${escapeHtml(formatDate(row.attendance_date))} · ${escapeHtml(t('common.checkIn'))} ${escapeHtml(formatTime(row.check_in_time))}</span>
            <button type="button" class="btn btn-secondary btn-small" data-fix-checkout data-user-id="${escapeHtml(row.user_id)}" data-date="${escapeHtml(row.attendance_date)}">${escapeHtml(t('reportsPage.missingCheckoutFix'))}</button>
          </li>`)).join('')}
      </ul>
    </section>
  `;
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
        <strong>${escapeHtml(profile?.full_name || t('labels.unknown'))}</strong>
        <span>${escapeHtml(profile?.email || '-')}</span>
      </div>
    </div>
  `;
}

function badgeMarkup(type, value, label = null) {
  return `<span class="badge ${escapeHtml(type)}">${escapeHtml(label || statusLabel(value))}</span>`;
}

function requestTypeLabel(value) {
  const translated = t(`labels.${value}`);
  if (translated !== `labels.${value}`) {
    return translated;
  }

  return value;
}

function requestDateLabel(request) {
  if (!request) {
    return '-';
  }

  if (request.request_type === 'late_2_hours') {
    return formatDate(request.late_date);
  }

  if (request.request_type === 'annual_leave') {
    const start = formatDate(request.leave_start_date);
    const end = formatDate(request.leave_end_date);
    return `${start} - ${end}`;
  }

  return '-';
}

function requestDurationLabel(request) {
  if (!request) {
    return '-';
  }

  if (request.request_type === 'late_2_hours') {
    return t('requestPage.delayDuration');
  }

  if (request.request_type === 'annual_leave') {
    return t('requestPage.leaveDaysCount', { days: String(request.leave_days || 0) });
  }

  return '-';
}

function buildAttendanceRecordNote(row) {
  if (!row) {
    return '';
  }

  if (row.attendance_status === 'absent' && !row.check_in_time) {
    return t('notes.recordMarkedAbsent');
  }

  const parts = [];
  if (row.check_in_time) {
    parts.push(t('notes.recordCheckIn', { time: formatTime(row.check_in_time) }));
  }
  if (row.check_out_time) {
    parts.push(t('notes.recordCheckOut', { time: formatTime(row.check_out_time) }));
  }

  return parts.length ? parts.join(', ') : t('notes.recordExistsNoCheckIn');
}

function isEmployeeProfile(profile) {
  return profile?.role === 'employee';
}

function isTrackedAttendanceEmployee(employee) {
  return Boolean(isEmployeeProfile(employee) && employee?.is_active);
}

function isExpectedAttendanceEmployee(employee) {
  return Boolean(
    isEmployeeProfile(employee)
    && employee?.is_active
    && employee?.status !== 'inactive'
    && employee?.status !== 'on_leave'
  );
}

function isEmployeeAttendanceRow(row) {
  return Boolean(row && isEmployeeProfile(employeeById(row.user_id)));
}

function getAttendanceDisplayState({ employee = null, row = null, attendanceDate = todayIso() } = {}) {
  if (row) {
    return {
      code: row.attendance_status,
      label: statusLabel(row.attendance_status),
      note: buildAttendanceRecordNote(row),
      badgeType: row.attendance_status,
      countsAsMissing: false,
      countsAsAbsent: row.attendance_status === 'absent',
    };
  }

  return deriveMissingAttendanceState({
    attendanceDate,
    employeeStatus: employee?.status,
    isActive: employee?.is_active !== false,
  });
}

function attendanceStateBadgeMarkup(displayState) {
  return badgeMarkup(displayState.badgeType || displayState.code, displayState.code, displayState.label);
}

function missingAttendanceOutcome(displayState, shortfallMinutes = 0) {
  switch (displayState.code) {
    case 'weekend':
      return t('outcomes.weeklyLeave');
    case 'on_leave':
      return t('outcomes.onLeave');
    case 'absent':
      return t('outcomes.absent', { duration: formatDuration(shortfallMinutes || FULL_SHIFT_MINUTES) });
    case 'absent_so_far':
      return t('outcomes.noCheckInToday');
    case 'not_checked_in_yet':
      return t('outcomes.noCheckInToday');
    case 'inactive':
      return t('outcomes.attendanceDisabled');
    default:
      return displayState.note || displayState.label;
  }
}

function attendanceDayTypeLabel(displayState) {
  switch (displayState.code) {
    case 'weekend':
      return t('states.weeklyLeave');
    case 'on_leave':
      return t('states.approvedLeave');
    case 'inactive':
      return t('states.inactiveAccount');
    default:
      return t('states.workday');
  }
}

function attendanceLedgerNote({ row = null, displayState, metrics = null, countsAsLate = false, countsAsAbsent = false, shortfallMinutes = 0, overtimeMinutes = 0 }) {
  if (countsAsAbsent) {
    return displayState.note || `Absent - ${formatDuration(shortfallMinutes || FULL_SHIFT_MINUTES)} shortfall`;
  }

  if (!row || !metrics) {
    return displayState.note || displayState.label;
  }

  if (metrics.isOpenShift) {
    return attendanceOutcome(metrics);
  }

  if (countsAsLate && shortfallMinutes > 0) {
    return t('ledgerNotes.lateWithShortfall');
  }

  if (countsAsLate && overtimeMinutes > 0) {
    return t('ledgerNotes.lateRecovered');
  }

  if (countsAsLate) {
    return t('ledgerNotes.lateArrival');
  }

  if (overtimeMinutes > 0) {
    return t('ledgerNotes.completedWithOvertime');
  }

  if (shortfallMinutes > 0) {
    return t('ledgerNotes.belowTarget');
  }

  return t('ledgerNotes.completedDay');
}

function buildEmployeeMonthLedger(employee, attendanceRows, range) {
  const attendanceByDate = new Map(attendanceRows.map((row) => [row.attendance_date, row]));

  return enumerateDates(range.startDate, range.endDate)
    .slice()
    .reverse()
    .map((date) => {
      const attendanceDate = formatDateInput(date);
      const row = attendanceByDate.get(attendanceDate) || null;
      const displayState = getAttendanceDisplayState({ employee, row, attendanceDate });

      if (row) {
        const metrics = buildAttendanceRowMetrics(row);
        const countsAsAbsent = displayState.countsAsAbsent || (row.attendance_status === 'absent' && !row.check_in_time);
        const shortfallMinutes = countsAsAbsent ? FULL_SHIFT_MINUTES : metrics.shortfallMinutes;
        const countsAsLate = row.attendance_status === 'late';

        return {
          attendanceDate,
          row,
          metrics,
          displayState,
          dayTypeLabel: attendanceDayTypeLabel(displayState),
          workedMinutes: metrics.workedMinutes,
          overtimeMinutes: metrics.overtimeMinutes,
          shortfallMinutes,
          countsAsCheckedDay: Boolean(row.check_in_time),
          countsAsLate,
          countsAsAbsent,
          countsAsFullShift: Boolean(metrics.isCompleteShift && shortfallMinutes === 0),
          outcomeLabel: countsAsAbsent
            ? missingAttendanceOutcome(displayState, shortfallMinutes)
            : attendanceOutcome(metrics),
          noteLabel: attendanceLedgerNote({
            row,
            displayState,
            metrics,
            countsAsLate,
            countsAsAbsent,
            shortfallMinutes,
            overtimeMinutes: metrics.overtimeMinutes,
          }),
        };
      }

      const shortfallMinutes = displayState.countsAsAbsent ? FULL_SHIFT_MINUTES : 0;

      return {
        attendanceDate,
        row: null,
        metrics: null,
        displayState,
        dayTypeLabel: attendanceDayTypeLabel(displayState),
        workedMinutes: 0,
        overtimeMinutes: 0,
        shortfallMinutes,
        countsAsCheckedDay: false,
        countsAsLate: false,
        countsAsAbsent: displayState.countsAsAbsent,
        countsAsFullShift: false,
        outcomeLabel: missingAttendanceOutcome(displayState, shortfallMinutes),
        noteLabel: attendanceLedgerNote({
          displayState,
          countsAsAbsent: displayState.countsAsAbsent,
          shortfallMinutes,
        }),
      };
    });
}

function attendanceRosterRank(entry) {
  if (!entry.row) {
    switch (entry.displayState.code) {
      case 'absent':
        return 0;
      case 'absent_so_far':
        return 1;
      case 'not_checked_in_yet':
        return 2;
      case 'on_leave':
        return 7;
      case 'weekend':
        return 8;
      case 'inactive':
        return 9;
      default:
        return 6;
    }
  }

  const metrics = buildAttendanceRowMetrics(entry.row);
  if (metrics.isOpenShift && entry.row.attendance_status === 'late') {
    return 3;
  }
  if (metrics.isOpenShift) {
    return 4;
  }
  if (entry.row.attendance_status === 'late') {
    return 5;
  }
  if (entry.row.check_out_time) {
    return 6;
  }

  return 5;
}

function buildTodayAttendanceRoster(employees, attendanceRows, attendanceDate) {
  const attendanceByUserId = new Map(attendanceRows.map((row) => [row.user_id, row]));

  return employees
    .filter(isTrackedAttendanceEmployee)
    .map((employee) => {
      const row = attendanceByUserId.get(employee.id) || null;
      const displayState = getAttendanceDisplayState({ employee, row, attendanceDate });

      return {
        profile: employee,
        row,
        displayState,
        user_id: employee.id,
        attendance_date: attendanceDate,
        check_in_time: row?.check_in_time || null,
        check_out_time: row?.check_out_time || null,
        attendance_status: row?.attendance_status || displayState.code,
        ip_address: row?.ip_address || null,
        device_info: row?.device_info || displayState.note,
        work_notes: row?.work_notes || null,
        work_place: row?.work_place || null,
        training_minutes: row?.training_minutes ?? null,
      };
    })
    .sort((left, right) => {
      const rankDelta = attendanceRosterRank(left) - attendanceRosterRank(right);
      if (rankDelta !== 0) {
        return rankDelta;
      }

      return (left.profile?.full_name || '').localeCompare(right.profile?.full_name || '');
    });
}

function buildPaginationMeta(totalItems, paginationState) {
  const totalPages = Math.max(1, Math.ceil(totalItems / paginationState.pageSize));
  const currentPage = Math.min(Math.max(paginationState.page, 1), totalPages);
  paginationState.page = currentPage;

  const startIndex = (currentPage - 1) * paginationState.pageSize;
  const endIndex = startIndex + paginationState.pageSize;

  return {
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
        <span class="pagination-summary">${escapeHtml(t('pagination.showingRecords', { count: String(meta.totalItems) }))}</span>
      </div>
    `;
  }

  return `
    <div class="pagination" data-pagination="${escapeHtml(id)}">
      <span class="pagination-summary">${escapeHtml(t('pagination.showingRange', { start: String(meta.startItem), end: String(meta.endItem), total: String(meta.totalItems) }))}</span>
      <div class="inline-actions">
        <button type="button" class="btn btn-secondary" data-page-action="prev" ${meta.currentPage === 1 ? 'disabled' : ''}>${escapeHtml(t('common.previous'))}</button>
        <span class="pagination-pill">${escapeHtml(t('pagination.pageOf', { current: String(meta.currentPage), total: String(meta.totalPages) }))}</span>
        <button type="button" class="btn btn-secondary" data-page-action="next" ${meta.currentPage === meta.totalPages ? 'disabled' : ''}>${escapeHtml(t('common.next'))}</button>
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

function confirmAction({ eyebrow = t('confirm.pleaseConfirm'), title, message, confirmLabel = t('confirm.confirm'), tone = 'danger' }) {
  return new Promise((resolve) => {
    openModal(`
      <div class="modal-header">
        <div>
          <p class="eyebrow">${escapeHtml(eyebrow)}</p>
          <h2>${escapeHtml(title)}</h2>
        </div>
        <button id="closeModalBtn" type="button" class="ghost-inline">${escapeHtml(t('common.close'))}</button>
      </div>
      <div class="form-alert info">${escapeHtml(message)}</div>
      <div class="modal-footer">
        <div></div>
        <div class="inline-actions">
          <button id="cancelConfirmBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.cancel'))}</button>
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
  const today = todayIso();
  const currentMonth = monthRange(currentMonthInput());
  const warmDashboardCache = isAdmin()
    ? Boolean(
      getFreshCachedValue(buildCacheKey('employees', { all: true }), QUERY_CACHE_TTL_MS.employees)
      && getFreshCachedValue(buildCacheKey('attendance', { date: today, limit: 250 }), QUERY_CACHE_TTL_MS.attendance)
    )
    : Boolean(
      getFreshCachedValue(buildCacheKey('attendance', { userId: state.profile?.id, date: today, limit: 1 }), QUERY_CACHE_TTL_MS.attendance)
      && getFreshCachedValue(buildCacheKey('attendance', { userId: state.profile?.id, from: currentMonth.from, to: currentMonth.to, limit: 60 }), QUERY_CACHE_TTL_MS.attendance)
    );

  if (!warmDashboardCache) {
    setPageLoading(container, t('pages.loading.dashboard'));
  }

  try {
    if (isAdmin()) {
      const businessContext = getBusinessDayContext();
      const todayIsWorkday = businessContext.isScheduledWorkday;
      const [employees, todayAttendance] = await Promise.all([
        loadEmployees(),
        fetchAttendance({ date: today, limit: 250 }),
      ]);

      const employeeProfiles = employees.filter(isEmployeeProfile);
      const trackedEmployees = employeeProfiles.filter(isTrackedAttendanceEmployee);
      const employeeTodayRows = todayAttendance.filter(isEmployeeAttendanceRow);
      const onLeave = trackedEmployees.filter((employee) => employee.status === 'on_leave').length;
      const todayDetailed = employeeTodayRows.map((row) => ({
        row,
        profile: employeeById(row.user_id),
        metrics: buildAttendanceRowMetrics(row),
      }));
      const todayRoster = buildTodayAttendanceRoster(employeeProfiles, employeeTodayRows, today);
      const missingTodayRows = todayRoster.filter((entry) => !entry.row && entry.displayState.countsAsMissing);
      const presentToday = todayDetailed.filter((entry) => entry.metrics.isPresent).length;
      const missingTodayCount = todayIsWorkday ? missingTodayRows.length : 0;
      const missingTodayLabel = !todayIsWorkday
        ? t('dashboard.admin.missingWeekend')
        : businessContext.hasShiftEnded
          ? t('dashboard.admin.missingAbsent')
          : t('dashboard.admin.missingSoFar');
      const missingTodayMeta = !todayIsWorkday
        ? t('dashboard.admin.missingWeekendMeta')
        : businessContext.hasShiftEnded
          ? t('dashboard.admin.missingAbsentMeta')
          : t('dashboard.admin.missingSoFarMeta');
      const lateToday = todayIsWorkday
        ? todayDetailed.filter((entry) => entry.row.attendance_status === 'late').length
        : 0;
      const fullShiftCount = todayDetailed.filter((entry) => entry.metrics.isCompleteShift && entry.metrics.shortfallMinutes === 0 && entry.metrics.overtimeMinutes === 0).length;
      const openShiftCount = todayDetailed.filter((entry) => entry.metrics.isOpenShift).length;
      const workedMinutesToday = sumMetrics(todayDetailed, (entry) => entry.metrics.workedMinutes);
      const overtimeMinutesToday = sumMetrics(todayDetailed, (entry) => entry.metrics.overtimeMinutes);
      const shortfallMinutesToday = sumMetrics(todayDetailed, (entry) => entry.metrics.shortfallMinutes);
      const recentRows = employeeTodayRows.slice(0, 8);
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
              <p class="eyebrow">${escapeHtml(t('dashboard.admin.eyebrow'))}</p>
              <h1>${escapeHtml(t('dashboard.admin.title'))}</h1>
              <p>${escapeHtml(t('dashboard.admin.intro', { schedule: businessScheduleLabel() }))}</p>
            </div>
            <button id="dashboardRefreshBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.refresh'))}</button>
          </div>
          <div class="summary-grid">
            ${buildSummaryCard(t('dashboard.admin.totalEmployees'), String(employeeProfiles.length), t('dashboard.admin.totalEmployeesMeta'))}
            ${buildSummaryCard(t('dashboard.admin.activeEmployees'), String(trackedEmployees.length), t('dashboard.admin.activeEmployeesMeta'))}
            ${buildSummaryCard(t('dashboard.admin.onLeave'), String(onLeave), t('dashboard.admin.onLeaveMeta'))}
            ${buildSummaryCard(t('dashboard.admin.presentToday'), String(presentToday), t('dashboard.admin.presentTodayMeta'))}
            ${buildSummaryCard(missingTodayLabel, String(missingTodayCount), missingTodayMeta)}
            ${buildSummaryCard(t('dashboard.admin.lateToday'), String(lateToday), todayIsWorkday ? t('dashboard.admin.lateTodayMeta') : t('dashboard.admin.lateTodayWeekendMeta'))}
            ${buildSummaryCard(t('dashboard.admin.workedToday'), formatDuration(workedMinutesToday), t('dashboard.admin.workedTodayMeta'))}
            ${buildSummaryCard(t('dashboard.admin.actualsCard'), `${fullShiftCount} full / ${openShiftCount} open`, t('dashboard.admin.actualsCardMeta', { overtime: formatDuration(overtimeMinutesToday), shortfall: formatDuration(shortfallMinutesToday) }))}
          </div>
          <section class="card-block">
            <div class="card-head">
              <div>
                <h3>${escapeHtml(t('dashboard.admin.watchlistTitle'))}</h3>
                <p class="card-subtle">${escapeHtml(t('dashboard.admin.watchlistText'))}</p>
              </div>
            </div>
            <div class="table-shell">
              <table>
                <thead>
                  <tr><th>${escapeHtml(t('common.employee'))}</th><th>${escapeHtml(t('common.department'))}</th><th>${escapeHtml(t('common.status'))}</th><th>${escapeHtml(t('common.note'))}</th></tr>
                </thead>
                <tbody>
                  ${todayIsWorkday && missingTodayRows.length ? missingTodayRows.slice(0, 12).map((entry) => `
                    <tr>
                      <td>${buildUserCell(entry.profile)}</td>
                      <td>${escapeHtml(departmentLabel(entry.profile?.department))}</td>
                      <td>${attendanceStateBadgeMarkup(entry.displayState)}</td>
                      <td>${escapeHtml(entry.displayState.note)}</td>
                    </tr>
                  `).join('') : `<tr><td colspan="4"><div class="empty-state">${escapeHtml(todayIsWorkday ? t('notes.noExpectedWatchlist') : t('notes.noWatchlistOnWeeklyLeave'))}</div></td></tr>`}
                </tbody>
              </table>
            </div>
          </section>
          <section class="card-block">
            <div class="card-head">
              <div>
                <h3>${escapeHtml(t('dashboard.admin.actualsTitle'))}</h3>
                <p class="card-subtle">${escapeHtml(t('dashboard.admin.actualsText'))}</p>
              </div>
            </div>
            <div class="table-shell">
              <table>
                <thead>
                  <tr><th>${escapeHtml(t('common.employee'))}</th><th>${escapeHtml(t('common.worked'))}</th><th>${escapeHtml(t('common.overtime'))}</th><th>${escapeHtml(t('common.shortfall'))}</th><th>${escapeHtml(t('dashboard.admin.actualsCard'))}</th></tr>
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
                  `).join('') : `<tr><td colspan="5"><div class="empty-state">${escapeHtml(t('notes.noAttendanceRowsToday'))}</div></td></tr>`}
                </tbody>
              </table>
            </div>
          </section>
          <div class="content-grid">
            <section class="card-block">
              <div class="card-head">
                <div>
                  <h3>${escapeHtml(t('dashboard.admin.recentTitle'))}</h3>
                  <p class="card-subtle">${escapeHtml(t('dashboard.admin.recentText', { date: formatDate(today) }))}</p>
                </div>
              </div>
              <div class="table-shell">
                <table>
                  <thead>
                    <tr><th>${escapeHtml(t('common.employee'))}</th><th>${escapeHtml(t('common.department'))}</th><th>${escapeHtml(t('common.checkIn'))}</th><th>${escapeHtml(t('common.checkOut'))}</th><th>${escapeHtml(t('common.status'))}</th></tr>
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
                    }).join('') : `<tr><td colspan="5"><div class="empty-state">${escapeHtml(t('notes.noAttendanceRecordsToday'))}</div></td></tr>`}
                  </tbody>
                </table>
              </div>
            </section>
            <aside class="card-block">
              <div class="card-head">
                <div>
                  <h3>${escapeHtml(t('dashboard.admin.pulseTitle'))}</h3>
                  <p class="card-subtle">${escapeHtml(t('dashboard.admin.pulseText'))}</p>
                </div>
              </div>
              <div class="page-shell">
                ${Object.entries(employeeProfiles.reduce((acc, employee) => {
                  const key = departmentLabel(employee.department);
                  acc[key] = (acc[key] || 0) + 1;
                  return acc;
                }, {}))
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 6)
                  .map(([department, count]) => `
                  <div class="status-card compact">
                    <div>
                      <span class="status-label">Department</span>
                      <strong>${escapeHtml(department)}</strong>
                      <p class="inline-note">${escapeHtml(String(count))} team member(s)</p>
                    </div>
                  </div>
                `).join('') || `<div class="empty-state">${escapeHtml(t('notes.noDepartmentData'))}</div>`}
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

    const todayIsWorkday = isWorkday(new Date(`${today}T12:00:00`));
    const [todayAttendance, monthAttendance] = await Promise.all([
      fetchAttendance({ userId: state.profile.id, date: today, limit: 1 }),
      fetchAttendance({ userId: state.profile.id, from: currentMonth.from, to: currentMonth.to, limit: 60 }),
    ]);
    const todayRecord = todayAttendance[0] || null;
    const missingTodayState = todayRecord
      ? null
      : getAttendanceDisplayState({
        employee: state.profile,
        attendanceDate: today,
      });
    const monthLedger = buildEmployeeMonthLedger(state.profile, monthAttendance, currentMonth);
    const checkedDays = monthLedger.filter((entry) => entry.countsAsCheckedDay).length;
    const lateDays = monthLedger.filter((entry) => entry.countsAsLate).length;
    const absentDays = monthLedger.filter((entry) => entry.countsAsAbsent).length;
    const weeklyLeaveDays = monthLedger.filter((entry) => entry.displayState.code === 'weekend').length;
    const fullShiftDays = monthLedger.filter((entry) => entry.countsAsFullShift).length;
    const partialShortfallDays = monthLedger.filter((entry) => !entry.countsAsAbsent && entry.shortfallMinutes > 0).length;
    const absenceShortfallMinutes = sumMetrics(monthLedger, (entry) => (entry.countsAsAbsent ? entry.shortfallMinutes : 0));
    const shiftShortfallMinutes = sumMetrics(monthLedger, (entry) => (!entry.countsAsAbsent ? entry.shortfallMinutes : 0));
    const monthOvertimeMinutes = sumMetrics(monthLedger, (entry) => entry.overtimeMinutes);
    const monthShortfallMinutes = absenceShortfallMinutes + shiftShortfallMinutes;
    // Rate over days that are already decided (attended or absent); today's pending check-in does not count against it.
    const decidedDays = monthLedger.filter((entry) => entry.countsAsCheckedDay || entry.countsAsAbsent).length;
    const attendanceRate = decidedDays ? Math.round((checkedDays / decidedDays) * 100) : 100;

    container.innerHTML = `
      <div class="emp-page emp-home">
        ${shiftHeroMarkup({ record: todayRecord, missingState: missingTodayState || (todayIsWorkday ? null : { code: 'weekend' }) })}
        <section class="quick-actions" aria-label="${escapeHtml(t('mobile.quick.title'))}">
          <button type="button" class="quick-action" data-quick="request">${icon('plus')}<span>${escapeHtml(t('mobile.quick.newRequest'))}</span></button>
          <button type="button" class="quick-action" data-quick="history">${icon('history')}<span>${escapeHtml(t('mobile.quick.history'))}</span></button>
          <button type="button" class="quick-action" data-quick="requests">${icon('requests')}<span>${escapeHtml(t('mobile.quick.requests'))}</span></button>
          <button type="button" class="quick-action" data-quick="timesheet">${icon('table')}<span>${escapeHtml(t('mobile.quick.timesheet'))}</span></button>
        </section>
        <section class="emp-card">
          <div class="emp-card-head">
            <div>
              <h3>${escapeHtml(t('mobile.month.title'))}</h3>
              <p>${escapeHtml(currentMonth.label)}</p>
            </div>
            ${rateRingMarkup(attendanceRate, t('mobile.month.rate'))}
          </div>
          <div class="stat-grid">
            ${statTileMarkup({ iconName: 'calendar', label: t('mobile.month.attended'), value: String(checkedDays), tone: 'success' })}
            ${statTileMarkup({ iconName: 'alarm', label: t('mobile.month.late'), value: String(lateDays), tone: 'warning' })}
            ${statTileMarkup({ iconName: 'up', label: t('mobile.month.overtime'), value: formatDuration(monthOvertimeMinutes), tone: 'brand' })}
            ${statTileMarkup({ iconName: 'down', label: t('mobile.month.shortfall'), value: formatDuration(monthShortfallMinutes), tone: 'danger' })}
          </div>
          <details class="emp-more">
            <summary>${escapeHtml(t('mobile.month.more'))}${icon('chevron', 'chevron')}</summary>
            <p class="emp-hint">${escapeHtml(t('notes.totalShortfallHint'))}</p>
            <div class="detail-list">
              ${detailRowMarkup(t('dashboard.employee.absentDays'), String(absentDays))}
              ${detailRowMarkup(t('dashboard.employee.fullShiftDays'), String(fullShiftDays))}
              ${detailRowMarkup(t('dashboard.employee.weeklyLeaveDays'), String(weeklyLeaveDays))}
              ${detailRowMarkup(t('dashboard.employee.absenceShortfall'), formatDuration(absenceShortfallMinutes))}
              ${detailRowMarkup(t('dashboard.employee.shiftShortfall'), `${formatDuration(shiftShortfallMinutes)} · ${partialShortfallDays}`)}
            </div>
          </details>
        </section>
        ${monthStripMarkup(monthLedger, today)}
        <details class="emp-card emp-timesheet" id="employeeTimesheet">
          <summary>
            <span class="emp-summary-icon">${icon('table')}</span>
            <span class="emp-summary-copy"><strong>${escapeHtml(t('mobile.timesheet.title'))}</strong><span>${escapeHtml(t('mobile.timesheet.hint'))}</span></span>
            ${icon('chevron', 'chevron')}
          </summary>
          ${renderTimesheet(monthAttendance, currentMonth.from.slice(0, 7), state.profile.full_name)}
        </details>
      </div>
    `;

    stopLiveShift = startLiveShift(container);
    bindMonthStrip(container);
    container.querySelector('.quick-actions')?.addEventListener('click', (event) => {
      const action = event.target.closest('[data-quick]')?.dataset.quick;
      if (action === 'request') {
        openRequestForm({ onSaved: () => navigate('requests') });
      } else if (action === 'history' || action === 'requests') {
        navigate(action);
      } else if (action === 'timesheet') {
        const sheet = container.querySelector('#employeeTimesheet');
        if (sheet) {
          sheet.open = true;
          sheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  } catch (error) {
    setPageError(container, error.message);
  }
}
async function renderEmployeesPage() {
  const container = elements.pages.employees;
  if (!isAdmin()) {
    setPageError(container, t('errors.adminEmployeesOnly'));
    return;
  }
  const employeesPageKey = buildCacheKey('employeeDirectoryPage', {
    filters: state.employeeFilters,
    requestedPage: state.employeePagination.page,
    pageSize: state.employeePagination.pageSize,
  });
  const statsKey = buildCacheKey('employeeDirectoryStats', { all: true });
  if (!(getFreshCachedValue(employeesPageKey, QUERY_CACHE_TTL_MS.employeeDirectory) && getFreshCachedValue(statsKey, QUERY_CACHE_TTL_MS.employeeStats))) {
    setPageLoading(container, t('pages.loading.employees'));
  }

  try {
    const [, pageData, stats] = await Promise.all([
      loadEmployees(),
      fetchEmployeeDirectoryPage(state.employeeFilters, state.employeePagination),
      fetchEmployeeDirectoryStats(),
    ]);
    state.employeeDirectoryItems = pageData.items;
    state.employeeDirectoryMeta = pageData;
    state.employeeDirectoryStats = stats;
    pageData.items.forEach((employee) => {
      state.profileMap.set(employee.id, employee);
    });
    drawEmployeesPage();
  } catch (error) {
    setPageError(container, error.message);
  }
}

async function renderProfilePage() {
  const container = elements.pages.profile;
  const profileKey = buildCacheKey('attendance', {
    userId: state.profile?.id,
    from: offsetDate(-30),
    to: todayIso(),
    limit: 30,
  });
  if (!getFreshCachedValue(profileKey, QUERY_CACHE_TTL_MS.profile)) {
    setPageLoading(container, t('pages.loading.profile'));
  }

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

    if (!isAdmin()) {
      const profile = state.profile;
      const settingsRow = (id, iconName, label, value = '', tone = '') => `
        <button id="${id}" type="button" class="settings-row${tone ? ` ${tone}` : ''}">
          <span class="settings-icon">${icon(iconName)}</span>
          <span class="settings-label">${escapeHtml(label)}</span>
          ${value ? `<span class="settings-value">${escapeHtml(value)}</span>` : ''}
          ${tone ? '' : icon('chevron', 'chevron')}
        </button>
      `;
      const infoRow = (iconName, label, value) => `
        <div class="settings-row static">
          <span class="settings-icon">${icon(iconName)}</span>
          <span class="settings-label">${escapeHtml(label)}</span>
          <span class="settings-value" dir="auto">${escapeHtml(value || '-')}</span>
        </div>
      `;
      container.innerHTML = `
        <div class="emp-page emp-profile">
          <section class="profile-hero">
            <div class="profile-avatar">${escapeHtml(toInitials(profile.full_name))}</div>
            <h2>${escapeHtml(profile.full_name)}</h2>
            <p>${escapeHtml([profile.position, departmentLabel(profile.department)].filter(Boolean).join(' · '))}</p>
            <div class="profile-chips">
              ${profile.employee_code ? `<span class="profile-chip">${icon('id')}${escapeHtml(profile.employee_code)}</span>` : ''}
              <span class="profile-chip ok">${escapeHtml(statusLabel(profile.status))}</span>
            </div>
          </section>
          <div class="profile-stats">
            <div><strong>${escapeHtml(`${monthlyRatio}%`)}</strong><span>${escapeHtml(t('mobile.profile.monthRate'))}</span></div>
            <div><strong dir="auto">${escapeHtml(monthlyAverageCheckIn)}</strong><span>${escapeHtml(t('mobile.profile.avgCheckIn'))}</span></div>
            <div><strong>${escapeHtml(String(lateDays))}</strong><span>${escapeHtml(t('mobile.profile.lateDays'))}</span></div>
          </div>
          <section class="emp-card settings-list">
            <h3>${escapeHtml(t('mobile.profile.account'))}</h3>
            ${infoRow('mail', t('common.email'), profile.email)}
            ${infoRow('phone', t('common.phone'), profile.phone)}
            ${infoRow('briefcase', t('common.position'), profile.position)}
            ${infoRow('calendar', t('mobile.profile.joined'), formatDate(profile.created_at))}
          </section>
          <section class="emp-card settings-list">
            <h3>${escapeHtml(t('mobile.profile.settings'))}</h3>
            ${settingsRow('openChangePasswordFromProfileBtn', 'lock', t('profilePage.changePassword'))}
            ${settingsRow('profileLogoutBtn', 'logout', t('nav.logout'), '', 'danger')}
          </section>
        </div>
      `;
      container.querySelector('#openChangePasswordFromProfileBtn')?.addEventListener('click', () => openChangeOwnPasswordModal());
      container.querySelector('#profileLogoutBtn')?.addEventListener('click', () => handleLogout());
      return;
    }

    container.innerHTML = `
      <div class="page-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">${escapeHtml(t('profilePage.eyebrow'))}</p>
            <h1>${escapeHtml(state.profile.full_name)}</h1>
            <p>${escapeHtml(t('profilePage.intro'))}</p>
          </div>
          <div class="inline-actions">
            <button id="openChangePasswordFromProfileBtn" type="button" class="btn btn-secondary">${escapeHtml(t('profilePage.changePassword'))}</button>
            <button id="openHistoryFromProfileBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.openHistory'))}</button>
            <button id="openAttendanceFromProfileBtn" type="button" class="btn btn-primary">${escapeHtml(t('common.openAttendance'))}</button>
          </div>
        </div>
        <div class="summary-grid">
          ${buildSummaryCard(t('profilePage.roleCard'), roleLabel(state.profile.role), state.profile.is_active ? t('profilePage.roleActive') : t('profilePage.roleInactive'))}
          ${buildSummaryCard(t('profilePage.departmentCard'), departmentLabel(state.profile.department), state.profile.position || t('notes.noPositionAssigned'))}
          ${buildSummaryCard(t('profilePage.checkedDays'), String(checkedDays), t('profilePage.checkedDaysMeta'))}
          ${buildSummaryCard(t('profilePage.lateDays'), String(lateDays), latestRecord ? t('notes.latestStatus', { status: statusLabel(latestRecord.attendance_status) }) : t('notes.profileNoAttendanceYet'))}
          ${buildSummaryCard(t('profilePage.thisMonth'), `${monthlyRatio}%`, t('notes.presentDaysInMonth', { days: String(monthlyPresentDays), month: currentMonth.label }))}
          ${buildSummaryCard(t('profilePage.avgCheckIn'), monthlyAverageCheckIn, t('profilePage.avgCheckInMeta'))}
        </div>
        <div class="content-grid">
          <section class="card-block">
            <div class="card-head">
              <div>
                <h3>${escapeHtml(t('profilePage.profileDetails'))}</h3>
                <p class="card-subtle">${escapeHtml(t('profilePage.profileDetailsText'))}</p>
              </div>
            </div>
            <div class="form-grid profile-grid">
              <div class="status-card compact"><div><span class="status-label">${escapeHtml(t('common.employeeCode'))}</span><strong>${escapeHtml(state.profile.employee_code || '-')}</strong></div></div>
              <div class="status-card compact"><div><span class="status-label">${escapeHtml(t('common.email'))}</span><strong>${escapeHtml(state.profile.email)}</strong></div></div>
              <div class="status-card compact"><div><span class="status-label">${escapeHtml(t('common.phone'))}</span><strong>${escapeHtml(state.profile.phone || '-')}</strong></div></div>
              <div class="status-card compact"><div><span class="status-label">${escapeHtml(t('common.position'))}</span><strong>${escapeHtml(state.profile.position || '-')}</strong></div></div>
              <div class="status-card compact"><div><span class="status-label">${escapeHtml(t('common.status'))}</span><strong>${escapeHtml(statusLabel(state.profile.status))}</strong></div></div>
              <div class="status-card compact"><div><span class="status-label">${escapeHtml(t('profilePage.accountAccess'))}</span><strong>${escapeHtml(state.profile.is_active ? statusLabel('active') : statusLabel('inactive'))}</strong></div></div>
              <div class="status-card compact"><div><span class="status-label">${escapeHtml(t('common.created'))}</span><strong>${escapeHtml(formatDateTime(state.profile.created_at))}</strong></div></div>
              <div class="status-card compact"><div><span class="status-label">${escapeHtml(t('common.updated'))}</span><strong>${escapeHtml(formatDateTime(state.profile.updated_at))}</strong></div></div>
            </div>
          </section>
          <section class="card-block">
            <div class="card-head">
              <div>
                <h3>${escapeHtml(t('profilePage.recentSnapshot'))}</h3>
                <p class="card-subtle">${escapeHtml(t('profilePage.recentSnapshotText'))}</p>
              </div>
            </div>
            <div class="summary-grid compact-grid">
              ${buildSummaryCard(t('profilePage.completedDays'), String(completedDays), t('profilePage.completedDaysMeta'))}
              ${buildSummaryCard(t('profilePage.latestCheckIn'), latestRecord?.check_in_time ? formatTime(latestRecord.check_in_time) : '-', latestRecord ? formatDate(latestRecord.attendance_date) : t('notes.profileNoRowYet'))}
            </div>
            <div class="table-shell">
              <table>
                <thead>
                  <tr><th>${escapeHtml(t('common.date'))}</th><th>${escapeHtml(t('common.checkIn'))}</th><th>${escapeHtml(t('common.checkOut'))}</th><th>${escapeHtml(t('common.status'))}</th></tr>
                </thead>
                <tbody>
                  ${records.slice(0, 8).length ? records.slice(0, 8).map((row) => `
                    <tr>
                      <td>${escapeHtml(formatDate(row.attendance_date))}</td>
                      <td>${escapeHtml(formatTime(row.check_in_time))}</td>
                      <td>${escapeHtml(formatTime(row.check_out_time))}</td>
                      <td>${badgeMarkup(row.attendance_status, row.attendance_status)}</td>
                    </tr>
                  `).join('') : `<tr><td colspan="4"><div class="empty-state">${escapeHtml(t('notes.profileSnapshotEmpty'))}</div></td></tr>`}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    `;

    container.querySelector('#openAttendanceFromProfileBtn')?.addEventListener('click', () => navigate('attendance'));
    container.querySelector('#openHistoryFromProfileBtn')?.addEventListener('click', () => navigate('history'));
    container.querySelector('#openChangePasswordFromProfileBtn')?.addEventListener('click', () => openChangeOwnPasswordModal());
  } catch (error) {
    setPageError(container, error.message);
  }
}

async function renderReportsPage() {
  const container = elements.pages.reports;
  if (!isAdmin()) {
    setPageError(container, t('errors.adminReportsOnly'));
    return;
  }
  const range = monthRange(state.reportsFilters.month);
  const reportsAttendanceKey = buildCacheKey('attendance', { from: range.from, to: range.to });
  const reportsEmployeesKey = buildCacheKey('employees', { all: true });
  if (!(getFreshCachedValue(reportsAttendanceKey, QUERY_CACHE_TTL_MS.reports) && getFreshCachedValue(reportsEmployeesKey, QUERY_CACHE_TTL_MS.employees))) {
    setPageLoading(container, t('pages.loading.reports'));
  }

  try {
    await loadEmployees();

    const eligibleEmployees = state.employees.filter((employee) => isEmployeeProfile(employee) && employee.is_active && employee.status !== 'inactive');
    const scopedEmployees = reportsEmployeeChoices(eligibleEmployees, state.reportsFilters.department);
    if (state.reportsFilters.employeeId !== 'all' && !scopedEmployees.some((employee) => employee.id === state.reportsFilters.employeeId)) {
      state.reportsFilters.employeeId = 'all';
    }

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
    const selectedEmployeeLedger = selectedEmployee
      ? buildEmployeeMonthLedger(selectedEmployee.employee, selectedEmployee.rows, report.range)
      : [];
    const selectedEmployeeCheckedDays = selectedEmployeeLedger.filter((entry) => entry.countsAsCheckedDay).length;
    const selectedEmployeeLateDays = selectedEmployeeLedger.filter((entry) => entry.countsAsLate).length;
    const selectedEmployeeAbsentDays = selectedEmployeeLedger.filter((entry) => entry.countsAsAbsent).length;
    const selectedEmployeeWeeklyLeaveDays = selectedEmployeeLedger.filter((entry) => entry.displayState.code === 'weekend').length;
    const selectedEmployeeFullShiftDays = selectedEmployeeLedger.filter((entry) => entry.countsAsFullShift).length;
    const selectedEmployeePartialShortfallDays = selectedEmployeeLedger.filter((entry) => !entry.countsAsAbsent && entry.shortfallMinutes > 0).length;
    const selectedEmployeeAbsenceShortfallMinutes = sumMetrics(
      selectedEmployeeLedger,
      (entry) => (entry.countsAsAbsent ? entry.shortfallMinutes : 0)
    );
    const selectedEmployeeShiftShortfallMinutes = sumMetrics(
      selectedEmployeeLedger,
      (entry) => (!entry.countsAsAbsent ? entry.shortfallMinutes : 0)
    );

    container.innerHTML = `
      <div class="page-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">${escapeHtml(t('reportsPage.eyebrow'))}</p>
            <h1>${escapeHtml(t('reportsPage.title'))}</h1>
            <p>${escapeHtml(t('reportsPage.intro', { schedule: businessScheduleLabel() }))}</p>
          </div>
          <div class="inline-actions">
            <button id="reportsExportBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.exportPayrollExcel'))}</button>
            ${selectedEmployee ? `<button id="reportsTimesheetExportBtn" type="button" class="btn btn-primary">${escapeHtml(t('timesheetExport.button'))}</button>` : ''}
          </div>
        </div>
        <section class="card-block">
          <div class="toolbar toolbar-wide">
            <input id="reportsMonth" type="month" value="${escapeHtml(state.reportsFilters.month)}" />
            <select id="reportsDepartment">
              <option value="all">${escapeHtml(t('common.allDepartments'))}</option>
              ${departmentChoices.map((department) => `<option value="${escapeHtml(department)}" ${state.reportsFilters.department === department ? 'selected' : ''}>${escapeHtml(department)}</option>`).join('')}
            </select>
            <select id="reportsEmployee">
              ${reportEmployeeOptions(employeeChoices, state.reportsFilters.employeeId)}
            </select>
            <button id="reportsApplyBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.apply'))}</button>
            <button id="reportsRefreshBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.refresh'))}</button>
          </div>
          <p class="inline-note">${escapeHtml(t('reportsPage.period'))}: ${escapeHtml(report.range.label)} · ${escapeHtml(t('reportsPage.employeesInScope'))}: ${escapeHtml(String(report.filteredEmployees.length))}</p>
        </section>
        ${missingCheckoutMarkup(report)}
        <div class="summary-grid">
          ${buildSummaryCard(t('reportsPage.totalHoursWorked'), formatDuration(report.totals.totalHoursWorkedMinutes), t('reportsPage.totalHoursWorkedMeta'))}
          ${buildSummaryCard(t('reportsPage.totalOvertime'), formatDuration(report.totals.totalOvertimeMinutes), t('reportsPage.totalOvertimeMeta'))}
          ${buildSummaryCard(t('reportsPage.totalShortfall'), formatDuration(report.totals.totalShortfallMinutes), t('reportsPage.totalShortfallMeta'))}
          ${buildSummaryCard(t('reportsPage.attendanceRate'), `${report.totals.attendanceRate}%`, t('reportsPage.attendanceRateMeta', { present: String(report.totals.totalPresentDays), expected: String(report.totals.totalExpectedDays || 0) }))}
          ${buildSummaryCard(t('reportsPage.onTimeArrival'), `${report.totals.onTimeArrivalRate}%`, t('reportsPage.onTimeArrivalMeta'))}
          ${buildSummaryCard(t('reportsPage.peakAbsenceDay'), peakWeekday ? peakWeekday.weekday : t('common.notAvailable'), peakWeekday ? t('reportsPage.peakAbsenceDayMeta', { count: String(peakWeekday.absentCount) }) : t('reportsPage.peakAbsenceDayEmpty'))}
        </div>
        <div class="content-grid">
          <section class="card-block">
            <div class="card-head">
              <div>
                <h3>${escapeHtml(t('reportsPage.workingHoursTrendTitle'))}</h3>
                <p class="card-subtle">${escapeHtml(t('reportsPage.workingHoursTrendText'))}</p>
              </div>
            </div>
            ${report.dailyTrend.length ? `
              <div class="chart-shell">
                <canvas id="reportsHoursCanvas" aria-label="${escapeHtml(t('reportsPage.workingHoursTrendAria'))}"></canvas>
              </div>
            ` : `<div class="empty-state">${escapeHtml(t('notes.reportsNoWorkingHours'))}</div>`}
          </section>
          <section class="card-block">
            <div class="card-head">
              <div>
                <h3>${escapeHtml(t('reportsPage.departmentHoursTitle'))}</h3>
                <p class="card-subtle">${escapeHtml(t('reportsPage.departmentHoursText'))}</p>
              </div>
            </div>
            ${report.departmentHours.length ? `
              <div class="chart-shell">
                <canvas id="reportsDepartmentCanvas" aria-label="${escapeHtml(t('reportsPage.departmentHoursAria'))}"></canvas>
              </div>
            ` : `<div class="empty-state">${escapeHtml(t('notes.reportsNoDepartmentComparison'))}</div>`}
          </section>
        </div>
        <section class="card-block">
          <div class="card-head">
            <div>
              <h3>${escapeHtml(t('reportsPage.detailedTitle'))}</h3>
              <p class="card-subtle">${escapeHtml(t('reportsPage.detailedText'))}</p>
            </div>
          </div>
          <div class="table-shell">
            <table>
              <thead>
                <tr><th>${escapeHtml(t('reportsPage.employeeName'))}</th><th>${escapeHtml(t('reportsPage.daysPresent'))}</th><th>${escapeHtml(t('reportsPage.daysAbsent'))}</th><th>${escapeHtml(t('reportsPage.lateArrivals'))}</th><th>${escapeHtml(t('reportsPage.totalHours'))}</th><th>${escapeHtml(t('reportsPage.expectedHours'))}</th><th>${escapeHtml(t('common.overtime'))}</th><th>${escapeHtml(t('reportsPage.statusTrend'))}</th></tr>
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
                        <span class="inline-note">${escapeHtml(t('reportsPage.attendanceAndOnTime', { attendance: `${item.attendanceRate}%`, ontime: `${item.onTimeArrivalRate}%` }))}</span>
                      </div>
                    </td>
                  </tr>
                `).join('') : `<tr><td colspan="8"><div class="empty-state">${escapeHtml(t('notes.reportsNoEmployeeData'))}</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        <div class="content-grid">
          <section class="card-block">
            <div class="card-head">
              <div>
                <h3>${escapeHtml(t('reportsPage.rankingTitle'))}</h3>
                <p class="card-subtle">${escapeHtml(t('reportsPage.rankingText'))}</p>
              </div>
            </div>
            <div class="page-shell">
              ${report.topPerformers.length ? report.topPerformers.map((item, index) => `
                <div class="status-card compact">
                  <div>
                    <span class="status-label">${escapeHtml(t('reportsPage.rank', { index: String(index + 1) }))}</span>
                    <strong>${escapeHtml(item.employee.full_name)}</strong>
                    <p class="inline-note">${escapeHtml(t('reportsPage.rankingMeta', { attendance: `${item.attendanceRate}%`, ontime: `${item.onTimeArrivalRate}%`, worked: formatDuration(item.workedMinutes) }))}</p>
                  </div>
                </div>
              `).join('') : `<div class="empty-state">${escapeHtml(t('notes.reportsNoRanking'))}</div>`}
            </div>
          </section>
          <section class="card-block">
            <div class="card-head">
              <div>
                <h3>${escapeHtml(t('reportsPage.weekdayTitle'))}</h3>
                <p class="card-subtle">${escapeHtml(t('reportsPage.weekdayText'))}</p>
              </div>
            </div>
            <div class="table-shell">
              <table>
                <thead>
                  <tr><th>${escapeHtml(t('reportsPage.weekday'))}</th><th>${escapeHtml(t('reportsPage.totalAbsences'))}</th><th>${escapeHtml(t('reportsPage.occurrences'))}</th></tr>
                </thead>
                <tbody>
                  ${report.weekdayRows.length ? report.weekdayRows.map((item) => `
                    <tr>
                      <td>${escapeHtml(item.weekday)}</td>
                      <td>${escapeHtml(String(item.absentCount))}</td>
                      <td>${escapeHtml(String(item.occurrences))}</td>
                    </tr>
                  `).join('') : `<tr><td colspan="3"><div class="empty-state">${escapeHtml(t('notes.reportsNoWeekdayTrend'))}</div></td></tr>`}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <section class="card-block">
          <div class="card-head">
              <div>
                <h3>${escapeHtml(t('reportsPage.averageTimesTitle'))}</h3>
                <p class="card-subtle">${escapeHtml(t('reportsPage.averageTimesText'))}</p>
              </div>
          </div>
          <div class="table-shell">
            <table>
              <thead>
                <tr><th>${escapeHtml(t('common.employee'))}</th><th>${escapeHtml(t('reportsPage.averageCheckIn'))}</th><th>${escapeHtml(t('reportsPage.averageCheckOut'))}</th><th>${escapeHtml(t('reportsPage.onTimeRate'))}</th><th>${escapeHtml(t('reportsPage.completeShifts'))}</th></tr>
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
                `).join('') : `<tr><td colspan="5"><div class="empty-state">${escapeHtml(t('notes.reportsNoTimeAnalytics'))}</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        <section class="card-block">
          <div class="card-head">
            <div>
              <h3>${escapeHtml(t('reportsPage.timesheetTitle'))}</h3>
              <p class="card-subtle">${escapeHtml(t('reportsPage.timesheetText'))}</p>
            </div>
          </div>
          ${selectedEmployee ? `
            <p class="inline-note">${escapeHtml(t('reportsPage.selectedHint'))}</p>
            <div class="summary-grid">
              ${buildSummaryCard(t('reportsPage.selectedEmployee'), selectedEmployee.employee.full_name, departmentLabel(selectedEmployee.employee.department))}
              ${buildSummaryCard(t('dashboard.employee.attendedDays'), String(selectedEmployeeCheckedDays), t('notes.checkedSinceMonthStart'))}
              ${buildSummaryCard(t('dashboard.employee.absentDays'), String(selectedEmployeeAbsentDays), t('notes.workdaysWithoutAttendance'))}
              ${buildSummaryCard(t('dashboard.employee.weeklyLeaveDays'), String(selectedEmployeeWeeklyLeaveDays), t('notes.weeklyLeaveSinceMonthStart'))}
              ${buildSummaryCard(t('dashboard.employee.fullShiftDays'), String(selectedEmployeeFullShiftDays), t('notes.completedWithoutShortfall'))}
              ${buildSummaryCard(t('dashboard.employee.lateArrivals'), String(selectedEmployeeLateDays), t('notes.lateAfterStart'))}
              ${buildSummaryCard(t('dashboard.employee.absenceShortfall'), formatDuration(selectedEmployeeAbsenceShortfallMinutes), t('notes.absenceCardMeta', { days: String(selectedEmployeeAbsentDays) }))}
              ${buildSummaryCard(t('dashboard.employee.shiftShortfall'), formatDuration(selectedEmployeeShiftShortfallMinutes), t('notes.shiftShortfallMeta', { days: String(selectedEmployeePartialShortfallDays) }))}
              ${buildSummaryCard(t('common.overtime'), formatDuration(selectedEmployee.overtimeMinutes), t('notes.overtimeMonthMeta'))}
              ${buildSummaryCard(t('dashboard.employee.totalShortfall'), formatDuration(selectedEmployee.shortfallMinutes), t('notes.combinedShortfall'))}
            </div>
            ${renderTimesheet(selectedEmployee.detailedRows.map((entry) => entry.row), state.reportsFilters.month, selectedEmployee.employee.full_name)}
          ` : `<div class="empty-state">${escapeHtml(t('notes.reportsSelectEmployee'))}</div>`}
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
    container.querySelectorAll('[data-fix-checkout]').forEach((button) => {
      button.addEventListener('click', () => {
        const item = report.byEmployee.find((entry) => entry.employee.id === button.dataset.userId);
        const row = item?.missingCheckoutRows.find((entry) => entry.attendance_date === button.dataset.date);
        if (!row) return;
        openManualAttendanceForm({
          userId: row.user_id,
          attendanceDate: row.attendance_date,
          checkInTime: row.check_in_time,
          status: row.attendance_status === 'late' ? 'late' : 'checked_out',
          onSaved: () => renderReportsPage(),
        });
      });
    });
    container.querySelector('#reportsExportBtn')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const fileName = await downloadPayrollExcel(report, state.reportsFilters);
        showToast(t('toasts.payrollExported', { file: fileName }), 'success');
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });
    container.querySelector('#reportsTimesheetExportBtn')?.addEventListener('click', () => {
      if (!selectedEmployee) {
        return;
      }
      openTimesheetExportModal(selectedEmployee.employee);
    });
    drawWorkingHoursTrend(container.querySelector('#reportsHoursCanvas'), report.dailyTrend);
    drawDepartmentHoursChart(container.querySelector('#reportsDepartmentCanvas'), report.departmentHours);
  } catch (error) {
    setPageError(container, error.message);
  }
}

function drawEmployeesPage() {
  const container = elements.pages.employees;
  const items = state.employeeDirectoryItems;
  const paginated = state.employeeDirectoryMeta;
  const departments = state.employeeDirectoryStats.departments;
  const activeCount = state.employeeDirectoryStats.activeCount;
  const onLeaveCount = state.employeeDirectoryStats.onLeaveCount;
  const activeAdminCount = state.employeeDirectoryStats.activeAdminCount;

  container.innerHTML = `
    <div class="page-shell">
      <div class="section-header">
        <div>
          <p class="eyebrow">${escapeHtml(t('employeePage.eyebrow'))}</p>
          <h1>${escapeHtml(t('employeePage.title'))}</h1>
          <p>${escapeHtml(t('employeePage.intro'))}</p>
        </div>
        <button id="openAddEmployeeBtn" type="button" class="btn btn-primary">${escapeHtml(t('common.addEmployee'))}</button>
      </div>
      <div class="summary-grid">
        ${buildSummaryCard(t('dashboard.admin.totalEmployees'), String(state.employeeDirectoryStats.totalEmployees), t('employeePage.totalEmployeesMeta', { count: String(activeAdminCount) }))}
        ${buildSummaryCard(t('employeePage.activeEmployees'), String(activeCount), t('employeePage.activeEmployeesMeta'))}
        ${buildSummaryCard(t('employeePage.onLeave'), String(onLeaveCount), t('employeePage.onLeaveMeta'))}
        ${buildSummaryCard(t('employeePage.departments'), String(departments.length), t('employeePage.departmentsMeta'))}
      </div>
      <section class="card-block">
        <div class="toolbar toolbar-wide">
          <input id="employeeSearch" type="search" placeholder="${escapeHtml(t('employeePage.searchPlaceholder'))}" value="${escapeHtml(state.employeeFilters.search)}" />
          <select id="departmentFilter">
            <option value="all">${escapeHtml(t('common.allDepartments'))}</option>
            ${departments.map((department) => `<option value="${escapeHtml(department)}" ${state.employeeFilters.department === department ? 'selected' : ''}>${escapeHtml(department)}</option>`).join('')}
          </select>
          <select id="statusFilter">
            <option value="all">${escapeHtml(t('common.allStatuses'))}</option>
            ${['active', 'inactive', 'on_leave'].map((status) => `<option value="${status}" ${state.employeeFilters.status === status ? 'selected' : ''}>${escapeHtml(statusLabel(status))}</option>`).join('')}
          </select>
          <button id="refreshEmployeesBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.refresh'))}</button>
          <button id="exportEmployeesBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.exportCsv'))}</button>
        </div>
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                <th>${escapeHtml(t('common.employeeCode'))}</th>
                <th>${escapeHtml(t('common.fullName'))}</th>
                <th>${escapeHtml(t('common.email'))}</th>
                <th>${escapeHtml(t('common.phone'))}</th>
                <th>${escapeHtml(t('common.department'))}</th>
                <th>${escapeHtml(t('common.position'))}</th>
                <th>${escapeHtml(t('common.status'))}</th>
                <th>${escapeHtml(t('common.role'))}</th>
                <th>${escapeHtml(t('common.actions'))}</th>
              </tr>
            </thead>
            <tbody>
              ${items.length ? items.map((employee) => {
                const isSelf = employee.id === state.profile?.id;
                const isLastActiveAdmin = employee.role === 'admin' && employee.is_active && activeAdminCount <= 1;
                const protectionReason = isSelf
                  ? t('employeePage.deactivateDeleteSelf')
                  : isLastActiveAdmin
                    ? t('employeePage.lastActiveAdmin')
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
                      <button class="btn btn-secondary" data-action="view" data-id="${employee.id}">${escapeHtml(t('common.view'))}</button>
                      <button class="btn btn-secondary" data-action="edit" data-id="${employee.id}">${escapeHtml(t('common.edit'))}</button>
                      <button class="btn btn-secondary" data-action="excel" data-id="${employee.id}">${escapeHtml(t('timesheetExport.rowAction'))}</button>
                      <button class="btn btn-secondary" data-action="toggle" data-id="${employee.id}" ${isSelf || isLastActiveAdmin ? 'disabled' : ''} title="${escapeHtml(protectionReason)}">${escapeHtml(employee.is_active ? t('common.deactivate') : t('common.activate'))}</button>
                      <button class="btn btn-danger" data-action="delete" data-id="${employee.id}" ${isSelf || isLastActiveAdmin ? 'disabled' : ''} title="${escapeHtml(protectionReason)}">${escapeHtml(t('common.delete'))}</button>
                    </div>
                  </td>
                </tr>
              `;
              }).join('') : `<tr><td colspan="9"><div class="empty-state">${escapeHtml(t('notes.employeesNoMatch'))}</div></td></tr>`}
            </tbody>
          </table>
        </div>
        ${buildPaginationMarkup('employeesPager', paginated)}
      </section>
    </div>
  `;

  container.querySelector('#employeeSearch')?.addEventListener('input', (event) => {
    const nextValue = event.target.value;
    if (employeeSearchDebounceId) {
      window.clearTimeout(employeeSearchDebounceId);
    }
    employeeSearchDebounceId = window.setTimeout(() => {
      state.employeeFilters.search = nextValue;
      state.employeePagination.page = 1;
      renderEmployeesPage().catch((error) => setPageError(container, error.message));
    }, INPUT_DEBOUNCE_MS);
  });
  container.querySelector('#departmentFilter')?.addEventListener('change', (event) => {
    state.employeeFilters.department = event.target.value;
    state.employeePagination.page = 1;
    renderEmployeesPage().catch((error) => setPageError(container, error.message));
  });
  container.querySelector('#statusFilter')?.addEventListener('change', (event) => {
    state.employeeFilters.status = event.target.value;
    state.employeePagination.page = 1;
    renderEmployeesPage().catch((error) => setPageError(container, error.message));
  });
  container.querySelector('#openAddEmployeeBtn')?.addEventListener('click', () => {
    openEmployeeForm('create');
  });
  container.querySelector('#refreshEmployeesBtn')?.addEventListener('click', () => {
    renderEmployeesPage().catch((error) => setPageError(container, error.message));
  });
  container.querySelector('#exportEmployeesBtn')?.addEventListener('click', async () => {
    const list = await fetchEmployees();
    const searchValue = state.employeeFilters.search.trim().toLowerCase();
    const filteredList = list.filter((employee) => {
      if (!isEmployeeProfile(employee)) {
        return false;
      }
      const matchesSearch = !searchValue || `${employee.full_name} ${employee.employee_code || ''} ${employee.email} ${employee.department || ''} ${employee.position || ''}`
        .toLowerCase()
        .includes(searchValue);
      const matchesDepartment = state.employeeFilters.department === 'all'
        || departmentLabel(employee.department) === state.employeeFilters.department;
      const matchesStatus = state.employeeFilters.status === 'all'
        || employee.status === state.employeeFilters.status;
      return matchesSearch && matchesDepartment && matchesStatus;
    });
    exportEmployeesCsv(filteredList);
    showToast(t('toasts.employeesExported'), 'success');
  });
  bindPagination(container, 'employeesPager', state.employeePagination, () => {
    renderEmployeesPage().catch((error) => setPageError(container, error.message));
  });
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
    if (action.dataset.action === 'excel') {
      openTimesheetExportModal(employee);
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
        <p class="eyebrow">${isEdit ? escapeHtml(t('employeePage.updateEmployee')) : escapeHtml(t('employeePage.createEmployee'))}</p>
        <h2>${isEdit ? escapeHtml(employee.full_name) : escapeHtml(t('employeePage.addEmployeeTitle'))}</h2>
      </div>
      <button id="closeModalBtn" type="button" class="ghost-inline">${escapeHtml(t('common.close'))}</button>
    </div>
    <form id="employeeForm" class="stack-form">
      <div class="form-grid">
        <div class="form-group">
          <label for="employee_full_name">${escapeHtml(t('common.fullName'))}</label>
          <input id="employee_full_name" name="full_name" value="${escapeHtml(employee?.full_name || '')}" required />
        </div>
        <div class="form-group">
          <label for="employee_code">${escapeHtml(t('common.employeeCode'))}</label>
          <input id="employee_code" name="employee_code" value="${escapeHtml(employee?.employee_code || '')}" required />
        </div>
        <div class="form-group">
          <label for="employee_email">${escapeHtml(t('common.email'))}</label>
          <input id="employee_email" name="email" type="email" value="${escapeHtml(employee?.email || '')}" required />
        </div>
        <div class="form-group">
          <label for="employee_phone">${escapeHtml(t('common.phone'))}</label>
          <input id="employee_phone" name="phone" value="${escapeHtml(employee?.phone || '')}" />
        </div>
        <div class="form-group">
          <label for="employee_department">${escapeHtml(t('common.department'))}</label>
          <select id="employee_department" name="department">
            <option value="">${escapeHtml(t('employeePage.selectDepartment'))}</option>
            ${departments.map((department) => `<option value="${escapeHtml(department)}" ${(employee?.department || '') === department ? 'selected' : ''}>${escapeHtml(department)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="employee_position">${escapeHtml(t('common.position'))}</label>
          <input id="employee_position" name="position" autocomplete="off" value="${escapeHtml(employee?.position || '')}" />
        </div>
        <div class="form-group">
          <label for="employee_role">${escapeHtml(t('common.role'))}</label>
          <select id="employee_role" name="role">
            ${['employee', 'admin'].map((role) => `<option value="${role}" ${(employee?.role || 'employee') === role ? 'selected' : ''}>${escapeHtml(roleLabel(role))}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="employee_status">${escapeHtml(t('common.status'))}</label>
          <select id="employee_status" name="status">
            ${['active', 'inactive', 'on_leave'].map((status) => `<option value="${status}" ${(employee?.status || 'active') === status ? 'selected' : ''}>${escapeHtml(statusLabel(status))}</option>`).join('')}
          </select>
        </div>
        ${isEdit ? '' : `
          <div class="form-group">
            <label for="employee_password">${escapeHtml(t('common.password'))}</label>
            <input id="employee_password" name="password" type="password" autocomplete="new-password" aria-describedby="employee_password_hint" required />
          </div>
          <div class="form-group">
            <label for="employee_password_confirm">${escapeHtml(t('common.confirmPassword'))}</label>
            <input id="employee_password_confirm" name="password_confirm" type="password" autocomplete="new-password" required />
          </div>
          <p id="employee_password_hint" class="inline-note full">${escapeHtml(t('employeeForm.passwordHint'))}</p>
        `}
      </div>
      <div id="employeeFormError" class="form-alert error hidden"></div>
      <div class="modal-footer">
        <div class="inline-actions">
          ${isEdit ? `<button id="resetEmployeePasswordBtn" type="button" class="btn btn-secondary">${escapeHtml(t('employeePage.resetPassword'))}</button>` : ''}
        </div>
        <div class="inline-actions">
          <button type="button" id="cancelEmployeeFormBtn" class="btn btn-secondary">${escapeHtml(t('common.cancel'))}</button>
          <button id="submitEmployeeFormBtn" type="submit" class="btn btn-primary">${isEdit ? escapeHtml(t('common.saveChanges')) : escapeHtml(t('common.createEmployee'))}</button>
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
        <p class="eyebrow">${escapeHtml(t('employeePage.viewProfile'))}</p>
        <h2>${escapeHtml(employee.full_name)}</h2>
      </div>
      <button id="closeModalBtn" type="button" class="ghost-inline">${escapeHtml(t('common.close'))}</button>
    </div>
    <div class="form-grid">
      <div class="status-card compact"><div><span class="status-label">${escapeHtml(t('common.employeeCode'))}</span><strong>${escapeHtml(employee.employee_code || '-')}</strong></div></div>
      <div class="status-card compact"><div><span class="status-label">${escapeHtml(t('common.role'))}</span><strong>${escapeHtml(roleLabel(employee.role))}</strong></div></div>
      <div class="status-card compact"><div><span class="status-label">${escapeHtml(t('common.email'))}</span><strong>${escapeHtml(employee.email)}</strong></div></div>
      <div class="status-card compact"><div><span class="status-label">${escapeHtml(t('common.phone'))}</span><strong>${escapeHtml(employee.phone || '-')}</strong></div></div>
      <div class="status-card compact"><div><span class="status-label">${escapeHtml(t('common.department'))}</span><strong>${escapeHtml(departmentLabel(employee.department))}</strong></div></div>
      <div class="status-card compact"><div><span class="status-label">${escapeHtml(t('common.position'))}</span><strong>${escapeHtml(employee.position || '-')}</strong></div></div>
      <div class="status-card compact"><div><span class="status-label">${escapeHtml(t('common.status'))}</span><strong>${escapeHtml(statusLabel(employee.status))}</strong></div></div>
      <div class="status-card compact"><div><span class="status-label">${escapeHtml(t('common.created'))}</span><strong>${escapeHtml(formatDateTime(employee.created_at))}</strong></div></div>
    </div>
    <div class="modal-footer">
      <div class="inline-actions">
        <button id="viewEditEmployeeBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.edit'))}</button>
        ${isAdmin() && isEmployeeProfile(employee) ? `<button id="viewManualAttendanceBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.addManualRecord'))}</button>` : ''}
      </div>
      <div class="inline-actions">
        <button id="closeEmployeeViewBtn" type="button" class="btn btn-primary">${escapeHtml(t('common.done'))}</button>
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
      showFormError('employeeFormError', t('errors.requiredEmployeeFields'));
      return;
    }

    if (mode === 'create') {
      const password = form.password.value;
      const confirmPassword = form.password_confirm.value;
      if (!isStrongPassword(password)) {
        showFormError('employeeFormError', t('errors.strongPassword'));
        return;
      }
      if (password !== confirmPassword) {
        showFormError('employeeFormError', t('errors.passwordMismatch'));
        return;
      }
      payload.password = password;
    }

    submitButton.disabled = true;
    submitButton.textContent = mode === 'create' ? t('employeePage.createLabel') : t('employeePage.saveLabel');

    try {
      await apiRequest(mode === 'create' ? '/admin/employees' : `/admin/employees/${employee.id}`, {
        method: mode === 'create' ? 'POST' : 'PUT',
        body: payload,
      });
      invalidateEmployeeCache();
      closeModal();
      showToast(mode === 'create' ? t('toasts.employeeCreated') : t('toasts.employeeUpdated'), 'success');
      await renderEmployeesPage();
    } catch (error) {
      showFormError('employeeFormError', error.message);
      submitButton.disabled = false;
      submitButton.textContent = mode === 'create' ? t('common.createEmployee') : t('common.saveChanges');
    }
  });
}

function fileNameFromDisposition(header, fallback) {
  const value = String(header || '');
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch (_error) {
      // fall through to the plain filename
    }
  }
  const plain = value.match(/filename="([^"]+)"/i);
  return plain ? plain[1] : fallback;
}

// POSTs to an admin export endpoint and saves the returned .xlsx; resolves to its name.
async function downloadXlsxFromApi(path, body, fallbackName, failMessage) {
  const token = await getAccessToken();
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail = payload?.details?.errors?.map((item) => item.message).join(' ');
    throw new Error(detail || payload?.message || failMessage);
  }

  const blob = await response.blob();
  const fileName = fileNameFromDisposition(response.headers.get('Content-Disposition'), fallbackName);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  return fileName;
}

function downloadTimesheetExcel(employee, from, to) {
  return downloadXlsxFromApi(
    `/admin/employees/${encodeURIComponent(employee.id)}/timesheet-export`,
    { from, to },
    `${employee.full_name} - Timesheet.xlsx`,
    t('timesheetExport.failed'),
  );
}

// Payroll workbook for the month and filters on the reports page. Hours are the same
// numbers the page shows; days still to come are not counted as absences in the notes.
function downloadPayrollExcel(report, filters) {
  const today = todayIso();
  const elapsedWorkdays = report.workdays.filter((date) => formatDateInput(date) <= today).length;
  const requiredHours = Math.round((report.workdays.length * FULL_SHIFT_MINUTES) / 60);
  const employees = [...report.byEmployee]
    .sort((left, right) => String(left.employee.employee_code || '').localeCompare(String(right.employee.employee_code || ''), undefined, { numeric: true })
      || String(left.employee.full_name || '').localeCompare(String(right.employee.full_name || '')))
    .map((item) => ({
      name: item.employee.full_name || item.employee.email || '-',
      hoursWorked: Math.round((item.workedMinutes / 60) * 100) / 100,
      notes: [
        `Present ${item.presentDays}/${elapsedWorkdays} days`,
        item.lateArrivals ? `Late ${item.lateArrivals}` : '',
        elapsedWorkdays > item.presentDays ? `Not present ${elapsedWorkdays - item.presentDays}` : '',
        item.missingCheckoutRows.length ? `No check-out ${item.missingCheckoutRows.length} day(s), hours estimated` : '',
      ].filter(Boolean).join(' · '),
    }));

  return downloadXlsxFromApi(
    '/admin/reports/payroll-export',
    { month: filters.month, requiredHours, employees },
    `Evara Payroll - ${filters.month}.xlsx`,
    t('toasts.payrollExportFailed'),
  );
}

async function openTimesheetExportModal(employee) {
  openModal(`
    <div class="modal-header">
      <div>
        <p class="eyebrow">${escapeHtml(t('timesheetExport.eyebrow'))}</p>
        <h2>${escapeHtml(employee.full_name)}</h2>
      </div>
      <button id="closeModalBtn" type="button" class="ghost-inline">${escapeHtml(t('common.close'))}</button>
    </div>
    <div id="timesheetExportBody"><div class="loading-state"><div class="spinner"></div><div>${escapeHtml(t('timesheetExport.loading'))}</div></div></div>
  `);
  document.getElementById('closeModalBtn')?.addEventListener('click', closeModal);

  let summary;
  try {
    const payload = await apiRequest(`/admin/employees/${employee.id}/timesheet-export`);
    summary = payload.data;
  } catch (error) {
    const body = document.getElementById('timesheetExportBody');
    if (body) body.innerHTML = `<div class="form-alert error">${escapeHtml(error.message)}</div>`;
    return;
  }

  const body = document.getElementById('timesheetExportBody');
  if (!body) {
    return;
  }

  const last = summary.last_export;
  const lastText = last
    ? t('timesheetExport.lastExport', {
      from: formatDate(last.period_from),
      to: formatDate(last.period_to),
      date: formatDateTime(last.exported_at),
    })
    : t('timesheetExport.firstExport');

  body.innerHTML = `
    <form id="timesheetExportForm" class="stack-form">
      <p class="inline-note">${escapeHtml(lastText)}</p>
      ${summary.up_to_date ? `<p class="inline-note attention-note">${escapeHtml(t('timesheetExport.upToDate'))}</p>` : ''}
      <div class="form-grid">
        <div class="form-group">
          <label for="timesheet_from">${escapeHtml(t('timesheetExport.from'))}</label>
          <input id="timesheet_from" type="date" value="${escapeHtml(summary.suggested_from)}" required />
        </div>
        <div class="form-group">
          <label for="timesheet_to">${escapeHtml(t('timesheetExport.to'))}</label>
          <input id="timesheet_to" type="date" value="${escapeHtml(summary.suggested_to)}" required />
        </div>
      </div>
      <p class="inline-note">${escapeHtml(t('timesheetExport.hint', { days: String(summary.max_days) }))}</p>
      <div id="timesheetExportError" class="form-alert error hidden"></div>
      <div class="modal-footer">
        <div></div>
        <div class="inline-actions">
          <button id="cancelTimesheetExportBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.cancel'))}</button>
          <button id="submitTimesheetExportBtn" type="submit" class="btn btn-primary">${escapeHtml(t('timesheetExport.download'))}</button>
        </div>
      </div>
    </form>
  `;

  document.getElementById('cancelTimesheetExportBtn')?.addEventListener('click', closeModal);
  document.getElementById('timesheetExportForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFormError('timesheetExportError');
    const from = document.getElementById('timesheet_from').value;
    const to = document.getElementById('timesheet_to').value;
    if (!from || !to || to < from) {
      showFormError('timesheetExportError', t('timesheetExport.invalidRange'));
      return;
    }

    const submitButton = document.getElementById('submitTimesheetExportBtn');
    submitButton.disabled = true;
    submitButton.textContent = t('timesheetExport.preparing');
    try {
      await downloadTimesheetExcel(employee, from, to);
      closeModal();
      showToast(t('timesheetExport.done', { name: employee.full_name }), 'success');
    } catch (error) {
      showFormError('timesheetExportError', error.message);
      submitButton.disabled = false;
      submitButton.textContent = t('timesheetExport.download');
    }
  });
}

function openResetPasswordModal(employee) {
  openModal(`
    <div class="modal-header">
      <div>
        <p class="eyebrow">${escapeHtml(t('employeePage.resetPassword'))}</p>
        <h2>${escapeHtml(employee.full_name)}</h2>
      </div>
      <button id="closeModalBtn" type="button" class="ghost-inline">${escapeHtml(t('common.close'))}</button>
    </div>
    <form id="resetPasswordForm" class="stack-form">
      <div class="form-group">
        <label for="reset_password">${escapeHtml(t('common.password'))}</label>
        <input id="reset_password" type="password" required />
      </div>
      <div class="form-group">
        <label for="reset_password_confirm">${escapeHtml(t('common.confirmPassword'))}</label>
        <input id="reset_password_confirm" type="password" required />
      </div>
      <div id="resetPasswordError" class="form-alert error hidden"></div>
      <div class="modal-footer">
        <div></div>
        <div class="inline-actions">
          <button id="cancelResetPasswordBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.cancel'))}</button>
          <button id="submitResetPasswordBtn" type="submit" class="btn btn-primary">${escapeHtml(t('employeePage.resetPassword'))}</button>
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
      showFormError('resetPasswordError', t('errors.strongPassword'));
      return;
    }
    if (password !== confirmPassword) {
      showFormError('resetPasswordError', t('errors.passwordMismatch'));
      return;
    }

    const submitButton = document.getElementById('submitResetPasswordBtn');
    submitButton.disabled = true;
    submitButton.textContent = t('employeePage.resetting');

    try {
      await apiRequest(`/admin/employees/${employee.id}/reset-password`, {
        method: 'PATCH',
        body: { new_password: password },
      });
      closeModal();
      showToast(t('toasts.passwordReset'), 'success');
    } catch (error) {
      showFormError('resetPasswordError', error.message);
      submitButton.disabled = false;
      submitButton.textContent = t('employeePage.resetPassword');
    }
  });
}

function openChangeOwnPasswordModal() {
  openModal(`
    <div class="modal-header">
      <div>
        <p class="eyebrow">${escapeHtml(t('profilePage.changePassword'))}</p>
        <h2>${escapeHtml(t('profilePage.changePasswordTitle'))}</h2>
      </div>
      <button id="closeModalBtn" type="button" class="ghost-inline">${escapeHtml(t('common.close'))}</button>
    </div>
    <form id="changeOwnPasswordForm" class="stack-form">
      <div class="form-group">
        <label for="current_password">${escapeHtml(t('profilePage.currentPassword'))}</label>
        <input id="current_password" type="password" required />
      </div>
      <div class="form-group">
        <label for="new_password">${escapeHtml(t('profilePage.newPassword'))}</label>
        <input id="new_password" type="password" required />
      </div>
      <div class="form-group">
        <label for="new_password_confirm">${escapeHtml(t('profilePage.confirmNewPassword'))}</label>
        <input id="new_password_confirm" type="password" required />
      </div>
      <div id="changeOwnPasswordError" class="form-alert error hidden"></div>
      <div class="modal-footer">
        <div></div>
        <div class="inline-actions">
          <button id="cancelChangeOwnPasswordBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.cancel'))}</button>
          <button id="submitChangeOwnPasswordBtn" type="submit" class="btn btn-primary">${escapeHtml(t('profilePage.changePassword'))}</button>
        </div>
      </div>
    </form>
  `);

  document.getElementById('closeModalBtn')?.addEventListener('click', closeModal);
  document.getElementById('cancelChangeOwnPasswordBtn')?.addEventListener('click', closeModal);
  document.getElementById('changeOwnPasswordForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFormError('changeOwnPasswordError');

    const currentPassword = document.getElementById('current_password').value;
    const newPassword = document.getElementById('new_password').value;
    const newPasswordConfirm = document.getElementById('new_password_confirm').value;

    if (!isStrongPassword(newPassword)) {
      showFormError('changeOwnPasswordError', t('errors.strongPassword'));
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      showFormError('changeOwnPasswordError', t('errors.passwordMismatch'));
      return;
    }
    if (currentPassword === newPassword) {
      showFormError('changeOwnPasswordError', t('errors.newPasswordMustDiffer'));
      return;
    }

    const submitButton = document.getElementById('submitChangeOwnPasswordBtn');
    submitButton.disabled = true;
    submitButton.textContent = t('profilePage.updatingPassword');

    try {
      await apiRequest('/account/password', {
        method: 'PATCH',
        body: {
          current_password: currentPassword,
          new_password: newPassword,
        },
      });
      closeModal();
      showToast(t('toasts.passwordChanged'), 'success');
    } catch (error) {
      showFormError('changeOwnPasswordError', error.message);
      submitButton.disabled = false;
      submitButton.textContent = t('profilePage.changePassword');
    }
  });
}

function openManualAttendanceForm(options = {}) {
  const employees = state.employees
    .filter(isEmployeeProfile)
    .slice()
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const defaultUserId = options.userId || '';
  const defaultAttendanceDate = options.attendanceDate || todayIso();
  const defaultCheckIn = toDateTimeLocalValue(options.checkInTime);
  const defaultStatus = options.status || 'present';
  const onSaved = typeof options.onSaved === 'function' ? options.onSaved : async () => {
    await renderAttendancePage();
  };

  openModal(`
    <div class="modal-header">
      <div>
        <p class="eyebrow">${escapeHtml(t('employeePage.manualAttendance'))}</p>
        <h2>${escapeHtml(t('employeePage.addAttendanceRecord'))}</h2>
      </div>
      <button id="closeModalBtn" type="button" class="ghost-inline">${escapeHtml(t('common.close'))}</button>
    </div>
    <form id="manualAttendanceForm" class="stack-form">
      <div class="form-grid">
        <div class="form-group full">
          <label for="manual_user_id">${escapeHtml(t('common.employee'))}</label>
          <select id="manual_user_id" name="user_id" required>
            <option value="">${escapeHtml(t('common.employee'))}</option>
            ${employees.map((employee) => `<option value="${employee.id}" ${defaultUserId === employee.id ? 'selected' : ''}>${escapeHtml(employee.full_name)}${employee.employee_code ? ` - ${escapeHtml(employee.employee_code)}` : ''}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="manual_attendance_date">${escapeHtml(t('common.date'))}</label>
          <input id="manual_attendance_date" name="attendance_date" type="date" value="${escapeHtml(defaultAttendanceDate)}" required />
        </div>
        <div class="form-group">
          <label for="manual_attendance_status">${escapeHtml(t('common.status'))}</label>
          <select id="manual_attendance_status" name="attendance_status">
            ${['present', 'late', 'checked_out', 'absent'].map((status) => `<option value="${status}" ${status === defaultStatus ? 'selected' : ''}>${escapeHtml(statusLabel(status))}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="manual_check_in_time">${escapeHtml(t('common.checkIn'))}</label>
          <input id="manual_check_in_time" name="check_in_time" type="datetime-local" value="${escapeHtml(defaultCheckIn)}" />
        </div>
        <div class="form-group">
          <label for="manual_check_out_time">${escapeHtml(t('common.checkOut'))}</label>
          <input id="manual_check_out_time" name="check_out_time" type="datetime-local" />
        </div>
        <div class="form-group full">
          <label for="manual_device_info">${escapeHtml(t('employeePage.notesDeviceInfo'))}</label>
          <textarea id="manual_device_info" name="device_info" rows="3" placeholder="${escapeHtml(t('employeePage.optionalManualNote'))}"></textarea>
        </div>
      </div>
      <div id="manualAttendanceError" class="form-alert error hidden"></div>
      <div class="modal-footer">
        <div></div>
        <div class="inline-actions">
          <button id="cancelManualAttendanceBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.cancel'))}</button>
          <button id="submitManualAttendanceBtn" type="submit" class="btn btn-primary">${escapeHtml(t('common.saveAttendance'))}</button>
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
      showFormError('manualAttendanceError', t('employeePage.employeeAndDateRequired'));
      return;
    }
    if (form.attendance_status.value === 'absent' && (checkInTime || checkOutTime)) {
      showFormError('manualAttendanceError', t('employeePage.absentNoTimes'));
      return;
    }
    if ((form.attendance_status.value === 'present' || form.attendance_status.value === 'late') && !checkInTime) {
      showFormError('manualAttendanceError', t('employeePage.presentNeedsCheckIn'));
      return;
    }
    if (form.attendance_status.value === 'checked_out' && (!checkInTime || !checkOutTime)) {
      showFormError('manualAttendanceError', t('employeePage.checkedOutNeedsBoth'));
      return;
    }
    if (checkOutTime && !checkInTime) {
      showFormError('manualAttendanceError', t('employeePage.checkoutNeedsCheckIn'));
      return;
    }
    if (checkInTime && checkOutTime && new Date(checkOutTime) < new Date(checkInTime)) {
      showFormError('manualAttendanceError', t('employeePage.checkoutAfterCheckIn'));
      return;
    }

    const submitButton = document.getElementById('submitManualAttendanceBtn');
    submitButton.disabled = true;
    submitButton.textContent = t('employeePage.saveLabel');

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
      invalidateAttendanceCache();
      closeModal(true);
      showToast(t('toasts.manualAttendanceSaved'), 'success');
      await onSaved();
    } catch (error) {
      showFormError('manualAttendanceError', error.message);
      submitButton.disabled = false;
      submitButton.textContent = t('common.saveAttendance');
    }
  });
}

async function handleEmployeeToggle(employee) {
  const activeAdminCount = state.employees.filter((item) => item.role === 'admin' && item.is_active).length;
  if (employee.id === state.profile?.id) {
    showToast(t('errors.disableSelf'), 'error');
    return;
  }
  if (employee.role === 'admin' && employee.is_active && activeAdminCount <= 1) {
    showToast(t('errors.lastActiveAdmin'), 'error');
    return;
  }

  const confirmed = await confirmAction({
    eyebrow: t('confirm.accountAccess'),
    title: employee.is_active ? t('confirm.deactivateTitle', { name: employee.full_name }) : t('confirm.activateTitle', { name: employee.full_name }),
    message: employee.is_active
      ? t('confirm.deactivateMessage')
      : t('confirm.activateMessage'),
    confirmLabel: employee.is_active ? t('confirm.deactivateConfirm') : t('confirm.activateConfirm'),
  });
  if (!confirmed) {
    return;
  }

  await apiRequest(`/admin/employees/${employee.id}/toggle-status`, {
    method: 'PATCH',
  });
  invalidateEmployeeCache();
  showToast(t('toasts.employeeStatusUpdated', { name: employee.full_name }), 'success');
  await renderEmployeesPage();
}

async function handleEmployeeDelete(employee) {
  const activeAdminCount = state.employees.filter((item) => item.role === 'admin' && item.is_active).length;
  if (employee.id === state.profile?.id) {
    showToast(t('errors.deleteSelf'), 'error');
    return;
  }
  if (employee.role === 'admin' && employee.is_active && activeAdminCount <= 1) {
    showToast(t('errors.lastActiveAdmin'), 'error');
    return;
  }

  const confirmed = await confirmAction({
    eyebrow: t('confirm.deleteEyebrow'),
    title: t('confirm.deleteTitle', { name: employee.full_name }),
    message: t('confirm.deleteMessage'),
    confirmLabel: t('confirm.deleteConfirm'),
  });
  if (!confirmed) {
    return;
  }

  await apiRequest(`/admin/employees/${employee.id}`, {
    method: 'DELETE',
  });
  invalidateEmployeeCache();
  showToast(t('toasts.employeeDeleted', { name: employee.full_name }), 'success');
  await renderEmployeesPage();
}
async function renderAttendancePage() {
  const container = elements.pages.attendance;
  const hasWarmHealth = (Date.now() - state.attendanceRestrictionsFetchedAt) < HEALTH_CACHE_TTL_MS;
  const today = todayIso();
  const warmAttendanceCache = isAdmin()
    ? Boolean(
      getFreshCachedValue(buildCacheKey('attendance', { date: today }), QUERY_CACHE_TTL_MS.attendance)
      && getFreshCachedValue(buildCacheKey('attendance', { from: offsetDate(-14), to: today, limit: 14 }), QUERY_CACHE_TTL_MS.attendance)
      && hasWarmHealth
    )
    : Boolean(
      getFreshCachedValue(buildCacheKey('attendance', { userId: state.profile?.id, date: today }), QUERY_CACHE_TTL_MS.attendance)
      && getFreshCachedValue(buildCacheKey('attendance', { userId: state.profile?.id, from: offsetDate(-14), to: today, limit: 14 }), QUERY_CACHE_TTL_MS.attendance)
      && hasWarmHealth
    );
  if (!warmAttendanceCache) {
    setPageLoading(container, t('pages.loading.attendance'));
  }

  try {
    const [todayRecords, recentRecords, restrictionSummary] = await Promise.all([
      fetchAttendance({ date: today, ...(isAdmin() ? {} : { userId: state.profile.id }) }),
      fetchAttendance({ from: offsetDate(-14), to: today, limit: 14, ...(isAdmin() ? {} : { userId: state.profile.id }) }),
      fetchSystemHealth(),
    ]);
    const restrictionNote = attendanceRestrictionMessage(restrictionSummary);

    if (isAdmin()) {
      await loadEmployees();
      await ensureProfileDirectory(todayRecords);
      const businessContext = getBusinessDayContext();
      const employeeTodayRecords = todayRecords.filter(isEmployeeAttendanceRow);
      const todayRoster = buildTodayAttendanceRoster(state.employees, employeeTodayRecords, today);
      const expectedRoster = todayRoster.filter((entry) => isExpectedAttendanceEmployee(entry.profile));
      const missingRoster = expectedRoster.filter((entry) => !entry.row && entry.displayState.countsAsMissing);
      const checkedInCount = employeeTodayRecords.filter((item) => item.check_in_time).length;
      const checkedOut = employeeTodayRecords.filter((item) => item.check_out_time).length;
      const stillInside = employeeTodayRecords.filter((item) => item.check_in_time && !item.check_out_time).length;
      const lateCount = employeeTodayRecords.filter((item) => item.attendance_status === 'late').length;
      const missingCount = businessContext.isScheduledWorkday ? missingRoster.length : 0;
      const missingLabel = !businessContext.isScheduledWorkday
        ? t('attendancePage.missingWeekend')
        : businessContext.hasShiftEnded
          ? t('attendancePage.missingAbsent')
          : t('attendancePage.missingSoFar');
      const missingMeta = !businessContext.isScheduledWorkday
        ? t('attendancePage.missingWeekendMeta')
        : businessContext.hasShiftEnded
          ? t('attendancePage.missingAbsentMeta')
          : t('attendancePage.missingSoFarMeta');

      container.innerHTML = `
        <div class="page-shell">
          <div class="section-header">
            <div>
              <p class="eyebrow">${escapeHtml(t('attendancePage.adminEyebrow'))}</p>
              <h1>${escapeHtml(t('attendancePage.adminTitle', { date: formatDate(today) }))}</h1>
              <p>${escapeHtml(t('attendancePage.adminIntro', { schedule: businessScheduleLabel() }))}</p>
              ${restrictionNote ? `<p class="inline-note attention-note">${escapeHtml(restrictionNote)}</p>` : ''}
            </div>
            <div class="inline-actions">
              <button id="manualAttendanceBtn" type="button" class="btn btn-primary">${escapeHtml(t('common.addManualRecord'))}</button>
              <button id="exportAttendanceBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.exportCsv'))}</button>
              <button id="attendanceRefreshBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.refresh'))}</button>
            </div>
          </div>
          <div class="summary-grid">
            ${buildSummaryCard(t('attendancePage.present'), String(checkedInCount), t('attendancePage.presentMeta'))}
            ${buildSummaryCard(missingLabel, String(missingCount), missingMeta)}
            ${buildSummaryCard(t('attendancePage.checkedOut'), String(checkedOut), t('attendancePage.checkedOutMeta'))}
            ${buildSummaryCard(t('attendancePage.inOffice'), String(stillInside), t('attendancePage.inOfficeMeta'))}
            ${buildSummaryCard(t('attendancePage.late'), String(lateCount), t('attendancePage.lateMeta'))}
          </div>
          <section class="card-block">
            <div class="table-shell">
              <table>
                <thead>
                  <tr><th>${escapeHtml(t('common.employee'))}</th><th>${escapeHtml(t('timesheetExport.columnTitle'))}</th><th>${escapeHtml(t('common.department'))}</th><th>${escapeHtml(t('common.checkIn'))}</th><th>${escapeHtml(t('common.checkOut'))}</th><th>${escapeHtml(t('common.status'))}</th><th>${escapeHtml(t('common.device'))}</th><th>${escapeHtml(t('timesheet.notes'))}</th></tr>
                </thead>
                <tbody id="attendanceRosterBody">
                  ${todayRoster.length ? todayRoster.map((entry) => {
                    const profile = entry.profile || employeeById(entry.user_id);
                    return `
                      <tr>
                        <td>${buildUserCell(profile)}</td>
                        <td>${profile?.id ? `<button type="button" class="btn btn-secondary" data-excel-id="${escapeHtml(profile.id)}">${escapeHtml(t('timesheetExport.rowAction'))}</button>` : ''}</td>
                        <td>${escapeHtml(departmentLabel(profile?.department))}</td>
                        <td>${escapeHtml(formatTime(entry.check_in_time))}</td>
                        <td>${escapeHtml(formatTime(entry.check_out_time))}</td>
                        <td>${attendanceStateBadgeMarkup(entry.displayState)}</td>
                        <td title="${escapeHtml(entry.device_info || '')}">${escapeHtml(entry.device_info ? shortDeviceLabel(entry.device_info) : entry.displayState.note || '-')}</td>
                        <td class="work-notes-cell">${escapeHtml(entry.work_notes || '—')}</td>
                      </tr>
                    `;
                  }).join('') : `<tr><td colspan="8"><div class="empty-state">${escapeHtml(t('notes.noEmployeeAttendanceToday'))}</div></td></tr>`}
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
        exportAttendanceCsv(todayRoster, { resolveProfile: employeeById, fallbackProfile: state.profile });
        showToast(t('toasts.attendanceExported'), 'success');
      });
      container.querySelector('#attendanceRosterBody')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-excel-id]');
        const employee = button ? employeeById(button.dataset.excelId) : null;
        if (employee) {
          openTimesheetExportModal(employee);
        }
      });
      return;
    }

    const openPreviousShift = recentRecords.find((row) => row.check_in_time && !row.check_out_time
      && (Date.now() - new Date(row.check_in_time).getTime()) <= 24 * 60 * 60 * 1000);
    const todayRecord = todayRecords[0] || openPreviousShift || null;
    const missingTodayState = todayRecord
      ? null
      : getAttendanceDisplayState({
        employee: state.profile,
        attendanceDate: today,
      });
    container.innerHTML = `
      <div class="emp-page emp-today">
        ${shiftHeroMarkup({ record: todayRecord, missingState: missingTodayState })}
        <section class="emp-card how-card">
          <div class="emp-card-head"><h3>${escapeHtml(t('mobile.how.title'))}</h3></div>
          <ol class="how-steps">
            <li>${icon('wifi')}<span>${escapeHtml(t('mobile.how.step1'))}</span></li>
            <li>${icon('qr')}<span>${escapeHtml(t('mobile.how.step2'))}</span></li>
            <li>${icon('note')}<span>${escapeHtml(t('mobile.how.step3'))}</span></li>
          </ol>
        </section>
        <section class="emp-section">
          <div class="emp-section-head">
            <h3>${escapeHtml(t('mobile.recent.title'))}</h3>
            <button id="attendanceRefreshBtn" type="button" class="icon-btn" aria-label="${escapeHtml(t('common.refresh'))}">${icon('refresh')}</button>
          </div>
          ${recordListMarkup(recentRecords, t('mobile.recent.empty'))}
        </section>
      </div>
    `;

    stopLiveShift = startLiveShift(container);
    container.querySelector('#attendanceRefreshBtn')?.addEventListener('click', () => renderAttendancePage().catch((error) => setPageError(container, error.message)));
  } catch (error) {
    setPageError(container, error.message);
  }
}

function requestFormMarkup(defaultType = 'late_2_hours', defaultUserId = '') {
  const employees = state.employees
    .filter(isEmployeeProfile)
    .sort((left, right) => (left.full_name || '').localeCompare(right.full_name || ''));

  return `
    <form id="requestForm" class="stack-form">
      <div class="modal-header">
        <div>
          <p class="eyebrow">${escapeHtml(t('requestPage.newRequestEyebrow'))}</p>
          <h2>${escapeHtml(t('requestPage.newRequestTitle'))}</h2>
        </div>
        <button id="closeModalBtn" type="button" class="ghost-inline">${escapeHtml(t('common.close'))}</button>
      </div>

      <div class="form-grid">
        ${isAdmin() ? `
          <div class="form-group">
            <label for="request_user_id">${escapeHtml(t('common.employee'))}</label>
            <select id="request_user_id" name="user_id" required>
              <option value="">${escapeHtml(t('requestPage.selectEmployee'))}</option>
              ${employees.map((employee) => `<option value="${employee.id}" ${defaultUserId === employee.id ? 'selected' : ''}>${escapeHtml(employee.full_name)}${employee.employee_code ? ` - ${escapeHtml(employee.employee_code)}` : ''}</option>`).join('')}
            </select>
          </div>
        ` : ''}
        <fieldset class="form-group full type-picker">
          <legend>${escapeHtml(t('requestPage.requestType'))}</legend>
          ${REQUEST_TYPES.map((type) => `
            <label class="type-option">
              <input type="radio" name="request_type" value="${type}" ${defaultType === type ? 'checked' : ''} required />
              <span class="type-option-icon">${icon(type === 'annual_leave' ? 'plane' : 'hourglass')}</span>
              <span class="type-option-copy">
                <strong>${escapeHtml(requestTypeLabel(type))}</strong>
                <span>${escapeHtml(t(type === 'annual_leave' ? 'mobile.requests.typeHintLeave' : 'mobile.requests.typeHintDelay'))}</span>
              </span>
            </label>
          `).join('')}
        </fieldset>
        <div class="form-group" id="requestLateDateGroup">
          <label for="request_late_date">${escapeHtml(t('requestPage.lateDate'))}</label>
          <input id="request_late_date" name="late_date" type="date" value="${escapeHtml(todayIso())}" />
        </div>
        <div class="form-group hidden" id="requestLeaveStartGroup">
          <label for="request_leave_start_date">${escapeHtml(t('requestPage.leaveStartDate'))}</label>
          <input id="request_leave_start_date" name="leave_start_date" type="date" value="${escapeHtml(todayIso())}" />
        </div>
        <div class="form-group hidden" id="requestLeaveEndGroup">
          <label for="request_leave_end_date">${escapeHtml(t('requestPage.leaveEndDate'))}</label>
          <input id="request_leave_end_date" name="leave_end_date" type="date" value="${escapeHtml(todayIso())}" />
        </div>
      </div>

      <div class="form-group">
        <label for="request_reason">${escapeHtml(t('requestPage.reason'))}</label>
        <textarea id="request_reason" name="reason" rows="4" placeholder="${escapeHtml(t('requestPage.reasonPlaceholder'))}"></textarea>
      </div>

      <div id="requestFormError" class="form-alert error hidden"></div>
      <div class="modal-footer">
        <div class="inline-note">${escapeHtml(t('requestPage.limitHint'))}</div>
        <div class="inline-actions">
          <button id="cancelRequestFormBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.cancel'))}</button>
          <button id="submitRequestFormBtn" type="submit" class="btn btn-primary">${escapeHtml(t('requestPage.submitRequest'))}</button>
        </div>
      </div>
    </form>
  `;
}

function syncRequestFormFields(form) {
  const requestType = form.request_type.value;
  const isDelayRequest = requestType === 'late_2_hours';

  const lateGroup = document.getElementById('requestLateDateGroup');
  const leaveStartGroup = document.getElementById('requestLeaveStartGroup');
  const leaveEndGroup = document.getElementById('requestLeaveEndGroup');

  lateGroup?.classList.toggle('hidden', !isDelayRequest);
  leaveStartGroup?.classList.toggle('hidden', isDelayRequest);
  leaveEndGroup?.classList.toggle('hidden', isDelayRequest);

  if (form.late_date) {
    form.late_date.required = isDelayRequest;
  }
  if (form.leave_start_date) {
    form.leave_start_date.required = !isDelayRequest;
  }
  if (form.leave_end_date) {
    form.leave_end_date.required = !isDelayRequest;
  }
}

function collectRequestForm(form) {
  const payload = {
    request_type: form.request_type.value,
    reason: form.reason.value.trim(),
  };

  if (isAdmin() && form.user_id) {
    payload.user_id = form.user_id.value;
  }

  if (payload.request_type === 'late_2_hours') {
    payload.late_date = form.late_date.value;
  } else {
    payload.leave_start_date = form.leave_start_date.value;
    payload.leave_end_date = form.leave_end_date.value;
  }

  return payload;
}

function openRequestForm({ onSaved = null, defaultType = 'late_2_hours', defaultUserId = '' } = {}) {
  openModal(requestFormMarkup(defaultType, defaultUserId));

  const form = document.getElementById('requestForm');
  const submitButton = document.getElementById('submitRequestFormBtn');
  if (!form || !submitButton) {
    return;
  }

  document.getElementById('closeModalBtn')?.addEventListener('click', () => closeModal(false));
  document.getElementById('cancelRequestFormBtn')?.addEventListener('click', () => closeModal(false));
  form.addEventListener('change', (event) => {
    if (event.target.name === 'request_type') {
      syncRequestFormFields(form);
    }
  });
  syncRequestFormFields(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFormError('requestFormError');

    const payload = collectRequestForm(form);

    if (isAdmin() && !payload.user_id) {
      showFormError('requestFormError', t('requestPage.employeeRequired'));
      return;
    }

    if (payload.request_type === 'late_2_hours' && !payload.late_date) {
      showFormError('requestFormError', t('requestPage.lateDateRequired'));
      return;
    }

    if (payload.request_type === 'annual_leave') {
      if (!payload.leave_start_date || !payload.leave_end_date) {
        showFormError('requestFormError', t('requestPage.leaveDatesRequired'));
        return;
      }

      if (payload.leave_end_date < payload.leave_start_date) {
        showFormError('requestFormError', t('requestPage.leaveDatesOrder'));
        return;
      }
    }

    submitButton.disabled = true;
    submitButton.textContent = t('requestPage.submitting');

    try {
      await apiRequest('/requests', {
        method: 'POST',
        body: payload,
      });
      invalidateRequestsCache();
      showToast(t('toasts.requestSubmitted'), 'success');
      closeModal(true);
      if (typeof onSaved === 'function') {
        await onSaved();
      }
    } catch (error) {
      showFormError('requestFormError', error.message);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = t('requestPage.submitRequest');
    }
  });
}

async function submitRequestStatusUpdate(requestId, status) {
  const confirmed = await confirmAction({
    eyebrow: t('requestPage.reviewEyebrow'),
    title: t('requestPage.reviewTitle'),
    message: t('requestPage.reviewMessage', { status: statusLabel(status) }),
    confirmLabel: t('requestPage.confirmStatusUpdate'),
    tone: status === 'approved' ? 'primary' : 'danger',
  });

  if (!confirmed) {
    return;
  }

  try {
    await apiRequest(`/requests/${requestId}/status`, {
      method: 'PATCH',
      body: { status },
    });
    invalidateRequestsCache();
    showToast(t('toasts.requestStatusUpdated'), 'success');
    await renderRequestsPage();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function renderRequestsPage() {
  const container = elements.pages.requests;
  const requestFilters = {
    type: state.requestFilters.type,
    status: state.requestFilters.status,
  };
  const requestKey = buildCacheKey('requests', requestFilters);
  const allowanceKey = buildCacheKey('requestAllowance', isAdmin() ? {} : { user_id: state.profile.id });
  const hasWarmCache = getFreshCachedValue(requestKey, QUERY_CACHE_TTL_MS.requests)
    && (isAdmin() || getFreshCachedValue(allowanceKey, QUERY_CACHE_TTL_MS.requestAllowance));
  if (!hasWarmCache) {
    setPageLoading(container, t('pages.loading.requests'));
  }

  try {
    if (isAdmin()) {
      await loadEmployees();
    }

    const [items, allowance] = await Promise.all([
      fetchRequests(requestFilters),
      isAdmin() ? Promise.resolve(null) : fetchRequestAllowanceSummary({ user_id: state.profile.id }),
    ]);

    if (isAdmin()) {
      await ensureProfileDirectory(items);
    }

    const pendingCount = items.filter((item) => item.status === 'pending').length;
    const approvedCount = items.filter((item) => item.status === 'approved').length;
    const rejectedCount = items.filter((item) => item.status === 'rejected' || item.status === 'cancelled').length;

    if (!isAdmin()) {
      const statusChips = ['all', 'pending', 'approved', 'rejected'];
      container.innerHTML = `
        <div class="emp-page emp-requests">
          <div class="quota-grid">
            ${quotaCardMarkup({ iconName: 'hourglass', title: t('mobile.requests.delayTitle'), used: allowance?.late_2_hours?.used || 0, limit: REQUEST_MONTHLY_DELAY_LIMIT, period: t('mobile.requests.delayPeriod'), tone: 'warning' })}
            ${quotaCardMarkup({ iconName: 'plane', title: t('mobile.requests.leaveTitle'), used: allowance?.annual_leave_days?.used || 0, limit: REQUEST_ANNUAL_LEAVE_LIMIT, period: t('mobile.requests.leavePeriod'), tone: 'brand' })}
          </div>
          <div class="chip-row" role="group" aria-label="${escapeHtml(t('common.status'))}">
            ${statusChips.map((status) => `<button type="button" class="chip${state.requestFilters.status === status ? ' active' : ''}" data-status-chip="${status}" aria-pressed="${state.requestFilters.status === status}">${escapeHtml(status === 'all' ? t('mobile.requests.all') : statusLabel(status))}</button>`).join('')}
          </div>
          ${items.length
    ? `<div class="request-list">${items.map((item) => requestCardMarkup(item, {
      typeLabel: requestTypeLabel(item.request_type),
      dateLabel: requestDateLabel(item),
      durationLabel: requestDurationLabel(item),
    })).join('')}</div>`
    : `<div class="emp-empty">${icon('requests')}<strong>${escapeHtml(t('mobile.requests.emptyTitle'))}</strong><p>${escapeHtml(t('mobile.requests.emptyText'))}</p></div>`}
          <button id="openRequestFormBtn" type="button" class="fab">${icon('plus')}<span>${escapeHtml(t('requestPage.newRequest'))}</span></button>
        </div>
      `;
      container.querySelector('#openRequestFormBtn')?.addEventListener('click', () => {
        openRequestForm({ onSaved: () => renderRequestsPage() });
      });
      container.querySelector('.chip-row')?.addEventListener('click', (event) => {
        const chip = event.target.closest('[data-status-chip]');
        if (!chip || chip.dataset.statusChip === state.requestFilters.status) return;
        state.requestFilters.type = 'all';
        state.requestFilters.status = chip.dataset.statusChip;
        renderRequestsPage().catch((error) => setPageError(container, error.message));
      });
      return;
    }

    container.innerHTML = `
      <div class="page-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">${escapeHtml(t('requestPage.eyebrow'))}</p>
            <h1>${escapeHtml(t('requestPage.title'))}</h1>
            <p>${escapeHtml(t('requestPage.intro'))}</p>
          </div>
          <button id="openRequestFormBtn" type="button" class="btn btn-primary">${escapeHtml(t('requestPage.newRequest'))}</button>
        </div>

        <section class="summary-grid">
          ${isAdmin()
    ? `
            ${buildSummaryCard(t('requestPage.pendingRequests'), String(pendingCount), t('requestPage.pendingRequestsMeta'))}
            ${buildSummaryCard(t('requestPage.approvedRequests'), String(approvedCount), t('requestPage.approvedRequestsMeta'))}
            ${buildSummaryCard(t('requestPage.rejectedRequests'), String(rejectedCount), t('requestPage.rejectedRequestsMeta'))}
          `
    : `
            ${buildSummaryCard(
    t('requestPage.delayQuotaTitle'),
    `${allowance?.late_2_hours?.used || 0}/${REQUEST_MONTHLY_DELAY_LIMIT}`,
    t('requestPage.delayQuotaMeta', { remaining: String(allowance?.late_2_hours?.remaining ?? REQUEST_MONTHLY_DELAY_LIMIT) })
  )}
            ${buildSummaryCard(
    t('requestPage.leaveQuotaTitle'),
    `${allowance?.annual_leave_days?.used || 0}/${REQUEST_ANNUAL_LEAVE_LIMIT}`,
    t('requestPage.leaveQuotaMeta', { remaining: String(allowance?.annual_leave_days?.remaining ?? REQUEST_ANNUAL_LEAVE_LIMIT) })
  )}
            ${buildSummaryCard(
    t('requestPage.totalRequests'),
    String(items.length),
    t('requestPage.totalRequestsMeta')
  )}
          `}
        </section>

        <section class="card-block">
          <div class="toolbar">
            <select id="requestTypeFilter">
              <option value="all">${escapeHtml(t('requestPage.allTypes'))}</option>
              ${REQUEST_TYPES.map((type) => `<option value="${type}" ${state.requestFilters.type === type ? 'selected' : ''}>${escapeHtml(requestTypeLabel(type))}</option>`).join('')}
            </select>
            <select id="requestStatusFilter">
              <option value="all">${escapeHtml(t('common.allStatuses'))}</option>
              ${REQUEST_STATUSES.map((status) => `<option value="${status}" ${state.requestFilters.status === status ? 'selected' : ''}>${escapeHtml(statusLabel(status))}</option>`).join('')}
            </select>
            <button id="applyRequestFiltersBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.apply'))}</button>
          </div>
          <div class="table-shell">
            <table>
              <thead>
                <tr>
                  ${isAdmin() ? `<th>${escapeHtml(t('common.employee'))}</th>` : ''}
                  <th>${escapeHtml(t('requestPage.requestType'))}</th>
                  <th>${escapeHtml(t('requestPage.requestDateRange'))}</th>
                  <th>${escapeHtml(t('requestPage.duration'))}</th>
                  <th>${escapeHtml(t('requestPage.reason'))}</th>
                  <th>${escapeHtml(t('common.status'))}</th>
                  <th>${escapeHtml(t('requestPage.submittedAt'))}</th>
                  ${isAdmin() ? `<th>${escapeHtml(t('common.actions'))}</th>` : ''}
                </tr>
              </thead>
              <tbody>
                ${items.length ? items.map((item) => {
    const profile = employeeById(item.user_id) || state.profile;
    return `
                    <tr>
                      ${isAdmin() ? `<td>${buildUserCell(profile)}</td>` : ''}
                      <td>${escapeHtml(requestTypeLabel(item.request_type))}</td>
                      <td>${escapeHtml(requestDateLabel(item))}</td>
                      <td>${escapeHtml(requestDurationLabel(item))}</td>
                      <td>${escapeHtml(item.reason || '-')}</td>
                      <td>${badgeMarkup(item.status, item.status)}</td>
                      <td>${escapeHtml(formatDateTime(item.created_at))}</td>
                      ${isAdmin() ? `
                        <td>
                          ${item.status === 'pending'
    ? `<div class="inline-actions">
                                 <button type="button" class="btn btn-secondary" data-request-action="approved" data-request-id="${item.id}">${escapeHtml(t('requestPage.approve'))}</button>
                                 <button type="button" class="btn btn-danger" data-request-action="rejected" data-request-id="${item.id}">${escapeHtml(t('requestPage.reject'))}</button>
                               </div>`
    : `<span class="inline-note">-</span>`}
                        </td>
                      ` : ''}
                    </tr>
                  `;
  }).join('') : `<tr><td colspan="${isAdmin() ? 8 : 6}"><div class="empty-state">${escapeHtml(t('requestPage.emptyState'))}</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    container.querySelector('#openRequestFormBtn')?.addEventListener('click', () => {
      openRequestForm({
        onSaved: async () => {
          await renderRequestsPage();
        },
      });
    });

    container.querySelector('#applyRequestFiltersBtn')?.addEventListener('click', () => {
      state.requestFilters.type = container.querySelector('#requestTypeFilter').value;
      state.requestFilters.status = container.querySelector('#requestStatusFilter').value;
      renderRequestsPage().catch((error) => setPageError(container, error.message));
    });

    container.querySelectorAll('[data-request-action]').forEach((button) => {
      button.addEventListener('click', () => {
        submitRequestStatusUpdate(button.dataset.requestId, button.dataset.requestAction);
      });
    });
  } catch (error) {
    setPageError(container, error.message || t('errors.loadRequests'));
  }
}

async function renderHistoryPage() {
  const container = elements.pages.history;
  const historyKey = buildCacheKey('attendancePage', {
    filters: {
      from: state.historyFilters.from,
      to: state.historyFilters.to,
      status: state.historyFilters.status,
      ...(isAdmin() ? {} : { userId: state.profile?.id }),
    },
    requestedPage: state.historyPagination.page,
    pageSize: state.historyPagination.pageSize,
  });
  if (!getFreshCachedValue(historyKey, QUERY_CACHE_TTL_MS.attendancePage)) {
    setPageLoading(container, t('pages.loading.history'));
  }

  try {
    const pageData = await fetchAttendancePage({
      from: state.historyFilters.from,
      to: state.historyFilters.to,
      status: state.historyFilters.status,
      ...(isAdmin() ? {} : { userId: state.profile.id }),
    }, state.historyPagination);
    state.historyPageData = pageData;
    await ensureProfileDirectory(pageData.items);

    if (!isAdmin()) {
      const presets = {
        last14: offsetDate(-14),
        last30: offsetDate(-29),
        thisMonth: monthRange(currentMonthInput()).from,
      };
      const activePreset = state.historyFilters.to === todayIso() && state.historyFilters.status === 'all'
        ? Object.keys(presets).find((key) => presets[key] === state.historyFilters.from) || ''
        : '';
      container.innerHTML = `
        <div class="emp-page emp-history">
          <div class="chip-row" role="group">
            ${Object.keys(presets).map((key) => `<button type="button" class="chip${activePreset === key ? ' active' : ''}" data-range-chip="${key}" aria-pressed="${activePreset === key}">${escapeHtml(t(`mobile.history.${key}`))}</button>`).join('')}
          </div>
          <details class="emp-card history-filters"${activePreset ? '' : ' open'}>
            <summary>${icon('calendar')}<span>${escapeHtml(t('mobile.history.custom'))}</span>${icon('chevron', 'chevron')}</summary>
            <div class="history-filter-grid">
              <label>${escapeHtml(t('mobile.history.from'))}<input id="historyFrom" type="date" value="${escapeHtml(state.historyFilters.from)}" /></label>
              <label>${escapeHtml(t('mobile.history.to'))}<input id="historyTo" type="date" value="${escapeHtml(state.historyFilters.to)}" /></label>
              <label class="full">${escapeHtml(t('common.status'))}
                <select id="historyStatus">
                  <option value="all">${escapeHtml(t('common.allStatuses'))}</option>
                  ${['present', 'late', 'checked_out', 'absent'].map((status) => `<option value="${status}" ${state.historyFilters.status === status ? 'selected' : ''}>${escapeHtml(statusLabel(status))}</option>`).join('')}
                </select>
              </label>
              <button id="historySearchBtn" type="button" class="btn btn-primary full">${escapeHtml(t('common.apply'))}</button>
            </div>
          </details>
          <div class="emp-section-head">
            <h3>${escapeHtml(t('mobile.history.count', { count: String(pageData.totalItems) }))}</h3>
            <button id="historyExportBtn" type="button" class="icon-btn" aria-label="${escapeHtml(t('common.exportCsv'))}" title="${escapeHtml(t('common.exportCsv'))}">${icon('download')}</button>
          </div>
          ${recordListMarkup(pageData.items, t('mobile.history.empty'))}
          ${pageData.totalItems > pageData.pageSize ? buildPaginationMarkup('historyPager', pageData) : ''}
        </div>
      `;
      const rerender = () => renderHistoryPage().catch((error) => setPageError(container, error.message));
      container.querySelector('.chip-row')?.addEventListener('click', (event) => {
        const chip = event.target.closest('[data-range-chip]');
        if (!chip) return;
        state.historyFilters.from = presets[chip.dataset.rangeChip];
        state.historyFilters.to = todayIso();
        state.historyFilters.status = 'all';
        state.historyPagination.page = 1;
        rerender();
      });
      container.querySelector('#historySearchBtn')?.addEventListener('click', () => {
        state.historyFilters.from = container.querySelector('#historyFrom').value;
        state.historyFilters.to = container.querySelector('#historyTo').value;
        state.historyFilters.status = container.querySelector('#historyStatus').value;
        state.historyPagination.page = 1;
        rerender();
      });
      container.querySelector('#historyExportBtn')?.addEventListener('click', async () => {
        try {
          const records = await fetchAttendance({ ...state.historyFilters, userId: state.profile.id });
          exportAttendanceCsv(records, { resolveProfile: employeeById, fallbackProfile: state.profile });
          showToast(t('toasts.historyExported'), 'success');
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
      bindPagination(container, 'historyPager', state.historyPagination, rerender);
      return;
    }

    container.innerHTML = `
      <div class="page-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">${escapeHtml(t('historyPage.eyebrow'))}</p>
            <h1>${escapeHtml(t('historyPage.title'))}</h1>
            <p>${escapeHtml(t('historyPage.intro'))}</p>
          </div>
          <div class="inline-actions">
            <button id="openRequestsFromHistoryBtn" type="button" class="btn btn-secondary">${escapeHtml(t('requestPage.openRequests'))}</button>
            ${isAdmin() ? `<button id="historyManualAttendanceBtn" type="button" class="btn btn-primary">${escapeHtml(t('common.addManualRecord'))}</button>` : ''}
          </div>
        </div>
        <section class="card-block">
          <div class="toolbar toolbar-wide">
            <input id="historyFrom" type="date" value="${escapeHtml(state.historyFilters.from)}" />
            <input id="historyTo" type="date" value="${escapeHtml(state.historyFilters.to)}" />
            <select id="historyStatus">
              <option value="all">${escapeHtml(t('common.allStatuses'))}</option>
              ${['present', 'late', 'checked_out', 'absent'].map((status) => `<option value="${status}" ${state.historyFilters.status === status ? 'selected' : ''}>${escapeHtml(statusLabel(status))}</option>`).join('')}
            </select>
            <button id="historySearchBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.apply'))}</button>
            <button id="historyExportBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.exportCsv'))}</button>
          </div>
          <div class="table-shell">
            <table>
              <thead>
                <tr><th>${escapeHtml(t('common.employee'))}</th><th>${escapeHtml(t('common.date'))}</th><th>${escapeHtml(t('common.checkIn'))}</th><th>${escapeHtml(t('common.checkOut'))}</th><th>${escapeHtml(t('common.status'))}</th><th>${escapeHtml(t('historyPage.ipAddress'))}</th><th>${escapeHtml(t('timesheet.notes'))}</th></tr>
              </thead>
              <tbody>
                ${pageData.items.length ? pageData.items.map((row) => {
                  const profile = employeeById(row.user_id) || state.profile;
                  return `
                    <tr>
                      <td>${isAdmin() ? buildUserCell(profile) : escapeHtml(state.profile.full_name)}</td>
                      <td>${escapeHtml(formatDate(row.attendance_date))}</td>
                      <td>${escapeHtml(formatTime(row.check_in_time))}</td>
                      <td>${escapeHtml(formatTime(row.check_out_time))}</td>
                      <td>${badgeMarkup(row.attendance_status, row.attendance_status)}</td>
                      <td>${escapeHtml(row.ip_address || '-')}</td>
                      <td class="work-notes-cell">${escapeHtml(row.work_notes || '—')}</td>
                    </tr>
                  `;
                }).join('') : `<tr><td colspan="7"><div class="empty-state">${escapeHtml(t('notes.noFilteredRecords'))}</div></td></tr>`}
              </tbody>
            </table>
          </div>
          ${buildPaginationMarkup('historyPager', pageData)}
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
    container.querySelector('#openRequestsFromHistoryBtn')?.addEventListener('click', () => {
      navigate('requests');
    });
    container.querySelector('#historyManualAttendanceBtn')?.addEventListener('click', async () => {
      try {
        await loadEmployees();
        openManualAttendanceForm({
          attendanceDate: state.historyFilters.to || todayIso(),
          onSaved: async () => {
            await renderHistoryPage();
          },
        });
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
    container.querySelector('#historyExportBtn')?.addEventListener('click', async () => {
      const records = await fetchAttendance({
        from: state.historyFilters.from,
        to: state.historyFilters.to,
        status: state.historyFilters.status,
        ...(isAdmin() ? {} : { userId: state.profile.id }),
      });
      await ensureProfileDirectory(records);
      exportAttendanceCsv(records, { resolveProfile: employeeById, fallbackProfile: state.profile });
      showToast(t('toasts.historyExported'), 'success');
    });
    bindPagination(container, 'historyPager', state.historyPagination, () => {
      renderHistoryPage().catch((error) => setPageError(container, error.message));
    });
  } catch (error) {
    setPageError(container, error.message);
  }
}

function networkRulesFromText(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function printQrCode(qrImage) {
  const printWindow = window.open('', '_blank', 'width=720,height=900');
  if (!printWindow) {
    showToast(t('qrOnly.popupBlocked'), 'error');
    return;
  }
  printWindow.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>EVARA BNS QR</title>
    <style>body{font-family:Arial,sans-serif;text-align:center;padding:32px;color:#111827}img{width:420px;height:420px}h1{font-size:28px;margin:8px 0}p{font-size:18px;margin:6px 0}</style>
    </head><body><h1>EVARA BNS</h1><p>${escapeHtml(t('qrOnly.printLine1'))}</p><p dir="rtl">${escapeHtml(t('qrOnly.printLineAr'))}</p>
    <img src="${escapeHtml(qrImage)}" alt="QR" /><p>${escapeHtml(t('qrOnly.printLine2'))}</p></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 300);
}

async function renderQrPage(prefetched = null) {
  const container = elements.pages.qr;
  if (!isAdmin()) {
    setPageError(container, t('errors.adminQrOnly'));
    return;
  }
  if (!prefetched) {
    setPageLoading(container, t('pages.loading.qr'));
  }

  try {
    const settings = prefetched || (await apiRequest('/admin/attendance-settings')).data;
    const allRules = [...settings.allowed_networks, ...settings.environment_networks];
    const blocked = settings.require_office_network && !allRules.length;
    container.innerHTML = `
      <div class="page-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">${escapeHtml(t('qrPage.eyebrow'))}</p>
            <h1>${escapeHtml(t('qrOnly.title'))}</h1>
            <p>${escapeHtml(t('qrOnly.intro'))}</p>
          </div>
        </div>
        ${blocked ? `<div class="form-alert error">${escapeHtml(t('qrOnly.blockedWarning'))}</div>` : ''}
        <section class="card-block">
          <div class="card-head">
            <div>
              <h3>${escapeHtml(t('qrOnly.qrCardTitle'))}</h3>
              <p class="card-subtle">${escapeHtml(t('qrOnly.qrCardText'))}</p>
            </div>
          </div>
          <div class="page-shell">
            <div class="qr-frame">
              <img src="${escapeHtml(settings.qr_image)}" alt="${escapeHtml(t('qrPage.imageAlt'))}" />
            </div>
            <p class="inline-note">${escapeHtml(t('qrOnly.qrUpdated', { date: settings.qr_updated_at ? formatDateTime(settings.qr_updated_at) : '—' }))}</p>
            <div class="inline-actions">
              <button id="printQrBtn" type="button" class="btn btn-primary">${escapeHtml(t('qrOnly.print'))}</button>
              <button id="downloadQrBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.downloadQr'))}</button>
              <button id="rotateQrBtn" type="button" class="btn btn-danger">${escapeHtml(t('qrOnly.rotate'))}</button>
            </div>
          </div>
        </section>
        <section class="card-block">
          <div class="card-head">
            <div>
              <h3>${escapeHtml(t('qrOnly.networkTitle'))}</h3>
              <p class="card-subtle">${escapeHtml(t('qrOnly.networkText'))}</p>
            </div>
          </div>
          <form id="officeNetworkForm" class="stack-form">
            <div class="status-card compact">
              <div>
                <span class="status-label">${escapeHtml(t('qrOnly.detectedIp'))}</span>
                <strong dir="ltr">${escapeHtml(settings.detected_ip || '—')}</strong>
                <p class="inline-note">${escapeHtml(settings.detected_ip_allowed ? t('qrOnly.detectedAllowed') : t('qrOnly.detectedNotAllowed'))}</p>
              </div>
              ${settings.detected_ip && !settings.detected_ip_allowed ? `<button id="addDetectedIpBtn" type="button" class="btn btn-secondary">${escapeHtml(t('qrOnly.addDetectedIp'))}</button>` : ''}
            </div>
            <label class="toggle-line">
              <input id="requireOfficeNetwork" type="checkbox" ${settings.require_office_network ? 'checked' : ''} />
              <span>${escapeHtml(t('qrOnly.requireNetwork'))}</span>
            </label>
            <div class="form-group">
              <label for="allowedNetworks">${escapeHtml(t('qrOnly.allowedNetworks'))}</label>
              <textarea id="allowedNetworks" rows="4" dir="ltr" spellcheck="false" placeholder="41.33.10.5&#10;192.168.1.*">${escapeHtml(settings.allowed_networks.join('\n'))}</textarea>
              <small class="inline-note">${escapeHtml(t('qrOnly.allowedNetworksHint'))}</small>
              ${settings.environment_networks.length ? `<small class="inline-note">${escapeHtml(t('qrOnly.environmentNetworks', { list: settings.environment_networks.join(', ') }))}</small>` : ''}
            </div>
            <div id="officeNetworkError" class="form-alert error hidden"></div>
            <div class="inline-actions">
              <button id="saveOfficeNetworkBtn" type="submit" class="btn btn-primary">${escapeHtml(t('common.saveChanges'))}</button>
            </div>
          </form>
        </section>
      </div>
    `;

    container.querySelector('#printQrBtn')?.addEventListener('click', () => printQrCode(settings.qr_image));
    container.querySelector('#downloadQrBtn')?.addEventListener('click', () => {
      const anchor = document.createElement('a');
      anchor.href = settings.qr_image;
      anchor.download = 'evara-bns-office-qr.png';
      anchor.click();
    });
    container.querySelector('#rotateQrBtn')?.addEventListener('click', async () => {
      const confirmed = await confirmAction({
        title: t('qrOnly.rotateConfirmTitle'),
        message: t('qrOnly.rotateConfirmText'),
        confirmLabel: t('qrOnly.rotate'),
      });
      if (!confirmed) {
        return;
      }
      try {
        const payload = await apiRequest('/admin/attendance-settings/rotate-qr', { method: 'POST' });
        showToast(t('qrOnly.rotated'), 'success');
        await renderQrPage(payload.data);
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
    container.querySelector('#addDetectedIpBtn')?.addEventListener('click', () => {
      const textarea = container.querySelector('#allowedNetworks');
      const rules = networkRulesFromText(textarea.value);
      if (!rules.includes(settings.detected_ip)) {
        rules.push(settings.detected_ip);
      }
      textarea.value = rules.join('\n');
      textarea.focus();
    });
    container.querySelector('#officeNetworkForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      showFormError('officeNetworkError');
      const button = container.querySelector('#saveOfficeNetworkBtn');
      button.disabled = true;
      try {
        const payload = await apiRequest('/admin/attendance-settings', {
          method: 'PUT',
          body: {
            require_office_network: container.querySelector('#requireOfficeNetwork').checked,
            allowed_networks: networkRulesFromText(container.querySelector('#allowedNetworks').value),
          },
        });
        showToast(t('qrOnly.saved'), 'success');
        await renderQrPage(payload.data);
      } catch (error) {
        showFormError('officeNetworkError', error.message);
        button.disabled = false;
      }
    });
  } catch (error) {
    setPageError(container, error.message);
  }
}
