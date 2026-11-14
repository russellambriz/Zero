import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CACHE_NAME,APP_VERSION,buildLabel} from '../dist/modules/version.js';
import {decideUpdate,noteControllerChange} from '../dist/modules/update.js';

const sw=readFileSync(new URL('../dist/sw.js',import.meta.url),'utf8');
const version=readFileSync(new URL('../dist/modules/version.js',import.meta.url),'utf8');

test('the service worker and the app share one shell cache name',()=>{
  const token=name=>name.match(/zero-shell-[A-Za-z0-9_-]+/)?.[0];
  assert.equal(token(sw),token(version));
  assert.equal(token(version),CACHE_NAME);
  assert.match(APP_VERSION,/^\d+\.\d+\.\d+$/);
});

test('the worker waits for Update, then claims clients, and does not cache itself',()=>{
  const install=sw.slice(sw.indexOf("addEventListener('install'"),sw.indexOf("addEventListener('activate'"));
  assert.match(sw,/SKIP_WAITING/);
  assert.match(sw,/self\.skipWaiting\(\)/);
  assert.match(sw,/clients\.claim/);
  assert.match(sw,/endsWith\('\/sw\.js'\)/);
  assert.doesNotMatch(install,/skipWaiting/);
});

test('Update applies a waiting or installing worker and stays put when current',()=>{
  assert.equal(decideUpdate({waiting:true}),'apply');
  assert.equal(decideUpdate({installing:true}),'apply');
  assert.equal(decideUpdate({}),'current');
  assert.equal(decideUpdate({online:false,waiting:true}),'apply');
  assert.equal(decideUpdate({online:false}),'offline');
});

test('the first worker claim does not reload the page',()=>{
  assert.deepEqual(noteControllerChange({hadController:false,reloading:false}),{hadController:true,reloading:false,reload:false});
  assert.equal(noteControllerChange({hadController:true,reloading:false}).reload,true);
  assert.equal(noteControllerChange({hadController:true,reloading:true}).reload,false);
});

test('an unstamped build reads as dev',()=>{
  assert.equal(buildLabel('__BUILD__'),'dev');
  assert.equal(buildLabel('abc1234'),'abc1234');
  assert.equal(buildLabel(),'dev');
});

test('there is no banner: a waiting update lights up the Update buttons instead',()=>{
  const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../dist/styles.css',import.meta.url),'utf8');
  assert.doesNotMatch(app,/update-banner|showUpdateBanner/);
  assert.doesNotMatch(css,/update-banner/);
  assert.match(app,/markUpdateAvailable/);
  assert.match(app,/has-update/);
  assert.match(css,/has-update/);
  // A tap finishes any in-progress ink stroke through the engine, not the
  // old InkSurface, and always answers with a toast.
  assert.match(app,/engine\.commitPenStroke\(\)/);
  assert.match(app,/You are up to date\./);
});

test('the worker precaches the ink engine so it works offline after an update',()=>{
  assert.match(sw,/modules\/inkEngine\.js/);
});

test('the update flag is declared with the other app state, before first render',()=>{
  const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  const decl=app.indexOf('updateAvailable=false');
  assert.ok(decl>0);
  // Declared up top with the rest of the state, not at the bottom next to
  // runUpdate: sidebar reads it during the first render, and a `let`
  // declared after boot would throw before the app ever opens.
  assert.ok(decl<app.indexOf('function sidebar()'));
  assert.doesNotMatch(app,/let updateBusy=false,updateAvailable=false/);
});
