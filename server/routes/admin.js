const router          = require('express').Router();
const { requireAdmin, requireSuperAdmin, requirePermission } = require('../middleware/adminAuth');
const { loadAssignedRegions, requireRegionAccessForUser } = require('../middleware/regionAuth');
const superCtrl       = require('../controllers/superAdminController');
const superUserCtrl   = require('../controllers/superAdminUserController');
const regionCtrl      = require('../controllers/adminRegionController');
const auditCtrl       = require('../controllers/auditController');
const adminCtrl       = require('../controllers/adminController');
const supportCtrl     = require('../controllers/supportController');
const searchCtrl      = require('../controllers/adminSearchController');
const permCtrl        = require('../controllers/adminPermissionController');
const bizModCtrl      = require('../controllers/businessModerationController');
const convAdminCtrl   = require('../controllers/conversationsAdminController');
const paymentsCtrl    = require('../controllers/paymentsAdminController');
const adminMsgCtrl    = require('../controllers/adminMessageController');
const adminPhoneVerificationCtrl = require('../controllers/adminPhoneVerificationController');
const logisticsInternalAccessCtrl = require('../controllers/logisticsInternalAccessController');
const restaurantCreditAdminCtrl = require('../controllers/restaurantCreditAdminController');
const oxsteedCreditCtrl = require('../controllers/oxsteedCreditController');
const oxsteedCreditCardCtrl = require('../controllers/oxsteedCreditCardController');
const { creditAdminMutationLimiter, creditExportLimiter, adminPhoneVerificationLimiter } = require('../middleware/rateLimiter');

function noStoreCreditResponse(_req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  next();
}

// —— Admin live-support availability toggle ——
router.get('/support/availability', requireAdmin, supportCtrl.getMyAvailability);
router.put('/support/availability', requireAdmin, supportCtrl.setMyAvailability);

// ══════════════════════════════════════════════════════════════
// REGULAR ADMIN - both admin and super_admin can access
// ══════════════════════════════════════════════════════════════

// Dashboard
router.get('/dashboard',         requireAdmin, adminCtrl.getDashboardStats);

// Content moderation
router.get('/reports',           requireAdmin, adminCtrl.getReports);
router.put('/reports/:reportId', requireAdmin, adminCtrl.reviewReport);
router.get('/moderation-queue',  requireAdmin, adminCtrl.getModerationQueue);

// Jobs (read + moderate - all admins)
router.get('/jobs',                    requireAdmin,      superCtrl.getJobs);
router.get('/jobs/:jobId',             requireAdmin,      superCtrl.getJobDetail);
router.post('/jobs/:jobId/action',     requireAdmin,      superCtrl.forceJobAction);
// Hard delete - delegatable via delete_jobs grant
router.delete('/jobs/:jobId',          requireAdmin, requirePermission('delete_jobs'), superCtrl.deleteJob);

// Content removal - bids and reviews (always logged for super-admin review)
router.get('/content',                         requireAdmin, adminCtrl.getContent);
router.post('/bids/:bidId/remove',             requireAdmin, adminCtrl.removeBid);
router.post('/reviews/:reviewId/remove',       requireAdmin, adminCtrl.removeReview);
router.post('/reviews/:reviewId/restore',      requireAdmin, adminCtrl.restoreReview);

// ══════════════════════════════════════════════════════════════
// ENTITY MODERATION - admin + super_admin
// ══════════════════════════════════════════════════════════════

// Businesses
router.get('/businesses',                      requireAdmin, bizModCtrl.listBusinesses);
router.get('/businesses/:id',                  requireAdmin, bizModCtrl.getBusinessDetail);
router.put('/businesses/:id/toggle',           requireAdmin, bizModCtrl.toggleBusiness);
router.put('/businesses/:id/flag',             requireAdmin, bizModCtrl.flagBusiness);
router.put('/businesses/:id/admin-notes',      requireAdmin, bizModCtrl.updateAdminNotes);
router.put('/businesses/:id/delete',           requireAdmin, bizModCtrl.deleteBusiness);

// Tool Rentals
router.get('/tool-rentals',             requireAdmin, bizModCtrl.listToolRentals);
router.put('/tool-rentals/:id/toggle',  requireAdmin, bizModCtrl.toggleToolRental);

