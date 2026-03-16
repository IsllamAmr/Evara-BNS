import { getAppConfig, getSupabase, isSupabaseReady } from './supabaseClient.js';
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
const PAGE_TITLES = {
  dashboard: ['Workspace', 'Dashboard'],
  profile: ['Workspace', 'My Profile'],
  employees: ['Administration', 'Employee Management'],
  attendance: ['Operations', 'Attendance'],
  history: ['Operations', 'Attendance History'],
  reports: ['Insights', 'Reports & Analytics'],
  qr: ['Administration', 'QR Access'],
};
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
const BUSINESS_TIME_ZONE = 'Africa/Cairo';
const FULL_SHIFT_MINUTES = 8 * 60;
const ON_TIME_THRESHOLD_MINUTES = (9 * 60) + 15;
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
  topbarEyebrow: document.getElementById('topbarEyebrow'),
  topbarTitle: document.getElementById('topbarTitle'),
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
  container.innerHTML = `<div class="empty-state"><strong>Unable to load this section.</strong><p class="empty-note">${escapeHtml(message)}</p></div>`;
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
      <strong>${escapeHtml(type === 'success' ? 'Success' : type === 'error' ? 'Action needed' : 'Notice')}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
    <button type="button" class="toast-close" aria-label="Close message">Close</button>
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
    elements.topbarClock.textContent = now.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
    elements.topbarDate.textContent = now.toLocaleDateString('en-GB', {
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
    throw new Error(payload.message || 'Request failed');
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

  const [eyebrow, title] = PAGE_TITLES[page] || ['Workspace', 'EVARA BNS'];
  elements.topbarEyebrow.textContent = eyebrow;
  elements.topbarTitle.textContent = title;
  syncShell();
}

function bindStaticEvents() {
  elements.loginForm.addEventListener('submit', handleLogin);
  elements.togglePasswordBtn.addEventListener('click', () => {
    const nextType = elements.loginPassword.type === 'password' ? 'text' : 'password';
    elements.loginPassword.type = nextType;
    elements.togglePasswordBtn.textContent = nextType === 'password' ? 'Show' : 'Hide';
  });
  elements.logoutBtn.addEventListener('click', handleLogout);
  elements.menuToggle.addEventListener('click', () => {
    elements.sidebar.classList.toggle('open');
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
  bindStaticEvents();
  startClock();

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
  elements.loginBtn.textContent = 'Signing in';

  try {
    const { error, data } = await supabase.auth.signInWithPassword({
      email: elements.loginEmail.value.trim(),
      password: elements.loginPassword.value,
    });

    if (error) {
      throw new Error(error.message || 'Unable to sign in');
    }

    await handleAuthenticatedSession(data.session);
  } catch (error) {
    setLoginError(error.message || 'Unable to sign in');
  } finally {
    elements.loginBtn.disabled = false;
    elements.loginBtn.textContent = 'Sign In';
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

function badgeMarkup(type, value) {
  return `<span class="badge ${escapeHtml(type)}">${escapeHtml(statusLabel(value))}</span>`;
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

function csvValue(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function downloadCsvFile(filename, headers, rows) {
  const content = ['\uFEFF' + headers.map(csvValue).join(','), ...rows.map((row) => row.map(csvValue).join(','))].join('\r\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportEmployeesCsv(list) {
  downloadCsvFile(
    `employees-${todayIso()}.csv`,
    ['Employee Code', 'Full Name', 'Email', 'Phone', 'Department', 'Position', 'Status', 'Role', 'Access'],
    list.map((employee) => [
      employee.employee_code || '',
      employee.full_name,
      employee.email,
      employee.phone || '',
      departmentLabel(employee.department),
      employee.position || '',
      statusLabel(employee.status),
      roleLabel(employee.role),
      employee.is_active ? 'Active' : 'Inactive',
    ])
  );
}

function exportAttendanceCsv(records) {
  downloadCsvFile(
    `attendance-${todayIso()}.csv`,
    ['Employee', 'Email', 'Date', 'Check In', 'Check Out', 'Status', 'IP Address', 'Device Info'],
    records.map((row) => {
      const profile = employeeById(row.user_id) || state.profile;
      return [
        profile?.full_name || '',
        profile?.email || '',
        formatDate(row.attendance_date),
        formatTime(row.check_in_time),
        formatTime(row.check_out_time),
        statusLabel(row.attendance_status),
        row.ip_address || '',
        row.device_info || '',
      ];
    })
  );
}

function exportReportsCsv(report, filters) {
  const monthToken = (filters.month || currentMonthInput()).replace('-', '_');
  const departmentToken = filters.department && filters.department !== 'all'
    ? filters.department.toLowerCase().replace(/\s+/g, '-')
    : 'all-departments';
  const employeeToken = filters.employeeId && filters.employeeId !== 'all'
    ? 'single-employee'
    : 'all-employees';

  downloadCsvFile(
    `reports-${monthToken}-${departmentToken}-${employeeToken}.csv`,
    [
      'Employee Name',
      'Employee Code',
      'Email',
      'Department',
      'Position',
      'Days Present',
      'Days Absent',
      'Late Arrivals',
      'Total Hours',
      'Expected Hours',
      'Overtime',
      'Shortfall',
      'Attendance Rate (%)',
      'On-Time Arrival (%)',
      'Average Check In',
      'Average Check Out',
      'Complete Shifts',
      'Trend',
      'Trend Note',
    ],
    report.byEmployee.map((item) => [
      item.employee.full_name,
      item.employee.employee_code || '',
      item.employee.email || '',
      departmentLabel(item.employee.department),
      item.employee.position || '',
      item.presentDays,
      item.absentDays,
      item.lateArrivals,
      formatDuration(item.workedMinutes),
      formatDuration(item.expectedMinutes),
      formatDuration(item.overtimeMinutes),
      formatDuration(item.shortfallMinutes),
      item.attendanceRate,
      item.onTimeArrivalRate,
      formatAverageTime(item.averageCheckIn),
      formatAverageTime(item.averageCheckOut),
      item.detailedRows.filter((entry) => entry.metrics.isCompleteShift).length,
      item.trend.label,
      item.trend.note,
    ])
  );
}

function exportEmployeeTimesheetCsv(employeeReport, filters) {
  if (!employeeReport) {
    return;
  }

  const monthToken = (filters.month || currentMonthInput()).replace('-', '_');
  const employeeToken = (employeeReport.employee.full_name || 'employee')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'employee';

  downloadCsvFile(
    `timesheet-${employeeToken}-${monthToken}.csv`,
    [
      'Employee Name',
      'Employee Code',
      'Department',
      'Date',
      'Arrival',
      'Check In',
      'Check Out',
      'Total Hours',
      'Expected Hours',
      'Overtime',
      'Shortfall',
      'Shift Result',
      'Attendance Status',
    ],
    employeeReport.detailedRows.map((entry) => [
      employeeReport.employee.full_name,
      employeeReport.employee.employee_code || '',
      departmentLabel(employeeReport.employee.department),
      formatDate(entry.row.attendance_date),
      entry.metrics.isPresent ? (entry.metrics.isLateArrival ? 'Late' : 'On Time') : 'No Check-in',
      formatTime(entry.row.check_in_time),
      formatTime(entry.row.check_out_time),
      formatDuration(entry.metrics.workedMinutes),
      formatDuration(FULL_SHIFT_MINUTES),
      formatDuration(entry.metrics.overtimeMinutes),
      formatDuration(entry.metrics.shortfallMinutes),
      attendanceOutcome(entry.metrics),
      statusLabel(entry.row.attendance_status),
    ])
  );
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

function monthRange(monthValue) {
  const [yearValue, monthValuePart] = String(monthValue || currentMonthInput()).split('-');
  const year = Number(yearValue);
  const month = Number(monthValuePart);
  const now = new Date();
  const startDate = new Date(year, month - 1, 1, 12, 0, 0, 0);
  const endDate = new Date(year, month, 0, 12, 0, 0, 0);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  const boundedEnd = endDate > today ? today : endDate;

  return {
    startDate,
    endDate: boundedEnd,
    from: formatDateInput(startDate),
    to: formatDateInput(boundedEnd),
    label: startDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
  };
}

function isWorkday(date) {
  const day = date.getDay();
  return day !== 5 && day !== 6;
}

function enumerateDates(startDate, endDate) {
  const dates = [];
  const cursor = new Date(startDate);
  cursor.setHours(12, 0, 0, 0);
  const finalDate = new Date(endDate);
  finalDate.setHours(12, 0, 0, 0);

  while (cursor <= finalDate) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function timePartsInZone(value, timeZone = BUSINESS_TIME_ZONE) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  return { hour, minute };
}

function minutesFromTimestamp(value, timeZone = BUSINESS_TIME_ZONE) {
  if (!value) {
    return null;
  }

  const parts = timePartsInZone(value, timeZone);
  if (!parts) {
    return null;
  }

  return (parts.hour * 60) + parts.minute;
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) {
    return null;
  }

  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function formatAverageTime(minutes) {
  if (!Number.isFinite(minutes)) {
    return '-';
  }

  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mins = String(minutes % 60).padStart(2, '0');
  return `${hours}:${mins}`;
}

function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return '0h 00m';
  }

  const hours = Math.floor(minutes / 60);
  const mins = String(minutes % 60).padStart(2, '0');
  return `${hours}h ${mins}m`;
}

function durationToHours(minutes) {
  return Math.round((minutes / 60) * 10) / 10;
}

function workingMinutesBetween(checkInTime, checkOutTime) {
  if (!checkInTime || !checkOutTime) {
    return 0;
  }

  const start = new Date(checkInTime);
  const end = new Date(checkOutTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }

  return Math.max(Math.round((end.getTime() - start.getTime()) / 60000), 0);
}

function sumBy(items, selector) {
  return items.reduce((total, item) => total + selector(item), 0);
}

function buildAttendanceRowMetrics(row) {
  const checkInMinutes = minutesFromTimestamp(row.check_in_time);
  const checkOutMinutes = minutesFromTimestamp(row.check_out_time);
  const workedMinutes = workingMinutesBetween(row.check_in_time, row.check_out_time);
  const overtimeMinutes = Math.max(workedMinutes - FULL_SHIFT_MINUTES, 0);
  const shortfallMinutes = row.check_in_time && row.check_out_time
    ? Math.max(FULL_SHIFT_MINUTES - workedMinutes, 0)
    : 0;
  const isPresent = Boolean(row.check_in_time);
  const isLateArrival = Number.isFinite(checkInMinutes) && checkInMinutes > ON_TIME_THRESHOLD_MINUTES;

  return {
    checkInMinutes,
    checkOutMinutes,
    workedMinutes,
    overtimeMinutes,
    shortfallMinutes,
    isPresent,
    isLateArrival,
    isOnTimeArrival: isPresent && !isLateArrival,
    isCompleteShift: Boolean(row.check_in_time && row.check_out_time),
  };
}

function attendanceOutcome(metrics) {
  if (!metrics.isPresent) {
    return 'No Check-in';
  }
  if (!metrics.isCompleteShift) {
    return 'Incomplete Shift';
  }
  if (metrics.overtimeMinutes > 0) {
    return `Overtime +${formatDuration(metrics.overtimeMinutes)}`;
  }
  if (metrics.shortfallMinutes > 0) {
    return `Shortfall ${formatDuration(metrics.shortfallMinutes)}`;
  }
  return 'Full Shift';
}

function classifyEmployeeTrend(employeeReport) {
  if (employeeReport.attendanceRate >= 96 && employeeReport.onTimeArrivalRate >= 90 && employeeReport.shortfallMinutes <= FULL_SHIFT_MINUTES) {
    return { label: 'Exceptional', className: 'trend-exceptional', note: 'Consistent attendance with strong shift completion.' };
  }
  if (employeeReport.attendanceRate >= 85 && employeeReport.onTimeArrivalRate >= 75 && employeeReport.shortfallMinutes <= FULL_SHIFT_MINUTES * 2) {
    return { label: 'Committed', className: 'trend-committed', note: 'Reliable attendance and healthy punctuality.' };
  }
  if (employeeReport.attendanceRate >= 70 && employeeReport.onTimeArrivalRate >= 60) {
    return { label: 'Needs Focus', className: 'trend-focus', note: 'Watch punctuality and shift completion more closely.' };
  }
  return { label: 'Needs Attention', className: 'trend-risk', note: 'Attendance or punctuality is below target.' };
}

function trendBadgeMarkup(trend) {
  return `<span class="badge ${escapeHtml(trend.className)}">${escapeHtml(trend.label)}</span>`;
}

function reportsDepartmentChoices(employees) {
  return [...new Set(
    employees
      .map((employee) => departmentLabel(employee.department))
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right));
}

function reportsEmployeeChoices(employees, departmentFilter = 'all') {
  return employees
    .filter((employee) => departmentFilter === 'all' || departmentLabel(employee.department) === departmentFilter)
    .sort((left, right) => left.full_name.localeCompare(right.full_name));
}

function reportEmployeeOptions(employees, selectedEmployeeId = 'all') {
  return [
    '<option value="all">All Employees</option>',
    ...employees.map((employee) => `
      <option value="${escapeHtml(employee.id)}" ${selectedEmployeeId === employee.id ? 'selected' : ''}>
        ${escapeHtml(employee.full_name)}${employee.employee_code ? ` (${escapeHtml(employee.employee_code)})` : ''}
      </option>
    `),
  ].join('');
}

function buildReportsDataset(employees, attendanceRows, filters) {
  const range = monthRange(filters.month);
  const workdays = enumerateDates(range.startDate, range.endDate).filter(isWorkday);
  const workdaySet = new Set(workdays.map((date) => formatDateInput(date)));
  const eligibleEmployees = employees.filter((employee) => employee.is_active && employee.status !== 'inactive');
  const filteredEmployees = eligibleEmployees.filter((employee) => {
    if (filters.department !== 'all' && departmentLabel(employee.department) !== filters.department) {
      return false;
    }
    if (filters.employeeId !== 'all' && employee.id !== filters.employeeId) {
      return false;
    }
    return true;
  });
  const employeeIds = new Set(filteredEmployees.map((employee) => employee.id));
  const relevantRows = attendanceRows.filter((row) => employeeIds.has(row.user_id));
  const rowsByEmployee = new Map(filteredEmployees.map((employee) => [employee.id, []]));

  relevantRows.forEach((row) => {
    rowsByEmployee.get(row.user_id)?.push(row);
  });

  const byEmployee = filteredEmployees.map((employee) => {
    const rows = (rowsByEmployee.get(employee.id) || [])
      .slice()
      .sort((left, right) => right.attendance_date.localeCompare(left.attendance_date));
    const detailedRows = rows.map((row) => ({
      row,
      metrics: buildAttendanceRowMetrics(row),
    }));
    const workdayRows = detailedRows.filter((item) => workdaySet.has(item.row.attendance_date));
    const presentDays = new Set(workdayRows.filter((item) => item.metrics.isPresent).map((item) => item.row.attendance_date)).size;
    const absentDays = Math.max(workdays.length - presentDays, 0);
    const lateArrivals = workdayRows.filter((item) => item.metrics.isLateArrival).length;
    const onTimeArrivals = workdayRows.filter((item) => item.metrics.isOnTimeArrival).length;
    const workedMinutes = sumBy(detailedRows, (item) => item.metrics.workedMinutes);
    const overtimeMinutes = sumBy(detailedRows, (item) => item.metrics.overtimeMinutes);
    const shortfallMinutes = sumBy(workdayRows, (item) => item.metrics.shortfallMinutes);
    const expectedMinutes = workdays.length * FULL_SHIFT_MINUTES;
    const averageCheckIn = average(workdayRows.map((item) => item.metrics.checkInMinutes));
    const averageCheckOut = average(detailedRows.map((item) => item.metrics.checkOutMinutes));
    const attendanceRate = workdays.length ? Math.round((presentDays / workdays.length) * 100) : 0;
    const onTimeArrivalRate = presentDays ? Math.round((onTimeArrivals / presentDays) * 100) : 0;

    const employeeReport = {
      employee,
      rows,
      detailedRows,
      presentDays,
      absentDays,
      lateArrivals,
      onTimeArrivals,
      workedMinutes,
      overtimeMinutes,
      shortfallMinutes,
      expectedMinutes,
      attendanceRate,
      onTimeArrivalRate,
      averageCheckIn,
      averageCheckOut,
    };

    return {
      ...employeeReport,
      trend: classifyEmployeeTrend(employeeReport),
    };
  }).sort((left, right) => {
    if (right.attendanceRate !== left.attendanceRate) {
      return right.attendanceRate - left.attendanceRate;
    }
    if (right.onTimeArrivalRate !== left.onTimeArrivalRate) {
      return right.onTimeArrivalRate - left.onTimeArrivalRate;
    }
    return right.workedMinutes - left.workedMinutes;
  });

  const totalExpectedDays = filteredEmployees.length * workdays.length;
  const totalPresentDays = sumBy(byEmployee, (item) => item.presentDays);
  const totalOnTimeArrivals = sumBy(byEmployee, (item) => item.onTimeArrivals);
  const totalHoursWorkedMinutes = sumBy(byEmployee, (item) => item.workedMinutes);
  const totalOvertimeMinutes = sumBy(byEmployee, (item) => item.overtimeMinutes);
  const totalShortfallMinutes = sumBy(byEmployee, (item) => item.shortfallMinutes);
  const attendanceRate = totalExpectedDays ? Math.round((totalPresentDays / totalExpectedDays) * 100) : 0;
  const onTimeArrivalRate = totalPresentDays ? Math.round((totalOnTimeArrivals / totalPresentDays) * 100) : 0;

  const weekdayTotals = workdays
    .map((date) => {
      const isoDate = formatDateInput(date);
      const presentCount = new Set(
        relevantRows
          .filter((row) => row.attendance_date === isoDate && row.check_in_time)
          .map((row) => row.user_id)
      ).size;

      return {
        weekday: date.toLocaleDateString('en-GB', { weekday: 'long' }),
        absentCount: Math.max(filteredEmployees.length - presentCount, 0),
        occurrences: 1,
      };
    })
    .reduce((accumulator, item) => {
      const existing = accumulator.get(item.weekday) || { weekday: item.weekday, absentCount: 0, occurrences: 0 };
      existing.absentCount += item.absentCount;
      existing.occurrences += 1;
      accumulator.set(item.weekday, existing);
      return accumulator;
    }, new Map());

  const weekdayRows = [...weekdayTotals.values()].sort((left, right) => right.absentCount - left.absentCount);
  const dailyTrend = workdays.map((date) => {
    const isoDate = formatDateInput(date);
    const rowsForDate = relevantRows
      .filter((row) => row.attendance_date === isoDate)
      .map((row) => buildAttendanceRowMetrics(row));
    const presentCount = relevantRows.filter((row) => row.attendance_date === isoDate && row.check_in_time).length;

    return {
      label: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      presentCount,
      absentCount: Math.max(filteredEmployees.length - presentCount, 0),
      workedHours: durationToHours(sumBy(rowsForDate, (item) => item.workedMinutes)),
      overtimeHours: durationToHours(sumBy(rowsForDate, (item) => item.overtimeMinutes)),
    };
  });

  const departmentHours = [...byEmployee.reduce((accumulator, item) => {
    const key = departmentLabel(item.employee.department);
    const current = accumulator.get(key) || {
      department: key,
      employeeCount: 0,
      actualMinutes: 0,
      expectedMinutes: 0,
    };
    current.employeeCount += 1;
    current.actualMinutes += item.workedMinutes;
    current.expectedMinutes += item.expectedMinutes;
    accumulator.set(key, current);
    return accumulator;
  }, new Map()).values()]
    .map((item) => ({
      ...item,
      actualHours: durationToHours(item.actualMinutes),
      expectedHours: durationToHours(item.expectedMinutes),
    }))
    .sort((left, right) => right.actualMinutes - left.actualMinutes);

  return {
    range,
    workdays,
    eligibleEmployees,
    filteredEmployees,
    attendanceRows: relevantRows,
    byEmployee,
    weekdayRows,
    topPerformers: byEmployee.slice(0, 5),
    dailyTrend,
    departmentHours,
    selectedEmployeeReport: filters.employeeId === 'all'
      ? null
      : byEmployee.find((item) => item.employee.id === filters.employeeId) || null,
    totals: {
      totalHoursWorkedMinutes,
      totalOvertimeMinutes,
      totalShortfallMinutes,
      totalExpectedMinutes: sumBy(byEmployee, (item) => item.expectedMinutes),
      totalPresentDays,
      totalExpectedDays,
      attendanceRate,
      onTimeArrivalRate,
    },
  };
}

function prepareChartCanvas(canvas, height = 260) {
  const context = canvas?.getContext('2d');
  if (!canvas || !context) {
    return null;
  }

  const width = canvas.clientWidth || 720;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  return {
    context,
    width,
    height,
  };
}

function drawWorkingHoursTrend(canvas, points) {
  if (!canvas || !points.length) {
    return;
  }

  const prepared = prepareChartCanvas(canvas);
  if (!prepared) {
    return;
  }

  const { context, width, height } = prepared;
  const padding = { top: 26, right: 18, bottom: 44, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...points.map((point) => Math.max(point.workedHours, point.overtimeHours)), 1);
  const stepX = points.length > 1 ? chartWidth / (points.length - 1) : chartWidth;
  const yForValue = (value) => padding.top + chartHeight - ((value / maxValue) * chartHeight);

  context.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  context.lineWidth = 1;
  for (let step = 0; step <= 4; step += 1) {
    const y = padding.top + ((chartHeight / 4) * step);
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();

    const labelValue = Math.round(maxValue - ((maxValue / 4) * step));
    context.fillStyle = 'rgba(237, 242, 247, 0.72)';
    context.font = '12px Inter, sans-serif';
    context.fillText(`${labelValue}h`, 8, y + 4);
  }

  context.fillStyle = 'rgba(59, 130, 246, 0.12)';
  context.beginPath();
  points.forEach((point, index) => {
    const x = padding.left + (stepX * index);
    const y = yForValue(point.workedHours);
    if (index === 0) {
      context.moveTo(x, height - padding.bottom);
      context.lineTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.lineTo(padding.left + (stepX * (points.length - 1)), height - padding.bottom);
  context.closePath();
  context.fill();

  context.beginPath();
  points.forEach((point, index) => {
    const x = padding.left + (stepX * index);
    const y = yForValue(point.workedHours);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.strokeStyle = '#60a5fa';
  context.lineWidth = 3;
  context.stroke();

  context.beginPath();
  points.forEach((point, index) => {
    const x = padding.left + (stepX * index);
    const y = yForValue(point.overtimeHours);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.strokeStyle = 'rgba(191, 219, 254, 0.78)';
  context.setLineDash([6, 4]);
  context.lineWidth = 2;
  context.stroke();
  context.setLineDash([]);

  context.fillStyle = '#dbeafe';
  points.forEach((point, index) => {
    const x = padding.left + (stepX * index);
    const y = yForValue(point.workedHours);
    context.beginPath();
    context.arc(x, y, 4, 0, Math.PI * 2);
    context.fill();

    if (index === 0 || index === points.length - 1 || index % Math.max(Math.round(points.length / 6), 2) === 0) {
      context.fillStyle = 'rgba(237, 242, 247, 0.72)';
      context.font = '12px Inter, sans-serif';
      context.fillText(point.label, x - 18, height - 16);
      context.fillStyle = '#dbeafe';
    }
  });

  context.fillStyle = '#60a5fa';
  context.fillRect(width - 176, 16, 12, 12);
  context.fillStyle = '#dbeafe';
  context.font = '12px Inter, sans-serif';
  context.fillText('Hours Worked', width - 156, 26);
  context.strokeStyle = 'rgba(191, 219, 254, 0.78)';
  context.setLineDash([6, 4]);
  context.beginPath();
  context.moveTo(width - 176, 42);
  context.lineTo(width - 164, 42);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = 'rgba(237, 242, 247, 0.72)';
  context.fillText('Overtime', width - 156, 46);
}

function drawDepartmentHoursChart(canvas, points) {
  if (!canvas || !points.length) {
    return;
  }

  const prepared = prepareChartCanvas(canvas, 280);
  if (!prepared) {
    return;
  }

  const { context, width, height } = prepared;
  const rows = points.slice(0, 6);
  const padding = { top: 26, right: 18, bottom: 62, left: 52 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...rows.map((item) => Math.max(item.actualHours, item.expectedHours)), 1);
  const groupWidth = chartWidth / Math.max(rows.length, 1);
  const barWidth = Math.min(22, Math.max(10, (groupWidth / 3)));
  const yForValue = (value) => padding.top + chartHeight - ((value / maxValue) * chartHeight);

  context.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  context.lineWidth = 1;
  for (let step = 0; step <= 4; step += 1) {
    const y = padding.top + ((chartHeight / 4) * step);
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();

    const labelValue = Math.round(maxValue - ((maxValue / 4) * step));
    context.fillStyle = 'rgba(237, 242, 247, 0.72)';
    context.font = '12px Inter, sans-serif';
    context.fillText(`${labelValue}h`, 8, y + 4);
  }

  rows.forEach((item, index) => {
    const groupX = padding.left + (groupWidth * index) + (groupWidth / 2);
    const expectedHeight = chartHeight * (item.expectedHours / maxValue);
    const actualHeight = chartHeight * (item.actualHours / maxValue);
    const expectedX = groupX - barWidth - 4;
    const actualX = groupX + 4;
    const expectedY = yForValue(item.expectedHours);
    const actualY = yForValue(item.actualHours);
    const shortLabel = item.department.length > 11 ? `${item.department.slice(0, 11)}...` : item.department;

    context.fillStyle = 'rgba(148, 163, 184, 0.45)';
    context.fillRect(expectedX, expectedY, barWidth, expectedHeight);

    context.fillStyle = '#3b82f6';
    context.fillRect(actualX, actualY, barWidth, actualHeight);

    context.fillStyle = 'rgba(237, 242, 247, 0.72)';
    context.font = '11px Inter, sans-serif';
    context.save();
    context.translate(groupX, height - 22);
    context.rotate(-0.18);
    context.fillText(shortLabel, -20, 0);
    context.restore();
  });

  context.fillStyle = 'rgba(148, 163, 184, 0.45)';
  context.fillRect(width - 178, 16, 12, 12);
  context.fillStyle = '#dbeafe';
  context.font = '12px Inter, sans-serif';
  context.fillText('Expected', width - 158, 26);
  context.fillStyle = '#3b82f6';
  context.fillRect(width - 98, 16, 12, 12);
  context.fillStyle = '#dbeafe';
  context.fillText('Actual', width - 78, 26);
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
      const presentToday = todayAttendance.filter((row) => row.check_in_time).length;
      const absentToday = Math.max(activeEmployees.length - presentToday, 0);
      const lateToday = todayAttendance.filter((row) => row.attendance_status === 'late').length;
      const recentRows = todayAttendance.slice(0, 8);

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
          </div>
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

    const [todayAttendance, recentAttendance] = await Promise.all([
      fetchAttendance({ date: today, limit: 1 }),
      fetchAttendance({ from: offsetDate(-14), to: today, limit: 14 }),
    ]);
    const todayRecord = todayAttendance[0] || null;
    const checkedDays = recentAttendance.filter((row) => row.check_in_time).length;
    const lateDays = recentAttendance.filter((row) => row.attendance_status === 'late').length;

    container.innerHTML = `
      <div class="page-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">Welcome</p>
            <h1>${escapeHtml(state.profile.full_name)}</h1>
            <p>Your attendance overview is ready and synced live from Supabase.</p>
          </div>
          <button id="employeeAttendanceShortcut" type="button" class="btn btn-secondary">Open attendance</button>
        </div>
        <div class="summary-grid">
          ${buildSummaryCard('Today Status', todayRecord ? statusLabel(todayRecord.attendance_status) : 'Pending', todayRecord ? `Checked in ${formatTime(todayRecord.check_in_time)}` : 'No attendance recorded yet')}
          ${buildSummaryCard('Checked Days', String(checkedDays), 'Last 14 calendar days')}
          ${buildSummaryCard('Late Days', String(lateDays), 'Last 14 calendar days')}
          ${buildSummaryCard('Department', departmentLabel(state.profile.department), roleLabel(state.profile.role))}
        </div>
        <section class="card-block">
          <div class="card-head">
            <div>
              <h3>Recent personal history</h3>
              <p class="card-subtle">Your latest attendance records</p>
            </div>
          </div>
          <div class="table-shell">
            <table>
              <thead>
                <tr><th>Date</th><th>Check In</th><th>Check Out</th><th>Status</th></tr>
              </thead>
              <tbody>
                ${recentAttendance.length ? recentAttendance.map((row) => `
                  <tr>
                    <td>${escapeHtml(formatDate(row.attendance_date))}</td>
                    <td>${escapeHtml(formatTime(row.check_in_time))}</td>
                    <td>${escapeHtml(formatTime(row.check_out_time))}</td>
                    <td>${badgeMarkup(row.attendance_status, row.attendance_status)}</td>
                  </tr>
                `).join('') : '<tr><td colspan="4"><div class="empty-state">No attendance records available yet.</div></td></tr>'}
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
    const [todayRecords, recentRecords] = await Promise.all([
      fetchAttendance({ date: today, ...(isAdmin() ? {} : { userId: state.profile.id }) }),
      fetchAttendance({ from: offsetDate(-14), to: today, limit: 14, ...(isAdmin() ? {} : { userId: state.profile.id }) }),
    ]);

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
        exportAttendanceCsv(todayRecords);
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
    await apiRequest(`/attendance/${type}`, { method: 'POST' });
    showToast(type === 'checkin' ? 'Check-in recorded successfully.' : 'Check-out recorded successfully.', 'success');
    await renderAttendancePage();
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
      exportAttendanceCsv(records);
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

