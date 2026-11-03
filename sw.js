/* Service worker: abre la app sin conexión, guarda teselas del mapa y sincroniza en segundo plano (Android) */
importScripts('config.js', 'db.js', 'sync.js');

var APP = 'campo-app-v1';
var TESELAS = 'campo-teselas-v1';
var ARCHIVOS = [
  './', 'index.html', 'app.js', 'estilos.css', 'config.js', 'catalogos.js', 'db.js', 'sync.js',
  'manifest.webmanifest', 'icons/icono-192.png', 'icons/icono-512.png',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'datos/parroquias.geojson'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(APP).then(function (c) {
    return Promise.all(ARCHIVOS.map(function (u) {
      return c.add(u).catch(function () { /* un archivo opcional ausente no bloquea la instalación */ });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== APP && k !== TESELAS; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function esTesela(url) {
  return /basemaps\.cartocdn\.com|arcgisonline\.com/.test(url);
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return; // los POST al backend pasan directo
  var url = req.url;
  if (esTesela(url)) {
    // Teselas: primero la copia guardada; si no hay, la red y se guarda
    e.respondWith(caches.open(TESELAS).then(function (c) {
      return c.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (r) {
          if (r.ok || r.type === 'opaque') c.put(req, r.clone());
          return r;
        }).catch(function () { return new Response('', { status: 504 }); });
      });
    }));
    return;
  }
  if (new URL(url).origin === self.location.origin) {
    // Archivos de la app: red primero para recibir actualizaciones, copia guardada sin conexión
    e.respondWith(fetch(req).then(function (r) {
      if (r.ok) { var copia = r.clone(); caches.open(APP).then(function (c) { c.put(req, copia); }); }
      return r;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || caches.match('index.html');
      });
    }));
  }
});

// Sincronización en segundo plano (solo navegadores que la soportan, como Chrome en Android)
self.addEventListener('sync', function (e) {
  if (e.tag === 'enviar-fichas') {
    e.waitUntil(Sync.sincronizar().then(function (r) {
      if (!r.ok && r.offline) throw new Error('reintentar');
    }));
  }
});
