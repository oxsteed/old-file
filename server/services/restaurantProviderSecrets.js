'use strict';
const {spawn}=require('child_process');
const path=require('path');
const {decrypt}=require('../utils/encryption');

function resolveReferences(values) {
  const names=['accessToken','refreshToken','clientId','clientSecret','webhookSecret'];
  const env={...process.env};
  names.forEach((name,i)=>{env[`PROVIDER_REF_${i}`]=values[name]||'';});
  return new Promise((resolve,reject)=>{
    const child=spawn(process.env.ASM_EXECUTABLE||'asm-exec',['--',process.execPath,
      path.join(__dirname,'../scripts/encrypt-runtime-provider-refs.cjs')],{env,stdio:['ignore','pipe','ignore']});
    const chunks=[];let bytes=0;
    const timer=setTimeout(()=>child.kill(),30000);
    const fail=()=>reject(Object.assign(Error('Provider runtime references could not be resolved'),{code:'provider_credentials_unavailable'}));
    child.on('error',()=>{clearTimeout(timer);fail();});
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536)child.kill();else chunks.push(chunk);});
    child.on('close',code=>{clearTimeout(timer);if(code!==0||bytes>65536)return fail();
      try{resolve(JSON.parse(decrypt(Buffer.concat(chunks).toString())));}catch{fail();}});
  });
}
module.exports={resolveReferences};
