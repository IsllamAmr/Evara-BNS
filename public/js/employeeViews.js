// Markup builders for the employee (phone-first) screens: shift ring, day strip,
// record and request cards. Pure functions over data; app.js wires events.
import { escapeHtml, formatDate, formatTime, statusLabel } from './shared.js';
import { getLocale, t } from './i18n.js';
import { buildAttendanceRowMetrics, formatDuration, FULL_SHIFT_MINUTES } from './reporting.js';

const ICON_PATHS = {
  camera: '<path d="M14.5 4h-5L8 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4z"/><circle cx="12" cy="14" r="4"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  requests: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  alarm: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3 2 6M22 6l-3-3"/>',
  up: '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  down: '<path d="m3 7 6 6 4-4 8 8"/><path d="M14 17h7v-7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  wifi: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0"/><path d="M12 19.5h.01"/>',
  note: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  id: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17a3.5 3.5 0 0 1 7 0M15 9h3M15 13h3"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  coffee: '<path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M6 2v2M10 2v2M14 2v2"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
  plane: '<path d="M2 16.5 22 9l-2.5-2.5L13 9 7 3 5 4l3.5 6.5-4 1.5L3 10.5 2 11l2.5 3z"/><path d="M3 21h18"/>',
  hourglass: '<path d="M6 2h12M6 22h12M7 2v4a5 5 0 0 0 10 0V2M7 22v-4a5 5 0 0 1 10 0v4"/>',
  place: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
};

