/** Decide what an Update tap should do once the service worker has been checked. */
export function decideUpdate({online=true,waiting=false,installing=false}={}){
  if(waiting||installing)return 'apply';
  if(online===false)return 'offline';
  return 'current';
}

/** The first time a worker takes control, the page is unchanged and must not reload. */
export function noteControllerChange(state){
  if(!state.hadController)return {hadController:true,reloading:false,reload:false};
  if(state.reloading)return {hadController:true,reloading:true,reload:false};
  return {hadController:true,reloading:true,reload:true};
}

let control={hadController:false,reloading:false};
let registration=null;
let onAvailable=()=>{};

export function currentRegistration(){return registration;}

export function bindUpdate(sw,{secure=true,onWaiting}={}){
  if(!sw||!secure)return null;
  onAvailable=onWaiting||(()=>{});
  control={hadController:!!sw.controller,reloading:false};
  sw.addEventListener('controllerchange',()=>{
    control=noteControllerChange(control);
    if(control.reload)location.reload();
  });
  const ready=sw.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(reg=>{
    registration=reg;
    const offer=worker=>{if(worker&&sw.controller)onAvailable(worker);};
    const watch=worker=>{
      if(!worker)return;
      if(worker.state==='installed')offer(worker);
      else worker.addEventListener('statechange',()=>{if(worker.state==='installed')offer(worker);});
    };
    if(reg.waiting)offer(reg.waiting);
    if(reg.installing)watch(reg.installing);
    reg.addEventListener('updatefound',()=>watch(reg.installing));
    const check=()=>{if(document.visibilityState==='visible'&&navigator.onLine)reg.update().catch(()=>{});};
    setInterval(check,30*60*1000);
    document.addEventListener('visibilitychange',check);
    return reg;
  }).catch(()=>null);
  return ready;
}

export function whenInstalled(worker){
  if(!worker||worker.state==='installed'||worker.state==='activated'||worker.state==='redundant')return Promise.resolve(worker);
  return new Promise(resolve=>{
    const done=()=>{if(worker.state==='installed'||worker.state==='activated'||worker.state==='redundant'){worker.removeEventListener('statechange',done);resolve(worker);}};
    worker.addEventListener('statechange',done);
  });
}

export async function checkForUpdate(){
  const reg=registration||await navigator.serviceWorker?.getRegistration?.('./');
  if(!reg)return {status:'unavailable',registration:null};
  registration=reg;
  if(navigator.onLine===false)return {status:decideUpdate({online:false,waiting:!!reg.waiting,installing:!!reg.installing}),registration:reg};
  try{await reg.update();}catch{return {status:'offline',registration:reg};}
  const installing=!!(reg.installing&&reg.installing.state==='installing');
  return {status:decideUpdate({online:true,waiting:!!reg.waiting,installing}),registration:reg};
}