// Planned Needs
router.get('/planned-needs',                         requireAdmin, bizModCtrl.listPlannedNeeds);
router.post('/planned-needs/:id/cancel-autopublish', requireAdmin, bizModCtrl.cancelAutopublish);
router.post('/planned-needs/:id/force-cancel',       requireAdmin, bizModCtrl.forceCancel);
router.post('/planned-needs/:id/:action',            requireAdmin, (req, res, next) => {
  if (req.params.action === 'cancel-autopublish') return bizModCtrl.cancelAutopublish(req, res, next);
  if (req.params.action === 'force-cancel') return bizModCtrl.forceCancel(req, res, next);
  return res.status(404).json({ error: 'Unknown planned need action.' });
});

// Payments list (read-only)
router.get('/payments', requireAdmin, requirePermission('view_financials'), paymentsCtrl.listPayments);

// Users - read + write actions (ban/unban logged; admins cannot ban other admins)
router.get('/users',            requireAdmin, superCtrl.getUsers);
router.get('/users/:userId',    requireAdmin, superCtrl.getUserDetail);
router.put('/users/:userId/name',  requireAdmin, superCtrl.updateUserName);
router.put('/users/:userId/didit-enforcement', requireAdmin, superCtrl.setUserDiditEnforcement);
router.post('/users/:userId/ban',  requireAdmin, superCtrl.toggleUserBan);
router.post(
  '/users/:userId/phone-verification-code',
  requireAdmin,
  requirePermission('verify_users'),
  adminPhoneVerificationLimiter,
  adminPhoneVerificationCtrl.sendCode,
);

// Market / Zip Code management
router.get('/regions',                       requireAdmin, regionCtrl.listRegions);
router.get('/markets',                        requireAdmin, adminCtrl.getMarkets);
router.post('/markets/:marketId/zip-codes',   requireAdmin, adminCtrl.addZipCodes);
router.delete('/markets/:marketId/zip-codes', requireAdmin, adminCtrl.removeZipCodes);

// ══════════════════════════════════════════════════════════════
// SUPER ADMIN ONLY
// ══════════════════════════════════════════════════════════════

// Full dashboard + charts
router.get('/super/dashboard',          requireSuperAdmin, superCtrl.getDashboardStats);
router.get('/super/revenue-chart',      requireSuperAdmin, superCtrl.getRevenueChart);
router.get('/super/dashboard/activity', requireSuperAdmin, superCtrl.getDashboardActivity);
router.get('/super/dashboard/geo',      requireSuperAdmin, superCtrl.getDashboardGeo);

// Restaurant credit oversight - global, super-admin-only read and control plane.
router.use('/super/restaurant-credit', noStoreCreditResponse);
router.get('/super/restaurant-credit/overview', requireSuperAdmin, restaurantCreditAdminCtrl.getOverview);
router.get('/super/restaurant-credit/wallets/:accountId', requireSuperAdmin, restaurantCreditAdminCtrl.getWalletDetail);
router.post('/super/restaurant-credit/wallets/:accountId/status', requireSuperAdmin, restaurantCreditAdminCtrl.updateWalletStatus);
router.post('/super/restaurant-credit/holds/:holdId/release', requireSuperAdmin, restaurantCreditAdminCtrl.releaseHold);
router.post('/super/restaurant-credit/load-requests/:requestId/approve', requireSuperAdmin, restaurantCreditAdminCtrl.approveLoadRequest);
router.post('/super/restaurant-credit/load-requests/:requestId/decline', requireSuperAdmin, restaurantCreditAdminCtrl.declineLoadRequest);

// OxSteed Credit holds are captured only by an authorized operator. Customer
// clients can create and release their own reservations, but never capture value.
router.post('/super/oxsteed-credit/holds/:holdId/capture', requireSuperAdmin, noStoreCreditResponse, creditAdminMutationLimiter, oxsteedCreditCtrl.adminCaptureHold);

