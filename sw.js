const CACHE = 'galileo-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('push', e => {
  if (!e.data) return;
  const d = e.data.json();
  e.waitUntil(self.registration.showNotification(d.title, {
    body:              d.body,
    icon:              '/icon.svg',
    badge:             '/badge.svg',
    tag:               d.tag || 'alerta',
    requireInteraction: d.urgente || false,
    vibrate:           d.urgente ? [400,100,400,100,400] : [200,100,200],
    data:              { url: '/' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(cs => {
    if (cs.length) return cs[0].focus();
    return clients.openWindow(e.notification.data?.url || '/');
  }));
});
