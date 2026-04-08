const router          = require('express').Router();
const { requireAdmin, requireSuperAdmin } = require('../middleware/adminAuth');
const superCtrl       = require('../controllers/superAdminController');
const adminCtrl       = require('../controllers/adminController');

// ══════════════════════════════════════════════════════════════
// REGULAR ADMIN — both admin and super_admin can access
// ══════════════════════════════════════════════════════════════

// Dashboard
router.get('/dashboard',         requireAdmin, adminCtrl.getDashboardStats);

// Content moderation
router.get('/reports',           requireAdmin, adminCtrl.getReports);
router.put('/reports/:reportId', requireAdmin, adminCtrl.reviewReport);
router.get('/moderation-queue',  requireAdmin, adminCtrl.getModerationQueue);

// Jobs (read + moderate)
router.get('/jobs',                    requireAdmin, superCtrl.getJobs);
router.post('/jobs/:jobId/action',     requireAdmin, superCtrl.forceJobAction);

// Content removal — bids and reviews (always logged for super-admin review)
router.get('/content',                         requireAdmin, adminCtrl.getContent);
router.post('/bids/:bidId/remove',             requireAdmin, adminCtrl.removeBid);
router.post('/reviews/:reviewId/remove',       requireAdmin, adminCtrl.removeReview);
router.post('/reviews/:reviewId/restore',      requireAdmin, adminCtrl.restoreReview);

// Users — read + write actions (ban/unban logged; admins cannot ban other admins)
router.get('/users',            requireAdmin, superCtrl.getUsers);
router.get('/users/:userId',    requireAdmin, superCtrl.getUserDetail);
router.put('/users/:userId/name',  requireAdmin, superCtrl.updateUserName);
router.post('/users/:userId/ban',  requireAdmin, superCtrl.toggleUserBan);

// Market / Zip Code management
router.get('/markets',                        requireAdmin, adminCtrl.getMarkets);
router.post('/markets/:marketId/zip-codes',   requireAdmin, adminCtrl.addZipCodes);
router.delete('/markets/:marketId/zip-codes', requireAdmin, adminCtrl.removeZipCodes);

// ══════════════════════════════════════════════════════════════
// SUPER ADMIN ONLY
// ══════════════════════════════════════════════════════════════

// Full dashboard + charts
router.get('/super/dashboard',     requireSuperAdmin, superCtrl.getDashboardStats);
router.get('/super/revenue-chart', requireSuperAdmin, superCtrl.getRevenueChart);

// User management (privileged write)
router.post('/users/:userId/verify', requireSuperAdmin, superCtrl.verifyUser);
router.put('/users/:userId/role',    requireSuperAdmin, superCtrl.updateUserRole);
router.delete('/users/:userId',      requireSuperAdmin, superCtrl.deleteUser);
router.post('/super/force-logout/:userId', requireSuperAdmin, superCtrl.forceLogout);

// Admin account management (super_admin only)
router.get('/super/admin-accounts',             requireSuperAdmin, superCtrl.getAdminAccounts);
router.post('/super/admin-accounts',            requireSuperAdmin, superCtrl.createAdminAccount);
router.put('/super/admin-accounts/:id/status',  requireSuperAdmin, superCtrl.toggleAdminAccountStatus);
router.get('/super/admin-activity/:adminId',    requireSuperAdmin, superCtrl.getAdminActivity);

// Financials
router.get('/financials',            requireSuperAdmin, superCtrl.getFinancials);
router.get('/payouts',               requireSuperAdmin, superCtrl.getPayouts);
router.get('/super/revenue',         requireSuperAdmin, superCtrl.getRevenueSummary);
router.get('/super/revenue/export',  requireSuperAdmin, superCtrl.getRevenueExport);
router.post('/jobs/:jobId/refund',   requireSuperAdmin, superCtrl.issueManualRefund);

// Platform settings
router.get('/settings',              requireSuperAdmin, superCtrl.getSettings);
router.put('/settings/:key',         requireSuperAdmin, superCtrl.updateSetting);
router.put('/feature-flags/:key',    requireSuperAdmin, superCtrl.updateFeatureFlag);

// Audit log + export
router.get('/audit-log',             requireSuperAdmin, superCtrl.getAuditLog);
router.get('/export/:type',          requireSuperAdmin, superCtrl.exportData);

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
      // updated_at may not exist — try without it
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

// DELETE /api/admin/skills-lookup/:id  — soft delete (sets is_active=false)
router.delete('/skills-lookup/:id', requireAdmin, async (req, res) => {
  try {
    const { hard } = req.query;
    let result;
    if (hard === 'true') {
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

module.exports = router;