// User management (privileged write)
// ID / background "confirm" is super-admin only (trust & compliance).
router.post('/users/:userId/verify', requireSuperAdmin, superCtrl.verifyUser);
router.put('/users/:userId/role',    requireSuperAdmin, superCtrl.updateUserRole);
router.delete('/users/:userId',      requireSuperAdmin, superCtrl.deleteUser);
router.post('/users/:userId/cancel-pending-deletion', requireSuperAdmin, superCtrl.cancelPendingDeletion);
router.post('/users/:userId/restore', requireSuperAdmin, superCtrl.restoreUser);
router.post('/super/force-logout/:userId', requireSuperAdmin, superCtrl.forceLogout);
router.post('/users/:userId/password', requireSuperAdmin, superCtrl.setUserPasswordBySuperAdmin);

// Impersonation (super-admin only)
router.post('/users/:userId/impersonate',     requireSuperAdmin, superCtrl.impersonateUser);
router.post('/users/:userId/impersonate/end', requireSuperAdmin, superCtrl.endImpersonation);

// Activity log & admin notes (all admins can read; super-admin can delete any note)
router.get('/users/:userId/activity',               requireAdmin, superCtrl.getUserActivityLog);
router.get('/users/:userId/notes',                  requireAdmin, superCtrl.getUserNotes);
router.post('/users/:userId/notes',                 requireAdmin, superCtrl.addUserNote);
router.put('/users/:userId/notes/:noteId',          requireAdmin, superCtrl.updateUserNote);
router.delete('/users/:userId/notes/:noteId',       requireAdmin, superCtrl.deleteUserNote);

// Granular status controls (super-admin only)
router.post('/users/:userId/suspend',    requireSuperAdmin, superCtrl.suspendUser);
router.post('/users/:userId/restrict',   requireSuperAdmin, superCtrl.restrictUser);
router.post('/users/:userId/warn',       requireSuperAdmin, superCtrl.warnUser);
router.post('/users/:userId/reactivate', requireSuperAdmin, superCtrl.reactivateUser);

// Extended profile editing (super-admin only)
router.put('/users/:userId/profile', requireSuperAdmin, superCtrl.updateUserProfile);

// Support tickets for a user (all admins)
router.get('/users/:userId/support-tickets', requireAdmin, superCtrl.getUserSupportTickets);

// Conversations (super-admin only - every read is audited)
router.get('/super/conversations',              requireSuperAdmin, convAdminCtrl.listConversations);
router.get('/super/conversations/:id',          requireSuperAdmin, convAdminCtrl.getThread);
router.post('/super/conversations/:id/break-glass', requireSuperAdmin, convAdminCtrl.breakGlass);
router.put('/super/conversations/:id/status', requireSuperAdmin, convAdminCtrl.setConversationStatus);
router.post('/super/conversations/:id/status', requireSuperAdmin, convAdminCtrl.setConversationStatus);
router.get('/super/guest-inquiries/:id',        requireSuperAdmin, convAdminCtrl.getGuestInquiry);

// Admin account management - delegatable via manage_admin_accounts grant
router.get('/super/admin-accounts',             requireAdmin, requirePermission('manage_admin_accounts'), superCtrl.getAdminAccounts);
router.get('/super/internal-staff',             requireSuperAdmin, superCtrl.getInternalStaffAccounts);
router.post('/super/admin-accounts',            requireAdmin, requirePermission('manage_admin_accounts'), superCtrl.createAdminAccount);
router.put('/super/admin-accounts/:id/status',  requireAdmin, requirePermission('manage_admin_accounts'), superCtrl.toggleAdminAccountStatus);
router.get('/super/admin-activity/:adminId',    requireAdmin, requirePermission('manage_admin_accounts'), superCtrl.getAdminActivity);

// Logistics internal access bootstrap (super-admin self-setup)
router.get('/super/logistics-internal-access/me', requireSuperAdmin, logisticsInternalAccessCtrl.getMyInternalAccess);
router.put('/super/logistics-internal-access/me', requireSuperAdmin, logisticsInternalAccessCtrl.upsertMyInternalAccess);
router.get('/super/logistics-internal-access', requireSuperAdmin, logisticsInternalAccessCtrl.listInternalAccessRecords);
router.put('/super/logistics-internal-access/:userId', requireSuperAdmin, logisticsInternalAccessCtrl.upsertInternalAccessForUser);

// Access gate rate-limit / lockout management (super-admin only)
router.get('/super/access-gate/lockouts',           requireSuperAdmin, logisticsInternalAccessCtrl.listLockouts);
router.post('/super/access-gate/lockouts/:id/lift', requireSuperAdmin, logisticsInternalAccessCtrl.liftLockoutById);
router.get('/super/access-gate/attempts',           requireSuperAdmin, logisticsInternalAccessCtrl.listAttempts);

