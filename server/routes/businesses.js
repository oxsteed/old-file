// server/routes/businesses.js
const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const upload  = require('../middleware/upload');

const {
  listBusinesses, addBusiness, updateBusiness, setPrimary, deleteBusiness,
  uploadBusinessPhotos,
  getBusinessPublicProfile,
  getBusinessProfileForEditor,
  getBusinessAnalytics,
  getBusinessTax, refreshTaxEstimates, markTaxPaid,
  listGoals, createGoal, updateGoal, deleteGoal,
} = require('../controllers/businessController');

const {
  listInvoices, getInvoice, getPublicInvoice, createInvoice,
  updateInvoice, markInvoicePaid, deleteInvoice, sendInvoice,
} = require('../controllers/businessInvoiceController');

const {
  listMembers, inviteMember, revokeMember,
  listMyInvitations, acceptInvitation, declineInvitation,
  listManagedBusinesses,
} = require('../controllers/businessMembersController');

const {
  generateToken, listTokens, revokeToken, redeemToken,
} = require('../controllers/vortexController');

const {
  getBusinessServices, createBusinessService, updateBusinessService, deleteBusinessService,
  getBusinessGallery, addBusinessGalleryPhoto, updateBusinessGalleryPhoto, deleteBusinessGalleryPhoto,
  getBusinessPolicies, createBusinessPolicy, updateBusinessPolicy, deleteBusinessPolicy,
  getBusinessFAQs, createBusinessFAQ, updateBusinessFAQ, deleteBusinessFAQ,
  getBusinessHours, updateBusinessHours,
} = require('../controllers/businessContentController');

const {
  listBusinessSkills, addBusinessSkill, updateBusinessSkill, removeBusinessSkill,
  searchSkillsForBusiness,
} = require('../controllers/businessSkillsController');

// ── Public invoice by token (no auth required) ────────────────────────────────
router.get('/invoices/public/:token', getPublicInvoice);

// ── Vortex redeem (no business id — must be before /:id routes) ───────────────
router.post('/vortex/redeem',                authenticate, redeemToken);

// ── Member invitations (must come before /:id routes) ─────────────────────────
router.get('/invitations',                   authenticate, listMyInvitations);
router.post('/invitations/:id/accept',       authenticate, acceptInvitation);
router.post('/invitations/:id/decline',      authenticate, declineInvitation);
router.get('/managed',                       authenticate, listManagedBusinesses);

// ── Public profile (no auth) — must be before authenticated /:id routes ───────
router.get('/:id/public',  getBusinessPublicProfile);

// ── Authenticated profile editor (before generic PUT /:id) ───────────────────
router.get('/:id/profile-edit', authenticate, getBusinessProfileForEditor);

// ── Business CRUD ─────────────────────────────────────────────────────────────
router.get('/',            authenticate, listBusinesses);
router.post('/',           authenticate, addBusiness);
router.put('/:id',         authenticate, updateBusiness);
router.put('/:id/primary', authenticate, setPrimary);
router.put('/:id/photos',  authenticate,
  upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'cover', maxCount: 1 }]),
  uploadBusinessPhotos);
router.delete('/:id',      authenticate, deleteBusiness);

// ── Analytics (P&L, trends, job stats) ───────────────────────────────────────
router.get('/:id/analytics', authenticate, getBusinessAnalytics);

// ── Invoices ──────────────────────────────────────────────────────────────────
router.get('/:id/invoices',                     authenticate, listInvoices);
router.get('/:id/invoices/:invoiceId',           authenticate, getInvoice);
router.post('/:id/invoices',                    authenticate, createInvoice);
router.put('/:id/invoices/:invoiceId',           authenticate, updateInvoice);
router.post('/:id/invoices/:invoiceId/pay',     authenticate, markInvoicePaid);
router.post('/:id/invoices/:invoiceId/send',    authenticate, sendInvoice);
router.delete('/:id/invoices/:invoiceId',       authenticate, deleteInvoice);

// ── Tax estimates ─────────────────────────────────────────────────────────────
router.get('/:id/tax',                          authenticate, getBusinessTax);
router.post('/:id/tax/refresh',                 authenticate, refreshTaxEstimates);
router.post('/:id/tax/:estimateId/pay',         authenticate, markTaxPaid);

// ── Revenue / growth goals ────────────────────────────────────────────────────
router.get('/:id/goals',                        authenticate, listGoals);
router.post('/:id/goals',                       authenticate, createGoal);
router.put('/:id/goals/:goalId',                authenticate, updateGoal);
router.delete('/:id/goals/:goalId',             authenticate, deleteGoal);

// ── Business team members ─────────────────────────────────────────────────────
router.get('/:id/members',                      authenticate, listMembers);
router.post('/:id/members',                     authenticate, inviteMember);
router.delete('/:id/members/:memberId',         authenticate, revokeMember);

// ── Vortex tokens (per-business) ─────────────────────────────────────────────
router.get('/:id/vortex-tokens',                authenticate, listTokens);
router.post('/:id/vortex-tokens',               authenticate, generateToken);
router.delete('/:id/vortex-tokens/:tokenId',    authenticate, revokeToken);

// ── Business content (services, gallery, policies, faqs, hours) ────────────────
// SERVICES
router.get('/:businessId/services',              getBusinessServices);
router.post('/:businessId/services',             authenticate, createBusinessService);
router.put('/:businessId/services/:serviceId',   authenticate, updateBusinessService);
router.delete('/:businessId/services/:serviceId', authenticate, deleteBusinessService);

// GALLERY
router.get('/:businessId/gallery',               getBusinessGallery);
router.post('/:businessId/gallery',              authenticate, addBusinessGalleryPhoto);
router.put('/:businessId/gallery/:photoId',      authenticate, updateBusinessGalleryPhoto);
router.delete('/:businessId/gallery/:photoId',   authenticate, deleteBusinessGalleryPhoto);

// POLICIES
router.get('/:businessId/policies',              getBusinessPolicies);
router.post('/:businessId/policies',             authenticate, createBusinessPolicy);
router.put('/:businessId/policies/:policyId',    authenticate, updateBusinessPolicy);
router.delete('/:businessId/policies/:policyId', authenticate, deleteBusinessPolicy);

// FAQs
router.get('/:businessId/faqs',                  getBusinessFAQs);
router.post('/:businessId/faqs',                 authenticate, createBusinessFAQ);
router.put('/:businessId/faqs/:faqId',           authenticate, updateBusinessFAQ);
router.delete('/:businessId/faqs/:faqId',        authenticate, deleteBusinessFAQ);

// HOURS
router.get('/:businessId/hours',                 getBusinessHours);
router.put('/:businessId/hours',                 authenticate, updateBusinessHours);

// SKILLS
router.get('/:businessId/skills/search',         searchSkillsForBusiness);
router.get('/:businessId/skills',                listBusinessSkills);
router.post('/:businessId/skills',               authenticate, addBusinessSkill);
router.put('/:businessId/skills/:skillId',       authenticate, updateBusinessSkill);
router.delete('/:businessId/skills/:skillId',    authenticate, removeBusinessSkill);

module.exports = router;
