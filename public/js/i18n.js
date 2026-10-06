const LANGUAGE_KEY = 'evara-language';
const DEFAULT_LANGUAGE = 'ar';
const RTL_LANGUAGES = new Set(['ar']);
const LANGUAGE_SWITCH_ENABLED = true;
const subscribers = new Set();

import en from './locales/en.js';

// Only English ships with the page. Other languages are fetched the first time
// they are needed (see ensureLanguageLoaded), so employees never download Arabic.
const dictionaries = { en };
const availableLanguages = new Set(['en', 'ar']);
const loadingLanguages = new Map();

export function ensureLanguageLoaded(language) {
  const lang = availableLanguages.has(language) ? language : DEFAULT_LANGUAGE;
  if (dictionaries[lang]) return Promise.resolve(lang);
  if (!loadingLanguages.has(lang)) {
    loadingLanguages.set(lang, import(`./locales/${lang}.js`)
      .then((module) => { dictionaries[lang] = module.default; return lang; })
      .finally(() => loadingLanguages.delete(lang)));
  }
  return loadingLanguages.get(lang);
}

function normalizeLanguage(language) {
  return availableLanguages.has(language) ? language : DEFAULT_LANGUAGE;
}

function getStoredLanguage() {
  try {
    return normalizeLanguage(window.localStorage.getItem(LANGUAGE_KEY));
  } catch (_error) {
    return DEFAULT_LANGUAGE;
  }
}

function persistLanguage(language) {
  try {
    window.localStorage.setItem(LANGUAGE_KEY, language);
  } catch (_error) {
    // Ignore storage failures in private browsing or restricted environments.
  }
}

function getNestedValue(object, key) {
  return String(key || '')
    .split('.')
    .reduce((current, part) => (current && part in current ? current[part] : undefined), object);
}

function interpolate(template, variables = {}) {
  return String(template).replace(/\{\{(.*?)\}\}/g, (_match, rawKey) => {
    const key = rawKey.trim();
    return variables[key] ?? '';
  });
}

// Arabic is offered to admins only. Every page starts locked to English (sign-in,
// QR check-in, password recovery, employee screens); app.js lifts the lock once an
// admin signs in. The admin's saved choice is left untouched while locked.
let lockedLanguage = 'en';

export function setLanguageLock(language) {
  lockedLanguage = language ? normalizeLanguage(language) : null;
}

export function getCurrentLanguage() {
  return lockedLanguage || getStoredLanguage();
}

export function isArabic() {
  return getCurrentLanguage() === 'ar';
}

export function getLocale() {
  return isArabic() ? 'ar-EG' : 'en-GB';
}

export function t(key, variables = {}) {
  const language = getCurrentLanguage();
  const value = getNestedValue(dictionaries[language], key) ?? getNestedValue(dictionaries.en, key) ?? key;
  return interpolate(value, variables);
}

export async function setCurrentLanguage(language) {
  if (lockedLanguage) {
    return lockedLanguage;
  }
  const nextLanguage = LANGUAGE_SWITCH_ENABLED ? normalizeLanguage(language) : DEFAULT_LANGUAGE;
  await ensureLanguageLoaded(nextLanguage);
  persistLanguage(nextLanguage);
  applyDocumentLanguage();
  subscribers.forEach((callback) => callback(nextLanguage));
  return nextLanguage;
}

export function toggleLanguage() {
  return setCurrentLanguage(isArabic() ? 'en' : 'ar');
}

export function onLanguageChange(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });

  root.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
  });

  root.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  });
}

export function syncLanguageToggleButtons(root = document) {
  root.querySelectorAll('[data-language-toggle]').forEach((button) => {
    const unavailable = !LANGUAGE_SWITCH_ENABLED || Boolean(lockedLanguage);
    button.hidden = unavailable;
    button.disabled = unavailable;
    button.setAttribute('aria-hidden', String(unavailable));
    button.textContent = isArabic() ? t('language.switchToEnglish') : t('language.switchToArabic');
    button.setAttribute('aria-label', t('language.switch'));
    button.setAttribute('title', t('language.switch'));
  });
}

export function applyDocumentLanguage() {
  const language = getCurrentLanguage();
  if (!lockedLanguage) {
    persistLanguage(language);
  }

  const titleKey = window.location.pathname.includes('/checkin') ? 'meta.checkinTitle' : 'meta.appTitle';
  document.documentElement.lang = language;
  document.documentElement.dir = RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
  document.title = t(titleKey);

  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.setAttribute('content', t('meta.description'));
  }

  applyTranslations(document);
  syncLanguageToggleButtons(document);
}