// Financials - super-admin direct, or admin with view_financials grant
router.get('/financials',            requireAdmin, requirePermission('view_financials'), superCtrl.getFinancials);
router.get('/payouts',               requireAdmin, requirePermission('view_financials'), superCtrl.getPayouts);
// Failed-payout retry: super-admin only (no payouts-write grant exists in the
// permission catalogue). Requeues the payout; idempotent on completed payouts.
router.post('/super/payouts/:id/retry', requireSuperAdmin, superCtrl.retryPayout);
router.get('/super/money',           requireAdmin, requirePermission('view_financials'), superCtrl.getMoneyOverview);
router.get('/super/revenue',         requireAdmin, requirePermission('view_financials'), superCtrl.getRevenueSummary);
router.get('/super/revenue/export',  requireAdmin, requirePermission('view_financials'), superCtrl.getRevenueExport);
router.post('/jobs/:jobId/refund',   requireAdmin, requirePermission('issue_refunds'),   superCtrl.issueManualRefund);

// Platform settings - super-admin direct, or admin with manage_settings grant
router.get('/settings',              requireAdmin, requirePermission('manage_settings'), superCtrl.getSettings);
router.put('/settings/:key',         requireAdmin, requirePermission('manage_settings'), superCtrl.updateSetting);
router.put('/feature-flags/:key',    requireAdmin, requirePermission('manage_settings'), superCtrl.updateFeatureFlag);

// Audit log + export
router.get('/audit-log',             requireAdmin, requirePermission('view_audit_log'), superCtrl.getAuditLog);
router.get('/export/:type',          requireAdmin, requirePermission('export_data'),    superCtrl.exportData);

// ══════════════════════════════════════════════════════════════
// SUPPORT TICKETS (admin + super_admin)
// ══════════════════════════════════════════════════════════════

router.get('/support/stats',                          requireAdmin, supportCtrl.getStats);
router.get('/support/tickets',                        requireAdmin, supportCtrl.listTickets);
router.get('/support/tickets/:ticketId',              requireAdmin, supportCtrl.getTicketAdmin);
router.post('/support/tickets/:ticketId/claim',       requireAdmin, supportCtrl.claimTicket);
router.post('/support/tickets/:ticketId/unclaim',     requireAdmin, supportCtrl.unclaimTicket);
router.put('/support/tickets/:ticketId/status',       requireAdmin, supportCtrl.updateStatus);
router.put('/support/tickets/:ticketId/priority',     requireAdmin, supportCtrl.updatePriority);
router.post('/support/tickets/:ticketId/reply',       requireAdmin, supportCtrl.adminReply);

// ══════════════════════════════════════════════════════════════
// SEARCH ENGINE (admin + super_admin)
// ══════════════════════════════════════════════════════════════

// Global search - all admins (results logged automatically)
router.get('/search',                  requireAdmin, searchCtrl.search);

// Search audit log - super-admin or admins with view_search_logs permission
router.get('/super/search-logs',       requireSuperAdmin, searchCtrl.getSearchLogs);
router.get('/super/search-stats',      requireSuperAdmin, searchCtrl.getSearchStats);

// ══════════════════════════════════════════════════════════════
// PERMISSION GRANTS (super-admin manages; admins view own)
// ══════════════════════════════════════════════════════════════

// Self-lookup for the signed-in admin's own grants (no grant required: the
// response only ever contains the caller's own grants). The admin app's
// GrantGuard uses this to decide which grant-gated pages the admin may see.
// Super-admins hold every permission implicitly, so the client skips this call.
router.get('/permission-grants/me',    requireAdmin,      permCtrl.listMyGrants);

// Listing all grants or the full permission-scope catalogue exposes the
// permission model beyond the caller's own access, so it requires the
// grant used for managing admin accounts/permissions.
router.get('/permission-grants',          requireAdmin, requirePermission('manage_admin_accounts'), permCtrl.listGrants);
router.get('/permission-scopes',          requireAdmin, requirePermission('manage_admin_accounts'), permCtrl.getScopes);
router.post('/super/permission-grants',   requireSuperAdmin, permCtrl.createGrant);
router.delete('/super/permission-grants/:id', requireSuperAdmin, permCtrl.revokeGrant);

