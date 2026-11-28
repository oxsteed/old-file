'use strict';

/**
 * investorReportingController.js — Slice 5f, "View entity reporting"
 * (roadmap items 726-730).
 *
 * The investor reporting dashboard's entity surfaces. All routes are
 * read-only (Group 14 is READ-ONLY, D-408): nothing here moves money.
 *
 * Scope follows the audience model (G-45, D-750): a holder with an
 * investor.reporting grant sees exactly the entities on their latest
 * active audience row, and an audience with no entities sees nothing —
 * never the platform. Admins and legacy investor roles reach these
 * routes without an audience (routes/investor.js allowInvestor) and see
 * the platform-wide picture, labeled as such. A holder with no audience
 * row at all reaches nothing: requireInvestorCapability refuses the
 * request before it gets here, and reportingScope below fails closed a
 * second time (position scope, empty) for any non-admin caller without
 * an audience.
 *
 * All queries fail open — missing tables return empty lists so the
 * dashboard never hard-errors on a fresh or partial deployment (the
 * investorController.js pattern).
 *
 * Routes (all under /api/investor/reporting):
 *   GET /entities                       — 726 entity summary
 *   GET /datasets                       — 727 authorized KPI dataset
 *   GET /documents                      — 728 reporting document library
 *   GET /entities/:entityId/contact     — 730 entity reporting contact
 */

const pool = require('../db');
const logger = require('../utils/logger');

const safeInt = (v) => parseInt(v ?? 0, 10) || 0;

const safeQuery = async (sql, params = []) => {
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } catch (e) {
    logger.warn('[investor-reporting] query skipped', { msg: e.message });
    return [];
  }
};

const tableExists = async (name) => {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
    [name],
  ).catch(() => ({ rows: [] }));
  return rows.length > 0;
};

function reportingScope(req) {
  const audience = req.investorAudience;
  if (audience) {
    const entityIds = (Array.isArray(audience.entity_ids) ? audience.entity_ids : [])
      .map(Number)
      .filter((n) => Number.isFinite(n));
    return { type: 'position', entityIds };
  }
  // Platform-wide is an admin/legacy view only. A granted holder whose
  // audience row is missing or expired must see nothing, never the
  // platform: the middleware's activation hold normally refuses such a
  // caller before it gets here, and this is the second lock on the door.
  // (investorController.js's reportingScope trusts the middleware alone;
  // this controller does not.)
  if (['admin', 'super_admin'].includes(req.user?.role)) return { type: 'platform_wide' };
  return { type: 'position', entityIds: [] };
}

function audienceView(req) {
  const audience = req.investorAudience;
  if (!audience) return null;
  return {
    key: audience.audience_key || null,
    datasets: Array.isArray(audience.datasets) ? audience.datasets : [],
    expiresAt: audience.expires_at || null,
  };
}

// Live opportunities are the post-approval states a reporting viewer can
// reason about; drafts and withdrawn/cancelled raises are not reporting.
const LIVE_OPPORTUNITY_STATUSES = ['published', 'paused', 'closing', 'closed'];
const DEAD_OPPORTUNITY_STATUSES = ['cancelled', 'withdrawn'];

// ── GET /api/investor/reporting/datasets — 727 authorized KPI dataset ──
// The six canonical datasets (reviewService.INVESTOR_DATASETS), each with
// whether this viewer's audience grants it and the API route that serves
// it. This makes the authorization explicit: the dashboard today hides
// withheld sections silently (datasetAllowed), so a holder cannot tell a
// withheld dataset from a broken one. `exports` has no serving route
// under /investor yet — it is grantable but serves nothing (sibling gap,
// not invented here): its apiRoute is null.
const DATASETS = Object.freeze([
  { id: 'overview', apiRoute: '/investor/kpis' },
  { id: 'revenue', apiRoute: '/investor/revenue-chart' },
  { id: 'franchise', apiRoute: '/investor/franchise' },
  { id: 'supply_demand', apiRoute: '/investor/supply-demand' },
  { id: 'evidence', apiRoute: '/investor/evidence/:metric' },
  { id: 'exports', apiRoute: null },
]);

