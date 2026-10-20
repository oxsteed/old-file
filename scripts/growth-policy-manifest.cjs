#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const copy=require('../server/growth/policyCopy.json');
const manifest={};
if(Object.keys(copy).length!==20)throw new Error('All twenty notice languages are required');
for(const locale of Object.keys(copy).sort()) {
  const file=path.join(root,'client/src/locales/privacy/next',`${locale}.content.json`);
  const raw=fs.readFileSync(file,'utf8');const data=JSON.parse(raw);
  for(let i=1;i<=14;i++)if(!data.sections[i]?.blocks?.length)throw new Error(`Missing section ${i} in ${locale}`);
  manifest[locale]=crypto.createHash('sha256').update(raw).digest('hex');
}
const file=path.join(root,'server/growth/policyManifest.json');
const output=JSON.stringify(manifest,null,2)+'\n';
if(process.argv.includes('--check')) {
  if(fs.readFileSync(file,'utf8')!==output)throw new Error('Policy manifest is stale');
}else fs.writeFileSync(file,output);
