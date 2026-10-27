// sw.js — the site's service worker, only for web push (server/src/web-push.js): show what the server sent, and open
// the right page when it's tapped (an open Herae tab is reused). No caching, no offline: nothing else lives here.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Herae', {
    body: d.body || '', icon: '/icon-192.png', badge: '/favicon-48.png', tag: d.tag || 'herae', renotify: true,
    data: { url: d.url || '/social.html' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/social.html';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const tab = cs.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) return tab.navigate(url).then((c) => (c || tab).focus()).catch(() => tab.focus());
    return self.clients.openWindow(url);
  }));
});
