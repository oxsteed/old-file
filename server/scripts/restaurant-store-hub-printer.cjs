#!/usr/bin/env node
'use strict';
process.umask(0o077);
const {createPrinter}=require('../services/storeHubPrinter');
const required=name=>{if(!process.env[name])throw Error(`${name} is required`);return process.env[name];};
const origin=new URL(required('OXSTEED_HUB_ORIGIN'));
if(origin.protocol!=='https:')throw Error('Trusted HTTPS is required');
const token=required('OXSTEED_DEVICE_TOKEN'),deviceId=required('OXSTEED_DEVICE_ID');
const printer=createPrinter({stateFile:required('OXSTEED_PRINTER_STATE_FILE'),host:required('OXSTEED_PRINTER_HOST'),port:Number(process.env.OXSTEED_PRINTER_PORT||9100),
  request:async(path,body)=>{
    const response=await fetch(new URL(`/v1/${path}`,origin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'X-Device-Id':deviceId},body:JSON.stringify(body)});
    if(!response.ok)throw Error('hub_printer_request_failed');return response.json();
  }});
let stopped=false,current;
const tick=()=>{if(!current&&!stopped)current=printer.tick().catch(error=>console.error(JSON.stringify({event:'hub_printer_unavailable',code:error.code||'connection_unavailable'}))).finally(()=>{current=null;});};
tick();const interval=setInterval(tick,2000);
async function stop(){stopped=true;clearInterval(interval);await current;}
process.once('SIGTERM',stop);process.once('SIGINT',stop);
