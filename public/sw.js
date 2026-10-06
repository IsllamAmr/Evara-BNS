// EVARA BNS service worker: shows check-out reminders pushed by the server.
// It deliberately has no fetch handler and caches nothing, so it can never serve
// stale pages; it only exists so notifications arrive while the site is closed.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_error) {
    data = { body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(self.registration.showNotification(data.title || 'EVARA BNS', {
    body: data.body || '',
    tag: data.tag || 'evara',
    renotify: true,
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      if ('navigate' in existing) await existing.navigate(target).catch(() => {});
      return;
    }
    await self.clients.openWindow(target);
  })());
});