exports.getDatasets = async (req, res) => {
  try {
    const scope = reportingScope(req);
    const audience = audienceView(req);
    const granted = new Set(audience ? audience.datasets : []);
    const all = scope.type === 'platform_wide' || granted.has('all');
    res.json({
      datasets: DATASETS.map((d) => ({
        id: d.id,
        granted: all || granted.has(d.id),
        apiRoute: d.apiRoute,
      })),
      scope,
      audience,
    });
  } catch (err) {
    logger.error('[investor-reporting] getDatasets error', { err: err.message });
    res.status(500).json({ error: 'Failed to load authorized datasets' });
  }
};
// One card per entity in the viewer's scope: the business identity, how
// many raises it has (live vs total), and the viewer's own live stakes in
// it (active positions, reserved/completed commitments, live participation
// applications) — the same UNION resolveInvestorScope uses (G-45).
exports.getEntities = async (req, res) => {
  try {
    const scope = reportingScope(req);
    const audience = audienceView(req);
    if (scope.type === 'position' && !scope.entityIds.length) {
      return res.json({ entities: [], scope, audience });
    }
    const [hasBusinesses, hasOpportunities, hasPositions, hasCommitments, hasApplications] = await Promise.all([
      tableExists('businesses'),
      tableExists('investment_opportunities'),
      tableExists('investment_positions'),
      tableExists('investment_commitments'),
      tableExists('investment_participation_applications'),
    ]);
    if (!hasBusinesses) return res.json({ entities: [], scope, audience });

    const where = scope.type === 'position' ? 'WHERE b.id = ANY($1::bigint[])' : '';
    const whereParams = scope.type === 'position' ? [scope.entityIds] : [];
    const limit = scope.type === 'platform_wide' ? 'LIMIT 50' : '';
    const userParam = scope.type === 'position' ? whereParams.length + 1 : 1;
    const userParams = [...whereParams, req.user.id];

    // Platform-wide lists only businesses with at least one raise that is
    // not dead; a position holder's list is exactly their audience, even
    // when an entity currently has no live raise.
    const having = scope.type === 'platform_wide' && hasOpportunities
      ? `HAVING COUNT(DISTINCT o.id) FILTER (WHERE o.status NOT IN (${DEAD_OPPORTUNITY_STATUSES.map((_, i) => `$${userParams.length + 1 + i}`).join(', ')})) > 0`
      : '';
    const havingParams = scope.type === 'platform_wide' && hasOpportunities
      ? DEAD_OPPORTUNITY_STATUSES : [];

    const rows = await safeQuery(`
      SELECT
        b.id AS entity_id,
        b.business_name,
        b.business_type,
        b.is_active,
        ${hasOpportunities ? `
        COUNT(DISTINCT o.id) AS total_opportunities,
        COUNT(DISTINCT o.id) FILTER (WHERE o.status = ANY($${userParams.length + 1 + havingParams.length}::varchar[])) AS live_opportunities,` : `
        0 AS total_opportunities,
        0 AS live_opportunities,`}
        ${hasPositions ? `
        COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'active') AS positions,` : `
        0 AS positions,`}
        ${hasCommitments ? `
        COUNT(DISTINCT c.id) FILTER (WHERE c.status IN ('reserved', 'completed')) AS commitments,` : `
        0 AS commitments,`}
        ${hasApplications ? `
        COUNT(DISTINCT a.id) FILTER (WHERE a.status IN ('submitted', 'under_review', 'approved')) AS applications` : `
        0 AS applications`}
      FROM businesses b
      ${hasOpportunities ? 'LEFT JOIN investment_opportunities o ON o.business_id = b.id' : ''}
      ${hasPositions ? `LEFT JOIN investment_positions p ON p.opportunity_id IN (SELECT id FROM investment_opportunities WHERE business_id = b.id) AND p.user_id = $${userParam}::uuid` : ''}
      ${hasCommitments ? `LEFT JOIN investment_commitments c ON c.opportunity_id IN (SELECT id FROM investment_opportunities WHERE business_id = b.id) AND c.user_id = $${userParam}::uuid` : ''}
      ${hasApplications ? `LEFT JOIN investment_participation_applications a ON a.opportunity_id IN (SELECT id FROM investment_opportunities WHERE business_id = b.id) AND a.user_id = $${userParam}::uuid` : ''}
      ${where}
      GROUP BY b.id, b.business_name, b.business_type, b.is_active
      ${having}
      ORDER BY b.business_name ASC
      ${limit}
    `, [...userParams, ...havingParams, LIVE_OPPORTUNITY_STATUSES]);

    res.json({
      entities: rows.map((row) => ({
        entityId: Number(row.entity_id),
        businessName: row.business_name,
        businessType: row.business_type || null,
        isActive: row.is_active !== false,
        opportunities: {
          total: safeInt(row.total_opportunities),
          live: safeInt(row.live_opportunities),
        },
        stakes: {
          positions: safeInt(row.positions),
          commitments: safeInt(row.commitments),
          applications: safeInt(row.applications),
        },
      })),
      scope,
      audience,
    });
  } catch (err) {
    logger.error('[investor-reporting] getEntities error', { err: err.message });
    res.status(500).json({ error: 'Failed to load entity summary' });
  }
};

