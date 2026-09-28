// server/routes/businesses.js
const express = require('express');
const router  = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const upload  = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');

// Centralized tenancy gate for mutating /:id and /:businessId routes.
const bizIdAccess = (minRole = 'any') => requireBusinessAccess({ paramName: 'id', minRole });
const businessIdAccess = (minRole = 'any') => requireBusinessAccess({ paramName: 'businessId', minRole });

const {
  listBusinesses, listBusinessCategories, addBusiness, updateBusiness, setPrimary, deleteBusiness,
  getBusinessOnboarding, updateBusinessOnboarding, completeBusinessOnboarding,
  uploadBusinessPhotos, getBusinessMediaAsset,
  getBusiness,
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
  listBusinessSkills, addBusinessSkill, updateBusinessSkill, replaceBusinessSkills, removeBusinessSkill,
  searchSkillsForBusiness,
} = require('../controllers/businessSkillsController');

const {
  listBusinessCalendar, getBusinessCalendarSummary,
  createBusinessEvent, updateBusinessEvent, deleteBusinessEvent,
} = require('../controllers/businessCalendarController');

const {
  listBusinessClients, createBusinessClient,
  updateBusinessClient, deleteBusinessClient,
} = require('../controllers/businessClientsController');

// ── Public invoice by token (no auth required) ────────────────────────────────
router.get('/invoices/public/:token', getPublicInvoice);

// ── Vortex redeem (no business id - must be before /:id routes) ───────────────
router.post('/vortex/redeem',                authenticate, redeemToken);
router.get('/categories',                    listBusinessCategories);

// ── Member invitations (must come before /:id routes) ─────────────────────────
router.get('/invitations',                   authenticate, listMyInvitations);
router.post('/invitations/:id/accept',       authenticate, acceptInvitation);
router.post('/invitations/:id/decline',      authenticate, declineInvitation);
router.get('/managed',                       authenticate, listManagedBusinesses);
router.get('/media/:assetId',                getBusinessMediaAsset);

// ── Public profile (no auth) - must be before authenticated /:id routes ───────
router.get('/:id/public',  getBusinessPublicProfile);
router.get('/:id/profile', getBusinessPublicProfile);

// ── Authenticated profile editor (before generic PUT /:id) ───────────────────
router.get('/:id/profile-edit', authenticate, getBusinessProfileForEditor);
router.put('/:id/slug', authenticate, bizIdAccess('owner'), require('../controllers/profileSlugController').setBusinessSlug);
router.get('/:id', authenticate, getBusiness);
router.get('/:id/onboarding', authenticate, getBusinessOnboarding);
router.put('/:id/onboarding', authenticate, bizIdAccess('any'), updateBusinessOnboarding);
router.post('/:id/onboarding/complete', authenticate, bizIdAccess('owner'), completeBusinessOnboarding);

// ── Business CRUD ─────────────────────────────────────────────────────────────
router.get('/',            authenticate, listBusinesses);
router.post('/',           authenticate, addBusiness);
router.put('/:id',         authenticate, bizIdAccess('any'), updateBusiness);
router.patch('/:id',       authenticate, bizIdAccess('any'), updateBusiness);
router.put('/:id/primary', authenticate, bizIdAccess('owner'), setPrimary);
router.put('/:id/photos',  authenticate, bizIdAccess('any'),
  upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'cover', maxCount: 1 }]),
  validateFileUpload,
  uploadBusinessPhotos);
router.delete('/:id',      authenticate, bizIdAccess('owner'), deleteBusiness);

// ── Analytics (P&L, trends, job stats) ───────────────────────────────────────
router.get('/:id/analytics', authenticate, getBusinessAnalytics);

// ── Invoices ──────────────────────────────────────────────────────────────────
router.get('/:id/invoices',                     authenticate, listInvoices);
router.get('/:id/invoices/:invoiceId',           authenticate, getInvoice);
router.post('/:id/invoices',                    authenticate, bizIdAccess('any'), createInvoice);
router.put('/:id/invoices/:invoiceId',           authenticate, bizIdAccess('any'), updateInvoice);
router.post('/:id/invoices/:invoiceId/pay',     authenticate, bizIdAccess('any'), markInvoicePaid);
router.post('/:id/invoices/:invoiceId/send',    authenticate, bizIdAccess('any'), sendInvoice);
router.delete('/:id/invoices/:invoiceId',       authenticate, bizIdAccess('any'), deleteInvoice);

// ── Tax estimates ─────────────────────────────────────────────────────────────
router.get('/:id/tax',                          authenticate, getBusinessTax);
router.post('/:id/tax/refresh',                 authenticate, bizIdAccess('any'), refreshTaxEstimates);
router.post('/:id/tax/:estimateId/pay',         authenticate, bizIdAccess('any'), markTaxPaid);

