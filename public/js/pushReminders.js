// Check-out reminders on this device (Web Push). The server decides when to send;
// this module only turns the device subscription on or off and reports its state.
import { getAppConfig } from './supabaseClient.js';

const SERVICE_WORKER_URL = '/sw.js';

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function urlBase64ToUint8Array(base64) {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
  return registration ? registration.pushManager.getSubscription() : null;
}

/**
 * 'unconfigured' (server has no VAPID keys) | 'install-first' (iPhone, not on Home Screen)
 * | 'unsupported' | 'denied' | 'on' | 'off'
 */
export async function getReminderState() {
  if (!getAppConfig().vapidPublicKey) return 'unconfigured';
  // iOS only offers Web Push to sites added to the Home Screen.
  if (isIos() && !isStandalone()) return 'install-first';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const subscription = await currentSubscription();
    return subscription && Notification.permission === 'granted' ? 'on' : 'off';
  } catch (_error) {
    return 'off';
  }
}

export async function enableReminders(apiRequest) {
  // Must run straight from the tap: browsers only show the prompt for a user gesture.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return getReminderState();

  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL);
  await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription()
    || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(getAppConfig().vapidPublicKey),
    });

  await apiRequest('/notifications/subscriptions', { method: 'POST', body: { subscription: subscription.toJSON() } });
  return 'on';
}

export async function disableReminders(apiRequest) {
  const subscription = await currentSubscription();
  if (subscription) {
    await apiRequest('/notifications/subscriptions', { method: 'DELETE', body: { endpoint: subscription.endpoint } }).catch(() => {});
    await subscription.unsubscribe().catch(() => {});
  }
  return 'off';
}

// Re-sends this device's subscription after sign-in, so the server always has the
// current one (browsers rotate them) and it belongs to whoever is signed in now.
export async function syncReminderSubscription(apiRequest) {
  try {
    if (!getAppConfig().vapidPublicKey || !('serviceWorker' in navigator) || Notification.permission !== 'granted') return;
    const subscription = await currentSubscription();
    if (subscription) {
      await apiRequest('/notifications/subscriptions', { method: 'POST', body: { subscription: subscription.toJSON() } });
    }
  } catch (_error) {
    // Best effort; the profile page shows the real state.
  }
}
