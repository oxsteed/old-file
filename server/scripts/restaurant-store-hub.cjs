#!/usr/bin/env node
'use strict';
// A dedicated in-store appliance process. Public API never dials LAN hosts.
process.umask(0o077);
const fs = require('fs');
const https = require('https');
const { createHub } = require('../services/storeHubLan');
const required = name => { if (!process.env[name]) throw Error(`${name} is required`); return process.env[name]; };
const origin = new URL(required('OXSTEED_HUB_ORIGIN'));
const api = new URL(required('OXSTEED_API_URL'));
if(origin.protocol!=='https:' || api.protocol!=='https:')throw Error('Trusted HTTPS is required for the LAN hub and cloud');
const restaurantId=Number(required('OXSTEED_RESTAURANT_ID'));
const hubId=Number(required('OXSTEED_HUB_ID'));
const deviceToken=required('OXSTEED_DEVICE_TOKEN');
const cloud=async(method,path,body)=>{
  const url=new URL(`/api/restaurants/${restaurantId}/hubs/${hubId}/${path}`,api);
  const res=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{'Content-Type':'application/json','X-Device-Token':deviceToken},
    ...(body?{body:JSON.stringify(body)}:{})});
  if(!res.ok)throw Object.assign(Error('hub_cloud_rejected'),{status:res.status});
  return res.json();
};
const filename=required('OXSTEED_HUB_DATABASE');
const hub=createHub({filename,restaurantId,hubId,locationId:Number(required('OXSTEED_LOCATION_ID')),origin:origin.origin,cloud});
fs.chmodSync(filename,0o600);
const server=https.createServer({key:fs.readFileSync(required('OXSTEED_HUB_TLS_KEY_FILE')),
  cert:fs.readFileSync(required('OXSTEED_HUB_TLS_CERT_FILE'))},hub.app);
server.listen(Number(origin.port)||443,process.env.OXSTEED_HUB_BIND||'0.0.0.0');
let current;
const tick=()=>{if(!current)current=hub.sync().catch(e=>console.error(JSON.stringify({event:'hub_sync_unavailable',code:e.code||'cloud_unavailable'}))).finally(()=>{current=null;});};
tick();
const interval=setInterval(tick,10000);
let stopping=false;
async function stop(){if(stopping)return;stopping=true;clearInterval(interval);await current;server.close(()=>{hub.close();});}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
