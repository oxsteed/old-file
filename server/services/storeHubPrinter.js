'use strict';
const fs=require('fs');
const {renderKitchenTicket,printBuffer,normalizePrinterHost}=require('./restaurantPrintBridge');
// A claim is durable before any bytes are sent. On restart, an unacknowledged
// write is uncertain and is never printed again automatically.
function createPrinter({stateFile,request,host,port=9100,print=printBuffer}){
  host=normalizePrinterHost(host);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('invalid_printer_port');
  let current=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):null;
  const save=value=>{const temporary=`${stateFile}.tmp`;fs.writeFileSync(temporary,JSON.stringify(value),{mode:0o600});
    const fd=fs.openSync(temporary,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,stateFile);current=value;};
  let running=false;
  return {async tick(){
    if(running)return;running=true;
    try{
      if(current){
        if(current.state==='printed'){
          await request(`prints/${current.id}/ack`,{claim:current.claim});save(null);
        }else throw Object.assign(Error('printer_delivery_uncertain'),{code:'printer_delivery_uncertain'});
        return;
      }
      const {job}=await request('prints/claim',{});if(!job)return;
      save({id:job.id,claim:job.claim,state:'sending'});
      const result=await print(host,port,renderKitchenTicket(job.payload));
      if(!result.ok)throw Object.assign(Error('printer_delivery_uncertain'),{code:'printer_delivery_uncertain'});
      save({...current,state:'printed'});
      await request(`prints/${job.id}/ack`,{claim:job.claim});save(null);
    }finally{running=false;}
  }};
}
module.exports={createPrinter};
