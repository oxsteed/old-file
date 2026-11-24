'use strict';
const router=require('express').Router(),{authenticate}=require('../middleware/auth'),{rejectImpersonated}=require('../middleware/rejectImpersonated'),{generalLimiter}=require('../middleware/rateLimiter'),service=require('../services/equipmentOperations');
const upload=require('../middleware/upload'),validateFileUpload=require('../middleware/validateFileUpload');
router.use(authenticate,generalLimiter,(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const handle=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){if(error.constraint==='equipment_calendar_conflict'){error.statusCode=409;error.code='equipment_calendar_conflict';}next(error);}};
router.get('/tools/:toolId',handle(async(req,res)=>res.json(await service.readTool(req.params.toolId,req.user.id))));
router.put('/tools/:toolId',rejectImpersonated,handle(async(req,res)=>res.json(await service.saveTool(req.params.toolId,req.user.id,req.body))));
router.post('/tools/:toolId/records',rejectImpersonated,handle(async(req,res)=>res.status(201).json(await service.record(req.params.toolId,req.user.id,req.body))));
router.get('/bookings/:bookingId',handle(async(req,res)=>res.json(await service.readBooking(req.params.bookingId,req.user.id))));
router.post('/bookings/:bookingId/reports',rejectImpersonated,handle(async(req,res)=>res.status(201).json(await service.report(req.params.bookingId,req.user.id,req.body))));
// Group 11 item 587: photo evidence attached to a condition/damage report.
router.post('/bookings/:bookingId/evidence',rejectImpersonated,upload.single('image'),validateFileUpload,handle(async(req,res)=>res.status(201).json(await service.addEvidence(req.params.bookingId,req.user.id,req.body,req.file))));
router.post('/bookings/:bookingId/missing/:reportId',rejectImpersonated,handle(async(req,res)=>res.json(await service.resolveMissing(req.params.bookingId,req.user.id,req.params.reportId,req.body))));
router.post('/bookings/:bookingId/extensions',rejectImpersonated,handle(async(req,res)=>res.status(201).json(await service.extend(req.params.bookingId,req.user.id,req.body))));
router.post('/bookings/:bookingId/extensions/:extensionId',rejectImpersonated,handle(async(req,res)=>res.json(await service.decideExtension(req.params.bookingId,req.user.id,req.params.extensionId,req.body))));
module.exports=router;
