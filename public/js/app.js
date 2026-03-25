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
  businessScheduleLabel,
  businessStartTimeLabel,
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
const REQUEST_MONTHLY_DELAY_LIMIT = 2;
const REQUEST_ANNUAL_LEAVE_LIMIT = 21;
const REQUEST_TYPES = ['late_2_hours', 'annual_leave'];
const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];
const EMPLOYEE_CACHE_TTL_MS = 30 * 1000; // Reduced from 60s to improve cache freshness
const HEALTH_CACHE_TTL_MS = 5 * 60 * 1000;
const INPUT_DEBOUNCE_MS = 220;
const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours
const SESSION_WARNING_MS = 5 * 60 * 1000; // 5 minutes before timeout
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
    requests: document.getElementById('page-requests'),
    reports: document.getElementById('page-reports'),
    qr: document.getElementById('page-qr'),
  },
};

let modalCloseHandler = null;
let realtimeChannels = [];
let employeeSearchDebounceId = null;
const queryCache = new Map();
let prefetchTimerId = null;

boot();

function updateSessionActivity() {
  state.sessionLastActivity = Date.now();
  state.sessionWarningShown = false;
}

function checkSessionTimeout() {
  if (!state.session) return;

  const now = Date.now();
  const timeSinceActivity = now - state.sessionLastActivity;

  if (timeSinceActivity >= SESSION_TIMEOUT_MS) {
    // Session expired
    handleLogout().catch(() => {});
    showToast('Your session has expired. Please log in again.', 'warning');
    return;
  }

  if (!state.sessionWarningShown && timeSinceActivity >= (SESSION_TIMEOUT_MS - SESSION_WARNING_MS)) {
    // Show warning 5 minutes before expiry
    const remainingMinutes = Math.ceil((SESSION_TIMEOUT_MS - timeSinceActivity) / 60000);
    showToast(`Your session will expire in ${remainingMinutes} minute(s).`, 'warning');
    state.sessionWarningShown = true;
  }
}

// Check session timeout every minute
setInterval(checkSessionTimeout, 60 * 1000);

// Update activity on user interactions
document.addEventListener('click', updateSessionActivity);
document.addEventListener('keydown', updateSessionActivity);
document.addEventListener('scroll', updateSessionActivity);

function todayIso() {
  return todayBusinessIso();
}

function currentMonthInput() {
  return currentBusinessMonthInput();
}

function offsetDate(days) {
  return offsetBusinessDate(days);
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
  state.sessionWarningShown = false;
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
  queryCache.clear();

  if (employeeSearchDebounceId) {
    window.clearTimeout(employeeSearchDebounceId);
    employeeSearchDebounceId = null;
  }
  if (prefetchTimerId) {
    window.clearTimeout(prefetchTimerId);
    prefetchTimerId = null;
  }
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

const LOCAL_API_BASE_URL = '/api';

function normalizeApiBaseUrl(baseUrl) {
  const normalized = String(baseUrl || '').trim();
  if (!normalized) {
    return LOCAL_API_BASE_URL;
  }

  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function isSupabaseDomain(urlValue) {
  try {
    const parsed = new URL(urlValue, window.location.origin);
    return parsed.hostname.endsWith('.supabase.co');
  } catch (_error) {
    return false;
  }
}

function isApplicationNotFoundError(message) {
  return String(message || '').toLowerCase().includes('application not found');
}

function shouldRetryOnLocalApi(primaryBaseUrl, message) {
  return primaryBaseUrl !== LOCAL_API_BASE_URL && isApplicationNotFoundError(message);
}

function formatApiErrorMessage(message, baseUrl) {
  if (isApplicationNotFoundError(message) && isSupabaseDomain(baseUrl)) {
    return t('errors.apiEndpointMisconfigured');
  }

  return message || t('common.requestFailed');
}

async function sendApiRequest(baseUrl, path, requestOptions) {
  const response = await fetch(`${baseUrl}${path}`, requestOptions);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
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

  const requestOptions = {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  };
  const primaryBaseUrl = normalizeApiBaseUrl(config.apiBaseUrl);
  const primaryResult = await sendApiRequest(primaryBaseUrl, path, requestOptions);

  // Recover from misconfigured API base URLs that point to Supabase instead of this backend.
  if (!primaryResult.response.ok && shouldRetryOnLocalApi(primaryBaseUrl, primaryResult.payload?.message)) {
    const fallbackResult = await sendApiRequest(LOCAL_API_BASE_URL, path, requestOptions);
    if (!fallbackResult.response.ok) {
      throw new Error(
        formatApiErrorMessage(
          fallbackResult.payload?.message || primaryResult.payload?.message,
          primaryBaseUrl
        )
      );
    }

    return fallbackResult.payload;
  }

  if (!primaryResult.response.ok) {
    throw new Error(formatApiErrorMessage(primaryResult.payload?.message, primaryBaseUrl));
  }

  return primaryResult.payload;
}

async function fetchMyProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('id', userId)
    .single();

  if (error) {
    throw new Error(error.message || t('errors.loadProfile'));
  }

  return data;
}

async function fetchEmployees(options = {}) {
  const key = buildCacheKey('employees', { all: true });
  return getCachedQuery(key, QUERY_CACHE_TTL_MS.employees, async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_SELECT)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message || t('errors.loadEmployees'));
    }

    return data || [];
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
    let query = supabase
      .from('attendance')
      .select(ATTENDANCE_SELECT)
      .order('attendance_date', { ascending: false })
      .order('check_in_time', { ascending: false });

    if (queryFilters.userId) {
      query = query.eq('user_id', queryFilters.userId);
    }
    if (queryFilters.date) {
      query = query.eq('attendance_date', queryFilters.date);
    }
    if (queryFilters.from) {
      query = query.gte('attendance_date', queryFilters.from);
    }
    if (queryFilters.to) {
      query = query.lte('attendance_date', queryFilters.to);
    }
    if (queryFilters.status && queryFilters.status !== 'all') {
      query = query.eq('attendance_status', queryFilters.status);
    }
    if (queryFilters.limit) {
      query = query.limit(queryFilters.limit);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message || t('errors.loadAttendance'));
    }

    return data || [];
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

