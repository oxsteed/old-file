const router = require('express').Router();
const { requireAdmin } = require('../middleware/adminAuth');
const { requireOneTruthGrant } = require('../middleware/oneTruthAccess');
const ctrl = require('../controllers/oneTruthController');

// One Truth P1 (item 11): every read goes through the purpose-trail gate.
// Super-admins pass by role (reads still audit-logged as super_admin_duty);
// delegated analysts need an active investigation grant, and their reads are
// scoped to the union of the grants' scope_user_ids. No grant -> 403
// 'investigation_access_required', which the UI turns into a
// "request investigation access" action.
const readAccess = [requireAdmin, requireOneTruthGrant];

router.get('/filters',         ...readAccess, ctrl.getFilters);
router.get('/stats',           ...readAccess, ctrl.getStats);
router.get('/users',           ...readAccess, ctrl.listUsers);
router.get('/suspects',        ...readAccess, ctrl.listSuspects);
// Detail exposes full PII: super-admin passes; analysts need a grant that
// covers the target user id (checked inside the controller, mirroring the
// E13 investigation profile endpoint).
router.get('/user/:userId',    ...readAccess, ctrl.getUserDetail);
// Any admin may request a fraud_analyst grant; the named approver (super-admin
// or manage_users holder, never the requester) activates it.
router.post('/access-request', requireAdmin, ctrl.requestOneTruthAccess);
// Analyst triage: mark a suspect pair reviewed/confirmed/dismissed.
router.post('/pairs/review',   ...readAccess, ctrl.reviewSuspectPair);

module.exports = router;
