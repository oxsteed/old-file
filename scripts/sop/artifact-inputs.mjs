import fs from 'node:fs';
import {createHash} from 'node:crypto';
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function guidePrintInput(guide,sidecar,publicRoot) {
 const screenshots=guide.steps.map(step=>{
  const key=`${guide.id}/${step.id}/desktop`,record=sidecar[key];
  if(!record?.src)throw new Error(`Missing PDF screenshot ${key}`);
  return {key,record,image:digest(fs.readFileSync(new URL('.'+record.src,publicRoot)))};
 });
 return digest(JSON.stringify({guide,screenshots,renderer:digest(fs.readFileSync(new URL('./pdf/generate.mjs',import.meta.url))),builder:digest(fs.readFileSync(new URL('./artifact-inputs.mjs',import.meta.url)))}));
}
