import { getSupabase, isSupabaseReady, getAppConfig } from './supabaseClient.js';
import { applyDocumentLanguage, onLanguageChange, t, toggleLanguage } from './i18n.js';
import { isStrongPassword } from './shared.js';
import { initRotatingQuotes } from './rotatingQuotes.js';

const client = isSupabaseReady() ? getSupabase() : null;
const byId = (id) => document.getElementById(id);
const requestForm = byId('recoveryRequestForm');
const updateForm = byId('recoveryUpdateForm');
const status = byId('recoveryStatus');
const email = byId('recoveryEmail');
const password = byId('recoveryPassword');
const confirm = byId('recoveryConfirm');
const sendButton = byId('recoverySendBtn');
const saveButton = byId('recoverySaveBtn');
const params = new URLSearchParams(window.location.search);
const fragment = new URLSearchParams(window.location.hash.slice(1));
const expectsRecovery = params.get('mode') === 'update' || fragment.get('type') === 'recovery';
let mode = expectsRecovery ? 'checking' : 'request';
let recoverySession = null;
let statusKey = '';
let statusKind = 'info';
let busy = false;

function render() {
  const updating = mode === 'update' || mode === 'saved';
  const titleKey = mode === 'sent' ? 'recovery.sentTitle'
    : mode === 'saved' ? 'recovery.savedTitle'
    : updating ? 'recovery.updateTitle' : 'recovery.requestTitle';
  const title = t(titleKey);
  byId('recoveryTitle').textContent = title;
  document.title = `EVARA BNS | ${title}`;
  byId('recoveryCopy').textContent = t(updating ? 'recovery.updateCopy' : 'recovery.requestCopy');
  byId('recoveryCopy').classList.toggle('hidden', mode === 'sent' || mode === 'saved');
  requestForm.classList.toggle('hidden', mode !== 'request');
  updateForm.classList.toggle('hidden', mode !== 'update');
  status.textContent = statusKey ? t(statusKey) : '';
  status.className = `form-alert ${statusKind}${statusKey ? '' : ' hidden'}`;
  sendButton.disabled = busy || !client;
  saveButton.disabled = busy || !recoverySession;
  sendButton.textContent = t(busy && mode === 'request' ? 'recovery.sending' : 'recovery.sendLink');
  saveButton.textContent = t(busy && mode === 'update' ? 'recovery.saving' : 'recovery.savePassword');
  requestForm.setAttribute('aria-busy', String(busy && mode === 'request'));
  updateForm.setAttribute('aria-busy', String(busy && mode === 'update'));
}

function announce(key = '', kind = 'info') {
  statusKey = key;
  statusKind = kind;
  render();
}

requestForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !client || !requestForm.reportValidity()) return;
  busy = true;
  announce();
  try {
    const redirectTo = new URL('/password-reset?mode=update', getAppConfig().appUrl).href;
    const { error } = await client.auth.resetPasswordForEmail(email.value.trim(), { redirectTo });
    if (error) throw error;
    mode = 'sent';
    announce('recovery.sent', 'success');
  } catch (error) {
    announce(error.status === 429 ? 'recovery.rateLimited' : 'recovery.sendFailed', 'error');
  } finally {
    busy = false;
    render();
  }
});

updateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !client || !recoverySession || !updateForm.reportValidity()) return;
  if (!isStrongPassword(password.value)) {
    announce('recovery.passwordWeak', 'error');
    password.focus();
    return;
  }
  if (password.value !== confirm.value) {
    announce('recovery.passwordMismatch', 'error');
    confirm.focus();
    return;
  }
  busy = true;
  announce();
  try {
    const { error } = await client.auth.updateUser({ password: password.value });
    if (error) throw error;
    password.value = '';
    confirm.value = '';
    recoverySession = null;
    mode = 'saved';
    announce('recovery.saved', 'success');
    // The recovery client only stores tokens in memory. Revocation is best-effort
    // after the confirmed password change, so an outage cannot hide that success.
    await client.auth.signOut({ scope: 'local' }).catch(() => {});
  } catch (_error) {
    announce('recovery.updateFailed', 'error');
  } finally {
    busy = false;
    render();
  }
});

document.querySelector('[data-language-toggle]').addEventListener('click', toggleLanguage);
onLanguageChange(render);
applyDocumentLanguage();
initRotatingQuotes();

async function boot() {
  if (!client) {
    mode = 'request';
    announce('recovery.unavailable', 'config-notice');
    return;
  }
  if (expectsRecovery) announce('recovery.checking');
  else render();

  // A stored login alone is not treated as a password-recovery link.
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) {
      recoverySession = session;
      byId('recoveryAccount').value = session.user?.email || '';
      mode = 'update';
      announce();
    }
  });
  try {
    const { error } = await client.auth.getSession();
    if (expectsRecovery && (!recoverySession || error)) {
      mode = 'request';
      announce('recovery.invalidLink', 'error');
    }
  } catch (_error) {
    mode = 'request';
    announce('recovery.invalidLink', 'error');
  }
  if (expectsRecovery) {
    window.history.replaceState(null, '', '/password-reset');
  }
}

boot();