function stableSerialize(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${key}:${stableSerialize(value[key])}`).join('|')}}`;
  }
  return String(value);
}

function buildCacheKey(namespace, params = {}) {
  return `${namespace}:${stableSerialize(params)}`;
}

function getFreshCachedValue(key, ttlMs) {
  const entry = queryCache.get(key);
  if (!entry) {
    return null;
  }
  if (entry.data !== undefined && entry.expiresAt > Date.now()) {
    return entry.data;
  }
  if (!entry.promise) {
    queryCache.delete(key);
  }
  return null;
}

async function getCachedQuery(key, ttlMs, loader, options = {}) {
  const force = Boolean(options.force);
  const now = Date.now();
  const existing = queryCache.get(key);

  if (!force && existing?.data !== undefined && existing.expiresAt > now) {
    return existing.data;
  }

  if (!force && existing?.promise) {
    return existing.promise;
  }

  const promise = Promise.resolve()
    .then(loader)
    .then((data) => {
      queryCache.set(key, {
        data,
        expiresAt: Date.now() + ttlMs,
        promise: null,
      });
      return data;
    })
    .catch((error) => {
      queryCache.delete(key);
      throw error;
    });

  queryCache.set(key, {
    data: existing?.data,
    expiresAt: existing?.expiresAt || 0,
    promise,
  });

  return promise;
}

function invalidateQueryCache(prefixes = []) {
  const list = Array.isArray(prefixes) ? prefixes : [prefixes];
  if (!list.length) {
    queryCache.clear();
    return;
  }

  [...queryCache.keys()].forEach((key) => {
    if (list.some((prefix) => key.startsWith(prefix))) {
      queryCache.delete(key);
    }
  });
}

function warmQueryInBackground(key, ttlMs, loader) {
  if (getFreshCachedValue(key, ttlMs)) {
    return;
  }

  getCachedQuery(key, ttlMs, loader).catch(() => {
    // Ignore background prefetch failures.
  });
}

