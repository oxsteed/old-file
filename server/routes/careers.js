'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/careerController');

router.get('/catalog', ctrl.getCatalog);
router.get('/openings', optionalAuth, ctrl.listPublicOpenings);
router.get('/openings/:idOrSlug', optionalAuth, ctrl.getPublicOpening);
router.post('/openings/:idOrSlug/apply', optionalAuth, ctrl.applyToOpening);

router.get('/me/applications', authenticate, ctrl.listMyApplications);
router.post('/me/applications/:applicationId/withdraw', authenticate, ctrl.withdrawMyApplication);
router.post('/offers/:offerId/decide', authenticate, ctrl.decideOffer);

router.get('/employer/openings', authenticate, ctrl.listEmployerOpenings);
router.post('/employer/openings', authenticate, ctrl.createOpening);
router.patch('/employer/openings/:id', authenticate, ctrl.updateOpening);
router.get('/employer/openings/:id/applications', authenticate, ctrl.listApplications);
router.post('/employer/applications/:applicationId/stage', authenticate, ctrl.changeStage);
router.post('/employer/applications/:applicationId/interviews', authenticate, ctrl.scheduleInterview);
router.post('/employer/applications/:applicationId/offers', authenticate, ctrl.createOffer);

module.exports = router;
