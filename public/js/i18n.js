const LANGUAGE_KEY = 'evara-language';
const DEFAULT_LANGUAGE = 'en';
const RTL_LANGUAGES = new Set(['ar']);
const LANGUAGE_SWITCH_ENABLED = true;
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
      arabic: 'العربية',
      switch: 'Switch language',
      switchToEnglish: 'English',
      switchToArabic: 'العربية',
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
      title: 'Quick mobile attendance.',
      copy: 'Sign in once, then check in or out instantly.',
      heroReadyTitle: 'Start your morning with calm focus.',
      heroReadyText: 'Check in when you are ready and begin your day with clear confidence.',
      heroCheckedInTitle: 'Good morning. Your day has started beautifully.',
      heroCheckedInText: 'Keep your focus, move with calm energy, and enjoy a productive day.',
      heroCompletedTitle: 'Excellent work today. You finished strong.',
      heroCompletedText: 'Take your rest with pride and come back tomorrow ready for more.',
      heroUnavailableTitle: 'We could not prepare this page right now.',
      heroUnavailableText: 'Return to the dashboard, refresh the session, and try again in a moment.',
      statusLabel: 'Attendance status',
      loadingTitle: 'Checking your session',
      loadingText: 'Please wait while we load your attendance state.',
      loadingButton: 'Loading',
      today: 'Today',
      currentTime: 'Current time',
      readyTitle: 'Ready for check-in',
      readyText: 'Tap below and we will record your arrival in seconds.',
      readyBadge: 'Ready',
      checkedInBadge: 'Checked In',
      completedBadge: 'Completed',
      checkInNow: 'Check In Now',
      checkedInTitle: 'Checked in for today',
      checkedInText: 'Your arrival was recorded at {{time}}. Check out when your workday ends.',
      checkOutNow: 'Check Out Now',
      completedTitle: 'Today completed successfully',
      completedText: 'Your attendance for today is already closed.',
      completedButton: 'Attendance Completed',
      signedInAs: 'Signed in as {{name}}{{department}}',
      checkInTimeLabel: 'Check In',
      checkOutTimeLabel: 'Check Out',
      statusSummaryLabel: 'Status',
      refreshStatus: 'Refresh Status',
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
      appTitle: 'EVARA BNS | نظام الحضور',
      checkinTitle: 'EVARA BNS | تسجيل الحضور',
      description: 'نظام EVARA BNS لإدارة الحضور والموظفين باستخدام Supabase.',
    },
    language: {
      english: 'English',
      arabic: 'العربية',
      switch: 'تبديل اللغة',
      switchToEnglish: 'English',
      switchToArabic: 'العربية',
    },
    common: {
      success: 'تم بنجاح',
      notice: 'تنبيه',
      actionNeeded: 'إجراء مطلوب',
      close: 'إغلاق',
      menu: 'القائمة',
      requestFailed: 'فشل الطلب',
      openDashboard: 'فتح لوحة التحكم',
      unableToLoadSection: 'تعذر تحميل هذا القسم.',
    },
    login: {
      heroLine1: 'صباح الخير!',
      heroLine2: 'يوم جديد قد بدأ',
      heroLine3: 'استثمره بأفضل شكل',
      heroLine4: 'وابقَ مبتسمًا.',
      emailLabel: 'البريد الإلكتروني',
      emailPlaceholder: 'name@company.com',
      passwordLabel: 'كلمة المرور',
      passwordPlaceholder: 'أدخل كلمة المرور',
      signIn: 'تسجيل الدخول',
      signingIn: 'جارٍ تسجيل الدخول',
      unableToSignIn: 'تعذر تسجيل الدخول',
      showPassword: 'إظهار',
      hidePassword: 'إخفاء',
    },
    nav: {
      dashboard: 'لوحة التحكم',
      profile: 'الملف الشخصي',
      employees: 'الموظفون',
      attendance: 'الحضور',
      history: 'السجل',
      reports: 'التقارير',
      qr: 'الوصول عبر QR',
      logout: 'تسجيل الخروج',
    },
    topbar: {
      preCheckInHeadline: 'صباح جميل، ابدأ يومك بتركيز هادئ وثقة واضحة.',
      preCheckInSubline: 'البداية القوية تصنع يومًا أكثر إنتاجًا ونتائج أفضل.',
      inShiftHeadline: 'أنت تسير بشكل ممتاز، حافظ على إيقاعك وتركيزك.',
      inShiftSubline: 'استمر بثبات ودع يومك يعمل لصالحك خطوة بخطوة.',
      afterCheckOutHeadline: 'أحسنت اليوم، لقد أنهيت يومك بشكل قوي ومؤثر.',
      afterCheckOutSubline: 'خذ قسطًا من الراحة وعد غدًا بطاقة جديدة وبداية قوية.',
    },
    checkin: {
      eyebrow: 'حضور سريع',
      title: 'تسجيل حضور سريع من الهاتف.',
      copy: 'سجّل الدخول مرة واحدة ثم سجّل الحضور أو الانصراف فورًا.',
      heroReadyTitle: 'ابدأ صباحك بتركيز هادئ.',
      heroReadyText: 'سجّل حضورك عندما تكون جاهزًا وابدأ يومك بثقة ووضوح.',
      heroCheckedInTitle: 'صباح الخير. لقد بدأ يومك بشكل جميل.',
      heroCheckedInText: 'حافظ على تركيزك وتحرك بهدوء واستمتع بيوم منتج.',
      heroCompletedTitle: 'أحسنت اليوم. لقد أنهيت يومك بقوة.',
      heroCompletedText: 'خذ راحتك بفخر وعد غدًا مستعدًا ليوم جديد.',
      heroUnavailableTitle: 'تعذر تجهيز هذه الصفحة الآن.',
      heroUnavailableText: 'ارجع إلى لوحة التحكم وحدّث الجلسة ثم حاول مرة أخرى.',
      statusLabel: 'حالة الحضور',
      loadingTitle: 'جارٍ التحقق من الجلسة',
      loadingText: 'يرجى الانتظار بينما نقوم بتحميل حالة الحضور الخاصة بك.',
      loadingButton: 'جارٍ التحميل',
      today: 'اليوم',
      currentTime: 'الوقت الحالي',
      readyTitle: 'جاهز لتسجيل الحضور',
      readyText: 'اضغط بالأسفل وسنسجّل حضورك خلال ثوانٍ.',
      readyBadge: 'جاهز',
      checkedInBadge: 'تم الحضور',
      completedBadge: 'مكتمل',
      checkInNow: 'سجّل الحضور الآن',
      checkedInTitle: 'تم تسجيل حضور اليوم',
      checkedInText: 'تم تسجيل حضورك في {{time}}. يمكنك تسجيل الانصراف عند نهاية يوم العمل.',
      checkOutNow: 'سجّل الانصراف الآن',
      completedTitle: 'اكتمل حضور اليوم بنجاح',
      completedText: 'تم إغلاق حضورك لهذا اليوم بالفعل.',
      completedButton: 'اكتمل الحضور',
      signedInAs: 'تم تسجيل الدخول باسم {{name}}{{department}}',
      checkInTimeLabel: 'وقت الحضور',
      checkOutTimeLabel: 'وقت الانصراف',
      statusSummaryLabel: 'الحالة',
      refreshStatus: 'تحديث الحالة',
      configurationRequired: 'الإعداد مطلوب',
      configurationText: 'لا يمكن لهذه الصفحة الاتصال بـ Supabase حتى تتوفر إعدادات التشغيل.',
      configurationMissing: 'إعدادات Supabase غير موجودة. أضف SUPABASE_URL وSUPABASE_ANON_KEY أولًا.',
      unableToContinue: 'تعذر المتابعة',
      returnDashboard: 'يرجى العودة إلى لوحة التحكم والمحاولة مرة أخرى.',
      unableProfile: 'تعذر تحميل ملفك الشخصي',
      unableAttendance: 'تعذر تحميل بيانات الحضور',
      checkinLoading: 'جارٍ تسجيل الحضور',
      checkoutLoading: 'جارٍ تسجيل الانصراف',
      loginRedirect: '/?next=checkin',
    },
    labels: {
      unassigned: 'غير محدد',
      unknown: 'غير معروف',
      admin: 'مدير',
      employee: 'موظف',
      active: 'نشط',
      inactive: 'غير نشط',
      on_leave: 'في إجازة',
      present: 'حاضر',
      absent: 'غائب',
      late: 'متأخر',
      checked_out: 'تم الانصراف',
    },
  },
};

function normalizeLanguage(language) {
  return Object.prototype.hasOwnProperty.call(dictionaries, language) ? language : DEFAULT_LANGUAGE;
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

export function getCurrentLanguage() {
  return getStoredLanguage();
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
  const nextLanguage = LANGUAGE_SWITCH_ENABLED ? normalizeLanguage(language) : DEFAULT_LANGUAGE;
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
    button.hidden = !LANGUAGE_SWITCH_ENABLED;
    button.disabled = !LANGUAGE_SWITCH_ENABLED;
    button.setAttribute('aria-hidden', String(!LANGUAGE_SWITCH_ENABLED));
    button.textContent = isArabic() ? t('language.switchToEnglish') : t('language.switchToArabic');
    button.setAttribute('aria-label', t('language.switch'));
    button.setAttribute('title', t('language.switch'));
  });
}

export function applyDocumentLanguage() {
  const language = getCurrentLanguage();
  persistLanguage(language);

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
