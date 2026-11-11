/* RWO Scoring offline support: keeps the app itself on the iPad so it opens with no internet.
 * Taps and results never go through this file; they live in the iPad's storage.
 * Bump VERSION whenever the app files change so iPads pick up the new copy. */
var VERSION = 'rwo-v3.0.2';
var FILES = ['./', 'index.html', 'engine.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return; // Google Sheet calls go straight to the network
  // Use the saved copy right away, and refresh it in the background when online.
  e.respondWith(caches.open(VERSION).then(function (c) {
    return c.match(e.request, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(e.request).then(function (res) { if (res && res.ok) c.put(e.request, res.clone()); return res; }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});