// Create regular user - super-admin, or admin with create_users grant
router.post('/super/users', requireSuperAdmin, superCtrl.createUser);

// ══════════════════════════════════════════════════════════════
// SUPER-ADMIN / REGIONAL-ADMIN - FULL USER MANAGEMENT
// ══════════════════════════════════════════════════════════════
// Full user create + edit, regional scoping, region CRUD, structured
// per-field audit log. Regional admins are gated by `loadAssignedRegions`
// + `requireRegionAccessForUser`. Super-admins always pass through.

// Full account creation (super-admin only)
router.post(
  '/super/users/create-full',
  requireSuperAdmin,
  superUserCtrl.createUserFull
);

// Region-scoped users list (admin or super-admin)
router.get(
  '/super/users/in-region',
  requireAdmin,
  loadAssignedRegions,
  superUserCtrl.getUsersInRegion
);

// Full account edit (super-admin or regional admin with region access)
router.put(
  '/super/users/:userId/edit-full',
  requireAdmin,
  loadAssignedRegions,
  requireRegionAccessForUser('userId'),
  superUserCtrl.editUserFull
);

// Region CRUD - super-admin only
router.get(   '/super/regions',             requireSuperAdmin, regionCtrl.listRegions);
router.post(  '/super/regions',             requireSuperAdmin, regionCtrl.createRegion);
router.put(   '/super/regions/:regionId',   requireSuperAdmin, regionCtrl.updateRegion);
router.delete('/super/regions/:regionId',   requireSuperAdmin, regionCtrl.deleteRegion);

