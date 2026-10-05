'use strict';

const express=require('express');
const {pipeline}=require('node:stream/promises');
const {authenticate}=require('../middleware/auth');
const {creditExportLimiter}=require('../middleware/rateLimiter');
const jobs=require('../services/statementExportJobService');

// Mount after the application's normal CSRF/session/revocation middleware:
// app.use('/api/statements/exports', require('./routes/statementExports')).
function createRouter(service=jobs) {
  const router=express.Router();
  router.use(authenticate);
  router.use((_req,res,next)=>{res.set({'Cache-Control':'private, no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff'});next();});
  const action=handler=>async(req,res,next)=>{try{await handler(req,res);}catch(error){next(error);}};
  router.post('/',creditExportLimiter,action(async(req,res)=>{
    const job=await service.request(req.user.id,req.body,req.get('Idempotency-Key'));
    res.status(job.state==='complete'?200:202).json({success:true,data:job});
  }));
  router.get('/:jobId',action(async(req,res)=>res.json({success:true,data:await service.status(req.params.jobId,req.user.id)})));
  router.post('/:jobId/cancel',creditExportLimiter,action(async(req,res)=>res.json({success:true,data:await service.cancel(req.params.jobId,req.user.id)})));
  router.post('/:jobId/retry',creditExportLimiter,action(async(req,res)=>res.status(202).json({success:true,data:await service.retry(req.params.jobId,req.user.id)})));
  router.get('/:jobId/manifest',action(async(req,res)=>res.json({success:true,data:await service.manifest(req.params.jobId,req.user.id)})));
  router.get('/:jobId/files/:fileId',creditExportLimiter,action(async(req,res)=>{
    const {stream,file}=await service.download(req.params.jobId,req.params.fileId,req.user.id);
    res.set({'Content-Type':file.mediaType,'Content-Length':String(file.byteLength),'Accept-Ranges':'none',
      'Content-Disposition':`attachment; filename="statement-export-${file.part}.${file.kind==='csv'?'csv':'pdf'}"`});
    try {await pipeline(stream,res);}catch(error){if(!res.headersSent)throw error;res.destroy(error);}
  }));
  return router;
}
module.exports=createRouter();
module.exports.createRouter=createRouter;