// ── Revenue / growth goals ────────────────────────────────────────────────────
router.get('/:id/goals',                        authenticate, listGoals);
router.post('/:id/goals',                       authenticate, bizIdAccess('any'), createGoal);
router.put('/:id/goals/:goalId',                authenticate, bizIdAccess('any'), updateGoal);
router.delete('/:id/goals/:goalId',             authenticate, bizIdAccess('any'), deleteGoal);

// ── Per-business calendar (appointments + internal events) ────────────────────
router.get('/:id/calendar',                     authenticate, listBusinessCalendar);
router.get('/:id/calendar/summary',             authenticate, getBusinessCalendarSummary);
router.post('/:id/calendar/events',             authenticate, bizIdAccess('any'), createBusinessEvent);
router.put('/:id/calendar/events/:eventId',     authenticate, bizIdAccess('any'), updateBusinessEvent);
router.delete('/:id/calendar/events/:eventId',  authenticate, bizIdAccess('any'), deleteBusinessEvent);

// ── Per-business clients (CRM) ────────────────────────────────────────────────
router.get('/:id/clients',                      authenticate, listBusinessClients);
router.post('/:id/clients',                     authenticate, bizIdAccess('any'), createBusinessClient);
router.put('/:id/clients/:clientId',            authenticate, bizIdAccess('any'), updateBusinessClient);
router.delete('/:id/clients/:clientId',         authenticate, bizIdAccess('any'), deleteBusinessClient);

// ── Business team members ─────────────────────────────────────────────────────
router.get('/:id/members',                      authenticate, listMembers);
router.post('/:id/members',                     authenticate, bizIdAccess('manager'), inviteMember);
router.delete('/:id/members/:memberId',         authenticate, bizIdAccess('manager'), revokeMember);

// ── Vortex tokens (per-business) ─────────────────────────────────────────────
router.get('/:id/vortex-tokens',                authenticate, listTokens);
router.post('/:id/vortex-tokens',               authenticate, bizIdAccess('manager'), generateToken);
router.delete('/:id/vortex-tokens/:tokenId',    authenticate, bizIdAccess('manager'), revokeToken);

// ── Business content (services, gallery, policies, faqs, hours) ────────────────
// SERVICES
router.get('/:businessId/services/manage',       authenticate, (req, res, next) => {
  req.query = { ...req.query, all: 'true' };
  return getBusinessServices(req, res, next);
});
router.get('/:businessId/services',              optionalAuth, getBusinessServices);
router.post('/:businessId/services',             authenticate, businessIdAccess('any'), createBusinessService);
router.put('/:businessId/services/:serviceId',   authenticate, businessIdAccess('any'), updateBusinessService);
router.delete('/:businessId/services/:serviceId', authenticate, businessIdAccess('any'), deleteBusinessService);

// GALLERY
router.get('/:businessId/gallery',               getBusinessGallery);
router.post('/:businessId/gallery',              authenticate, businessIdAccess('any'), addBusinessGalleryPhoto);
router.put('/:businessId/gallery/:photoId',      authenticate, businessIdAccess('any'), updateBusinessGalleryPhoto);
router.delete('/:businessId/gallery/:photoId',   authenticate, businessIdAccess('any'), deleteBusinessGalleryPhoto);

// POLICIES
router.get('/:businessId/policies',              getBusinessPolicies);
router.post('/:businessId/policies',             authenticate, businessIdAccess('any'), createBusinessPolicy);
router.put('/:businessId/policies/:policyId',    authenticate, businessIdAccess('any'), updateBusinessPolicy);
router.delete('/:businessId/policies/:policyId', authenticate, businessIdAccess('any'), deleteBusinessPolicy);

// FAQs
router.get('/:businessId/faqs',                  getBusinessFAQs);
router.post('/:businessId/faqs',                 authenticate, businessIdAccess('any'), createBusinessFAQ);
router.put('/:businessId/faqs/:faqId',           authenticate, businessIdAccess('any'), updateBusinessFAQ);
router.delete('/:businessId/faqs/:faqId',        authenticate, businessIdAccess('any'), deleteBusinessFAQ);

// HOURS
router.get('/:businessId/hours',                 getBusinessHours);
router.put('/:businessId/hours',                 authenticate, businessIdAccess('any'), updateBusinessHours);

// SKILLS
router.get('/:businessId/skills/search',         searchSkillsForBusiness);
router.get('/:businessId/skills',                listBusinessSkills);
router.post('/:businessId/skills',               authenticate, businessIdAccess('any'), addBusinessSkill);
router.put('/:businessId/skills',                authenticate, businessIdAccess('any'), replaceBusinessSkills);
router.put('/:businessId/skills/:skillId',       authenticate, businessIdAccess('any'), updateBusinessSkill);
router.delete('/:businessId/skills/:skillId',    authenticate, businessIdAccess('any'), removeBusinessSkill);

module.exports = router;
