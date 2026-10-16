#!/usr/bin/env node
/** Explicit review baseline. --regenerate records reviewed inputs; normal checks never update it. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {guidePrintInput,digest} from './artifact-inputs.mjs';
import {pathToFileURL} from 'node:url';
import {GUIDES} from '../../client/src/sop/guides/index.js';
import {HANDBOOKS} from '../../client/src/sop/guideRegistry.js';
import {validateGuide,validateScreenshotSidecar,validateHandbook} from '../../client/src/sop/model.js';
export const root = fileURLToPath(new URL('../../',import.meta.url));
const manifestPath=path.join(root,'docs/sop/source-manifest.json');
const hash=data=>createHash('sha256').update(data).digest('hex');
const relative=p=>path.relative(root,p).split(path.sep).join('/');
function sourceFiles(g) {
 const common=['client/src/components/Navbar.jsx','client/src/components/Footer.jsx','client/src/utils/launchScope.js','client/src/components/ProtectedRoute.jsx','server/middleware/launchGate.js','server/utils/modeRole.js','server/constants/roles.js','server/middleware/requireLogisticsPayments.js'];
 common.push('client/src/locales/en.json', ...fs.readdirSync(path.join(root,'client/src/i18n/locales/en')).filter(f=>f.endsWith('.json')).map(f=>'client/src/i18n/locales/en/'+f));
 const files=new Set(common.filter(file=>fs.existsSync(path.join(root,file))));
 for(const s of g.sources) {
  for(const match of s.ref.matchAll(/(?:client|server)\/[\w/.-]+\.(?:jsx?|tsx?)/g)) files.add(match[0]);
 }
 // Capture direct local component dependencies, which often hold the controls shown in a page.
 for(const file of [...files]) {
  const abs=path.join(root,file); if(!fs.existsSync(abs)) throw new Error(`${g.id}: missing source ${file}`);
  if(!/\.(?:js|jsx|ts|tsx)$/.test(file)) continue;
  for(const m of fs.readFileSync(abs,'utf8').matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
   const base=path.resolve(path.dirname(abs),m[1]);
   const found=[base,base+'.js',base+'.jsx',base+'.ts',base+'.tsx',path.join(base,'index.js')].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
   if(found && /\.(?:js|jsx|ts|tsx|css)$/.test(found)) files.add(relative(found));
  }
 }
 return [...files].sort();
}
export function compareSnapshots(before,after) {
 const changed=[];
 for(const [id,value] of Object.entries(after.guides)) if(JSON.stringify(before.guides?.[id])!==JSON.stringify(value)) changed.push(id);
 for(const id of Object.keys(before.guides||{})) if(!after.guides[id]) changed.push(id);
 for(const [role,value] of Object.entries(after.handbooks)) if(JSON.stringify(before.handbooks?.[role])!==JSON.stringify(value)) changed.push(`handbook:${role}`);
 return changed;
}
export function snapshot() {
 const sidecar=JSON.parse(fs.readFileSync(path.join(root,'client/src/sop/screenshots.json')));
 const errors=GUIDES.flatMap(g=>validateGuide(g).map(e=>`${g.id}: ${e}`));
 errors.push(...validateScreenshotSidecar(sidecar,{guides:GUIDES}));
 for(const h of HANDBOOKS) errors.push(...validateHandbook(h));
 const printMetadata=JSON.parse(fs.readFileSync(path.join(root,'docs/sop/pdf-build.json')));
 const printInputs=Object.fromEntries(GUIDES.map(g=>[g.id,guidePrintInput(g,sidecar,pathToFileURL(path.join(root,'client/public/')))]));
 const ids=new Set(GUIDES.map(g=>g.id));
 const sourceHashes=new Map();
 const fileHash=file=>{if(!sourceHashes.has(file)) sourceHashes.set(file,hash(fs.readFileSync(path.join(root,file))));return sourceHashes.get(file);};
 const result={version:2,guideCount:GUIDES.length,guides:{},handbooks:{}};
 const app=fs.readFileSync(path.join(root,'client/src/App.jsx'),'utf8');
 const routes=[...app.matchAll(/<Route\b[^>]*\bpath="([^"]+)"/g)].map(m=>m[1]).sort();
 for(const g of GUIDES) {
  for(const id of [...g.relatedGuides,...g.prerequisites.map(p=>p.guideId).filter(Boolean)]) if(!ids.has(id)) errors.push(`${g.id}: unknown related guide ${id}`);
  const sources=Object.fromEntries(sourceFiles(g).map(f=>[f,fileHash(f)]));
  // Hash documented route declarations and retain their references for human review.
  const documented=[...new Set([...g.sources.filter(s=>s.type==='route').map(s=>s.ref),...g.steps.flatMap(s=>s.screenshots.map(x=>x.screen))])].sort();
  const routeParts=documented.map(ref=>{const clean=ref.split(/[?#\s]/)[0];const match=routes.find(p=>p.replace(/:[^/]+/g, ':id')===clean.replace(/:[^/]+/g, ':id')); if(!match) errors.push(`${g.id}: missing documented route ${clean}`);return {path:match||clean,declaration:hash((app.split("\n").find(line=>line.includes(`path="${match}"`))||clean).trim())};});
  const screenshots={};
  for(const s of g.steps) for(const viewport of ['desktop','mobile']) {
   const key=`${g.id}/${s.id}/${viewport}`, rec=sidecar[key];
   if(!rec?.src) {errors.push(`Missing screenshot ${key}`);continue;}
   const file=path.join(root,'client/public',rec.src);
   if(!fs.existsSync(file)) {errors.push(`Missing image ${file}`);continue;}
   if(rec.annotations.some(a=>a.x===0 && a.y===0)) errors.push(`Unresolved annotation ${key}`);
   const planned=s.screenshots.find(x=>x.viewport===viewport)?.annotations || [];
   for(const annotation of planned) if(!rec.annotations.some(actual=>actual.n===annotation.n && actual.label===annotation.label)) errors.push(`Missing reviewed callout ${key}#${annotation.n}`);
   screenshots[key]={src:rec.src,image:hash(fs.readFileSync(file)),metadata:hash(JSON.stringify(rec))};
  }
  const pdf=`client/public/sop/pdfs/guides/${g.id}.pdf`;
  if(!fs.existsSync(path.join(root,pdf))) errors.push(`Missing PDF ${pdf}`);
  if(printMetadata.guides[g.id]?.input!==printInputs[g.id] || printMetadata.guides[g.id]?.pdf!==hash(fs.readFileSync(path.join(root,pdf)))) errors.push(`Stale PDF: ${g.id}. Rebuild the guide download.`);
  result.guides[g.id]={revision:g.revision,content:hash(JSON.stringify(g)),references:g.sources,sources,routes:routeParts,screenshots,pdf:fs.existsSync(path.join(root,pdf))?hash(fs.readFileSync(path.join(root,pdf))):null};
 }
 for(const h of HANDBOOKS) {const file=path.join(root,`client/public/sop/pdfs/handbooks/${h.role}.pdf`);if(!fs.existsSync(file))errors.push(`Missing handbook ${h.role}`);if(printMetadata.handbooks[h.role]?.input!==digest(JSON.stringify(h.guideIds.map(id=>printInputs[id]))) || printMetadata.handbooks[h.role]?.pdf!==hash(fs.readFileSync(file))) errors.push(`Stale handbook: ${h.role}. Rebuild the role download.`);result.handbooks[h.role]={guideIds:h.guideIds,pdf:fs.existsSync(file)?hash(fs.readFileSync(file)):null};}
 if(errors.length) throw new Error(errors.join('\n'));
 return result;
}
export function main() {
 const current=snapshot();
 if(process.argv.includes('--regenerate')) {fs.writeFileSync(manifestPath,JSON.stringify(current,null,2)+'\n');console.log(`Recorded reviewed baseline: ${current.guideCount} guides, 5 handbooks.`);return;}
 const changed=compareSnapshots(JSON.parse(fs.readFileSync(manifestPath)),current);
 if(changed.length) throw new Error(`SOP inputs changed. Review instructions, recapture affected screenshots and rebuild PDFs before --regenerate:\n${changed.join('\n')}`);
 console.log(`SOP content, routes, sources, screenshots and PDFs match the reviewed baseline (${GUIDES.length} guides).`);
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {main();} catch(e) {console.error(e.message);process.exitCode=1;}
}
