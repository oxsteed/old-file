'use strict';
const express = require('express');
const ctrl = require('../controllers/broadcastTrackingController');

const router = express.Router();
router.get('/o/:token', ctrl.emailOpen);
router.post('/p/:token', async(req,res,next)=>{
  if(!req.params.token.startsWith('growth.'))return ctrl.pushOpen(req,res,next);
  const data=require('../growth/partners/tokens').verify(req.params.token.slice(7));
  if(!data?.delivery_id)return res.sendStatus(204);
  try {await require('../db').query(`UPDATE offer_campaign_deliveries SET opened_at=COALESCE(opened_at,NOW())
    WHERE id=$1 AND channel='push' AND status='sent'`,[data.delivery_id]);}catch{/* no payload logging */}
  res.sendStatus(204);
});
router.get('/c/:token/:index', ctrl.click);
router.get('/u/:token', ctrl.unsubscribePage);
router.post('/u/:token', ctrl.unsubscribe);
module.exports = router;
