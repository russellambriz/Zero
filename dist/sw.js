/*
 * Zero's app shell.
 * CACHE is stamped with the deploy commit by .github/workflows/pages.yml.
 * A new worker waits until the page sends SKIP_WAITING (the Update button,
 * after notes are saved). The previous cache keeps serving until then.
 * sw.js itself is never answered from the cache, so the next deploy can be seen.
 */
const CACHE='zero-shell-dev';
const ASSETS=['./','./index.html','./styles.css','./app.js','./icon.svg','./manifest.webmanifest','./modules/version.js','./modules/update.js','./modules/model.js','./modules/storage.js','./modules/icons.js','./modules/ink.js','./modules/inkEngine.js','./modules/organize.js'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS.map(url=>new Request(url,{cache:'reload'})))));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>(name.startsWith('zero-shell-')||name.startsWith('atelier-shell-'))&&name!==CACHE).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('message',event=>{
  if(event.data&&event.data.type==='SKIP_WAITING')self.skipWaiting();
  if(event.data&&event.data.type==='GET_VERSION'&&event.ports&&event.ports[0])event.ports[0].postMessage({cache:CACHE});
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname.endsWith('/sw.js'))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const cached=await cache.match(req.mode==='navigate'?'./index.html':req,{ignoreSearch:true});
    if(cached)return cached;
    try{return await fetch(req);}catch{return req.mode==='navigate'?cache.match('./index.html'):Response.error();}
  })());
});
