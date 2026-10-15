const CACHE='taskhub-v5';
const FILES=['./','index.html','features.css','features.js','features2.js','manifest.webmanifest','icon.svg'];
const LIB='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET')return;
  // never touch API traffic: only our own files and the pinned library
  if(u.origin!==location.origin&&r.url!==LIB)return;
  if(r.url===LIB){
    e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{const c=res.clone();caches.open(CACHE).then(x=>x.put(r,c));return res})));
    return;
  }
  e.respondWith(fetch(r).then(res=>{
    const copy=res.clone();caches.open(CACHE).then(c=>c.put(r,copy));return res;
  }).catch(()=>caches.match(r).then(m=>m||caches.match('index.html'))));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    if(cs.length)return cs[0].focus();
    return self.clients.openWindow('./');
  }));
});
