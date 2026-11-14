import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import test from 'node:test';
const source=fs.readFileSync(new URL('../src/hooks/useNotifications.js',import.meta.url),'utf8');
test('two Media consumers share one load and one socket lifecycle, then clean up',async()=>{
  const cleanups=[], handlers=new Map(), apiCalls=[];
  let notifications=[{id:1,type:'media_reply',is_read:false},{id:2,type:'new_bid',is_read:false}];
  const socket={on:(event,fn)=>handlers.set(event,fn),off:(event)=>handlers.delete(event)};
  const react={useMemo:fn=>fn(),useEffect:fn=>cleanups.push(fn()),useSyncExternalStore:(_,get)=>get()};
  const isMedia=(n)=>['media_reply','media_like','media_repost','media_quote','media_follow','media_creator_update'].includes(n.type);
  // The stub answers like the server: the scoped fetch returns only media
  // rows, the unscoped fetch returns the whole window.
  const getAccountSnapshot=async(_userId,_path,params)=>{
    apiCalls.push(1);
    const rows=params?.scope==='media'?notifications.filter(isMedia):notifications;
    return {data:{notifications:rows,unread_count:rows.filter(n=>!n.is_read).length}};
  };
  const api={get:async()=>{apiCalls.push(1);return {data:{notifications}}},put:async()=>{},delete:async()=>{}};
  const mod={exports:{}};
  const noop=()=>{};
  vm.runInNewContext(transformSync(source,{format:'cjs'}).code,{
    module:mod,exports:mod.exports,console,Map,Set,Date,
    document:{visibilityState:'visible',addEventListener:noop,removeEventListener:noop},window:{addEventListener:noop,removeEventListener:noop},
    require:name=>name==='react'?react:name.endsWith('/axios')?{default:api}:name.endsWith('/AuthContext')?{useAuth:()=>({user:{id:'account-a'}})}:name==='./useSocket'?{useSocket:()=>({socket})}:{getAccountSnapshot,invalidateAccountSnapshots:noop},
  });
  const hook=mod.exports.default;
  hook('media'); hook('media');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(apiCalls.length,1);
  assert.equal(handlers.size,2);
  assert.equal(hook('media').unreadCount,1);
  assert.equal(hook('media').notifications.length,1);
  // Cost audit 2026-11-13 item 12 (fixed): the scope-null store (Navbar /
  // Dashboard) and the media store share one socket lifecycle per user,
  // but each scope has its own load: the media list is a scoped server
  // fetch (scope=media), not a client-side filter of the unscoped
  // window, so mounting the unscoped consumer fires its own GET and the
  // media consumer does not re-fire. Each scope still shares one load
  // among its own consumers.
  hook(); hook();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(apiCalls.length,2);
  assert.equal(hook().unreadCount,2);
  assert.equal(hook().notifications.length,2);
  notifications=[];
  handlers.get('notification:new')();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(apiCalls.length,4);
  assert.equal(hook('media').unreadCount,0);
  for(const cleanup of cleanups) cleanup?.();
  assert.equal(handlers.size,0);
});