// OxSteed Credit is a separate globally scoped stored-value rail. Keep
// issuance and oversight behind the existing Super Admin authentication gate.
router.use('/super/oxsteed-credit', noStoreCreditResponse);
router.post('/super/oxsteed-credit/cards/issue-virtual', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCardCtrl.adminIssueVirtualCard);
router.post('/super/oxsteed-credit/cards/issue-physical', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCardCtrl.adminIssuePhysicalCard);
router.get('/super/oxsteed-credit/cards', requireSuperAdmin, oxsteedCreditCardCtrl.listAdminCards);
router.post('/super/oxsteed-credit/cards/:cardId/fulfillment', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCardCtrl.updateAdminCardFulfillment);
router.post('/super/oxsteed-credit/cards/:cardId/revoke', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCardCtrl.revokeAdminCard);
router.get('/super/oxsteed-credit/rail', requireSuperAdmin, oxsteedCreditCtrl.getAdminCreditRail);
router.post('/super/oxsteed-credit/rail', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.updateAdminCreditRail);
router.get('/super/oxsteed-credit/overview', requireSuperAdmin, oxsteedCreditCtrl.getAdminOverview);
router.post('/super/oxsteed-credit/notifications/:notificationId/retry', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.retryAdminCreditNotification);
router.get('/super/oxsteed-credit/accounts', requireSuperAdmin, oxsteedCreditCtrl.listAdminCustomerAccounts);
router.get('/super/oxsteed-credit/accounts.csv', requireSuperAdmin, creditExportLimiter, oxsteedCreditCtrl.downloadAdminCustomerAccounts);
router.get('/super/oxsteed-credit/accounts/:customerId/eligible-partners', requireSuperAdmin, oxsteedCreditCtrl.getAdminCustomerEligiblePartners);
router.get('/super/oxsteed-credit/accounts/:customerId/statement.csv', requireSuperAdmin, creditExportLimiter, oxsteedCreditCtrl.downloadAdminCustomerStatement);
router.get('/super/oxsteed-credit/accounts/:customerId', requireSuperAdmin, oxsteedCreditCtrl.getAdminCustomerAccount);
router.get('/super/oxsteed-credit/transactions', requireSuperAdmin, oxsteedCreditCtrl.listAdminTransactions);
router.get('/super/oxsteed-credit/transactions.csv', requireSuperAdmin, creditExportLimiter, oxsteedCreditCtrl.downloadAdminTransactions);
router.get('/super/oxsteed-credit/transactions/:transactionId', requireSuperAdmin, oxsteedCreditCtrl.getAdminTransaction);
router.post('/super/oxsteed-credit/transactions/:transactionId/refund', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.refundAdminCredit);
router.get('/super/oxsteed-credit/partners', requireSuperAdmin, oxsteedCreditCtrl.listAdminPartners);
router.get('/super/oxsteed-credit/partners/directory', requireSuperAdmin, oxsteedCreditCtrl.listAdminPartnerDirectory);
router.get('/super/oxsteed-credit/partners.csv', requireSuperAdmin, creditExportLimiter, oxsteedCreditCtrl.downloadAdminPartners);
router.get('/super/oxsteed-credit/partners/:partnerId/ledger', requireSuperAdmin, noStoreCreditResponse, oxsteedCreditCtrl.getAdminPartnerLedger);
router.post('/super/oxsteed-credit/partners/:partnerId/funding', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.recordAdminPartnerFunding);
router.post('/super/oxsteed-credit/currency-quotes', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.createAdminCurrencyQuote);
router.get('/super/oxsteed-credit/currency-quotes/:quoteId', requireSuperAdmin, oxsteedCreditCtrl.getAdminCurrencyQuote);
router.get('/super/oxsteed-credit/agreements', requireSuperAdmin, oxsteedCreditCtrl.listAdminAgreements);
router.get('/super/oxsteed-credit/agreements.csv', requireSuperAdmin, creditExportLimiter, oxsteedCreditCtrl.downloadAdminAgreements);
router.get('/super/oxsteed-credit/entitlements', requireSuperAdmin, oxsteedCreditCtrl.listAdminEntitlements);
router.post('/super/oxsteed-credit/entitlements/bulk', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.bulkUpsertAdminEntitlements);
router.post('/super/oxsteed-credit/partners', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.registerAdminPartner);
router.post('/super/oxsteed-credit/partners/:partnerId/transition', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.transitionAdminPartner);
router.post('/super/oxsteed-credit/partners/:partnerId/agreements', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.createAdminAgreement);
router.post('/super/oxsteed-credit/agreements/:agreementId/transition', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.transitionAdminAgreement);
router.post('/super/oxsteed-credit/agreements/:agreementId/entitlements', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.upsertAdminEntitlement);
router.get('/super/oxsteed-credit/entitlements.csv', requireSuperAdmin, creditExportLimiter, oxsteedCreditCtrl.downloadAdminEntitlements);
router.post('/super/oxsteed-credit/customers/:customerId/loads', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.adminLoadCredit);
router.post('/super/oxsteed-credit/customers/:customerId/adjustments', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.adminAdjustCredit);
router.post('/super/oxsteed-credit/customers/:customerId/status', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.adminUpdateCreditAccountStatus);
router.get('/super/oxsteed-credit/disputes', requireSuperAdmin, oxsteedCreditCtrl.listAdminDisputes);
router.get('/super/oxsteed-credit/disputes.csv', requireSuperAdmin, creditExportLimiter, oxsteedCreditCtrl.downloadAdminCreditDisputes);
router.post('/super/oxsteed-credit/disputes/:disputeId/resolve', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.resolveAdminDispute);
router.get('/super/oxsteed-credit/audit-events', requireSuperAdmin, oxsteedCreditCtrl.listAdminCreditAuditEvents);
router.get('/super/oxsteed-credit/audit-events.csv', requireSuperAdmin, creditExportLimiter, oxsteedCreditCtrl.downloadAdminCreditAuditEvents);
router.get('/super/oxsteed-credit/settlements', requireSuperAdmin, oxsteedCreditCtrl.listAdminSettlements);
router.get('/super/oxsteed-credit/settlements.csv', requireSuperAdmin, creditExportLimiter, oxsteedCreditCtrl.downloadAdminSettlements);
router.get('/super/oxsteed-credit/reconciliation', requireSuperAdmin, oxsteedCreditCtrl.listAdminCreditReconciliationRuns);
router.get('/super/oxsteed-credit/reconciliation.csv', requireSuperAdmin, creditExportLimiter, oxsteedCreditCtrl.downloadAdminCreditReconciliationRuns);
router.post('/super/oxsteed-credit/settlements', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.createAdminSettlement);
router.post('/super/oxsteed-credit/settlements/:settlementId/status', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.transitionAdminSettlement);
router.post('/super/oxsteed-credit/settlements/:settlementId/reversal', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.reverseAdminSettlement);
router.post('/super/oxsteed-credit/reconciliation', requireSuperAdmin, creditAdminMutationLimiter, oxsteedCreditCtrl.reconcileAdminCredit);

