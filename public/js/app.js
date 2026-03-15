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
  employees: ['Administration', 'Employee Management'],
  attendance: ['Operations', 'Attendance'],
  history: ['Operations', 'Attendance History'],
  qr: ['Administration', 'QR Access'],
};
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
  historyFilters: {
    from: offsetDate(-14),
    to: todayIso(),
    status: 'all',
  },
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
  toast: document.getElementById('toast'),
  pages: {
    dashboard: document.getElementById('page-dashboard'),
    employees: document.getElementById('page-employees'),
    attendance: document.getElementById('page-attendance'),
    history: document.getElementById('page-history'),
    qr: document.getElementById('page-qr'),
  },
};

boot();

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function offsetDate(days) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value.toISOString().split('T')[0];
}

function isAdmin() {
  return state.profile?.role === 'admin';
}

function allowedPages() {
  return isAdmin() ? ['dashboard', 'employees', 'attendance', 'history', 'qr'] : ['dashboard', 'attendance', 'history'];
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

function showToast(message, type = 'info') {
  elements.toast.textContent = message;
  elements.toast.className = `toast ${type}`;
  elements.toast.classList.remove('hidden');
  clearTimeout(window.__evaraToastTimer);
  window.__evaraToastTimer = window.setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 3500);
}

function openModal(content) {
  elements.modalPanel.innerHTML = content;
  elements.modal.classList.remove('hidden');
}

function closeModal() {
  elements.modal.classList.add('hidden');
  elements.modalPanel.innerHTML = '';
}

function setLoginError(message = '') {
  elements.loginError.textContent = message;
  elements.loginError.classList.toggle('hidden', !message);
}

function resetSessionState() {
  state.session = null;
  state.profile = null;
  state.employees = [];
  state.profileMap = new Map();
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
  elements.modalBackdrop.addEventListener('click', closeModal);
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

function drawEmployeesPage() {
  const container = elements.pages.employees;
  const list = filteredEmployees();
  const departments = [...new Set(state.employees.map((employee) => departmentLabel(employee.department)))].sort();
  const activeCount = state.employees.filter((employee) => employee.is_active).length;
  const onLeaveCount = state.employees.filter((employee) => employee.status === 'on_leave').length;

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
        <div class="toolbar">
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
              ${list.length ? list.map((employee) => `
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
                      <button class="btn btn-secondary" data-action="toggle" data-id="${employee.id}">${employee.is_active ? 'Deactivate' : 'Activate'}</button>
                      <button class="btn btn-danger" data-action="delete" data-id="${employee.id}">Delete</button>
                    </div>
                  </td>
                </tr>
              `).join('') : '<tr><td colspan="9"><div class="empty-state">No employees match the current filters.</div></td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;

  container.querySelector('#employeeSearch')?.addEventListener('input', (event) => {
    state.employeeFilters.search = event.target.value;
    drawEmployeesPage();
  });
  container.querySelector('#departmentFilter')?.addEventListener('change', (event) => {
    state.employeeFilters.department = event.target.value;
    drawEmployeesPage();
  });
  container.querySelector('#statusFilter')?.addEventListener('change', (event) => {
    state.employeeFilters.status = event.target.value;
    drawEmployeesPage();
  });
  container.querySelector('#openAddEmployeeBtn')?.addEventListener('click', () => {
    openEmployeeForm('create');
  });
  container.querySelector('#refreshEmployeesBtn')?.addEventListener('click', () => {
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
          <input id="employee_department" name="department" value="${escapeHtml(employee?.department || '')}" />
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

async function handleEmployeeToggle(employee) {
  const confirmed = window.confirm(`Change account access for ${employee.full_name}?`);
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
  const confirmed = window.confirm(`Delete ${employee.full_name}? This removes the Supabase Auth account and all linked attendance data.`);
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
      fetchAttendance({ date: today, limit: 250 }),
      fetchAttendance({ from: offsetDate(-14), to: today, limit: 14 }),
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
              <p>Monitor check-ins and check-outs as they happen.</p>
            </div>
            <button id="attendanceRefreshBtn" type="button" class="btn btn-secondary">Refresh</button>
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
      limit: 150,
    });
    await ensureProfileDirectory(records);

    container.innerHTML = `
      <div class="page-shell">
        <div class="section-header">
          <div>
            <p class="eyebrow">Records</p>
            <h1>Attendance History</h1>
            <p>Filter live attendance rows by date range and status.</p>
          </div>
        </div>
        <section class="card-block">
          <div class="toolbar">
            <input id="historyFrom" type="date" value="${escapeHtml(state.historyFilters.from)}" />
            <input id="historyTo" type="date" value="${escapeHtml(state.historyFilters.to)}" />
            <select id="historyStatus">
              <option value="all">All Statuses</option>
              ${['present', 'late', 'checked_out', 'absent'].map((status) => `<option value="${status}" ${state.historyFilters.status === status ? 'selected' : ''}>${escapeHtml(statusLabel(status))}</option>`).join('')}
            </select>
            <button id="historySearchBtn" type="button" class="btn btn-secondary">Apply</button>
          </div>
          <div class="table-shell">
            <table>
              <thead>
                <tr><th>Employee</th><th>Date</th><th>Check In</th><th>Check Out</th><th>Status</th><th>IP Address</th></tr>
              </thead>
              <tbody>
                ${records.length ? records.map((row) => {
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
        </section>
      </div>
    `;

    container.querySelector('#historySearchBtn')?.addEventListener('click', () => {
      state.historyFilters.from = container.querySelector('#historyFrom').value;
      state.historyFilters.to = container.querySelector('#historyTo').value;
      state.historyFilters.status = container.querySelector('#historyStatus').value;
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