// ── GET /api/investor/reporting/documents — 728 document library ─────
// One list of the reporting documents the viewer can open, most recent
// first, capped at 50. Two kinds, both viewer-scoped by construction:
//   evidence_share — the viewer's active audit evidence shares
//     (auditor = viewer, unrevoked, unexpired; 716-720), with the audit
//     title and expiry; the link opens the audit requests list.
//   export — the viewer's own statement export jobs (711-715), with
//     product/format/state; the link opens that product's archive page.
// No audience filter is needed: a share names its auditor and a job
// names its requester, so another user's documents can never appear —
// including for admins, who see only their own. Nothing here invents
// a document: every entry links to a surface that already exists.
const EXPORT_ARCHIVE_URL = Object.freeze({
  oxsteed: '/oxsteed-credit/statements/archive',
  restaurant: '/restaurant-credit/statements/archive',
  restaurant_settlement: '/restaurant-settlement/statements',
  helper_earnings: '/helper-earnings/statements',
  business: '/business/statements',
});

exports.getDocuments = async (req, res) => {
  try {
    const userId = req.user.id;
    const [hasShares, hasRequests, hasExports] = await Promise.all([
      tableExists('audit_request_shares'),
      tableExists('audit_requests'),
      tableExists('statement_export_jobs'),
    ]);
    const documents = [];
    if (hasShares && hasRequests) {
      const shares = await safeQuery(`
        SELECT s.id, s.audit_request_id, s.expires_at, s.created_at,
               r.title AS audit_title, r.status AS audit_status
          FROM audit_request_shares s
          JOIN audit_requests r ON r.id = s.audit_request_id
         WHERE s.auditor_user_id = $1::uuid
           AND s.revoked_at IS NULL
           AND s.expires_at > NOW()
         ORDER BY s.created_at DESC
         LIMIT 25`, [userId]);
      for (const row of shares) {
        documents.push({
          kind: 'evidence_share',
          id: row.id,
          title: row.audit_title,
          auditRequestId: row.audit_request_id,
          auditStatus: row.audit_status,
          expiresAt: row.expires_at,
          createdAt: row.created_at,
          url: '/statements/audit-requests',
        });
      }
    }
    if (hasExports) {
      const jobs = await safeQuery(`
        SELECT id, product, format, state, created_at, completed_at
          FROM statement_export_jobs
         WHERE requested_by = $1::uuid
         ORDER BY created_at DESC
         LIMIT 25`, [userId]);
      for (const row of jobs) {
        documents.push({
          kind: 'export',
          id: row.id,
          product: row.product,
          format: String(row.format || '').toUpperCase(),
          state: row.state,
          createdAt: row.created_at,
          completedAt: row.completed_at,
          url: EXPORT_ARCHIVE_URL[row.product] || '/statements',
        });
      }
    }
    documents.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ documents: documents.slice(0, 50), scope: reportingScope(req), audience: audienceView(req) });
  } catch (err) {
    logger.error('[investor-reporting] getDocuments error', { err: err.message });
    res.status(500).json({ error: 'Failed to load reporting documents' });
  }
};
