// English ships with the page; Arabic is fetched only when first needed.
import assert from 'node:assert/strict';

const i18n = await import('../public/js/i18n.js');
i18n.setLanguageLock('en');
assert.equal(i18n.t('common.cancel'), 'Cancel');
i18n.setLanguageLock('ar');
assert.equal(i18n.t('common.cancel'), 'Cancel', 'Before Arabic loads, English is the safe fallback');
assert.equal(await i18n.ensureLanguageLoaded('ar'), 'ar');
assert.notEqual(i18n.t('common.cancel'), 'Cancel', 'Arabic strings are used once loaded');
assert.match(i18n.t('liveUpdates.available', { count: '3' }), /3/);
assert.equal(await i18n.ensureLanguageLoaded('xx'), 'ar', 'Unknown languages fall back to the default');

const [{ default: en }, { default: ar }] = await Promise.all([
  import('../public/js/locales/en.js'),
  import('../public/js/locales/ar.js'),
]);
const keys = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => (
  value && typeof value === 'object' && !Array.isArray(value) ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`]
));
const missing = keys(en).filter((key) => !keys(ar).includes(key));
assert.ok(missing.length < 40, `Arabic covers almost every English key (missing ${missing.length})`);
console.log(`Translations: English bundled, Arabic on demand (${keys(en).length} English keys, ${missing.length} fall back to English).`);