// User-action audit log - super-admin or admins with view_audit_log grant
router.get(
  '/super/audit-log/user-actions',
  requireAdmin,
  requirePermission('view_audit_log'),
  auditCtrl.listUserActions
);
router.get(
  '/super/audit-log/user-actions/export',
  requireAdmin,
  requirePermission('view_audit_log'),
  auditCtrl.exportUserActions
);

// ══════════════════════════════════════════════════════════════
// ADMIN → USER LIVE MESSAGING (super-admin only)
// ══════════════════════════════════════════════════════════════

// Legacy single-send endpoint (kept for UserDetail.jsx compatibility)
router.post('/super/users/:userId/message', requireAdmin, requirePermission('message_users'), superCtrl.sendAdminMessage);

// Full messaging inbox (all admins with message_users permission, super bypasses)
router.get('/messages/conversations',             requireAdmin, requirePermission('message_users'), adminMsgCtrl.listConversations);
router.get('/messages/conversations/:userId',     requireAdmin, requirePermission('message_users'), adminMsgCtrl.getThread);
router.post('/messages/conversations/:userId/send', requireAdmin, requirePermission('message_users'), adminMsgCtrl.send);

// ══════════════════════════════════════════════════════════════
// SKILLS & CATEGORIES LOOKUP MANAGEMENT (admin + super_admin)
// ══════════════════════════════════════════════════════════════
const pool = require('../db');

