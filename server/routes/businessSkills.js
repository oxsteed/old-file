const express = require('express');
const { authenticate } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const businessSkillsController = require('../controllers/businessSkillsController');

const router = express.Router({ mergeParams: true });
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const { scopeExempt } = require('../middleware/scopeGates');

// Rate limiting
router.use(generalLimiter);

// ── Public endpoints (skill search for UI autocomplete) ──────────────────────

// GET /api/businesses/:businessId/skills/search - autocomplete search
router.get('/:businessId/skills/search', scopeExempt('public-storefront'), businessSkillsController.searchSkillsForBusiness);

// ── Authenticated endpoints ──────────────────────────────────────────────────

// GET /api/businesses/:businessId/skills - list business's required skills
router.get('/:businessId/skills', scopeExempt('public-storefront'), businessSkillsController.listBusinessSkills);

// POST /api/businesses/:businessId/skills - add skill to business
router.post('/:businessId/skills', authenticate, requireBusinessAccess({ minRole: 'manager', resolvePermissions: false }), businessSkillsController.addBusinessSkill);

// PUT /api/businesses/:businessId/skills/:skillId - update skill requirement
router.put('/:businessId/skills/:skillId', authenticate, requireBusinessAccess({ minRole: 'manager', resolvePermissions: false }), businessSkillsController.updateBusinessSkill);

// DELETE /api/businesses/:businessId/skills/:skillId - remove skill
router.delete('/:businessId/skills/:skillId', authenticate, requireBusinessAccess({ minRole: 'manager', resolvePermissions: false }), businessSkillsController.removeBusinessSkill);

module.exports = router;