export function icon(name, className = '') {
  const paths = ICON_PATHS[name] || ICON_PATHS.alert;
  return `<svg class="ico${className ? ` ${className}` : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export function greeting(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Cairo' }).format(now));
  if (hour < 12) return t('mobile.greeting.morning');
  if (hour < 17) return t('mobile.greeting.afternoon');
  return t('mobile.greeting.evening');
}

export function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || '';
}

function clockDuration(minutes) {
  const safe = Math.max(0, Math.floor(Number(minutes) || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

// Classifies the employee's current day for the hero card.
export function describeShift({ record = null, missingState = null } = {}) {
  if (record?.check_in_time) {
    const metrics = buildAttendanceRowMetrics(record);
    const progress = Math.min(metrics.workedMinutes / FULL_SHIFT_MINUTES, 1);
    if (metrics.isOpenShift) {
      return { state: metrics.workedMinutes >= FULL_SHIFT_MINUTES ? 'target' : 'open', metrics, progress };
    }
    return { state: 'done', metrics, progress };
  }
  const code = missingState?.code;
  if (code === 'weekend') return { state: 'weekend', metrics: null, progress: 0 };
  if (code === 'on_leave') return { state: 'leave', metrics: null, progress: 0 };
  if (code === 'absent') return { state: 'absent', metrics: null, progress: 0 };
  return { state: 'none', metrics: null, progress: 0 };
}

const RING_RADIUS = 84;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function ringMarkup(progress, centerMarkup) {
  const offset = RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(progress, 1)));
  return `
    <div class="shift-ring">
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          <linearGradient id="shiftRingGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="var(--ring-start)"/>
            <stop offset="1" stop-color="var(--ring-end)"/>
          </linearGradient>
        </defs>
        <circle class="shift-ring-track" cx="100" cy="100" r="${RING_RADIUS}"/>
        <circle class="shift-ring-bar" data-ring-bar cx="100" cy="100" r="${RING_RADIUS}"
          stroke="url(#shiftRingGradient)"
          stroke-dasharray="${RING_CIRCUMFERENCE.toFixed(2)}"
          stroke-dashoffset="${offset.toFixed(2)}"/>
      </svg>
      <div class="shift-ring-center">${centerMarkup}</div>
    </div>
  `;
}

function expectedEndLabel(checkInTime) {
  const start = new Date(checkInTime);
  if (Number.isNaN(start.getTime())) return '-';
  return formatTime(new Date(start.getTime() + FULL_SHIFT_MINUTES * 60000));
}

function metaCell(label, value, attrs = '') {
  return `<div class="shift-meta-cell"><span>${escapeHtml(label)}</span><strong ${attrs}>${escapeHtml(value)}</strong></div>`;
}

// The hero card on Home and Today. `scanHint` adds the "scan the office QR" call to action.
export function shiftHeroMarkup({ record = null, missingState = null, scanHint = true } = {}) {
  const shift = describeShift({ record, missingState });
  const { state, metrics } = shift;
  const targetHours = String(FULL_SHIFT_MINUTES / 60);
  let title = '';
  let text = '';
  let center = '';
  let meta = '';
  let cta = '';

  if (state === 'open' || state === 'target') {
    title = state === 'target' ? t('mobile.shift.targetReachedTitle') : t('mobile.shift.openTitle');
    text = t('mobile.shift.openText');
    center = `
      <span class="ring-kicker">${escapeHtml(t('mobile.shift.workedLabel'))}</span>
      <strong class="ring-value" data-live-worked>${clockDuration(metrics.workedMinutes)}</strong>
      <span class="ring-sub">${escapeHtml(t('mobile.shift.ofTarget', { hours: targetHours }))}</span>
    `;
    const overtime = metrics.overtimeMinutes > 0;
    meta = [
      metaCell(t('mobile.shift.checkIn'), formatTime(record.check_in_time)),
      metaCell(t('mobile.shift.expectedOut'), expectedEndLabel(record.check_in_time)),
      metaCell(
        overtime ? t('mobile.shift.overtime') : t('mobile.shift.remaining'),
        formatDuration(overtime ? metrics.overtimeMinutes : metrics.projectedRemainingMinutes),
        'data-live-remaining',
      ),
    ].join('');
    if (scanHint) cta = t('qrOnly.scanToCheckOut');
  } else if (state === 'done') {
    title = t('mobile.shift.completeTitle');
    text = t('mobile.shift.completeText');
    center = `
      <span class="ring-check">${icon('check')}</span>
      <strong class="ring-value">${clockDuration(metrics.workedMinutes)}</strong>
      <span class="ring-sub">${escapeHtml(t('mobile.shift.workedLabel'))}</span>
    `;
    meta = [
      metaCell(t('mobile.shift.checkIn'), formatTime(record.check_in_time)),
      metaCell(t('mobile.shift.checkOut'), formatTime(record.check_out_time)),
      metaCell(
        metrics.overtimeMinutes > 0 ? t('mobile.shift.overtime') : t('mobile.shift.worked'),
        formatDuration(metrics.overtimeMinutes > 0 ? metrics.overtimeMinutes : metrics.workedMinutes),
      ),
    ].join('');
  } else {
    const copy = {
      none: ['mobile.shift.notStartedTitle', 'mobile.shift.notStartedText', 'qr'],
      weekend: ['mobile.shift.weekendTitle', 'mobile.shift.weekendText', 'coffee'],
      leave: ['mobile.shift.onLeaveTitle', 'mobile.shift.onLeaveText', 'plane'],
      absent: ['mobile.shift.absentTitle', 'mobile.shift.absentText', 'alert'],
    }[state];
    title = t(copy[0]);
    text = t(copy[1]);
    center = `<span class="ring-icon">${icon(copy[2])}</span>`;
    if (state === 'none' && scanHint) cta = t('qrOnly.scanToCheckIn');
  }

  const liveAttrs = (state === 'open' || state === 'target')
    ? ` data-live-shift data-check-in="${escapeHtml(record.check_in_time)}" data-attendance-date="${escapeHtml(record.attendance_date)}"`
    : '';

  return `
    <section class="shift-hero state-${state}"${liveAttrs}>
      <div class="shift-hero-glow" aria-hidden="true"></div>
      <div class="shift-hero-head">
        ${(state === 'open' || state === 'target')
    ? `<span class="live-chip"><i></i>${escapeHtml(t('mobile.shift.live'))}</span>`
    : `<span class="live-chip muted">${escapeHtml(formatDate(new Date()))}</span>`}
        ${(state === 'open' || state === 'target')
    ? `<span class="shift-hero-since">${escapeHtml(t('mobile.shift.since', { time: formatTime(record.check_in_time) }))}</span>`
    : ''}
      </div>
      ${ringMarkup(shift.progress, center)}
      <div class="shift-hero-copy">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(text)}</p>
      </div>
      ${meta ? `<div class="shift-meta">${meta}</div>` : ''}
      ${cta ? `<button type="button" class="shift-cta" data-open-qr-scanner>${icon('camera')}<div><strong>${escapeHtml(cta)}</strong><span>${escapeHtml(t('qrScanner.tapToOpen'))}</span></div>${icon('chevron', 'shift-cta-arrow')}</button>` : ''}
    </section>
  `;
}

// Keeps the open-shift ring ticking. Returns a stop function.
export function startLiveShift(root) {
  const hero = root.querySelector('[data-live-shift]');
  if (!hero) return () => {};
  const row = {
    check_in_time: hero.dataset.checkIn,
    check_out_time: null,
    attendance_date: hero.dataset.attendanceDate,
  };
  const tick = () => {
    if (!hero.isConnected) return;
    const metrics = buildAttendanceRowMetrics(row);
    const worked = hero.querySelector('[data-live-worked]');
    const remaining = hero.querySelector('[data-live-remaining]');
    const bar = hero.querySelector('[data-ring-bar]');
    if (worked) worked.textContent = clockDuration(metrics.workedMinutes);
    if (remaining) {
      remaining.textContent = formatDuration(metrics.overtimeMinutes > 0 ? metrics.overtimeMinutes : metrics.projectedRemainingMinutes);
    }
    if (bar) {
      const progress = Math.min(metrics.workedMinutes / FULL_SHIFT_MINUTES, 1);
      bar.setAttribute('stroke-dashoffset', (RING_CIRCUMFERENCE * (1 - progress)).toFixed(2));
    }
  };
  const id = window.setInterval(tick, 30 * 1000);
  return () => window.clearInterval(id);
}

function dayTone(entry, todayIso) {
  if (entry.row && entry.metrics?.isOpenShift) return 'open';
  if (entry.countsAsAbsent) return 'absent';
  const code = entry.displayState?.code;
  if (code === 'weekend') return 'off';
  if (code === 'on_leave') return 'leave';
  if (!entry.row) return entry.attendanceDate === todayIso ? 'pending' : 'off';
  if (entry.countsAsLate || entry.shortfallMinutes > 0) return 'late';
  return 'full';
}

// Horizontal, scrollable day-by-day strip of the current month (oldest to today).
export function monthStripMarkup(ledger, todayIso) {
  const days = ledger
    .filter((entry) => entry.attendanceDate <= todayIso)
    .slice()
    .sort((left, right) => left.attendanceDate.localeCompare(right.attendanceDate));
  if (!days.length) return '';

  const items = days.map((entry) => {
    const date = new Date(`${entry.attendanceDate}T12:00:00`);
    const tone = dayTone(entry, todayIso);
    const weekday = date.toLocaleDateString(getLocale(), { weekday: 'short' });
    const detail = [
      date.toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' }),
      entry.row?.check_in_time ? `${formatTime(entry.row.check_in_time)} → ${entry.row.check_out_time ? formatTime(entry.row.check_out_time) : '…'}` : '',
      entry.outcomeLabel,
    ].filter(Boolean).join(' · ');
    return `
      <li>
        <button type="button" class="day-pill tone-${tone}${entry.attendanceDate === todayIso ? ' is-today' : ''}" data-day-detail="${escapeHtml(detail)}" aria-label="${escapeHtml(detail)}">
          <span>${escapeHtml(weekday)}</span>
          <strong>${escapeHtml(String(date.getDate()))}</strong>
          <i aria-hidden="true"></i>
        </button>
      </li>
    `;
  }).join('');

  return `
    <section class="emp-card month-strip-card">
      <div class="emp-card-head">
        <h3>${escapeHtml(t('mobile.month.stripTitle'))}</h3>
      </div>
      <ol class="month-strip" data-month-strip>${items}</ol>
      <p class="day-detail" data-day-detail-output aria-live="polite"></p>
      <div class="strip-legend">
        <span class="tone-full"><i></i>${escapeHtml(t('mobile.month.legendFull'))}</span>
        <span class="tone-late"><i></i>${escapeHtml(t('mobile.month.legendLate'))}</span>
        <span class="tone-absent"><i></i>${escapeHtml(t('mobile.month.legendAbsent'))}</span>
        <span class="tone-off"><i></i>${escapeHtml(t('mobile.month.legendOff'))}</span>
      </div>
    </section>
  `;
}

export function bindMonthStrip(root) {
  const strip = root.querySelector('[data-month-strip]');
  const output = root.querySelector('[data-day-detail-output]');
  if (!strip || !output) return;
  const select = (button) => {
    strip.querySelectorAll('.day-pill.selected').forEach((item) => item.classList.remove('selected'));
    button.classList.add('selected');
    output.textContent = button.dataset.dayDetail || '';
  };
  strip.addEventListener('click', (event) => {
    const button = event.target.closest('.day-pill');
    if (button) select(button);
  });
  const today = strip.querySelector('.is-today') || strip.lastElementChild?.querySelector('.day-pill');
  if (today) {
    select(today);
    // Today is the last day: scroll the strip (not the page) to its end. RTL scrolls negative.
    window.requestAnimationFrame(() => {
      const end = strip.scrollWidth - strip.clientWidth;
      strip.scrollLeft = document.documentElement.dir === 'rtl' ? -end : end;
    });
  }
}

export function statTileMarkup({ iconName, label, value, tone = 'brand' }) {
  return `
    <article class="stat-tile tone-${tone}">
      <span class="stat-tile-icon">${icon(iconName)}</span>
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </article>
  `;
}

export function rateRingMarkup(percent, label) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const safe = Math.max(0, Math.min(Number(percent) || 0, 100));
  return `
    <div class="rate-ring" role="img" aria-label="${escapeHtml(`${safe}% ${label}`)}">
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="${radius}" class="rate-ring-track"/>
        <circle cx="32" cy="32" r="${radius}" class="rate-ring-bar" stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${(circumference * (1 - safe / 100)).toFixed(2)}"/>
      </svg>
      <strong>${safe}%</strong>
    </div>
  `;
}

export function detailRowMarkup(label, value) {
  return `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function recordTone(row, metrics) {
  if (metrics.isOpenShift) return 'open';
  if (row.attendance_status === 'absent' && !row.check_in_time) return 'absent';
  if (row.attendance_status === 'late' || metrics.shortfallMinutes > 0) return 'late';
  return 'full';
}

