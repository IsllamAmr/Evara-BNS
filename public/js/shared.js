import { getLocale, t } from './i18n.js';

export const BUSINESS_TIME_ZONE = 'Africa/Cairo';
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function parseDateOnly(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);

  if (date.getFullYear() !== year || date.getMonth() !== (month - 1) || date.getDate() !== day) {
    return null;
  }

  return date;
}

function normalizeDate(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (value instanceof Date) {
    return isValidDate(value) ? new Date(value.getTime()) : null;
  }

  if (typeof value === 'string' && DATE_ONLY_PATTERN.test(value.trim())) {
    return parseDateOnly(value);
  }

  const date = new Date(value);
  return isValidDate(date) ? date : null;
}

function datePartsInTimeZone(value, timeZone = BUSINESS_TIME_ZONE) {
  const date = normalizeDate(value);
  if (!date) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    return null;
  }

  return { year, month, day };
}

export function formatDateInput(value, timeZone = BUSINESS_TIME_ZONE) {
  if (typeof value === 'string' && DATE_ONLY_PATTERN.test(value.trim())) {
    return value.trim();
  }

  const parts = datePartsInTimeZone(value, timeZone);
  if (!parts) {
    return '';
  }

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function todayIso(timeZone = BUSINESS_TIME_ZONE) {
  return formatDateInput(new Date(), timeZone);
}

export function currentMonthInput(timeZone = BUSINESS_TIME_ZONE) {
  const parts = datePartsInTimeZone(new Date(), timeZone);
  return parts ? `${parts.year}-${parts.month}` : '';
}

export function offsetDate(days, timeZone = BUSINESS_TIME_ZONE) {
  const base = parseDateOnly(todayIso(timeZone));
  if (!base) {
    return '';
  }

  base.setDate(base.getDate() + Number(days || 0));
  return formatDateInput(base, timeZone);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDate(value) {
  const date = normalizeDate(value);
  if (!date) {
    return '-';
  }

  return new Intl.DateTimeFormat(getLocale(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatTime(value) {
  const date = normalizeDate(value);
  if (!date) {
    return '-';
  }

  return new Intl.DateTimeFormat(getLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function formatDateTime(value) {
  const date = normalizeDate(value);
  if (!date) {
    return '-';
  }

  return new Intl.DateTimeFormat(getLocale(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function departmentLabel(value) {
  return value || t('labels.unassigned');
}

export function statusLabel(value) {
  if (!value) {
    return t('labels.unknown');
  }

  const translated = t(`labels.${value}`);
  if (translated !== `labels.${value}`) {
    return translated;
  }

  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function roleLabel(value) {
  return value === 'admin' ? t('labels.admin') : t('labels.employee');
}

export function toInitials(value) {
  const text = String(value || '').trim();
  if (!text) {
    return 'EV';
  }

  const parts = text.split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('');
}

export function isStrongPassword(value) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(String(value || ''));
}
