const LANGUAGE_KEY = 'evara-language';
const DEFAULT_LANGUAGE = 'en';
const RTL_LANGUAGES = new Set(['ar']);
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
      appTitle: 'إيفارا بي إن إس | نظام الحضور',
      checkinTitle: 'إيفارا بي إن إس | تسجيل الحضور',
      description: 'نظام إيفارا بي إن إس لإدارة الحضور والموظفين باستخدام Supabase.',
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
      title: 'سجّل حضورك من الهاتف خلال ثوانٍ.',
      copy: 'إذا لم تكن مسجل الدخول، سننقلك أولًا إلى صفحة الدخول الآمنة ثم نعيدك مباشرة.',
      statusLabel: 'حالة الحضور',
      loadingTitle: 'جارٍ التحقق من جلستك',
      loadingText: 'يرجى الانتظار بينما نقوم بتحميل حالة الحضور الخاصة بك.',
      loadingButton: 'جارٍ التحميل',
      today: 'اليوم',
      currentTime: 'الوقت الحالي',
      readyTitle: 'جاهز لتسجيل الحضور',
      readyText: 'لم يتم تسجيل حضورك بعد لهذا اليوم.',
      checkInNow: 'سجّل الحضور الآن',
      checkedInText: 'تم تسجيل الحضور في {{time}}. يمكنك تسجيل الانصراف عند نهاية يوم العمل.',
      checkOutNow: 'سجّل الانصراف الآن',
      completedTitle: 'اكتمل حضور اليوم',
      completedText: 'تم تسجيل الحضور في {{checkIn}} والانصراف في {{checkOut}}.',
      completedButton: 'اكتمل الحضور',
      signedInAs: 'تم تسجيل الدخول باسم {{name}}{{department}}',
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
  const stored = window.localStorage.getItem(LANGUAGE_KEY);
  return stored && stored in dictionaries ? stored : DEFAULT_LANGUAGE;
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
  const nextLanguage = language in dictionaries ? language : DEFAULT_LANGUAGE;
  window.localStorage.setItem(LANGUAGE_KEY, nextLanguage);
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
    button.textContent = isArabic() ? t('language.switchToEnglish') : t('language.switchToArabic');
    button.setAttribute('aria-label', t('language.switch'));
    button.setAttribute('title', t('language.switch'));
  });
}

export function applyDocumentLanguage() {
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
