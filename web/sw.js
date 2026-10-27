// Service worker: guarda la app en el celular para que abra sin conexión.
// Los datos NO se guardan aquí (van por la cola/caché de la app).
// Al publicar cambios, sube el número de VERSION para que los celulares se actualicen.
const VERSION = 'inv-v1';
const ARCHIVOS = [
  './', 'index.html', 'config.js', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/api.js', 'js/cola.js', 'js/ui.js', 'js/estado.js', 'js/xlsx.js',
  'js/pantallas/acceso.js', 'js/pantallas/inicio.js', 'js/pantallas/inventario.js', 'js/pantallas/articulo.js',
  'js/pantallas/eventos.js', 'js/pantallas/evento.js', 'js/pantallas/salida.js', 'js/pantallas/recogida.js',
  'js/pantallas/movimientos.js', 'js/pantallas/diferencias.js', 'js/pantallas/bitacora.js', 'js/pantallas/usuarios.js',
  'js/pantallas/reportes.js', 'js/pantallas/cuenta.js', 'js/pantallas/cola.js', 'js/pantallas/mas.js', 'js/pantallas/componentes.js',
  'iconos/icono-192.png', 'iconos/icono-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // API de Supabase: siempre a la red
  // Red primero (para recibir actualizaciones); si no hay señal, la copia guardada
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copia)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
