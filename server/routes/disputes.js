const router      = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const disputeCtrl = require('../controllers/disputeController');
const adminDisputeCtrl = require('../controllers/disputeAdminController');
const { upload, validateMagicBytes } = require('../middleware/upload');

// User: open and manage own disputes
router.post('/jobs/:jobId',
  authenticate,
  disputeCtrl.openDispute
);

router.get('/my',
  authenticate,
  disputeCtrl.getMyDisputes
);

router.get('/:disputeId',
  authenticate,
  disputeCtrl.getDispute
);

router.post('/:disputeId/evidence',
  authenticate,
  upload.array('files', 5),
  validateMagicBytes,
  disputeCtrl.submitEvidence
);

router.post('/:disputeId/messages',
  authenticate,
  disputeCtrl.sendDisputeMessage
);

// Admin: dispute management
router.get('/admin/all',
  authenticate,
  requireAdmin,
  adminDisputeCtrl.getAllDisputes
);

router.post('/admin/:disputeId/review',
  authenticate,
  requireAdmin,
  adminDisputeCtrl.startReview
);

router.post('/admin/:disputeId/resolve',
  authenticate,
  requireAdmin,
  adminDisputeCtrl.resolveDispute
);

module.exports = router;