// One attendance day as an expandable card (notes and place inside).
export function recordCardMarkup(row) {
  const metrics = buildAttendanceRowMetrics(row);
  const tone = recordTone(row, metrics);
  const date = new Date(`${row.attendance_date}T12:00:00`);
  const workedLabel = metrics.isOpenShift
    ? t('mobile.record.open')
    : t('mobile.record.worked', { duration: formatDuration(metrics.workedMinutes) });
  return `
    <details class="record-card tone-${tone}">
      <summary>
        <span class="record-date">
          <strong>${escapeHtml(String(date.getDate()))}</strong>
          <span>${escapeHtml(date.toLocaleDateString(getLocale(), { weekday: 'short' }))}</span>
        </span>
        <span class="record-main">
          <span class="record-times">
            <span class="record-time in">${icon('login')}${escapeHtml(formatTime(row.check_in_time))}</span>
            <span class="record-time out">${icon('logout')}${escapeHtml(row.check_out_time ? formatTime(row.check_out_time) : '—')}</span>
          </span>
          <span class="record-sub">${escapeHtml(workedLabel)} · ${escapeHtml(date.toLocaleDateString(getLocale(), { month: 'short', year: 'numeric' }))}</span>
        </span>
        <span class="badge ${escapeHtml(row.attendance_status)}">${escapeHtml(statusLabel(row.attendance_status))}</span>
      </summary>
      <div class="record-extra">
        <div class="record-extra-row">${icon('note')}<div><span>${escapeHtml(t('mobile.record.notes'))}</span><p>${escapeHtml(row.work_notes || t('mobile.record.noNotes'))}</p></div></div>
        ${row.work_place ? `<div class="record-extra-row">${icon('place')}<div><span>${escapeHtml(t('mobile.record.place'))}</span><p>${escapeHtml(row.work_place)}</p></div></div>` : ''}
      </div>
    </details>
  `;
}

