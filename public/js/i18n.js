const LANGUAGE_KEY = 'evara-language';
const DEFAULT_LANGUAGE = 'en';
const RTL_LANGUAGES = new Set(['ar']);
const LANGUAGE_SWITCH_ENABLED = false;
const subscribers = new Set();

const dictionaries = {
  en: {
    meta: {
      appTitle: 'EVARA BNS | Attendance System',
      checkinTitle: 'EVARA BNS | Check In',
      description: 'EVARA BNS attendance and employee operations powered by Supabase.',
    },
    language: {
      english: 'English',
      arabic: 'Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©',
      switch: 'Switch language',
      switchToEnglish: 'English',
      switchToArabic: 'Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©',
    },
    common: {
      success: 'Success',
      notice: 'Notice',
      actionNeeded: 'Action needed',
      close: 'Close',
      menu: 'Menu',
      requestFailed: 'Request failed',
      openDashboard: 'Open Dashboard',
      unableToLoadSection: 'Unable to load this section.',
    },
    login: {
      heroLine1: 'Good morning!',
      heroLine2: 'A new day is here',
      heroLine3: 'make the most of it',
      heroLine4: 'and keep smiling.',
      emailLabel: 'Email Address',
      emailPlaceholder: 'name@company.com',
      passwordLabel: 'Password',
      passwordPlaceholder: 'Enter your password',
      signIn: 'Sign In',
      signingIn: 'Signing in',
      unableToSignIn: 'Unable to sign in',
      showPassword: 'Show',
      hidePassword: 'Hide',
    },
    nav: {
      dashboard: 'Dashboard',
      profile: 'Profile',
      employees: 'Employees',
      attendance: 'Attendance',
      history: 'History',
      reports: 'Reports',
      qr: 'QR Access',
      logout: 'Log out',
    },
    topbar: {
      preCheckInHeadline: 'Good morning, begin your day with calm focus and clear confidence.',
      preCheckInSubline: 'A strong start creates a productive day and better results.',
      inShiftHeadline: 'You are doing well, so keep your rhythm steady and your energy clear.',
      inShiftSubline: 'Stay focused, keep moving, and let the day work in your favor.',
      afterCheckOutHeadline: 'Excellent finish today, your effort made a real difference.',
      afterCheckOutSubline: 'Recharge well and come back tomorrow ready for another strong win.',
    },
    checkin: {
      eyebrow: 'Quick Attendance',
      title: 'Check in from your phone in seconds.',
      copy: 'If you are not signed in, we will send you to the secure login page first and bring you right back.',
      statusLabel: 'Attendance status',
      loadingTitle: 'Checking your session',
      loadingText: 'Please wait while we load your attendance state.',
      loadingButton: 'Loading',
      today: 'Today',
      currentTime: 'Current time',
      readyTitle: 'Ready to check in',
      readyText: 'Your attendance has not been recorded yet for today.',
      checkInNow: 'Check In Now',
      checkedInText: 'Checked in at {{time}}. You can check out when your workday ends.',
      checkOutNow: 'Check Out Now',
      completedTitle: 'Completed for today',
      completedText: 'Checked in at {{checkIn}} and checked out at {{checkOut}}.',
      completedButton: 'Attendance Completed',
      signedInAs: 'Signed in as {{name}}{{department}}',
      configurationRequired: 'Configuration required',
      configurationText: 'This page cannot connect to Supabase until the runtime configuration is available.',
      configurationMissing: 'Supabase configuration is missing. Set SUPABASE_URL and SUPABASE_ANON_KEY first.',
      unableToContinue: 'Unable to continue',
      returnDashboard: 'Please return to the dashboard and try again.',
      unableProfile: 'Unable to load your profile',
      unableAttendance: 'Unable to load attendance',
      checkinLoading: 'Checking In',
      checkoutLoading: 'Checking Out',
      loginRedirect: '/?next=checkin',
    },
    labels: {
      unassigned: 'Unassigned',
      unknown: 'Unknown',
      admin: 'Admin',
      employee: 'Employee',
      active: 'Active',
      inactive: 'Inactive',
      on_leave: 'On Leave',
      present: 'Present',
      absent: 'Absent',
      late: 'Late',
      checked_out: 'Checked Out',
    },
  },
  ar: {
    meta: {
      appTitle: 'Ø¥ÙŠÙØ§Ø±Ø§ Ø¨ÙŠ Ø¥Ù† Ø¥Ø³ | Ù†Ø¸Ø§Ù… Ø§Ù„Ø­Ø¶ÙˆØ±',
      checkinTitle: 'Ø¥ÙŠÙØ§Ø±Ø§ Ø¨ÙŠ Ø¥Ù† Ø¥Ø³ | ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø­Ø¶ÙˆØ±',
      description: 'Ù†Ø¸Ø§Ù… Ø¥ÙŠÙØ§Ø±Ø§ Ø¨ÙŠ Ø¥Ù† Ø¥Ø³ Ù„Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ø­Ø¶ÙˆØ± ÙˆØ§Ù„Ù…ÙˆØ¸ÙÙŠÙ† Ø¨Ø§Ø³ØªØ®Ø¯Ø§Ù… Supabase.',
    },
    language: {
      english: 'English',
      arabic: 'Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©',
      switch: 'ØªØ¨Ø¯ÙŠÙ„ Ø§Ù„Ù„ØºØ©',
      switchToEnglish: 'English',
      switchToArabic: 'Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©',
    },
    common: {
      success: 'ØªÙ… Ø¨Ù†Ø¬Ø§Ø­',
      notice: 'ØªÙ†Ø¨ÙŠÙ‡',
      actionNeeded: 'Ø¥Ø¬Ø±Ø§Ø¡ Ù…Ø·Ù„ÙˆØ¨',
      close: 'Ø¥ØºÙ„Ø§Ù‚',
      menu: 'Ø§Ù„Ù‚Ø§Ø¦Ù…Ø©',
      requestFailed: 'ÙØ´Ù„ Ø§Ù„Ø·Ù„Ø¨',
      openDashboard: 'ÙØªØ­ Ù„ÙˆØ­Ø© Ø§Ù„ØªØ­ÙƒÙ…',
      unableToLoadSection: 'ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ù‡Ø°Ø§ Ø§Ù„Ù‚Ø³Ù….',
    },
    login: {
      heroLine1: 'ØµØ¨Ø§Ø­ Ø§Ù„Ø®ÙŠØ±!',
      heroLine2: 'ÙŠÙˆÙ… Ø¬Ø¯ÙŠØ¯ Ù‚Ø¯ Ø¨Ø¯Ø£',
      heroLine3: 'Ø§Ø³ØªØ«Ù…Ø±Ù‡ Ø¨Ø£ÙØ¶Ù„ Ø´ÙƒÙ„',
      heroLine4: 'ÙˆØ§Ø¨Ù‚ÙŽ Ù…Ø¨ØªØ³Ù…Ù‹Ø§.',
      emailLabel: 'Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ',
      emailPlaceholder: 'name@company.com',
      passwordLabel: 'ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ±',
      passwordPlaceholder: 'Ø£Ø¯Ø®Ù„ ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ±',
      signIn: 'ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„',
      signingIn: 'Ø¬Ø§Ø±Ù ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„',
      unableToSignIn: 'ØªØ¹Ø°Ø± ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„',
      showPassword: 'Ø¥Ø¸Ù‡Ø§Ø±',
      hidePassword: 'Ø¥Ø®ÙØ§Ø¡',
    },
    nav: {
      dashboard: 'Ù„ÙˆØ­Ø© Ø§Ù„ØªØ­ÙƒÙ…',
      profile: 'Ø§Ù„Ù…Ù„Ù Ø§Ù„Ø´Ø®ØµÙŠ',
      employees: 'Ø§Ù„Ù…ÙˆØ¸ÙÙˆÙ†',
      attendance: 'Ø§Ù„Ø­Ø¶ÙˆØ±',
      history: 'Ø§Ù„Ø³Ø¬Ù„',
      reports: 'Ø§Ù„ØªÙ‚Ø§Ø±ÙŠØ±',
      qr: 'Ø§Ù„ÙˆØµÙˆÙ„ Ø¹Ø¨Ø± QR',
      logout: 'ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø®Ø±ÙˆØ¬',
    },
    topbar: {
      preCheckInHeadline: 'ØµØ¨Ø§Ø­ Ø¬Ù…ÙŠÙ„ØŒ Ø§Ø¨Ø¯Ø£ ÙŠÙˆÙ…Ùƒ Ø¨ØªØ±ÙƒÙŠØ² Ù‡Ø§Ø¯Ø¦ ÙˆØ«Ù‚Ø© ÙˆØ§Ø¶Ø­Ø©.',
      preCheckInSubline: 'Ø§Ù„Ø¨Ø¯Ø§ÙŠØ© Ø§Ù„Ù‚ÙˆÙŠØ© ØªØµÙ†Ø¹ ÙŠÙˆÙ…Ù‹Ø§ Ø£ÙƒØ«Ø± Ø¥Ù†ØªØ§Ø¬Ù‹Ø§ ÙˆÙ†ØªØ§Ø¦Ø¬ Ø£ÙØ¶Ù„.',
      inShiftHeadline: 'Ø£Ù†Øª ØªØ³ÙŠØ± Ø¨Ø´ÙƒÙ„ Ù…Ù…ØªØ§Ø²ØŒ Ø­Ø§ÙØ¸ Ø¹Ù„Ù‰ Ø¥ÙŠÙ‚Ø§Ø¹Ùƒ ÙˆØªØ±ÙƒÙŠØ²Ùƒ.',
      inShiftSubline: 'Ø§Ø³ØªÙ…Ø± Ø¨Ø«Ø¨Ø§Øª ÙˆØ¯Ø¹ ÙŠÙˆÙ…Ùƒ ÙŠØ¹Ù…Ù„ Ù„ØµØ§Ù„Ø­Ùƒ Ø®Ø·ÙˆØ© Ø¨Ø®Ø·ÙˆØ©.',
      afterCheckOutHeadline: 'Ø£Ø­Ø³Ù†Øª Ø§Ù„ÙŠÙˆÙ…ØŒ Ù„Ù‚Ø¯ Ø£Ù†Ù‡ÙŠØª ÙŠÙˆÙ…Ùƒ Ø¨Ø´ÙƒÙ„ Ù‚ÙˆÙŠ ÙˆÙ…Ø¤Ø«Ø±.',
      afterCheckOutSubline: 'Ø®Ø° Ù‚Ø³Ø·Ù‹Ø§ Ù…Ù† Ø§Ù„Ø±Ø§Ø­Ø© ÙˆØ¹Ø¯ ØºØ¯Ù‹Ø§ Ø¨Ø·Ø§Ù‚Ø© Ø¬Ø¯ÙŠØ¯Ø© ÙˆØ¨Ø¯Ø§ÙŠØ© Ù‚ÙˆÙŠØ©.',
    },
    checkin: {
      eyebrow: 'Ø­Ø¶ÙˆØ± Ø³Ø±ÙŠØ¹',
      title: 'Ø³Ø¬Ù‘Ù„ Ø­Ø¶ÙˆØ±Ùƒ Ù…Ù† Ø§Ù„Ù‡Ø§ØªÙ Ø®Ù„Ø§Ù„ Ø«ÙˆØ§Ù†Ù.',
      copy: 'Ø¥Ø°Ø§ Ù„Ù… ØªÙƒÙ† Ù…Ø³Ø¬Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ØŒ Ø³Ù†Ù†Ù‚Ù„Ùƒ Ø£ÙˆÙ„Ù‹Ø§ Ø¥Ù„Ù‰ ØµÙØ­Ø© Ø§Ù„Ø¯Ø®ÙˆÙ„ Ø§Ù„Ø¢Ù…Ù†Ø© Ø«Ù… Ù†Ø¹ÙŠØ¯Ùƒ Ù…Ø¨Ø§Ø´Ø±Ø©.',
      statusLabel: 'Ø­Ø§Ù„Ø© Ø§Ù„Ø­Ø¶ÙˆØ±',
      loadingTitle: 'Ø¬Ø§Ø±Ù Ø§Ù„ØªØ­Ù‚Ù‚ Ù…Ù† Ø¬Ù„Ø³ØªÙƒ',
      loadingText: 'ÙŠØ±Ø¬Ù‰ Ø§Ù„Ø§Ù†ØªØ¸Ø§Ø± Ø¨ÙŠÙ†Ù…Ø§ Ù†Ù‚ÙˆÙ… Ø¨ØªØ­Ù…ÙŠÙ„ Ø­Ø§Ù„Ø© Ø§Ù„Ø­Ø¶ÙˆØ± Ø§Ù„Ø®Ø§ØµØ© Ø¨Ùƒ.',
      loadingButton: 'Ø¬Ø§Ø±Ù Ø§Ù„ØªØ­Ù…ÙŠÙ„',
      today: 'Ø§Ù„ÙŠÙˆÙ…',
      currentTime: 'Ø§Ù„ÙˆÙ‚Øª Ø§Ù„Ø­Ø§Ù„ÙŠ',
      readyTitle: 'Ø¬Ø§Ù‡Ø² Ù„ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø­Ø¶ÙˆØ±',
      readyText: 'Ù„Ù… ÙŠØªÙ… ØªØ³Ø¬ÙŠÙ„ Ø­Ø¶ÙˆØ±Ùƒ Ø¨Ø¹Ø¯ Ù„Ù‡Ø°Ø§ Ø§Ù„ÙŠÙˆÙ….',
      checkInNow: 'Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø­Ø¶ÙˆØ± Ø§Ù„Ø¢Ù†',
      checkedInText: 'ØªÙ… ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø­Ø¶ÙˆØ± ÙÙŠ {{time}}. ÙŠÙ…ÙƒÙ†Ùƒ ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø§Ù†ØµØ±Ø§Ù Ø¹Ù†Ø¯ Ù†Ù‡Ø§ÙŠØ© ÙŠÙˆÙ… Ø§Ù„Ø¹Ù…Ù„.',
      checkOutNow: 'Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø§Ù†ØµØ±Ø§Ù Ø§Ù„Ø¢Ù†',
      completedTitle: 'Ø§ÙƒØªÙ…Ù„ Ø­Ø¶ÙˆØ± Ø§Ù„ÙŠÙˆÙ…',
      completedText: 'ØªÙ… ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø­Ø¶ÙˆØ± ÙÙŠ {{checkIn}} ÙˆØ§Ù„Ø§Ù†ØµØ±Ø§Ù ÙÙŠ {{checkOut}}.',
      completedButton: 'Ø§ÙƒØªÙ…Ù„ Ø§Ù„Ø­Ø¶ÙˆØ±',
      signedInAs: 'ØªÙ… ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ø¨Ø§Ø³Ù… {{name}}{{department}}',
      configurationRequired: 'Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯ Ù…Ø·Ù„ÙˆØ¨',
      configurationText: 'Ù„Ø§ ÙŠÙ…ÙƒÙ† Ù„Ù‡Ø°Ù‡ Ø§Ù„ØµÙØ­Ø© Ø§Ù„Ø§ØªØµØ§Ù„ Ø¨Ù€ Supabase Ø­ØªÙ‰ ØªØªÙˆÙØ± Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„ØªØ´ØºÙŠÙ„.',
      configurationMissing: 'Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Supabase ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©. Ø£Ø¶Ù SUPABASE_URL ÙˆSUPABASE_ANON_KEY Ø£ÙˆÙ„Ù‹Ø§.',
      unableToContinue: 'ØªØ¹Ø°Ø± Ø§Ù„Ù…ØªØ§Ø¨Ø¹Ø©',
      returnDashboard: 'ÙŠØ±Ø¬Ù‰ Ø§Ù„Ø¹ÙˆØ¯Ø© Ø¥Ù„Ù‰ Ù„ÙˆØ­Ø© Ø§Ù„ØªØ­ÙƒÙ… ÙˆØ§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ù…Ø±Ø© Ø£Ø®Ø±Ù‰.',
      unableProfile: 'ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ù…Ù„ÙÙƒ Ø§Ù„Ø´Ø®ØµÙŠ',
      unableAttendance: 'ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ø¶ÙˆØ±',
      checkinLoading: 'Ø¬Ø§Ø±Ù ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø­Ø¶ÙˆØ±',
      checkoutLoading: 'Ø¬Ø§Ø±Ù ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø§Ù†ØµØ±Ø§Ù',
      loginRedirect: '/?next=checkin',
    },
    labels: {
      unassigned: 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯',
      unknown: 'ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙ',
      admin: 'Ù…Ø¯ÙŠØ±',
      employee: 'Ù…ÙˆØ¸Ù',
      active: 'Ù†Ø´Ø·',
      inactive: 'ØºÙŠØ± Ù†Ø´Ø·',
      on_leave: 'ÙÙŠ Ø¥Ø¬Ø§Ø²Ø©',
      present: 'Ø­Ø§Ø¶Ø±',
      absent: 'ØºØ§Ø¦Ø¨',
      late: 'Ù…ØªØ£Ø®Ø±',
      checked_out: 'ØªÙ… Ø§Ù„Ø§Ù†ØµØ±Ø§Ù',
    },
  },
};

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

export function getCurrentLanguage() {
  return DEFAULT_LANGUAGE;
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

export function setCurrentLanguage(language) {
  const nextLanguage = LANGUAGE_SWITCH_ENABLED && language in dictionaries ? language : DEFAULT_LANGUAGE;
  window.localStorage.setItem(LANGUAGE_KEY, nextLanguage);
  applyDocumentLanguage();
  subscribers.forEach((callback) => callback(nextLanguage));
  return nextLanguage;
}

export function toggleLanguage() {
  return setCurrentLanguage(DEFAULT_LANGUAGE);
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
    button.hidden = !LANGUAGE_SWITCH_ENABLED;
    button.disabled = !LANGUAGE_SWITCH_ENABLED;
    button.setAttribute('aria-hidden', String(!LANGUAGE_SWITCH_ENABLED));
    button.textContent = isArabic() ? t('language.switchToEnglish') : t('language.switchToArabic');
    button.setAttribute('aria-label', t('language.switch'));
    button.setAttribute('title', t('language.switch'));
  });
}

export function applyDocumentLanguage() {
  window.localStorage.setItem(LANGUAGE_KEY, DEFAULT_LANGUAGE);
  const language = getCurrentLanguage();
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