function schedulePagePrefetch() {
  if (!state.profile) {
    return;
  }

  if (prefetchTimerId) {
    window.clearTimeout(prefetchTimerId);
  }

  const runner = () => {
    const today = todayIso();
    const currentMonth = monthRange(currentMonthInput());

    if (isAdmin()) {
      warmQueryInBackground(
        buildCacheKey('employees', { all: true }),
        QUERY_CACHE_TTL_MS.employees,
        () => fetchEmployees({ force: true })
      );
      warmQueryInBackground(
        buildCacheKey('employeeDirectoryPage', {
          filters: state.employeeFilters,
          requestedPage: state.employeePagination.page,
          pageSize: state.employeePagination.pageSize,
        }),
        QUERY_CACHE_TTL_MS.employeeDirectory,
        () => fetchEmployeeDirectoryPage(state.employeeFilters, state.employeePagination, { force: true })
      );
      warmQueryInBackground(
        buildCacheKey('employeeDirectoryStats', { all: true }),
        QUERY_CACHE_TTL_MS.employeeStats,
        () => fetchEmployeeDirectoryStats({ force: true })
      );
      warmQueryInBackground(
        buildCacheKey('attendance', { date: today, limit: 250 }),
        QUERY_CACHE_TTL_MS.attendance,
        () => fetchAttendance({ date: today, limit: 250, force: true })
      );
      warmQueryInBackground(
        buildCacheKey('attendance', { date: today }),
        QUERY_CACHE_TTL_MS.attendance,
        () => fetchAttendance({ date: today, force: true })
      );
      warmQueryInBackground(
        buildCacheKey('attendance', { from: offsetDate(-14), to: today, limit: 14 }),
        QUERY_CACHE_TTL_MS.attendance,
        () => fetchAttendance({ from: offsetDate(-14), to: today, limit: 14, force: true })
      );
      warmQueryInBackground(
        buildCacheKey('attendancePage', {
          filters: {
            from: state.historyFilters.from,
            to: state.historyFilters.to,
            status: state.historyFilters.status,
          },
          requestedPage: state.historyPagination.page,
          pageSize: state.historyPagination.pageSize,
        }),
        QUERY_CACHE_TTL_MS.attendancePage,
        () => fetchAttendancePage({
          from: state.historyFilters.from,
          to: state.historyFilters.to,
          status: state.historyFilters.status,
        }, state.historyPagination, { force: true })
      );
      warmQueryInBackground(
        buildCacheKey('requests', {
          type: state.requestFilters.type,
          status: state.requestFilters.status,
        }),
        QUERY_CACHE_TTL_MS.requests,
        () => fetchRequests({
          type: state.requestFilters.type,
          status: state.requestFilters.status,
        }, { force: true })
      );
      warmQueryInBackground(
        buildCacheKey('attendance', { from: currentMonth.from, to: currentMonth.to }),
        QUERY_CACHE_TTL_MS.reports,
        () => fetchAttendance({ from: currentMonth.from, to: currentMonth.to, force: true })
      );
      warmQueryInBackground(
        buildCacheKey('qr', { current: true }),
        QUERY_CACHE_TTL_MS.qr,
        () => apiRequest('/attendance/qr')
      );
    } else {
      warmQueryInBackground(
        buildCacheKey('attendance', { userId: state.profile.id, date: today, limit: 1 }),
        QUERY_CACHE_TTL_MS.attendance,
        () => fetchAttendance({ userId: state.profile.id, date: today, limit: 1, force: true })
      );
      warmQueryInBackground(
        buildCacheKey('attendance', { userId: state.profile.id, from: offsetDate(-14), to: today, limit: 14 }),
        QUERY_CACHE_TTL_MS.attendance,
        () => fetchAttendance({ userId: state.profile.id, from: offsetDate(-14), to: today, limit: 14, force: true })
      );
      warmQueryInBackground(
        buildCacheKey('attendance', { userId: state.profile.id, from: currentMonth.from, to: currentMonth.to, limit: 60 }),
        QUERY_CACHE_TTL_MS.attendance,
        () => fetchAttendance({ userId: state.profile.id, from: currentMonth.from, to: currentMonth.to, limit: 60, force: true })
      );
      warmQueryInBackground(
        buildCacheKey('attendancePage', {
          filters: {
            from: state.historyFilters.from,
            to: state.historyFilters.to,
            status: state.historyFilters.status,
            userId: state.profile.id,
          },
          requestedPage: state.historyPagination.page,
          pageSize: state.historyPagination.pageSize,
        }),
        QUERY_CACHE_TTL_MS.attendancePage,
        () => fetchAttendancePage({
          from: state.historyFilters.from,
          to: state.historyFilters.to,
          status: state.historyFilters.status,
          userId: state.profile.id,
        }, state.historyPagination, { force: true })
      );
      warmQueryInBackground(
        buildCacheKey('requests', {
          type: state.requestFilters.type,
          status: state.requestFilters.status,
        }),
        QUERY_CACHE_TTL_MS.requests,
        () => fetchRequests({
          type: state.requestFilters.type,
          status: state.requestFilters.status,
        }, { force: true })
      );
      warmQueryInBackground(
        buildCacheKey('requestAllowance', { user_id: state.profile.id }),
        QUERY_CACHE_TTL_MS.requestAllowance,
        () => fetchRequestAllowanceSummary({ user_id: state.profile.id }, { force: true })
      );
    }

    warmQueryInBackground(
      buildCacheKey('attendance', { userId: state.profile.id, from: offsetDate(-30), to: today, limit: 30 }),
      QUERY_CACHE_TTL_MS.profile,
      () => fetchAttendance({ userId: state.profile.id, from: offsetDate(-30), to: today, limit: 30, force: true })
    );

    warmQueryInBackground(
      buildCacheKey('health', { restrictions: true }),
      HEALTH_CACHE_TTL_MS,
      () => fetchSystemHealth({ force: true })
    );
  };

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(runner, { timeout: 1200 });
    return;
  }

  prefetchTimerId = window.setTimeout(runner, 250);
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
    throw new Error(error.message || t('errors.mapAttendance'));
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

  const requestChannel = supabase
    .channel(`requests-feed-${state.profile.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_requests' }, scheduleLiveRefresh)
    .subscribe();

  realtimeChannels.push(requestChannel);
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
    throw new Error(t('errors.missingProfile'));
  }

  if (!profile.is_active) {
    await supabase.auth.signOut();
    throw new Error(t('errors.inactiveAccount'));
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
    return 'Marked absent for this workday.';
  }

  const parts = [];
  if (row.check_in_time) {
    parts.push(`Check in ${formatTime(row.check_in_time)}`);
  }
  if (row.check_out_time) {
    parts.push(`check out ${formatTime(row.check_out_time)}`);
  }

  return parts.length ? parts.join(', ') : 'Attendance row exists, but no check-in has been recorded yet.';
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
      return t('outcomes.shiftStartsAt', { time: businessStartTimeLabel() });
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
        const countsAsLate = Boolean(metrics.isLateArrival || row.attendance_status === 'late');

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

function paginateItems(items, paginationState) {
  const meta = buildPaginationMeta(items.length, paginationState);
  const startIndex = (meta.currentPage - 1) * paginationState.pageSize;
  const endIndex = startIndex + paginationState.pageSize;

  return {
    items: items.slice(startIndex, endIndex),
    ...meta,
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
          : businessContext.hasShiftStarted
            ? t('dashboard.admin.missingSoFar')
            : t('dashboard.admin.missingPending');
      const missingTodayMeta = !todayIsWorkday
        ? t('dashboard.admin.missingWeekendMeta')
        : businessContext.hasShiftEnded
          ? t('dashboard.admin.missingAbsentMeta')
          : businessContext.hasShiftStarted
            ? t('dashboard.admin.missingSoFarMeta')
            : t('dashboard.admin.missingPendingMeta', { start: businessStartTimeLabel() });
      const lateToday = todayIsWorkday
        ? todayDetailed.filter((entry) => entry.metrics.isLateArrival || entry.row.attendance_status === 'late').length
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
            ${buildSummaryCard(t('dashboard.admin.lateToday'), String(lateToday), todayIsWorkday ? t('dashboard.admin.lateTodayMeta', { start: businessStartTimeLabel() }) : t('dashboard.admin.lateTodayWeekendMeta'))}
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
    const todayMetrics = todayRecord ? buildAttendanceRowMetrics(todayRecord) : null;
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
    let balanceLabel = t('notes.balanceWaiting');
    let balanceMeta = t('notes.noAttendanceToday');

    if (!todayRecord && missingTodayState) {
      if (missingTodayState.code === 'weekend') {
        balanceLabel = t('states.weeklyLeave');
      } else if (missingTodayState.code === 'on_leave') {
        balanceLabel = t('outcomes.onLeave');
      } else if (missingTodayState.code === 'absent') {
        balanceLabel = t('states.absentToday');
      } else if (missingTodayState.code === 'absent_so_far') {
        balanceLabel = t('states.checkInOverdue');
      } else if (missingTodayState.code === 'not_checked_in_yet') {
        balanceLabel = t('states.checkInPending');
      } else {
        balanceLabel = missingTodayState.label;
      }

      balanceMeta = missingTodayState.note;
    } else if (todayMetrics?.isOpenShift) {
      balanceLabel = t('notes.balanceRemaining', { duration: formatDuration(todayMetrics.projectedRemainingMinutes) });
      balanceMeta = t('notes.balanceRemainingMeta');
    } else if (todayMetrics?.overtimeMinutes) {
      balanceLabel = t('notes.balanceOvertime', { duration: formatDuration(todayMetrics.overtimeMinutes) });
      balanceMeta = t('notes.balanceOvertimeMeta');
    } else if (todayMetrics?.shortfallMinutes) {
      balanceLabel = formatDuration(todayMetrics.shortfallMinutes);
      balanceMeta = t('notes.balanceShortfallMeta');
    } else if (todayMetrics?.isCompleteShift) {
      balanceLabel = t('states.fullShiftReached');
      balanceMeta = t('notes.balanceFullShiftMeta');
    }

    container.innerHTML = `
      <div class="page-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">${escapeHtml(t('dashboard.employee.eyebrow'))}</p>
            <h1>${escapeHtml(state.profile.full_name)}</h1>
            <p>${escapeHtml(t('dashboard.employee.intro', { schedule: businessScheduleLabel() }))}</p>
          </div>
          <div class="inline-actions">
            <button id="employeeAttendanceShortcut" type="button" class="btn btn-secondary">${escapeHtml(t('common.openAttendance'))}</button>
          </div>
        </div>
        <section class="card-block">
          <div class="card-head">
            <div>
              <h3>${escapeHtml(t('dashboard.employee.todayTitle'))}</h3>
              <p class="card-subtle">${escapeHtml(t('dashboard.employee.todayText'))}</p>
            </div>
          </div>
          <div class="summary-grid compact-grid">
            ${buildSummaryCard(t('dashboard.employee.todayStatus'), todayRecord ? statusLabel(todayRecord.attendance_status) : (missingTodayState?.label || (todayIsWorkday ? t('states.pending') : t('states.weeklyLeave'))), todayRecord ? buildAttendanceRecordNote(todayRecord) : (missingTodayState?.note || (todayIsWorkday ? t('notes.noAttendanceToday') : t('schedule.weeklyLeaveHint'))))}
            ${buildSummaryCard(t('dashboard.employee.workedToday'), formatDuration(todayMetrics?.workedMinutes || 0), todayMetrics ? attendanceOutcome(todayMetrics) : (missingTodayState?.note || (todayIsWorkday ? t('notes.noAttendanceToday') : t('notes.noRequiredShift'))))}
            ${buildSummaryCard(t('dashboard.employee.todayBalance'), balanceLabel, balanceMeta)}
          </div>
        </section>
        <section class="card-block">
          <div class="card-head">
            <div>
              <h3>${escapeHtml(t('dashboard.employee.monthTitle'))}</h3>
              <p class="card-subtle">${escapeHtml(t('dashboard.employee.monthText'))}</p>
            </div>
          </div>
          <p class="inline-note">${escapeHtml(t('notes.totalShortfallHint'))}</p>
          <div class="summary-grid">
            ${buildSummaryCard(t('dashboard.employee.attendedDays'), String(checkedDays), t('notes.checkedSinceMonthStart'))}
            ${buildSummaryCard(t('dashboard.employee.absentDays'), String(absentDays), t('notes.workdaysWithoutAttendance'))}
            ${buildSummaryCard(t('dashboard.employee.weeklyLeaveDays'), String(weeklyLeaveDays), t('notes.weeklyLeaveSinceMonthStart'))}
            ${buildSummaryCard(t('dashboard.employee.fullShiftDays'), String(fullShiftDays), t('notes.completedWithoutShortfall'))}
            ${buildSummaryCard(t('dashboard.employee.lateArrivals'), String(lateDays), t('notes.lateAfterStart', { start: businessStartTimeLabel() }))}
            ${buildSummaryCard(t('dashboard.employee.absenceShortfall'), formatDuration(absenceShortfallMinutes), t('notes.absenceCardMeta', { days: String(absentDays) }))}
            ${buildSummaryCard(t('dashboard.employee.shiftShortfall'), formatDuration(shiftShortfallMinutes), t('notes.shiftShortfallMeta', { days: String(partialShortfallDays) }))}
            ${buildSummaryCard(t('dashboard.employee.overtimeThisMonth'), formatDuration(monthOvertimeMinutes), t('notes.overtimeMonthMeta'))}
            ${buildSummaryCard(t('dashboard.employee.totalShortfall'), formatDuration(monthShortfallMinutes), t('notes.combinedShortfall'))}
          </div>
        </section>
        <section class="card-block">
          <div class="card-head">
            <div>
              <h3>${escapeHtml(t('dashboard.employee.ledgerTitle'))}</h3>
              <p class="card-subtle">${escapeHtml(t('dashboard.employee.ledgerText'))}</p>
            </div>
          </div>
          <div class="table-shell">
            <table>
              <thead>
                <tr><th>${escapeHtml(t('common.date'))}</th><th>${escapeHtml(t('common.dayType'))}</th><th>${escapeHtml(t('common.status'))}</th><th>${escapeHtml(t('common.checkIn'))}</th><th>${escapeHtml(t('common.checkOut'))}</th><th>${escapeHtml(t('common.worked'))}</th><th>${escapeHtml(t('common.shortfall'))}</th><th>${escapeHtml(t('common.overtime'))}</th><th>${escapeHtml(t('common.note'))}</th></tr>
              </thead>
              <tbody>
                ${monthLedger.length ? monthLedger.map((entry) => {
                  return `
                  <tr>
                    <td>${escapeHtml(formatDate(entry.attendanceDate))}</td>
                    <td>${escapeHtml(entry.dayTypeLabel)}</td>
                    <td>${attendanceStateBadgeMarkup(entry.displayState)}</td>
                    <td>${escapeHtml(formatTime(entry.row?.check_in_time))}</td>
                    <td>${escapeHtml(formatTime(entry.row?.check_out_time))}</td>
                    <td>${escapeHtml(formatDuration(entry.workedMinutes))}</td>
                    <td>${escapeHtml(formatDuration(entry.shortfallMinutes))}</td>
                    <td>${escapeHtml(formatDuration(entry.overtimeMinutes))}</td>
                    <td>${escapeHtml(entry.noteLabel)}</td>
                  </tr>
                `;
                }).join('') : `<tr><td colspan="9"><div class="empty-state">${escapeHtml(t('notes.noMonthRecords'))}</div></td></tr>`}
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
            <button id="reportsExportBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.exportReportCsv'))}</button>
            ${selectedEmployee ? `<button id="reportsTimesheetExportBtn" type="button" class="btn btn-primary">${escapeHtml(t('common.exportTimesheetCsv'))}</button>` : ''}
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
        <div class="summary-grid">
          ${buildSummaryCard(t('reportsPage.totalHoursWorked'), formatDuration(report.totals.totalHoursWorkedMinutes), t('reportsPage.totalHoursWorkedMeta'))}
          ${buildSummaryCard(t('reportsPage.totalOvertime'), formatDuration(report.totals.totalOvertimeMinutes), t('reportsPage.totalOvertimeMeta'))}
          ${buildSummaryCard(t('reportsPage.totalShortfall'), formatDuration(report.totals.totalShortfallMinutes), t('reportsPage.totalShortfallMeta'))}
          ${buildSummaryCard(t('reportsPage.attendanceRate'), `${report.totals.attendanceRate}%`, t('reportsPage.attendanceRateMeta', { present: String(report.totals.totalPresentDays), expected: String(report.totals.totalExpectedDays || 0) }))}
          ${buildSummaryCard(t('reportsPage.onTimeArrival'), `${report.totals.onTimeArrivalRate}%`, t('reportsPage.onTimeArrivalMeta', { start: businessStartTimeLabel() }))}
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
              ${buildSummaryCard(t('dashboard.employee.lateArrivals'), String(selectedEmployeeLateDays), t('notes.lateAfterStart', { start: businessStartTimeLabel() }))}
              ${buildSummaryCard(t('dashboard.employee.absenceShortfall'), formatDuration(selectedEmployeeAbsenceShortfallMinutes), t('notes.absenceCardMeta', { days: String(selectedEmployeeAbsentDays) }))}
              ${buildSummaryCard(t('dashboard.employee.shiftShortfall'), formatDuration(selectedEmployeeShiftShortfallMinutes), t('notes.shiftShortfallMeta', { days: String(selectedEmployeePartialShortfallDays) }))}
              ${buildSummaryCard(t('common.overtime'), formatDuration(selectedEmployee.overtimeMinutes), t('notes.overtimeMonthMeta'))}
              ${buildSummaryCard(t('dashboard.employee.totalShortfall'), formatDuration(selectedEmployee.shortfallMinutes), t('notes.combinedShortfall'))}
            </div>
            <div class="table-shell">
              <table>
                <thead>
                  <tr><th>${escapeHtml(t('common.date'))}</th><th>${escapeHtml(t('common.dayType'))}</th><th>${escapeHtml(t('common.status'))}</th><th>${escapeHtml(t('common.checkIn'))}</th><th>${escapeHtml(t('common.checkOut'))}</th><th>${escapeHtml(t('common.worked'))}</th><th>${escapeHtml(t('common.shortfall'))}</th><th>${escapeHtml(t('common.overtime'))}</th><th>${escapeHtml(t('common.note'))}</th></tr>
                </thead>
                <tbody>
                  ${selectedEmployeeLedger.length ? selectedEmployeeLedger.map((entry) => `
                    <tr>
                      <td>${escapeHtml(formatDate(entry.attendanceDate))}</td>
                      <td>${escapeHtml(entry.dayTypeLabel)}</td>
                      <td>${attendanceStateBadgeMarkup(entry.displayState)}</td>
                      <td>${escapeHtml(formatTime(entry.row?.check_in_time))}</td>
                      <td>${escapeHtml(formatTime(entry.row?.check_out_time))}</td>
                      <td>${escapeHtml(formatDuration(entry.workedMinutes))}</td>
                      <td>${escapeHtml(formatDuration(entry.shortfallMinutes))}</td>
                      <td>${escapeHtml(formatDuration(entry.overtimeMinutes))}</td>
                      <td>${escapeHtml(entry.noteLabel)}</td>
                    </tr>
                  `).join('') : `<tr><td colspan="9"><div class="empty-state">${escapeHtml(t('notes.noMonthRecords'))}</div></td></tr>`}
                </tbody>
              </table>
            </div>
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
    container.querySelector('#reportsExportBtn')?.addEventListener('click', () => {
      exportReportsCsv(report, state.reportsFilters);
      showToast(t('toasts.reportsExported'), 'success');
    });
    container.querySelector('#reportsTimesheetExportBtn')?.addEventListener('click', () => {
      if (!selectedEmployee) {
        return;
      }
      exportEmployeeTimesheetCsv(selectedEmployee, state.reportsFilters);
      showToast(t('toasts.timesheetExported'), 'success');
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
          <input id="employee_position" name="position" value="${escapeHtml(employee?.position || '')}" />
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
            <input id="employee_password" name="password" type="password" required />
          </div>
          <div class="form-group">
            <label for="employee_password_confirm">${escapeHtml(t('common.confirmPassword'))}</label>
            <input id="employee_password_confirm" name="password_confirm" type="password" required />
          </div>
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
            ${['present', 'late', 'checked_out', 'absent'].map((status) => `<option value="${status}">${escapeHtml(statusLabel(status))}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="manual_check_in_time">${escapeHtml(t('common.checkIn'))}</label>
          <input id="manual_check_in_time" name="check_in_time" type="datetime-local" />
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
          : businessContext.hasShiftStarted
            ? t('attendancePage.missingSoFar')
            : t('attendancePage.missingPending');
      const missingMeta = !businessContext.isScheduledWorkday
        ? t('attendancePage.missingWeekendMeta')
        : businessContext.hasShiftEnded
          ? t('attendancePage.missingAbsentMeta')
          : businessContext.hasShiftStarted
            ? t('attendancePage.missingSoFarMeta')
            : t('attendancePage.missingPendingMeta', { start: businessStartTimeLabel() });

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
                  <tr><th>${escapeHtml(t('common.employee'))}</th><th>${escapeHtml(t('common.department'))}</th><th>${escapeHtml(t('common.checkIn'))}</th><th>${escapeHtml(t('common.checkOut'))}</th><th>${escapeHtml(t('common.status'))}</th><th>${escapeHtml(t('common.device'))}</th></tr>
                </thead>
                <tbody>
                  ${todayRoster.length ? todayRoster.map((entry) => {
                    const profile = entry.profile || employeeById(entry.user_id);
                    return `
                      <tr>
                        <td>${buildUserCell(profile)}</td>
                        <td>${escapeHtml(departmentLabel(profile?.department))}</td>
                        <td>${escapeHtml(formatTime(entry.check_in_time))}</td>
                        <td>${escapeHtml(formatTime(entry.check_out_time))}</td>
                        <td>${attendanceStateBadgeMarkup(entry.displayState)}</td>
                        <td>${escapeHtml(entry.device_info ? entry.device_info.slice(0, 72) : entry.displayState.note || '-')}</td>
                      </tr>
                    `;
                  }).join('') : `<tr><td colspan="6"><div class="empty-state">${escapeHtml(t('notes.noEmployeeAttendanceToday'))}</div></td></tr>`}
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
      return;
    }

    const todayRecord = todayRecords[0] || null;
    const missingTodayState = todayRecord
      ? null
      : getAttendanceDisplayState({
        employee: state.profile,
        attendanceDate: today,
      });
    const canCheckIn = !todayRecord?.check_in_time;
    const canCheckOut = Boolean(todayRecord?.check_in_time) && !todayRecord?.check_out_time;

    container.innerHTML = `
        <div class="page-shell">
          <div class="section-header">
            <div>
            <p class="eyebrow">${escapeHtml(t('attendancePage.employeeEyebrow'))}</p>
            <h1>${escapeHtml(t('attendancePage.employeeTitle'))}</h1>
            <p>${escapeHtml(t('attendancePage.employeeIntro', { schedule: businessScheduleLabel() }))}</p>
            ${restrictionNote ? `<p class="inline-note attention-note">${escapeHtml(restrictionNote)}</p>` : ''}
          </div>
        </div>
        <section class="status-card">
          <div>
            <span class="status-label">${escapeHtml(t('common.todayStatus'))}</span>
            <strong>${escapeHtml(todayRecord ? statusLabel(todayRecord.attendance_status) : (missingTodayState?.label || t('states.pending')))}</strong>
            <p class="inline-note">${escapeHtml(todayRecord ? buildAttendanceRecordNote(todayRecord) : (missingTodayState?.note || t('attendancePage.noSubmittedAttendance')))}</p>
          </div>
          <div class="inline-actions">
            ${canCheckIn ? `<button id="employeeCheckInBtn" type="button" class="btn btn-primary">${escapeHtml(t('common.checkIn'))}</button>` : ''}
            ${canCheckOut ? `<button id="employeeCheckOutBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.checkOut'))}</button>` : ''}
            <button id="attendanceRefreshBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.refresh'))}</button>
          </div>
        </section>
        <section class="card-block">
          <div class="card-head">
            <div>
              <h3>${escapeHtml(t('attendancePage.personalRecentTitle'))}</h3>
              <p class="card-subtle">${escapeHtml(t('attendancePage.personalRecentText'))}</p>
            </div>
          </div>
          <div class="table-shell">
            <table>
              <thead>
                <tr><th>${escapeHtml(t('common.date'))}</th><th>${escapeHtml(t('common.checkIn'))}</th><th>${escapeHtml(t('common.checkOut'))}</th><th>${escapeHtml(t('common.status'))}</th></tr>
              </thead>
              <tbody>
                ${recentRecords.length ? recentRecords.map((row) => `
                  <tr>
                    <td>${escapeHtml(formatDate(row.attendance_date))}</td>
                    <td>${escapeHtml(formatTime(row.check_in_time))}</td>
                    <td>${escapeHtml(formatTime(row.check_out_time))}</td>
                    <td>${badgeMarkup(row.attendance_status, row.attendance_status)}</td>
                  </tr>
                `).join('') : `<tr><td colspan="4"><div class="empty-state">${escapeHtml(t('notes.noHistoryRecords'))}</div></td></tr>`}
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
    invalidateAttendanceCache();
    showToast(type === 'checkin' ? t('toasts.checkInSuccess') : t('toasts.checkOutSuccess'), 'success');
    await renderAttendancePage();
    await refreshTopbarMessage();
  } catch (error) {
    showToast(error.message, 'error');
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
        <div class="form-group">
          <label for="request_type">${escapeHtml(t('requestPage.requestType'))}</label>
          <select id="request_type" name="request_type" required>
            ${REQUEST_TYPES.map((type) => `<option value="${type}" ${defaultType === type ? 'selected' : ''}>${escapeHtml(requestTypeLabel(type))}</option>`).join('')}
          </select>
        </div>
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
  form.request_type.addEventListener('change', () => syncRequestFormFields(form));
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
                <tr><th>${escapeHtml(t('common.employee'))}</th><th>${escapeHtml(t('common.date'))}</th><th>${escapeHtml(t('common.checkIn'))}</th><th>${escapeHtml(t('common.checkOut'))}</th><th>${escapeHtml(t('common.status'))}</th><th>${escapeHtml(t('historyPage.ipAddress'))}</th></tr>
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
                    </tr>
                  `;
                }).join('') : `<tr><td colspan="6"><div class="empty-state">${escapeHtml(t('notes.noFilteredRecords'))}</div></td></tr>`}
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

async function renderQrPage() {
  const container = elements.pages.qr;
  if (!isAdmin()) {
    setPageError(container, t('errors.adminQrOnly'));
    return;
  }
  if (!getFreshCachedValue(buildCacheKey('qr', { current: true }), QUERY_CACHE_TTL_MS.qr)) {
    setPageLoading(container, t('pages.loading.qr'));
  }

  try {
    const payload = await getCachedQuery(buildCacheKey('qr', { current: true }), QUERY_CACHE_TTL_MS.qr, () => apiRequest('/attendance/qr'));
    const qr = payload.data;
    container.innerHTML = `
      <div class="page-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">${escapeHtml(t('qrPage.eyebrow'))}</p>
            <h1>${escapeHtml(t('qrPage.title'))}</h1>
            <p>${escapeHtml(t('qrPage.intro'))}</p>
          </div>
          <button id="qrRefreshBtn" type="button" class="btn btn-secondary">${escapeHtml(t('common.regenerate'))}</button>
        </div>
        <section class="card-block">
          <div class="page-shell">
            <div class="qr-frame">
              <img src="${escapeHtml(qr.qr_image)}" alt="${escapeHtml(t('qrPage.imageAlt'))}" />
            </div>
            <div class="status-card compact">
              <div>
                <span class="status-label">${escapeHtml(t('qrPage.checkinUrl'))}</span>
                <strong>${escapeHtml(qr.checkin_url)}</strong>
                <p class="inline-note">${escapeHtml(t('notes.latestGenerated', { date: formatDateTime(qr.generated_at) }))}</p>
              </div>
            </div>
            <div class="inline-actions">
              <button id="downloadQrBtn" type="button" class="btn btn-primary">${escapeHtml(t('common.downloadQr'))}</button>
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
