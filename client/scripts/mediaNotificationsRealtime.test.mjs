import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import test from 'node:test';
const source=fs.readFileSync(new URL('../src/hooks/useNotifications.js',import.meta.url),'utf8');
test('two Media consumers share one load and one socket lifecycle, then clean up',async()=>{
  const cleanups=[], handlers=new Map(), apiCalls=[];
  let notifications=[{id:1,is_read:false}];
  const socket={on:(event,fn)=>handlers.set(event,fn),off:(event)=>handlers.delete(event)};
  const react={useMemo:fn=>fn(),useEffect:fn=>cleanups.push(fn()),useSyncExternalStore:(_,get)=>get()};
  const api={get:async()=>{apiCalls.push(1);return {data:{notifications}}},put:async()=>{},delete:async()=>{}};
  const mod={exports:{}};
  const noop=()=>{};
  vm.runInNewContext(transformSync(source,{format:'cjs'}).code,{
    module:mod,exports:mod.exports,console,Map,Set,Date,
    document:{visibilityState:'visible',addEventListener:noop,removeEventListener:noop},window:{addEventListener:noop,removeEventListener:noop},
    require:name=>name==='react'?react:name.endsWith('/axios')?{default:api}:name.endsWith('/AuthContext')?{useAuth:()=>({user:{id:'account-a'}})}:name==='./useSocket'?{useSocket:()=>({socket})}:{getAccountSnapshot:()=>api.get(),invalidateAccountSnapshots:noop},
  });
  const hook=mod.exports.default;
  hook('media'); hook('media');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(apiCalls.length,1);
  assert.equal(handlers.size,2);
  assert.equal(hook('media').unreadCount,1);
  notifications=[];
  handlers.get('notification:new')();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(hook('media').unreadCount,0);
  for(const cleanup of cleanups) cleanup?.();
  assert.equal(handlers.size,0);
});
