'use strict';

const express=require('express');
const {pipeline}=require('node:stream/promises');
const {authenticate}=require('../middleware/auth');
const {creditExportLimiter}=require('../middleware/rateLimiter');
const jobs=require('../services/statementExportJobService');
const bulk=require('../services/statementExportService');
const notes=require('../services/statementNoteService');

// Mount after the application's normal CSRF/session/revocation middleware:
// app.use('/api/statements/exports', require('./routes/statementExports'));
// (server/index.js). New capabilities live on the same mount:
//   POST /bulk, POST /bulk/package, GET / (history), POST /accounting,
//   GET|POST /notes, DELETE /notes/:id, GET /notes/:id/attachment.
// Specific paths are registered before /:jobId so a literal "bulk",
// "accounting", or "notes" is never mistaken for a job id.
function createRouter(service=jobs,deps={}) {
  const bulkService=deps.bulk||bulk;
  const noteService=deps.notes||notes.defaultService;
  const router=express.Router();
  router.use(authenticate);
  router.use((_req,res,next)=>{res.set({'Cache-Control':'private, no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff'});next();});
  const action=handler=>async(req,res,next)=>{try{await handler(req,res);}catch(error){next(error);}};
  const queryParam=value=>(value===undefined||value===''?undefined:value);

  // Export history: the existing statement_export_jobs records, newest first.
  router.get('/',action(async(req,res)=>{
    res.json({success:true,data:await bulkService.exportHistory(req.user.id,
      {page:req.query.page,pageSize:req.query.pageSize})});
  }));
  // Bulk export: one background job per item, reusing the export-job
  // progress/cancel/retry UI. Returns the job ids to poll.
  router.post('/bulk',creditExportLimiter,action(async(req,res)=>{
    const result=await bulkService.requestBulk(req.user.id,req.body?.items,req.get('Idempotency-Key'));
    res.status(202).json({success:true,data:result});
  }));
  // ZIP package of completed bulk jobs. Every job is re-authorized and must
  // be complete; anything else fails closed before any byte is written.
  router.post('/bulk/package',creditExportLimiter,action(async(req,res)=>{
    const packaged=await bulkService.packageJobs(req.user.id,req.body?.jobIds);
    res.set({'Content-Type':'application/zip',
      'Content-Disposition':`attachment; filename="${packaged.filename}"`});
    packaged.archive.on('error',error=>{res.destroy(error);});
    packaged.archive.pipe(res);
  }));
  // Synchronous accounting download (OFX/QFX/QBO). Same scope authorization
  // as an export job; statements stay within the builders' row budget.
  router.post('/accounting',creditExportLimiter,action(async(req,res)=>{
    const result=await bulkService.accountingExport(req.user.id,req.body||{});
    const body=Buffer.from(result.content,'utf8');
    res.set({'Content-Type':result.mediaType,'Content-Length':String(body.length),
      'Content-Disposition':`attachment; filename="${result.filename}"`});
    res.send(body);
  }));
  // Private per-user entry notes. Owner-only in the service layer.
  router.get('/notes',action(async(req,res)=>{
    res.json({success:true,data:await noteService.list(req.user.id,{
      product:queryParam(req.query.product),documentId:queryParam(req.query.documentId),
      entryId:queryParam(req.query.entryId)})});
  }));
  router.post('/notes',action(async(req,res)=>{
    const saved=await noteService.upsert(req.user.id,req.body||{});
    res.status(200).json({success:true,data:saved});
  }));
  router.delete('/notes/:id',action(async(req,res)=>{
    res.json({success:true,data:await noteService.remove(req.user.id,req.params.id)});
  }));
  router.get('/notes/:id/attachment',action(async(req,res)=>{
    const url=await noteService.attachmentRedirect(req.user.id,req.params.id);
    res.redirect(302,url);
  }));

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
