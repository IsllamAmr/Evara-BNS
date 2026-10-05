import { getCurrentLanguage, onLanguageChange, t } from './i18n.js';

// Original short sayings, paired by meaning. No external requests or attribution.
const QUOTES = [
  { ar: ['خطوة صغيرة اليوم،', 'فرق كبير غدًا.'], en: ['Small steps,', 'lasting progress.'] },
  { ar: ['ابدأ بتركيز،', 'واختم بإنجاز.'], en: ['Start with focus.', 'Finish with pride.'] },
  { ar: ['كل يوم فرصة', 'لتتقدم خطوة.'], en: ['Make today', 'count.'] },
  { ar: ['معًا، يصبح', 'الإنجاز أسهل.'], en: ['Better together,', 'every day.'] },
  { ar: ['تعلّم شيئًا،', 'وأتقن شيئًا.'], en: ['Learn something.', 'Build something.'] },
  { ar: ['جودة العمل', 'تبدأ بالاهتمام.'], en: ['Good work grows', 'with care.'] },
  { ar: ['هدف واضح،', 'وخطوة ثابتة.'], en: ['One clear goal.', 'One steady step.'] },
  { ar: ['احضر بشغف،', 'وانمُ كل يوم.'], en: ['Show up.', 'Keep growing.'] },
  { ar: ['جهد اليوم', 'يصنع فرق الغد.'], en: ["Today's effort,", "tomorrow's progress."] },
  { ar: ['داوم على السعي،', 'ودع النتائج تتحدث.'], en: ['Be consistent.', 'Let results speak.'] },
  { ar: ['قدّم أفضل ما عندك،', 'وساعد غيرك.'], en: ['Bring your best.', 'Help others shine.'] },
  { ar: ['كل صباح،', 'بداية جديدة.'], en: ['Every day,', 'a fresh chance.'] },
];
const INTERVAL_MS = 15_000;
const LAST_KEY = 'evara:quotes:last';
const PAUSED_KEY = 'evara:quotes:paused';

function readPreference(key) {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}

function savePreference(key, value) {
  try { window.sessionStorage.setItem(key, String(value)); } catch { /* Storage is optional. */ }
}

export function initRotatingQuotes() {
  const heading = document.querySelector('[data-rotating-quote]');
  const button = document.querySelector('[data-quote-toggle]');
  if (!heading || !button || heading.dataset.quotesReady) return;
  heading.dataset.quotesReady = 'true';
  const lines = heading.querySelectorAll('.quote-line');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const storedPaused = readPreference(PAUSED_KEY);
  let paused = reducedMotion.matches || storedPaused === 'true';
  let previous = Number(readPreference(LAST_KEY) ?? -1);
  let order = [];
  let timer;
  let animation;

  function nextIndex() {
    if (!order.length) {
      order = QUOTES.map((_quote, index) => index);
      for (let i = order.length - 1; i > 0; i--) {
        const other = Math.floor(Math.random() * (i + 1));
        [order[i], order[other]] = [order[other], order[i]];
      }
      // Avoid an immediate repeat, including the first quote after a page load.
      if (order[0] === previous) [order[0], order[1]] = [order[1], order[0]];
    }
    previous = order.shift();
    savePreference(LAST_KEY, previous);
  }

  function render(animate = false) {
    const quote = QUOTES[previous][getCurrentLanguage()] || QUOTES[previous].en;
    lines.forEach((line, index) => { line.textContent = quote[index]; });
    button.dataset.paused = String(paused);
    const label = t(paused ? 'login.resumeQuotes' : 'login.pauseQuotes');
    button.setAttribute('aria-label', label);
    button.title = label;
    animation?.cancel();
    if (animate && !reducedMotion.matches && heading.animate) {
      animation = heading.animate(
        [{ opacity: 0.25, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 350, easing: 'ease-out' }
      );
    }
  }

  function syncTimer() {
    window.clearInterval(timer);
    if (paused || document.hidden) return;
    timer = window.setInterval(() => {
      // Stop changing content once the authenticated workspace hides the login.
      if (!heading.getClientRects().length) return;
      nextIndex();
      render(true);
    }, INTERVAL_MS);
  }

  button.addEventListener('click', () => {
    paused = !paused;
    savePreference(PAUSED_KEY, paused);
    render();
    syncTimer();
  });
  reducedMotion.addEventListener('change', () => {
    animation?.cancel();
    if (reducedMotion.matches) paused = true;
    render();
    syncTimer();
  });
  document.addEventListener('visibilitychange', syncTimer);
  window.addEventListener('pagehide', () => window.clearInterval(timer));
  window.addEventListener('pageshow', syncTimer);
  onLanguageChange(() => render());
  nextIndex();
  render();
  syncTimer();
}
