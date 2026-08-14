const CACHE='crew-app-v1';
const SHELL=['/','/styles.css','/v02.css','/app.js','/manifest.webmanifest','/app-icon.svg'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==location.origin) return;
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/media/')) return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).then(r=>{
      const copy=r.clone();caches.open(CACHE).then(c=>c.put('/',copy));return r;
    }).catch(()=>caches.match('/')));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(r=>{
    const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));return r;
  })));
});
