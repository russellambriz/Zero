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
