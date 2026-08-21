const CACHE = 'crew-app-v25';
const SHELL = [
  '/', '/styles.css', '/v02.css', '/progress.css', '/storage-audit.css', '/access.css',
  '/app.js', '/game-mode-fix.js', '/reset-sync.js', '/progress.js', '/storage-audit.js', '/active-child.js',
  '/media-preview.js', '/speech-admin.js', '/speech-practice.js',
  '/session-guard.js', '/install.js', '/manifest.webmanifest', '/app-icon-192.png', '/app-icon-512.png'
];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/') || url.pathname.startsWith('/speech-media/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => { const copy=response.clone(); caches.open(CACHE).then(cache=>cache.put('/',copy)); return response; }).catch(()=>caches.match('/')));
    return;
  }
  event.respondWith(fetch(event.request).then(response => { const copy=response.clone(); caches.open(CACHE).then(cache=>cache.put(event.request,copy)); return response; }).catch(()=>caches.match(event.request)));
});
