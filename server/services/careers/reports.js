'use strict';

// Hiring reports (careers spec §4.7 step 6, §15): funnel, time to hire,
// offer acceptance and 90-day retention, by store and region, inside the
// viewer's hiring scope.

const STAGE_KEYS = ['received', 'screening', 'interview', 'assessment', 'offer', 'hired', 'rejected', 'withdrawn', 'offer_declined', 'closed_unfilled'];

function scopeClause(access, params) {
  if (!access || access.kind === 'platform' || access.isOwner || ['business', 'brand'].includes(access.scope?.mode)) return '';
  params.push(access.scope.locationIds || []);
  return ` AND o.location_ids && $${params.length}::bigint[]`;
}

async function hiringReport(db, { access, since = null }) {
  const params = [access.businessId];
  let where = `o.business_id = $1 AND o.employer_type = 'business'`;
  if (since) { params.push(since); where += ` AND a.created_at >= $${params.length}`; }
  where += scopeClause(access, params);

  const { rows: funnel } = await db.query(
    `SELECT a.stage, COUNT(*)::int AS n
       FROM career_applications a JOIN career_openings o ON o.id = a.opening_id
      WHERE ${where} GROUP BY a.stage`,
    params
  );
  const counts = Object.fromEntries(STAGE_KEYS.map((k) => [k, 0]));
  for (const r of funnel) counts[r.stage] = r.n;

  const { rows: byStore } = await db.query(
    `WITH hires AS (
       SELECT a.id, a.created_at, of.location_id, of.decided_at AS accepted_at, of.id AS offer_id,
              (SELECT MIN(e.created_at) FROM career_application_events e WHERE e.application_id = a.id AND e.to_stage = 'hired') AS hired_at
         FROM career_applications a
         JOIN career_openings o ON o.id = a.opening_id
         JOIN career_offers of ON of.application_id = a.id AND of.status = 'accepted'
        WHERE ${where} AND a.stage = 'hired'
     ),
     offers AS (
       SELECT of.location_id, COUNT(*) FILTER (WHERE of.status IN ('accepted','declined','expired'))::int AS decided,
              COUNT(*) FILTER (WHERE of.status = 'accepted')::int AS accepted
         FROM career_offers of
         JOIN career_applications a ON a.id = of.application_id
         JOIN career_openings o ON o.id = a.opening_id
        WHERE ${where}
        GROUP BY of.location_id
     ),
     hire_stats AS (
       SELECT COALESCE(h.location_id, 0) AS loc, COUNT(*)::int AS hires,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (h.hired_at - h.created_at)) / 86400)
                FILTER (WHERE h.hired_at IS NOT NULL) AS median_days_to_hire,
              COUNT(*) FILTER (WHERE h.hired_at < NOW() - INTERVAL '90 days')::int AS hires_90d_ago,
              COUNT(*) FILTER (WHERE h.hired_at < NOW() - INTERVAL '90 days' AND EXISTS (
                SELECT 1 FROM business_members bm
                 WHERE bm.career_offer_id = h.offer_id
                   AND (bm.status = 'active' OR EXISTS (SELECT 1 FROM staff_offboarding_records r
                                                         WHERE r.membership_id = bm.id AND r.removed_at >= h.hired_at + INTERVAL '90 days'))))::int AS retained_90d
         FROM hires h GROUP BY COALESCE(h.location_id, 0)
     ),
     offer_stats AS (
       SELECT COALESCE(location_id, 0) AS loc, SUM(decided)::int AS decided, SUM(accepted)::int AS accepted
         FROM offers GROUP BY COALESCE(location_id, 0)
     ),
     locs AS (SELECT loc FROM hire_stats UNION SELECT loc FROM offer_stats)
     SELECT NULLIF(k.loc, 0) AS location_id, l.name AS location_name, l.region_id, rr.name AS region_name,
            COALESCE(hs.hires, 0) AS hires, hs.median_days_to_hire, COALESCE(hs.hires_90d_ago, 0) AS hires_90d_ago,
            COALESCE(hs.retained_90d, 0) AS retained_90d, COALESCE(os.decided, 0) AS offers_decided, COALESCE(os.accepted, 0) AS offers_accepted
       FROM locs k
       LEFT JOIN hire_stats hs ON hs.loc = k.loc
       LEFT JOIN offer_stats os ON os.loc = k.loc
       LEFT JOIN restaurant_locations l ON l.id = NULLIF(k.loc, 0)
       LEFT JOIN restaurant_regions rr ON rr.id = l.region_id
      ORDER BY l.name NULLS LAST`,
    params
  );
  const stores = byStore.map((r) => ({
    location_id: r.location_id == null ? null : Number(r.location_id),
    location_name: r.location_name,
    region_id: r.region_id == null ? null : Number(r.region_id),
    region_name: r.region_name,
    hires: r.hires,
    median_days_to_hire: r.median_days_to_hire == null ? null : Math.round(Number(r.median_days_to_hire) * 10) / 10,
    offer_acceptance_rate: r.offers_decided ? Math.round((r.offers_accepted / r.offers_decided) * 100) / 100 : null,
    retention_90d: r.hires_90d_ago ? Math.round((r.retained_90d / r.hires_90d_ago) * 100) / 100 : null,
    retention_90d_sample: r.hires_90d_ago,
  }));
  const regions = new Map();
  for (const s of stores) {
    const key = s.region_id ?? 'none';
    const g = regions.get(key) || { region_id: s.region_id, region_name: s.region_name, hires: 0, retained: 0, sample: 0 };
    g.hires += s.hires;
    if (s.retention_90d != null) { g.sample += s.retention_90d_sample; g.retained += Math.round(s.retention_90d * s.retention_90d_sample); }
    regions.set(key, g);
  }
  return {
    funnel: counts,
    stores,
    regions: [...regions.values()].map((g) => ({ region_id: g.region_id, region_name: g.region_name, hires: g.hires, retention_90d: g.sample ? Math.round((g.retained / g.sample) * 100) / 100 : null, retention_90d_sample: g.sample })),
  };
}

module.exports = { hiringReport, STAGE_KEYS };