export function recordListMarkup(rows, emptyText) {
  if (!rows.length) {
    return `<div class="emp-empty">${icon('calendar')}<p>${escapeHtml(emptyText)}</p></div>`;
  }
  return `<div class="record-list">${rows.map(recordCardMarkup).join('')}</div>`;
}

export function quotaCardMarkup({ iconName, title, used, limit, period, tone }) {
  const safeUsed = Math.max(0, Number(used) || 0);
  const percent = Math.min(safeUsed / Math.max(limit, 1), 1) * 100;
  return `
    <article class="quota-card tone-${tone}">
      <div class="quota-head">
        <span class="quota-icon">${icon(iconName)}</span>
        <span class="quota-left">${escapeHtml(t('mobile.requests.left', { count: String(Math.max(limit - safeUsed, 0)) }))}</span>
      </div>
      <strong class="quota-value"><bdi dir="ltr">${safeUsed}<small>/${limit}</small></bdi></strong>
      <span class="quota-title">${escapeHtml(title)}</span>
      <div class="quota-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${safeUsed}" aria-label="${escapeHtml(title)}"><i style="width:${percent.toFixed(1)}%"></i></div>
      <span class="quota-period">${escapeHtml(period)}</span>
    </article>
  `;
}

export function requestCardMarkup(item, { typeLabel, dateLabel, durationLabel }) {
  const isLeave = item.request_type === 'annual_leave';
  return `
    <article class="request-card status-${escapeHtml(item.status)}">
      <span class="request-icon ${isLeave ? 'leave' : 'delay'}">${icon(isLeave ? 'plane' : 'hourglass')}</span>
      <div class="request-body">
        <div class="request-top">
          <strong>${escapeHtml(typeLabel)}</strong>
          <span class="badge ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
        </div>
        <span class="request-dates">${icon('calendar')}${escapeHtml(dateLabel)} · ${escapeHtml(durationLabel)}</span>
        ${item.reason ? `<p class="request-reason">${escapeHtml(item.reason)}</p>` : ''}
        <span class="request-sent">${escapeHtml(t('mobile.requests.sent', { date: formatDate(item.created_at) }))}</span>
      </div>
    </article>
  `;
}

export function skeletonMarkup() {
  return `
    <div class="emp-skeleton" aria-busy="true">
      <div class="sk sk-hero"></div>
      <div class="sk-row"><div class="sk sk-tile"></div><div class="sk sk-tile"></div></div>
      <div class="sk sk-line"></div>
      <div class="sk sk-card"></div>
      <div class="sk sk-card"></div>
    </div>
  `;
}
