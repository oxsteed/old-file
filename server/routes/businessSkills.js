const express = require('express');
const { authenticate } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const businessSkillsController = require('../controllers/businessSkillsController');

const router = express.Router({ mergeParams: true });

// Rate limiting
router.use(generalLimiter);

// ── Public endpoints (skill search for UI autocomplete) ──────────────────────

// GET /api/businesses/:businessId/skills/search - autocomplete search
router.get('/:businessId/skills/search', businessSkillsController.searchSkillsForBusiness);

// ── Authenticated endpoints ──────────────────────────────────────────────────

// GET /api/businesses/:businessId/skills - list business's required skills
router.get('/:businessId/skills', businessSkillsController.listBusinessSkills);

// POST /api/businesses/:businessId/skills - add skill to business
router.post('/:businessId/skills', authenticate, businessSkillsController.addBusinessSkill);

// PUT /api/businesses/:businessId/skills/:skillId - update skill requirement
router.put('/:businessId/skills/:skillId', authenticate, businessSkillsController.updateBusinessSkill);

// DELETE /api/businesses/:businessId/skills/:skillId - remove skill
router.delete('/:businessId/skills/:skillId', authenticate, businessSkillsController.removeBusinessSkill);

module.exports = router;