// GET /api/admin/skills-lookup?q=&category=&limit=50&offset=0
router.get('/skills-lookup', requireAdmin, async (req, res) => {
  try {
    const { q = '', category = '', limit = 50, offset = 0 } = req.query;
    const limitN  = Math.min(Math.max(1, parseInt(limit)  || 50), 200);
    const offsetN = Math.max(0, parseInt(offset) || 0);
    const result = await pool.query(
      `SELECT id, name, category, is_active, created_at
         FROM skills_lookup
        WHERE ($1 = '' OR name ILIKE $2)
          AND ($3 = '' OR category ILIKE $4)
        ORDER BY category, name
        LIMIT $5 OFFSET $6`,
      [q, `%${q}%`, category, `%${category}%`, limitN, offsetN]
    );
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM skills_lookup
        WHERE ($1 = '' OR name ILIKE $2) AND ($3 = '' OR category ILIKE $4)`,
      [q, `%${q}%`, category, `%${category}%`]
    );
    res.json({ skills: result.rows, total: parseInt(countRes.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch skills lookup' });
  }
});

// GET /api/admin/skills-lookup/categories
router.get('/skills-lookup/categories', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT category FROM skills_lookup
        WHERE category IS NOT NULL ORDER BY category`
    );
    res.json({ categories: result.rows.map(r => r.category) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// POST /api/admin/skills-lookup
router.post('/skills-lookup', requireAdmin, async (req, res) => {
  try {
    const { name, category, is_active = true } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const result = await pool.query(
      `INSERT INTO skills_lookup (name, category, is_active)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET category = $2, is_active = $3, updated_at = NOW()
       RETURNING *`,
      [name.trim(), category?.trim() || null, is_active]
    ).catch(async () => {
      // updated_at may not exist - try without it
      return pool.query(
        `INSERT INTO skills_lookup (name, category, is_active)
         VALUES ($1, $2, $3)
         ON CONFLICT (name) DO UPDATE SET category = $2, is_active = $3
         RETURNING *`,
        [name.trim(), category?.trim() || null, is_active]
      );
    });
    res.status(201).json({ skill: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create skill' });
  }
});

// PUT /api/admin/skills-lookup/:id
router.put('/skills-lookup/:id', requireAdmin, async (req, res) => {
  try {
    const { name, category, is_active } = req.body;
    const result = await pool.query(
      `UPDATE skills_lookup
          SET name      = COALESCE($1, name),
              category  = COALESCE($2, category),
              is_active = COALESCE($3, is_active)
        WHERE id = $4
        RETURNING *`,
      [name?.trim() || null, category?.trim() || null, is_active ?? null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Skill not found' });
    res.json({ skill: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update skill' });
  }
});

// DELETE /api/admin/skills-lookup/:id  - soft delete (sets is_active=false)
// ?hard=true is a permanent hard delete - super-admin only
router.delete('/skills-lookup/:id', requireAdmin, async (req, res) => {
  try {
    const { hard } = req.query;
    let result;
    if (hard === 'true') {
      if (!req.isSuper) {
        return res.status(403).json({ error: 'Hard delete requires super-admin access.' });
      }
      result = await pool.query(
        `DELETE FROM skills_lookup WHERE id = $1 RETURNING id`, [req.params.id]
      );
    } else {
      result = await pool.query(
        `UPDATE skills_lookup SET is_active = false WHERE id = $1 RETURNING id`, [req.params.id]
      );
    }
    if (!result.rows.length) return res.status(404).json({ error: 'Skill not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete skill' });
  }
});


// ─── Licenses Lookup CRUD ─────────────────────────────────────────────────
// Mirrors the skills-lookup block exactly for licenses_lookup table.

// GET /api/admin/licenses-lookup?q=&category=&limit=50&offset=0
router.get('/licenses-lookup', requireAdmin, async (req, res) => {
  try {
    const { q = '', category = '', limit = 50, offset = 0 } = req.query;
    const limitN  = Math.min(Math.max(1, parseInt(limit)  || 50), 200);
    const offsetN = Math.max(0, parseInt(offset) || 0);
    const result = await pool.query(
      `SELECT id, name, category, is_active
         FROM licenses_lookup
        WHERE ($1 = '' OR name ILIKE $2)
          AND ($3 = '' OR category = $3)
        ORDER BY name
        LIMIT $4 OFFSET $5`,
      [q, `%${q}%`, category, limitN, offsetN]
    );
    const count = await pool.query(
      `SELECT COUNT(*) FROM licenses_lookup
        WHERE ($1 = '' OR name ILIKE $2)
          AND ($3 = '' OR category = $3)`,
      [q, `%${q}%`, category]
    );
    res.json({ licenses: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch licenses' });
  }
});

// GET /api/admin/licenses-lookup/categories
router.get('/licenses-lookup/categories', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT category FROM licenses_lookup
        WHERE category IS NOT NULL
        ORDER BY category`
    );
    res.json({ categories: rows.map(r => r.category) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch license categories' });
  }
});

// POST /api/admin/licenses-lookup
router.post('/licenses-lookup', requireAdmin, async (req, res) => {
  try {
    const { name, category, is_active = true } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    let result;
    try {
      result = await pool.query(
        `INSERT INTO licenses_lookup (name, category, is_active)
         VALUES ($1, $2, $3) RETURNING *`,
        [name.trim(), category?.trim() || null, is_active]
      );
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'License name already exists' });
      throw e;
    }
    res.status(201).json({ license: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create license' });
  }
});

// PUT /api/admin/licenses-lookup/:id
router.put('/licenses-lookup/:id', requireAdmin, async (req, res) => {
  try {
    const { name, category, is_active } = req.body;
    const result = await pool.query(
      `UPDATE licenses_lookup
          SET name      = COALESCE($1, name),
              category  = COALESCE($2, category),
              is_active = COALESCE($3, is_active)
        WHERE id = $4
        RETURNING *`,
      [name?.trim() || null, category?.trim() || null, is_active ?? null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'License not found' });
    res.json({ license: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update license' });
  }
});

// DELETE /api/admin/licenses-lookup/:id  - soft delete (sets is_active=false)
// ?hard=true is a permanent hard delete - super-admin only
router.delete('/licenses-lookup/:id', requireAdmin, async (req, res) => {
  try {
    const { hard } = req.query;
    let result;
    if (hard === 'true') {
      if (!req.isSuper) {
        return res.status(403).json({ error: 'Hard delete requires super-admin access.' });
      }
      result = await pool.query(
        `DELETE FROM licenses_lookup WHERE id = $1 RETURNING id`, [req.params.id]
      );
    } else {
      result = await pool.query(
        `UPDATE licenses_lookup SET is_active = false WHERE id = $1 RETURNING id`, [req.params.id]
      );
    }
    if (!result.rows.length) return res.status(404).json({ error: 'License not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete license' });
  }
});

module.exports = router;
