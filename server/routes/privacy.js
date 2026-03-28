const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
/**
 * CCPA/CPRA Privacy Rights Routes
 * Provides data export, account deletion, and data portability
 * endpoints required by California and other state privacy laws.
 */
// GET /api/privacy/export - Export all user data (CCPA right to know)
router.get('/export', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    // Gather all user data across tables
    const userResult = await pool.query(
      `SELECT id, name, email, phone, role, city, state, zip_code,
              bio, skills, hourly_rate, availability, profile_photo,
              subscription_tier, created_at, updated_at
       FROM users WHERE id = $1`,
      [userId]
    );
    const jobsResult = await pool.query(
      `SELECT id, title, description, category, budget, status, created_at
       FROM jobs WHERE customer_id = $1 OR helper_id = $1`,
      [userId]
    );
    const bidsResult = await pool.query(
      `SELECT id, job_id, amount, message, status, created_at
       FROM bids WHERE helper_id = $1`,
      [userId]
    );
    const reviewsResult = await pool.query(
      `SELECT id, job_id, rating, comment, created_at
       FROM reviews WHERE reviewer_id = $1 OR reviewee_id = $1`,
      [userId]
    );
    const consentsResult = await pool.query(
      `SELECT consent_type, version, accepted_at
       FROM user_consents WHERE user_id = $1
       ORDER BY accepted_at DESC`,
      [userId]
    );
    const exportData = {
      exportDate: new Date().toISOString(),
      exportType: 'CCPA Data Export',
      user: userResult.rows[0] || null,
      jobs: jobsResult.rows,
      bids: bidsResult.rows,
      reviews: reviewsResult.rows,
      consents: consentsResult.rows,
    };
    // Remove sensitive fields
    if (exportData.user) {
      delete exportData.user.password_hash;
      delete exportData.user.otp_secret;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="oxsteed-data-export-${userId}-${Date.now()}.json"`
    );
    res.json(exportData);
  } catch (err) {
    console.error('[Privacy Export Error]', err);
    res.status(500).json({ error: 'Failed to export data. Please try again.' });
  }
});
// DELETE /api/privacy/delete-account - Request account deletion (CCPA right to delete)
router.delete('/delete-account', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { confirmation } = req.body;
    if (confirmation !== 'DELETE MY ACCOUNT') {
      return res.status(400).json({
        error: 'Please type "DELETE MY ACCOUNT" to confirm.',
      });
    }
    // Check for active escrow/Tier 3 jobs
    const activeJobs = await pool.query(
      `SELECT id FROM jobs
       WHERE (customer_id = $1 OR helper_id = $1)
       AND status IN ('in_progress', 'escrow_held')`,
      [userId]
    );
    if (activeJobs.rows.length > 0) {
      return res.status(409).json({
        error: 'Cannot delete account while you have active jobs or held escrow funds. Please resolve all active jobs first.',
        activeJobIds: activeJobs.rows.map((j) => j.id),
      });
    }
    // Soft-delete: anonymize PII but keep records for legal/financial compliance
    await pool.query(
      `UPDATE users SET
        name = 'Deleted User',
        email = CONCAT('deleted_', id, '@oxsteed.removed'),
        phone = NULL,
        bio = NULL,
        skills = NULL,
        profile_photo = NULL,
        city = NULL,
        state = NULL,
        zip_code = NULL,
        password_hash = 'DELETED',
        deleted_at = NOW(),
        updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );
    // Log the deletion request for audit
    await pool.query(
      `INSERT INTO user_consents (user_id, consent_type, version, ip_hash, user_agent)
       VALUES ($1, 'account_deletion', '1.0', $2, $3)`,
      [userId, req.ip, req.headers['user-agent'] || 'unknown']
    );
    res.json({
      message: 'Your account has been scheduled for deletion. Personal data has been anonymized. Some records may be retained for legal and financial compliance purposes as described in our Privacy Policy.',
    });
  } catch (err) {
    console.error('[Account Deletion Error]', err);
    res.status(500).json({ error: 'Failed to process deletion request.' });
  }
});
// GET /api/privacy/data-categories - List categories of data collected (CCPA disclosure)
router.get('/data-categories', (req, res) => {
  res.json({
    categories: [
      { category: 'Identifiers', examples: 'Name, email, phone number, mailing address', purpose: 'Account creation and authentication' },
      { category: 'Commercial Information', examples: 'Job postings, bids, transaction history', purpose: 'Platform marketplace operations' },
      { category: 'Financial Data', examples: 'Stripe customer ID, subscription tier', purpose: 'Payment processing (credit card data stored by Stripe only)' },
      { category: 'Professional Information', examples: 'Skills, hourly rate, availability, bio', purpose: 'Helper profile and job matching' },
      { category: 'Internet Activity', examples: 'IP address, browser type, pages visited', purpose: 'Analytics and security' },
      { category: 'Geolocation', examples: 'City, state, zip code', purpose: 'Location-based job matching' },
      { category: 'Background Check', examples: 'Pass/fail status from Checkr', purpose: 'Verified badge eligibility' },
    ],
    thirdParties: [
      { name: 'Stripe, Inc.', purpose: 'Payment processing', dataShared: 'Name, email for payment account' },
      { name: 'Checkr, Inc.', purpose: 'Background checks', dataShared: 'Name, DOB, SSN (provided directly to Checkr)' },
      { name: 'Resend', purpose: 'Email delivery', dataShared: 'Email address' },
      { name: 'Google Analytics', purpose: 'Usage analytics', dataShared: 'Anonymized usage data' },
    ],
  });
});
module.exports = router;
