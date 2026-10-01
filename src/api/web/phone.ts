import { DESIGN_TOKENS } from '../../core/owner/tokens.js';

/**
 * G5b — WHAT A PHONE NEEDS TO HOLD NOMI: the page it installs from (the
 * manifest) and the worker that shows an alert while Nomi is closed.
 *
 * The worker is the app's second script (the page's one is `live.<hash>.js`),
 * a deliberate change the plan names: a push arrives with no page open, and
 * only a worker the phone keeps can show it. It is served at `/sw.js`, never
 * cached, so a new build's worker replaces the old one. It does two things:
 * shows the alert Nomi sent (title, words, and where it leads), and opens that
 * place when the alert is tapped — only an address of this app, never one
 * handed to it from anywhere else.
 */
export const SERVICE_WORKER = `/* Nomi: the phone's own worker (G5b). Shows the alert Nomi sends; a tap opens the conversation. */
'use strict';
self.addEventListener('push', function (e) {
  var said = {};
  try { said = e.data ? e.data.json() : {}; } catch (x) { said = {}; }
  e.waitUntil(self.registration.showNotification(String(said.title || 'Nomi'), {
    body: String(said.body || ''),
    tag: String(said.url || 'nomi'),
    data: { url: String(said.url || '/app') },
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png'
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var to = (e.notification.data && e.notification.data.url) || '/app';
  var here = self.location.origin;
  if (to.charAt(0) !== '/' && to.indexOf(here + '/') !== 0) to = '/app';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (open) {
    for (var i = 0; i < open.length; i++) {
      var w = open[i];
      if (w.url.indexOf(here) === 0 && 'focus' in w) return (w.navigate ? w.navigate(to) : Promise.resolve()).then(function () { return w.focus(); });
    }
    return self.clients.openWindow(to);
  }));
});
`;

/** The install manifest: Nomi opens on its own, from the home screen, at the app. */
export function appManifest(): string {
  const { ink, paper } = DESIGN_TOKENS.color;
  return JSON.stringify({
    name: 'Nomi', short_name: 'Nomi', start_url: '/app', scope: '/', display: 'standalone',
    background_color: paper, theme_color: ink,
    icons: [
      { src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  });
}

/** What the shell's head carries so a phone can install it (its colours are in the manifest). */
export const INSTALL_LINKS = `<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/assets/icon-192.png">`;
