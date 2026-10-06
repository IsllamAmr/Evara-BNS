// Check-out reminders over Web Push.
//
// Employees opt in per device from the "Me" page; the browser hands us a push
// subscription that we store. A scheduled job (GitHub Actions, every 30 minutes, see
// .github/workflows/checkout-reminders.yml) calls /api/cron/checkout-reminders, which
// pushes one reminder per open shift once it is due. The server cannot use its own
// timer: on Render's free plan it sleeps when idle, and the job also wakes it.
const webpush = require('web-push');
const { AppError } = require('../middlewares/errorMiddleware');
const { getSupabaseAdmin } = require('../config/supabase');

const BUSINESS_TIME_ZONE = 'Africa/Cairo';
const FULL_SHIFT_MINUTES = 8 * 60;
// Remind a little after the full shift, so people leaving on time are not nagged.
const REMINDER_GRACE_MINUTES = 15;
// Anyone still checked in at this hour (business time) is reminded regardless.
const EVENING_SWEEP_HOUR = 21;
const MAX_SUBSCRIPTIONS_PER_USER = 10;

const vapidPublicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
const vapidPrivateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
const vapidSubject = String(process.env.VAPID_SUBJECT || 'mailto:admin@evara.local').trim();

let configured = false;
if (vapidPublicKey && vapidPrivateKey) {
  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    configured = true;
  } catch (error) {
    console.error('Web Push is disabled: invalid VAPID settings.', error.message);
  }
}

function isPushConfigured() {
  return configured;
}

function getPublicKey() {
  return configured ? vapidPublicKey : '';
}

function businessParts(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

function formatBusinessTime(timestamp) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(timestamp)).toLowerCase();
}

function validateSubscription(subscription) {
  const endpoint = String(subscription?.endpoint || '');
  const p256dh = String(subscription?.keys?.p256dh || '');
  const auth = String(subscription?.keys?.auth || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || p256dh.length > 200 || !auth || auth.length > 100) {
    throw new AppError('Invalid push subscription', 422);
  }
  return { endpoint, p256dh, auth };
}

async function saveSubscription(userId, subscription, userAgent = '') {
  if (!configured) {
    throw new AppError('Reminders are not set up on this server yet', 503);
  }
  const { endpoint, p256dh, auth } = validateSubscription(subscription);
  const supabaseAdmin = getSupabaseAdmin();

  // A device re-subscribing (or another account on the same phone) takes the endpoint over.
  const { error } = await supabaseAdmin.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint,
    p256dh,
    auth,
    user_agent: String(userAgent || '').slice(0, 300) || null,
  }, { onConflict: 'endpoint' });
  if (error) throw new AppError(error.message, 400);

  // Keep only the newest few devices per person.
  const { data: rows } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  const stale = (rows || []).slice(MAX_SUBSCRIPTIONS_PER_USER).map((row) => row.id);
  if (stale.length) {
    await supabaseAdmin.from('push_subscriptions').delete().in('id', stale);
  }
}

async function removeSubscription(userId, endpoint) {
  const { error } = await getSupabaseAdmin()
    .from('push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', String(endpoint || ''));
  if (error) throw new AppError(error.message, 400);
}

function isReminderDue(row, now) {
  const checkIn = new Date(row.check_in_time);
  if (Number.isNaN(checkIn.getTime())) return false;
  const minutesIn = (now.getTime() - checkIn.getTime()) / 60000;
  return minutesIn >= FULL_SHIFT_MINUTES + REMINDER_GRACE_MINUTES
    || businessParts(now).hour >= EVENING_SWEEP_HOUR;
}

function reminderPayload(row) {
  return JSON.stringify({
    title: "Don't forget to check out",
    body: `You checked in at ${formatBusinessTime(row.check_in_time)}. Scan the office QR when you leave and write your daily notes.`,
    url: '/#dashboard',
    tag: `checkout-${row.attendance_date}`,
  });
}

/**
 * Sends at most one reminder per open shift of the current business day.
 * Safe to call repeatedly or concurrently: each shift is claimed before sending.
 */
async function sendCheckoutReminders(now = new Date()) {
  const summary = { configured, openShifts: 0, due: 0, reminded: 0, devices: 0, removedDevices: 0 };
  if (!configured) return summary;

  const supabaseAdmin = getSupabaseAdmin();
  const today = businessParts(now).date;
  const { data: openShifts, error } = await supabaseAdmin
    .from('attendance')
    .select('id, user_id, attendance_date, check_in_time')
    .eq('attendance_date', today)
    .not('check_in_time', 'is', null)
    .is('check_out_time', null)
    .is('checkout_reminder_sent_at', null);
  if (error) throw new AppError(error.message, 500);

  summary.openShifts = (openShifts || []).length;
  const due = (openShifts || []).filter((row) => isReminderDue(row, now));
  summary.due = due.length;
  if (!due.length) return summary;

  const { data: subscriptions, error: subscriptionError } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', [...new Set(due.map((row) => row.user_id))]);
  if (subscriptionError) throw new AppError(subscriptionError.message, 500);

  for (const row of due) {
    const devices = (subscriptions || []).filter((item) => item.user_id === row.user_id);
    if (!devices.length) continue; // not opted in; checked again next run in case they enable it

    // Claim the shift first so overlapping runs never double-send.
    const { data: claimed } = await supabaseAdmin
      .from('attendance')
      .update({ checkout_reminder_sent_at: now.toISOString() })
      .eq('id', row.id)
      .is('checkout_reminder_sent_at', null)
      .select('id');
    if (!claimed || !claimed.length) continue;

    let delivered = 0;
    for (const device of devices) {
      try {
        await webpush.sendNotification(
          { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          reminderPayload(row),
          { TTL: 4 * 60 * 60, urgency: 'high' },
        );
        delivered += 1;
        await supabaseAdmin.from('push_subscriptions').update({ last_used_at: now.toISOString() }).eq('id', device.id);
      } catch (sendError) {
        // 404/410: the browser dropped this subscription (app removed, permission revoked).
        if (sendError.statusCode === 404 || sendError.statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', device.id);
          summary.removedDevices += 1;
        }
      }
    }

    summary.devices += delivered;
    if (delivered) {
      summary.reminded += 1;
    } else {
      // Nothing got through: release the claim so the next run can try again.
      await supabaseAdmin.from('attendance').update({ checkout_reminder_sent_at: null }).eq('id', row.id);
    }
  }

  return summary;
}

module.exports = {
  getPublicKey,
  isPushConfigured,
  isReminderDue,
  removeSubscription,
  saveSubscription,
  sendCheckoutReminders,
};
