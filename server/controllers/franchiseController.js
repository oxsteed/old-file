const { randomBytes } = require('node:crypto');
const db = require('../db');
const logger = require('../utils/logger');
const countriesUtil = require('../utils/countries');
const access = require('../services/access/accessService');
// Group 12 Slice 3a (603): applicant documents reuse the staff-document
// vault storage pattern — private prefix, signed-URL downloads only.
const { uploadFile, getSignedDownloadUrl, deleteFile } = require('../utils/storage');
// Group 12 Slice 3e (625, D-326): policy change reminders — sent when a
// standard's version is published and on HQ's manual remind.
const { sendFranchiseStandardReminders } = require('../jobs/franchiseStandardReminders');

const APPLICATION_STATUSES = new Set([
  'inquiry',
  'screening',
  'application_review',
  'diligence',
  'agreement_pending',
  'approved',
  'rejected',
  'archived',
  'launched',
]);

const AGREEMENT_STATUSES = new Set(['draft', 'sent', 'signed', 'waived']);
const TRAINING_STATUSES = new Set(['not_started', 'scheduled', 'in_progress', 'completed']);
const READINESS_STATUSES = new Set(['not_ready', 'planning', 'ready', 'launched']);
const CHECKLIST_STATUSES = new Set(['pending', 'in_progress', 'completed', 'blocked', 'waived']);
// Group 12 Slice 3a.
const INTERVIEW_STATUSES = new Set(['proposed', 'booked', 'completed', 'cancelled']);
const DOCUMENT_CATEGORIES = ['identity', 'entity', 'financials', 'territory_plan'];
const DOCUMENT_CATEGORY_SET = new Set(DOCUMENT_CATEGORIES);
const DOCUMENT_REVIEW_STATUSES = new Set(['accepted', 'rejected']);
const FRANCHISE_POLICY_VERSION = 'franchise-policy-1';

const DEFAULT_CHECKLIST = [
  ['intake_review', 'Initial intake review', 'franchise_hq', 10],
  ['market_validation', 'Country and market validation', 'strategy', 20],
  ['financial_review', 'Financial capacity review', 'finance', 30],
  ['identity_and_entity', 'Owner identity and entity setup', 'legal', 40],
  ['territory_plan', 'Territory and region plan', 'operations', 50],
  ['agreement_package', 'Agreement package prepared and sent', 'legal', 60],
  ['training_plan', 'Training and onboarding plan', 'people', 70],
  ['launch_readiness', 'Launch readiness and opening checklist', 'operations', 80],
];

// Group 12 Slice 3b (608, D-306): the fixed operator responsibility set.
// These are the responsibilities the operator accepts for their territory.
// They are NOT the HQ intake checklist above: those 8 items are HQ process
// steps, these 8 are what the operator signs up to do. Labels are stored
// in English; the client renders the localized label by code.
const DEFAULT_RESPONSIBILITIES = [
  ['operate_territory', 'Operate the territory to OxSteed standards', 10],
  ['brand_standards', 'Uphold brand standards and customer experience', 20],
  ['recruit_train_team', 'Recruit and train the opening team', 30],
  ['comply_local_law', 'Comply with local laws and licensing', 40],
  ['report_performance', 'Report performance and keep records current', 50],
  ['honor_agreement_fees', 'Honor the agreement fee and royalty terms', 60],
  ['protect_brand_assets', 'Protect brand assets and confidential information', 70],
  ['resolve_customer_issues', 'Resolve customer issues in the territory promptly', 80],
];

function asTrimmed(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function parseMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * 100);
}

function parsePositiveInt(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseNonNegativeInt(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

// Franchise fee currency: a validated 3-letter ISO code, uppercased.
// Anything else falls back to USD (creation path) or is rejected by the
// upsert validator below; never stored unvalidated.
function normalizeCurrencyCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : 'USD';
}

/**
 * Keep the progressive franchise entitlement aligned with the current
 * launched application. G-26: one franchisee, two territories. The grant
 * is scoped per territory (subject_type 'franchise_application', the
 * subject carrying the application id), so losing one territory never
 * removes access to the other. A legacy self grant is revoked only when
 * the user has no launched application left. Reassignment/revocation
 * bumps the browser projection so an open workspace loses access promptly.
 */
async function syncFranchiseGrant(client, {
  applicationId = null,
  ownerUserId,
  status,
  linkedBusinessId,
  actorId = null,
  revokeUserIds = [],
} = {}) {
  const currentEligible = ownerUserId && status === 'launched' && linkedBusinessId;
  const affected = new Set((revokeUserIds || []).filter(Boolean).map(String));
  if (currentEligible) affected.add(String(ownerUserId));

  // Per-territory grant for this application.
  if (applicationId && ownerUserId) {
    if (currentEligible) {
      const { rows } = await client.query(
        `INSERT INTO access_grants (
           user_id, capability, subject_type, subject_id, subject_key, status, provenance,
           provenance_reason, policy_version, granted_by, status_changed_at,
           status_changed_by, status_reason_code, version, updated_at
         ) VALUES ($1, 'franchise.operate', 'franchise_application', $2, $3, 'active', 'admin',
           'territory_assignment', $4, $5, NOW(), $5, 'territory_assigned', 1, NOW())
         ON CONFLICT (user_id, capability, subject_key) DO UPDATE SET
           status = 'active', provenance = 'admin',
           provenance_reason = 'territory_assignment', policy_version = EXCLUDED.policy_version,
           granted_by = EXCLUDED.granted_by, granted_at = NOW(),
           status_changed_at = NOW(), status_changed_by = EXCLUDED.status_changed_by,
           status_reason_code = 'territory_assigned', version = access_grants.version + 1,
           updated_at = NOW()
         RETURNING user_id, status, version`,
        [ownerUserId, String(applicationId), `franchise_application:${applicationId}`, FRANCHISE_POLICY_VERSION, actorId],
      );
      if (rows.length) await access.bumpProjection(client, ownerUserId);
    } else {
      const { rows } = await client.query(
        `UPDATE access_grants
            SET status = 'revoked', status_changed_at = NOW(), status_changed_by = $2,
                status_reason_code = 'territory_assignment_ended', version = version + 1,
                updated_at = NOW()
          WHERE user_id = $1 AND capability = 'franchise.operate'
            AND subject_type = 'franchise_application' AND subject_id = $3
            AND status IN ('active', 'suspended')
          RETURNING user_id`,
        [ownerUserId, actorId, String(applicationId)],
      );
      if (rows.length) await access.bumpProjection(client, ownerUserId);
    }
  }

  for (const userId of affected) {
    if (currentEligible && String(userId) === String(ownerUserId)) continue;
    // A previous owner loses this application's per-territory grant.
    if (applicationId) {
      const { rows } = await client.query(
        `UPDATE access_grants
            SET status = 'revoked', status_changed_at = NOW(), status_changed_by = $2,
                status_reason_code = 'territory_assignment_ended', version = version + 1,
                updated_at = NOW()
          WHERE user_id = $1 AND capability = 'franchise.operate'
            AND subject_type = 'franchise_application' AND subject_id = $3
            AND status IN ('active', 'suspended')
          RETURNING user_id`,
        [userId, actorId, String(applicationId)],
      );
      if (rows.length) await access.bumpProjection(client, userId);
    }
    // Legacy self grant: revoke only when no launched application remains
    // for this user, so a second territory keeps access.
    const { rows: [remaining] } = await client.query(
      `SELECT 1 FROM franchise_applications
        WHERE (applicant_user_id = $1 OR owner_user_id = $1)
          AND status = 'launched' AND linked_business_id IS NOT NULL
          AND ($2::uuid IS NULL OR id <> $2)
        LIMIT 1`,
      [userId, applicationId || null],
    );
    if (remaining) continue;
    const { rows } = await client.query(
      `UPDATE access_grants
          SET status = 'revoked', status_changed_at = NOW(), status_changed_by = $2,
              status_reason_code = 'territory_assignment_ended', version = version + 1,
              updated_at = NOW()
        WHERE user_id = $1 AND capability = 'franchise.operate' AND subject_key = 'self'
          AND status IN ('active', 'suspended')
        RETURNING user_id`,
      [userId, actorId],
    );
    if (rows.length) await access.bumpProjection(client, userId);
  }
}

async function ensureProgram(client) {
  const programResult = await client.query(
    `SELECT id, default_currency, initial_fee_cents, royalty_bps, marketing_fee_bps, term_years
       FROM franchise_programs
      WHERE code = 'oxsteed-global'
      LIMIT 1`
  );

  if (!programResult.rows.length) {
    throw new Error('Default franchise program missing');
  }

  return programResult.rows[0];
}

async function seedChecklist(client, applicationId) {
  for (const [code, label, ownerRole, sortOrder] of DEFAULT_CHECKLIST) {
    await client.query(
      `INSERT INTO franchise_application_checklist_items
         (application_id, code, label, owner_role, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (application_id, code) DO NOTHING`,
      [applicationId, code, label, ownerRole, sortOrder]
    );
  }
}

// Group 12 Slice 3b (609, D-309): the default launch plan steps. Dates
// and owners are filled in by HQ afterwards; `milestone_id` stays NULL
// until the 611 location milestones exist and plug in.
const DEFAULT_LAUNCH_PLAN_STEPS = [
  ['confirm_boundary', 'Confirm territory boundary and exclusivity', 'Review the boundary summary and exclusivity with HQ.', 'operator', 10],
  ['complete_training', 'Complete operator training', 'Finish the training programme for your territory.', 'operator', 20],
  ['secure_location', 'Secure the first location', 'Sign the first location inside your territory.', 'operator', 30],
  ['recruit_team', 'Recruit the opening team', 'Hire the opening team for the first location.', 'operator', 40],
  ['confirm_opening_date', 'Confirm the opening date with HQ', 'Agree the launch date and readiness review with HQ.', 'shared', 50],
];

const LAUNCH_PLAN_STATUSES = new Set(['pending', 'in_progress', 'completed', 'blocked']);
const LAUNCH_PLAN_OWNER_ROLES = new Set(['operator', 'hq', 'shared']);

// Group 12 Slice 3c (611-615, D-311..D-315): open locations. A location is
// a business/restaurant location inside a territory (D-298), never a new
// territory. Milestones (611) share the launch plan's status set and
// owner roles; the opening team (612) is lead/member; a readiness review
// (613) passes or requests changes; a location launches (614) only with
// at least one available service and is confirmed open (615) by the
// operator afterwards.
const MILESTONE_STATUSES = LAUNCH_PLAN_STATUSES;
const MILESTONE_OWNER_ROLES = LAUNCH_PLAN_OWNER_ROLES;
const OPENING_TEAM_ROLES = new Set(['lead', 'member']);
const READINESS_REVIEW_OUTCOMES = new Set(['passed', 'changes_requested']);
const LOCATION_STATUSES = new Set(['planned', 'launched']);

// Group 12 Slice 3b (607, D-294/D-308): seed the boundary with one
// included area from the territory the applicant asked for. HQ refines the
// list afterwards; the operator never edits it.
async function seedTerritoryArea(client, applicationId, { country, region, city }) {
  if (!country) return;
  await client.query(
    `INSERT INTO franchise_territory_areas
       (application_id, country, region, city, area_type, sort_order)
     SELECT $1, $2, $3, $4, 'included', 10
      WHERE NOT EXISTS (
        SELECT 1 FROM franchise_territory_areas
         WHERE application_id = $1
      )`,
    [applicationId, country, region || null, city || null]
  );
}

// Group 12 Slice 3b (609, D-309): seed the default launch plan steps on
// every new application. Guarded so a second seed is a no-op. (The guard
// is a separate SELECT: reusing the code parameter inside an INSERT ...
// SELECT ... WHERE NOT EXISTS makes Postgres deduce inconsistent types
// for it.)
async function seedLaunchPlanSteps(client, applicationId) {
  for (const [code, title, description, ownerRole, sortOrder] of DEFAULT_LAUNCH_PLAN_STEPS) {
    const { rows } = await client.query(
      `SELECT 1 FROM franchise_launch_plan_steps
        WHERE application_id = $1 AND code = $2 LIMIT 1`,
      [applicationId, code]
    );
    if (rows.length) continue;
    await client.query(
      `INSERT INTO franchise_launch_plan_steps
         (application_id, code, title, description, owner_role, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [applicationId, code, title, description, ownerRole, sortOrder]
    );
  }
}

// Group 12 Slice 3c (611-615, D-311): seed the first location inside the
// territory from the fields the applicant asked for, same pattern as the
// boundary seed above. HQ adds further locations afterwards; the operator
// never creates locations. Guarded so a second seed is a no-op.
async function seedLocation(client, applicationId, { country, region, city }) {
  const { rows } = await client.query(
    `SELECT 1 FROM franchise_locations WHERE application_id = $1 LIMIT 1`,
    [applicationId]
  );
  if (rows.length) return;
  const name = city ? `${city} location` : 'First location';
  await client.query(
    `INSERT INTO franchise_locations
       (application_id, name, city, region, country)
     VALUES ($1, $2, $3, $4, $5)`,
    [applicationId, name, city || null, region || null, country || null]
  );
}

// Group 12 Slice 3b (608, D-306): seed the operator responsibility set on
// every new application, same pattern as the HQ checklist above.
async function seedResponsibilityItems(client, applicationId) {
  for (const [code, label, sortOrder] of DEFAULT_RESPONSIBILITIES) {
    await client.query(
      `INSERT INTO franchise_responsibility_items
         (application_id, code, label, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (application_id, code) DO NOTHING`,
      [applicationId, code, label, sortOrder]
    );
  }
}

async function logActivity(client, applicationId, actorId, eventType, eventSummary, metadata = {}) {
  await client.query(
    `INSERT INTO franchise_activity_log
       (application_id, actor_id, event_type, event_summary, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [applicationId, actorId || null, eventType, eventSummary, JSON.stringify(metadata || {})]
  );
}

async function fetchFranchiseApplicationBundle(applicationId) {
  const applicationResult = await db.query(
    `SELECT
        fa.*,
        fp.name AS program_name,
        fp.default_currency,
        b.business_name AS linked_business_name,
        owner.email AS owner_email,
        owner.first_name AS owner_first_name,
        owner.last_name AS owner_last_name
      FROM franchise_applications fa
      JOIN franchise_programs fp ON fp.id = fa.program_id
      LEFT JOIN businesses b ON b.id = fa.linked_business_id
      LEFT JOIN users owner ON owner.id = fa.owner_user_id
      WHERE fa.id = $1`,
    [applicationId]
  );

  if (!applicationResult.rows.length) return null;

  const checklistResult = await db.query(
    `SELECT *
       FROM franchise_application_checklist_items
      WHERE application_id = $1
      ORDER BY sort_order, id`,
    [applicationId]
  );

  const agreementResult = await db.query(
    `SELECT *
       FROM franchise_agreements
      WHERE application_id = $1
      LIMIT 1`,
    [applicationId]
  );

  const notesResult = await db.query(
    `SELECT fan.*, u.email AS admin_email, u.first_name AS admin_first_name, u.last_name AS admin_last_name
       FROM franchise_application_notes fan
       LEFT JOIN users u ON u.id = fan.admin_id
      WHERE fan.application_id = $1
      ORDER BY fan.created_at DESC`,
    [applicationId]
  );

  const activityResult = await db.query(
    `SELECT fal.*, u.email AS actor_email
       FROM franchise_activity_log fal
       LEFT JOIN users u ON u.id = fal.actor_id
      WHERE fal.application_id = $1
      ORDER BY fal.created_at DESC
      LIMIT 50`,
    [applicationId]
  );

  const interviewResult = await db.query(
    `SELECT *
       FROM franchise_interview_slots
      WHERE application_id = $1
      ORDER BY starts_at ASC, id ASC`,
    [applicationId]
  );

  const documentResult = await db.query(
    `SELECT *
       FROM franchise_application_documents
      WHERE application_id = $1
      ORDER BY created_at DESC, id DESC`,
    [applicationId]
  );

  const followupResult = await db.query(
    `SELECT ffm.*, u.email AS author_email, u.first_name AS author_first_name, u.last_name AS author_last_name
       FROM franchise_followup_messages ffm
       LEFT JOIN users u ON u.id = ffm.author_id
      WHERE ffm.application_id = $1
      ORDER BY ffm.created_at ASC, ffm.id ASC`,
    [applicationId]
  );

  // Group 12 Slice 3b (608): the operator responsibility checklist.
  const responsibilityResult = await db.query(
    `SELECT *
       FROM franchise_responsibility_items
      WHERE application_id = $1
      ORDER BY sort_order, id`,
    [applicationId]
  );

  // Group 12 Slice 3b (607): the assignment boundary area list.
  const areaResult = await db.query(
    `SELECT *
       FROM franchise_territory_areas
      WHERE application_id = $1
      ORDER BY sort_order, id`,
    [applicationId]
  );

  // Group 12 Slice 3b (609): the territory launch plan steps.
  const launchPlanResult = await db.query(
    `SELECT *
       FROM franchise_launch_plan_steps
      WHERE application_id = $1
      ORDER BY sort_order, id`,
    [applicationId]
  );

  // Group 12 Slice 3c (611/612/614/615): the open locations with their
  // milestones, service availability, opening team, and confirmations.
  const locations = await fetchOpenLocations(applicationId);
  // Group 12 Slice 3c (614): the services the linked business can offer
  // — the catalogue the location checklists draw from.
  const businessServices = await fetchBusinessServices(applicationId);
  // Group 12 Slice 3c (613): the readiness review history, reviewer
  // included — HQ sees who signed off.
  const readinessReviews = await fetchReadinessReviews(applicationId, { includeReviewer: true });
  // Group 12 Slice 3c (612): the territory-wide opening team.
  const openingTeam = await fetchTerritoryOpeningTeam(applicationId);
  // Group 12 Slice 3d (616/618/620): territory invitations, training
  // distribution, and the HQ announcement feed (HQ sees read counts).
  const territoryInvitations = await fetchTerritoryInvitations(applicationId);
  const trainingAssignments = await fetchTrainingAssignments(applicationId);
  const announcements = await fetchAnnouncements(applicationId, { includeReadCounts: true });
  // Group 12 Slice 3e (621): the franchise standards library — the
  // franchise-wide standards plus this territory's own. HQ sees the
  // full acknowledgment list (622).
  const standards = await fetchFranchiseStandards(applicationId, { includeAcknowledgments: true });
  // Group 12 Slice 3e (623): the brand asset store — the franchise-wide
  // assets plus this territory's own.
  const brandAssets = await fetchBrandAssets(applicationId);
  // Group 12 Slice 3f (628, D-327): the service exception summary —
  // the territory's support tickets aggregated, derived on read.
  const exceptionSummary = await buildExceptionSummary(applicationId);
  // Group 12 Slice 3f (627, D-328): the per-location health view.
  const locationHealth = await buildLocationHealth(applicationId);
  // Group 12 Slice 3g (632, D-332): the territory members with names —
  // the member picker for remediation assignment.
  const territoryMembers = await fetchTerritoryMembers(applicationId);
  // Group 12 Slice 3g (635, D-335): the per-exception resolution state —
  // derived on read, so it can never drift from ticket + action state.
  const exceptionResolution = await buildExceptionResolution(applicationId);
  // Group 12 Slice 3h (636, D-336): the candidate locations inside this
  // territory — what the territory is scouting, shortlisted, or decided.
  const candidateLocations = await buildCandidateLocations(applicationId);
  // Group 12 Slice 3h (637, D-337): the structured per-area capacity
  // view — targets, open/planned/candidate load, staffing and exception
  // load per boundary area. Derived on read, no map.
  const territoryCapacity = await buildTerritoryCapacity(applicationId);
  // Group 12 Slice 3h (638, D-338): the training resource planner — who
  // needs what training by when, and how much is covered. Derived.
  const trainingPlanner = await buildTrainingPlanner(applicationId);
  // Group 12 Slice 3h (639, D-339): the launch dependency overview —
  // per-location dependencies with blocked/blocking status. Derived.
  const launchDependencies = await buildLaunchDependencies(applicationId);
  // Group 12 Slice 3h (640, D-340): the operator-authored expansion
  // readiness notes, read by HQ alongside its own admin fields.
  const expansionNotes = await buildExpansionNotes(applicationId);
  // Group 12 Slice 3i (641/643, D-341/D-343): the operator handoff flow
  // (with its live checklist) and the operator-maintained contact
  // directory, both visible to HQ on the same bundle.
  const handoffs = await buildHandoffs(applicationId);
  const contactDirectory = await buildContactDirectory(applicationId);
  // Group 12 Slice 3j (646, D-347): the territory's policy questions —
  // support tickets with category 'policy_question', with the territory
  // context attached from creation.
  const policyQuestions = await fetchPolicyQuestions(applicationId);

  const checklist = checklistResult.rows;
  const completedChecklist = checklist.filter((item) => item.status === 'completed' || item.status === 'waived').length;
  const documents = await Promise.all(documentResult.rows.map(presentFranchiseDocument));
  const responsibilities = responsibilityResult.rows;
  const acknowledgedResponsibilities = responsibilities.filter((item) => item.status === 'acknowledged').length;

  return {
    application: {
      ...applicationResult.rows[0],
      checklist_total: checklist.length,
      checklist_completed: completedChecklist,
      responsibility_total: responsibilities.length,
      responsibility_acknowledged: acknowledgedResponsibilities,
    },
    checklist,
    responsibilities,
    territory_areas: areaResult.rows,
    launch_plan_steps: launchPlanResult.rows,
    locations,
    business_services: businessServices,
    opening_team: openingTeam,
    territory_invitations: territoryInvitations,
    training_assignments: trainingAssignments,
    announcements,
    standards,
    brand_assets: brandAssets,
    exception_summary: exceptionSummary,
    location_health: locationHealth,
    territory_members: territoryMembers,
    exception_resolution: exceptionResolution,
    candidate_locations: candidateLocations,
    territory_capacity: territoryCapacity,
    training_planner: trainingPlanner,
    launch_dependencies: launchDependencies,
    expansion_notes: expansionNotes,
    handoffs,
    contact_directory: contactDirectory,
    policy_questions: policyQuestions,
    // Group 12 Slice 3e (624, D-325): the operator compliance checklist,
    // derived from the standards library, the acknowledgment state, and
    // readiness — team perspective for HQ.
    compliance_checklist: buildComplianceChecklist({
      standards,
      readinessStatus: applicationResult.rows[0].launch_readiness_status,
      perspective: 'team',
    }),
    readiness_reviews: readinessReviews,
    agreement: agreementResult.rows[0] || null,
    notes: notesResult.rows,
    activity: activityResult.rows,
    interviews: interviewResult.rows,
    documents,
    document_categories: documentCategorySummary(documentResult.rows),
    followup: followupResult.rows,
  };
}

// Group 12 Slice 3c (611/612/614/615): the open-locations bundle — every
// location in the territory with its milestones, service availability,
// opening team, and opening confirmation attached. `launch_complete` is
// derived, never stored: a location is complete only once launched AND
// confirmed open (D-315).
async function fetchOpenLocations(applicationId) {
  const locationResult = await db.query(
    `SELECT * FROM franchise_locations
      WHERE application_id = $1
      ORDER BY created_at ASC, id ASC`,
    [applicationId]
  );
  const locations = locationResult.rows;
  if (!locations.length) return [];
  const locationIds = locations.map((location) => location.id);
  const [milestoneResult, serviceResult, teamResult, confirmationResult, managerResult] = await Promise.all([
    db.query(
      `SELECT * FROM franchise_location_milestones
        WHERE application_id = $1
        ORDER BY sort_order ASC, id ASC`,
      [applicationId]
    ),
    db.query(
      `SELECT * FROM franchise_location_services
        WHERE application_id = $1
        ORDER BY service_name ASC, id ASC`,
      [applicationId]
    ),
    db.query(
      `SELECT m.*, u.first_name AS helper_first_name, u.last_name AS helper_last_name,
              u.email AS helper_email
         FROM franchise_opening_team_members m
         JOIN users u ON u.id = m.helper_user_id
        WHERE m.application_id = $1
        ORDER BY m.assigned_at ASC, m.id ASC`,
      [applicationId]
    ),
    db.query(
      `SELECT * FROM franchise_opening_confirmations
        WHERE application_id = $1`,
      [applicationId]
    ),
    // Group 12 Slice 3d (617): the location manager, HQ-assigned.
    db.query(
      `SELECT m.*, u.first_name AS manager_first_name, u.last_name AS manager_last_name,
              u.email AS manager_email
         FROM franchise_location_managers m
         JOIN users u ON u.id = m.manager_user_id
        WHERE m.application_id = $1`,
      [applicationId]
    ),
  ]);
  const byLocation = (rows) => {
    const map = new Map(locationIds.map((id) => [id, []]));
    for (const row of rows) {
      if (map.has(row.location_id)) map.get(row.location_id).push(row);
    }
    return map;
  };
  const milestonesByLocation = byLocation(milestoneResult.rows);
  const servicesByLocation = byLocation(serviceResult.rows);
  const teamByLocation = byLocation(teamResult.rows);
  const confirmationsByLocation = new Map(
    confirmationResult.rows.map((row) => [row.location_id, row])
  );
  const managerByLocation = new Map(
    managerResult.rows.map((row) => [row.location_id, row])
  );
  return locations.map((location) => {
    const confirmation = confirmationsByLocation.get(location.id) || null;
    return {
      ...location,
      milestones: milestonesByLocation.get(location.id) || [],
      services: servicesByLocation.get(location.id) || [],
      opening_team: teamByLocation.get(location.id) || [],
      manager: managerByLocation.get(location.id) || null,
      opening_confirmation: confirmation,
      launch_complete: location.status === 'launched' && Boolean(confirmation),
    };
  });
}

// Group 12 Slice 3c (613, D-313): the readiness review history, newest
// first. The operator view carries outcome, notes, and date only — never
// the reviewer's identity; HQ gets the reviewer id and email with it.
async function fetchReadinessReviews(applicationId, { includeReviewer = false } = {}) {
  const { rows } = await db.query(
    `SELECT r.*, u.email AS reviewer_email
       FROM franchise_readiness_reviews r
       LEFT JOIN users u ON u.id = r.reviewer_id
      WHERE r.application_id = $1
      ORDER BY r.created_at DESC, r.id DESC`,
    [applicationId]
  );
  return rows.map((row) => {
    const { reviewer_id: reviewerId, reviewer_email: reviewerEmail, ...rest } = row;
    return includeReviewer ? { ...rest, reviewer_id: reviewerId, reviewer_email: reviewerEmail } : rest;
  });
}

// Group 12 Slice 3c (612): the territory-wide opening team — members
// designated for the whole territory (location_id NULL), as opposed to
// one location launch. Per-location teams ride `fetchOpenLocations`.
async function fetchTerritoryOpeningTeam(applicationId) {
  const { rows } = await db.query(
    `SELECT m.*, u.first_name AS helper_first_name, u.last_name AS helper_last_name,
            u.email AS helper_email
       FROM franchise_opening_team_members m
       JOIN users u ON u.id = m.helper_user_id
      WHERE m.application_id = $1 AND m.location_id IS NULL
      ORDER BY m.assigned_at ASC, m.id ASC`,
    [applicationId]
  );
  return rows;
}

// Group 12 Slice 3d (616-620): the guide-teams bundle — territory
// invitations, training assignments, and announcements. The invite token
// never leaves the server in a list payload: it is only returned on
// create (the operator/HQ hands it to the invitee) and is stripped here.
async function fetchTerritoryInvitations(applicationId) {
  const { rows } = await db.query(
    `SELECT i.id, i.application_id, i.email, i.role, i.status,
            i.invited_by, i.expires_at, i.responded_at, i.created_at,
            u.email AS invited_by_email,
            iu.id AS invitee_user_id
       FROM franchise_territory_invitations i
       LEFT JOIN users u ON u.id = i.invited_by
       LEFT JOIN users iu ON lower(iu.email) = lower(i.email)
      WHERE i.application_id = $1
      ORDER BY i.created_at DESC, i.id DESC`,
    [applicationId]
  );
  return rows;
}

// Group 12 Slice 3d (618): territory-scoped training assignments with
// the assignee's name — the operator tracks completion per person.
async function fetchTrainingAssignments(applicationId) {
  const { rows } = await db.query(
    `SELECT a.*, u.first_name AS assignee_first_name,
            u.last_name AS assignee_last_name, u.email AS assignee_email
       FROM franchise_training_assignments a
       JOIN users u ON u.id = a.assignee_user_id
      WHERE a.application_id = $1
      ORDER BY a.created_at DESC, a.id DESC`,
    [applicationId]
  );
  return rows;
}

// Group 12 Slice 3d (620): HQ broadcast announcements. The operator
// feed hides expired announcements and carries `read_by_me`; HQ sees
// every announcement with a read count. The activity log stays the
// event record — this feed is broadcast only (D-320).
async function fetchAnnouncements(applicationId, { userId = null, includeReadCounts = false } = {}) {
  const { rows } = await db.query(
    `SELECT a.*, u.email AS created_by_email
       FROM franchise_announcements a
       LEFT JOIN users u ON u.id = a.created_by
      WHERE a.application_id = $1
      ORDER BY a.created_at DESC, a.id DESC`,
    [applicationId]
  );
  const now = Date.now();
  const visible = includeReadCounts
    ? rows
    : rows.filter((row) => !row.expires_at || new Date(row.expires_at).getTime() > now);
  if (!visible.length) return [];
  const ids = visible.map((row) => row.id);
  const readResult = await db.query(
    `SELECT announcement_id, COUNT(*)::int AS read_count
       FROM franchise_announcement_reads
      WHERE announcement_id = ANY($1::uuid[])
      GROUP BY announcement_id`,
    [ids]
  );
  const readCounts = new Map(readResult.rows.map((row) => [row.announcement_id, row.read_count]));
  let readByMe = new Set();
  if (userId) {
    const mineResult = await db.query(
      `SELECT announcement_id FROM franchise_announcement_reads
        WHERE announcement_id = ANY($1::uuid[]) AND user_id = $2`,
      [ids, userId]
    );
    readByMe = new Set(mineResult.rows.map((row) => row.announcement_id));
  }
  return visible.map((row) => ({
    ...row,
    expired: Boolean(row.expires_at) && new Date(row.expires_at).getTime() <= now,
    read_count: readCounts.get(row.id) || 0,
    read_by_me: readByMe.has(row.id),
  }));
}

// Group 12 Slice 3e (621, D-321): the franchise standards library —
// franchise-scoped views over the Learn guides catalog. A territory
// sees the franchise-wide standards (application_id NULL) plus its own
// territory standards; the guide title/category ride along from
// learn_guides so the operator never sees a bare guide id. Passing a
// null application id returns the franchise-wide standards only: the
// `application_id IS NULL OR application_id = $1` predicate keeps
// franchise-wide rows (TRUE OR NULL) and drops territory rows
// (FALSE OR NULL) when $1 is NULL.
async function fetchFranchiseStandards(applicationId, { userId = null, includeAcknowledgments = false } = {}) {
  const { rows } = await db.query(
    `SELECT s.*, g.title AS guide_title, g.category AS guide_category,
            g.difficulty AS guide_difficulty, g.minutes AS guide_minutes
       FROM franchise_standards s
       LEFT JOIN learn_guides g ON g.id = s.guide_id
      WHERE s.application_id IS NULL OR s.application_id = $1
      ORDER BY s.application_id NULLS FIRST, s.created_at ASC, s.id ASC`,
    [applicationId]
  );
  if (!rows.length) return [];
  // Group 12 Slice 3e (622, D-323): acknowledgment state per standard —
  // who acknowledged the CURRENT version, and (for the viewer) whether
  // they did. The signature storage key never leaves the server; the
  // list carries has_signature only.
  const ids = rows.map((row) => row.id);
  const ackResult = await db.query(
    `SELECT a.*, u.first_name AS user_first_name, u.last_name AS user_last_name,
            u.email AS user_email
       FROM franchise_standard_acknowledgments a
       JOIN users u ON u.id = a.user_id
      WHERE a.standard_id = ANY($1::uuid[])
      ORDER BY a.acknowledged_at DESC, a.id DESC`,
    [ids]
  );
  const acksByStandard = new Map(ids.map((id) => [id, []]));
  for (const ack of ackResult.rows) {
    if (acksByStandard.has(ack.standard_id)) acksByStandard.get(ack.standard_id).push(ack);
  }
  const memberIds = await fetchTerritoryMemberIds(applicationId);
  return rows.map((row) => {
    const acks = acksByStandard.get(row.id) || [];
    const currentAcks = acks.filter((ack) => ack.version === row.version);
    const myAck = userId
      ? currentAcks.find((ack) => String(ack.user_id) === String(userId)) || null
      : null;
    const presentable = {
      ...row,
      scope: row.application_id ? 'territory' : 'franchise',
      acknowledged_count: new Set(currentAcks.map((ack) => String(ack.user_id))).size,
      member_count: memberIds.length,
      acknowledged_by_me: Boolean(myAck),
      my_acknowledged_at: myAck ? myAck.acknowledged_at : null,
    };
    if (includeAcknowledgments) {
      presentable.acknowledgments = acks.map((ack) => ({
        id: ack.id,
        user_id: ack.user_id,
        user_name: [ack.user_first_name, ack.user_last_name].filter(Boolean).join(' ') || ack.user_email,
        user_email: ack.user_email,
        version: ack.version,
        acknowledged_at: ack.acknowledged_at,
        has_signature: Boolean(ack.signature_storage_key),
      }));
    }
    return presentable;
  });
}

// Group 12 Slice 3e (622/624/625): the territory member ids — the
// assigned operator, anyone who accepted a territory invite, or an
// opening-team helper. Same membership as isTerritoryMember, listed
// instead of tested, so acknowledgment counts and reminder targets
// cover exactly the people the territory owes a standard to.
async function fetchTerritoryMemberIds(applicationId) {
  if (!applicationId) return [];
  const { rows } = await db.query(
    `SELECT owner_user_id AS user_id FROM franchise_applications
      WHERE id = $1 AND owner_user_id IS NOT NULL
     UNION
     SELECT iu.id FROM franchise_territory_invitations i
       JOIN users iu ON lower(iu.email) = lower(i.email)
      WHERE i.application_id = $1 AND i.status = 'accepted'
     UNION
     SELECT helper_user_id FROM franchise_opening_team_members
      WHERE application_id = $1`,
    [applicationId]
  );
  return rows.map((row) => row.user_id);
}

// Group 12 Slice 3e (624, D-325): the operator compliance checklist —
// derived, never stored. One item per current standard, one team
// rollup item (every member acknowledged every current standard), and
// one launch-readiness item. The operator "checks" a standard item by
// acknowledging its current version (622); readiness is HQ-owned. The
// viewer perspective marks a standard done when the viewer acknowledged
// it; the team perspective (HQ) marks it done only when every member
// acknowledged it. This is the standards-compliance checklist —
// distinct from the HQ intake checklist (603), whose items stay
// admin-only.
function buildComplianceChecklist({ standards, readinessStatus, perspective }) {
  const standardItems = (standards || []).map((standard) => {
    const done = perspective === 'team'
      ? standard.member_count > 0 && (standard.acknowledged_count ?? 0) >= standard.member_count
      : Boolean(standard.acknowledged_by_me);
    return {
      code: `standard:${standard.id}`,
      kind: 'standard',
      standard_id: standard.id,
      guide_id: standard.guide_id,
      guide_title: standard.guide_title || standard.guide_id,
      version: standard.version,
      done,
      acknowledged_count: standard.acknowledged_count ?? 0,
      member_count: standard.member_count ?? 0,
    };
  });
  // The team rollup is always team-perspective, in both views: it is
  // done only when every member acknowledged every current standard.
  // (The per-standard item above is the one that changes with
  // perspective — viewer: did I acknowledge; team: did everyone.)
  const teamDoneFor = (standard) => standard.member_count > 0
    && (standard.acknowledged_count ?? 0) >= standard.member_count;
  const items = [...standardItems];
  if ((standards || []).length) {
    items.push({
      code: 'team_acknowledgments',
      kind: 'team',
      done: standards.every(teamDoneFor),
      pending_standards: standards.filter((standard) => !teamDoneFor(standard)).length,
    });
  }
  items.push({
    code: 'launch_readiness',
    kind: 'readiness',
    done: ['ready', 'launched'].includes(readinessStatus),
    readiness_status: readinessStatus || null,
  });
  const doneCount = items.filter((item) => item.done).length;
  return { items, done: doneCount, total: items.length };
}

// Group 12 Slice 3d (616/617/618): who counts as a territory member —
// the assigned operator, anyone who accepted a territory invite, or an
// opening-team helper. Membership is the gate for manager assignment
// and training distribution; it is checked against live rows, never
// against a role label.
async function isTerritoryMember(client, applicationId, userId) {
  if (!userId) return false;
  const { rows } = await client.query(
    `SELECT 1 FROM franchise_applications
      WHERE id = $1 AND owner_user_id = $2
     UNION
     SELECT 1 FROM franchise_territory_invitations
      WHERE application_id = $1 AND lower(email) = lower((SELECT email FROM users WHERE id = $2))
        AND status = 'accepted'
     UNION
     SELECT 1 FROM franchise_opening_team_members
      WHERE application_id = $1 AND helper_user_id = $2
     LIMIT 1`,
    [applicationId, userId]
  );
  return rows.length > 0;
}

// Group 12 Slice 3a (603): per-category document status, derived from the
// stored rows. `accepted` wins when any document in the category was
// accepted; otherwise the latest document decides, so a re-upload after a
// rejection reads `pending` again (D-304).
function documentCategorySummary(documents) {
  return DOCUMENT_CATEGORIES.map((category) => {
    const inCategory = (documents || []).filter((doc) => doc.category === category);
    let status = 'missing';
    if (inCategory.length) {
      status = inCategory.some((doc) => doc.status === 'accepted')
        ? 'accepted'
        : inCategory[0].status;
    }
    return { category, status, count: inCategory.length };
  });
}

// Group 12 Slice 3a (603): vault-style presentation — a signed download URL
// minted at read time (600s), never a public path. The storage key itself
// is stripped from the payload. When no signing secret is configured the
// row still reads, flagged `download_unavailable`, instead of failing.
async function presentFranchiseDocument(doc) {
  const { storage_key, ...rest } = doc;
  try {
    const downloadUrl = await getSignedDownloadUrl(storage_key, 600);
    return { ...rest, download_url: downloadUrl, download_unavailable: false };
  } catch (_err) {
    return { ...rest, download_url: null, download_unavailable: true };
  }
}

// Group 12 Slice 3e (623, D-324): vault-style presentation for brand
// assets — a signed download URL minted at read time (600s), never a
// public path. The storage key itself is stripped from the payload.
// When no signing secret is configured the row still reads, flagged
// `download_unavailable`, instead of failing.
async function presentFranchiseBrandAsset(asset) {
  const { storage_key, ...rest } = asset;
  try {
    const downloadUrl = await getSignedDownloadUrl(storage_key, 600);
    return { ...rest, download_url: downloadUrl, download_unavailable: false };
  } catch (_err) {
    return { ...rest, download_url: null, download_unavailable: true };
  }
}

// Group 12 Slice 3e (623, D-324): the brand assets visible to a
// territory — the franchise-wide assets plus its own. Passing a null
// application id returns the franchise-wide assets only (same
// predicate shape as the standards fetcher).
async function fetchBrandAssets(applicationId) {
  const { rows } = await db.query(
    `SELECT *
       FROM franchise_brand_assets
      WHERE application_id IS NULL OR application_id = $1
      ORDER BY application_id NULLS FIRST, created_at DESC, id DESC`,
    [applicationId]
  );
  const presented = await Promise.all(rows.map(presentFranchiseBrandAsset));
  return presented.map((asset) => ({
    ...asset,
    scope: asset.application_id ? 'territory' : 'franchise',
  }));
}

// Group 12 Slice 3a (604/603/605): the applicant-facing detail view. Same
// application, but scoped to the applicant's own rows only: shared notes
// (visibility = 'shared'), interviews, documents, and the follow-up thread.
// Internal notes are never selected here — server-enforced (D-301/D-305).
async function fetchApplicantApplicationDetail(applicationId, userId) {
  const applicationResult = await db.query(
    `SELECT
        fa.id,
        fa.first_name,
        fa.last_name,
        fa.email,
        fa.phone,
        fa.desired_country,
        fa.desired_region,
        fa.desired_city,
        fa.territory_summary,
        fa.timeline_window,
        fa.preferred_store_count,
        fa.status,
        fa.agreement_status,
        fa.training_status,
        fa.launch_readiness_status,
        fa.risk_notes,
        fa.hq_recommendation,
        fa.market_assessment,
        fa.available_capital_cents,
        fa.liquid_capital_cents,
        fa.linked_business_id,
        fa.submitted_at,
        fa.updated_at,
        fa.last_contacted_at,
        fa.owner_user_id,
        fa.acceptance_status,
        fa.acceptance_reason,
        fa.acceptance_decided_at,
        (fa.owner_user_id = $2) AS is_operator,
        b.business_name AS linked_business_name,
        COALESCE(progress.completed_count, 0)::int AS checklist_completed,
        COALESCE(progress.total_count, 0)::int AS checklist_total
       FROM franchise_applications fa
       LEFT JOIN businesses b ON b.id = fa.linked_business_id
       LEFT JOIN (
         SELECT
           application_id,
           COUNT(*) AS total_count,
           COUNT(*) FILTER (WHERE status IN ('completed', 'waived')) AS completed_count
         FROM franchise_application_checklist_items
         GROUP BY application_id
       ) progress ON progress.application_id = fa.id
      WHERE fa.id = $1 AND (fa.applicant_user_id = $2 OR fa.owner_user_id = $2)`,
    [applicationId, userId]
  );

  if (!applicationResult.rows.length) return null;

  const [interviewResult, documentResult, sharedNotesResult, followupResult, responsibilityResult, areaResult, agreementExclusiveResult, launchPlanResult, activityResult, locations, businessServices, readinessReviews, openingTeam, territoryInvitations, trainingAssignments, announcements] = await Promise.all([
    db.query(
      `SELECT *
         FROM franchise_interview_slots
        WHERE application_id = $1
        ORDER BY starts_at ASC, id ASC`,
      [applicationId]
    ),
    db.query(
      `SELECT *
         FROM franchise_application_documents
        WHERE application_id = $1
        ORDER BY created_at DESC, id DESC`,
      [applicationId]
    ),
    db.query(
      `SELECT fan.*, u.email AS admin_email, u.first_name AS admin_first_name, u.last_name AS admin_last_name
         FROM franchise_application_notes fan
         LEFT JOIN users u ON u.id = fan.admin_id
        WHERE fan.application_id = $1 AND fan.visibility = 'shared'
        ORDER BY fan.created_at ASC, fan.id ASC`,
      [applicationId]
    ),
    db.query(
      `SELECT ffm.*, u.email AS author_email, u.first_name AS author_first_name, u.last_name AS author_last_name
         FROM franchise_followup_messages ffm
         LEFT JOIN users u ON u.id = ffm.author_id
        WHERE ffm.application_id = $1
        ORDER BY ffm.created_at ASC, ffm.id ASC`,
      [applicationId]
    ),
    // Group 12 Slice 3b (608): the operator responsibility checklist.
    db.query(
      `SELECT *
         FROM franchise_responsibility_items
        WHERE application_id = $1
        ORDER BY sort_order, id`,
      [applicationId]
    ),
    // Group 12 Slice 3b (607): the assignment boundary area list.
    db.query(
      `SELECT *
         FROM franchise_territory_areas
        WHERE application_id = $1
        ORDER BY sort_order, id`,
      [applicationId]
    ),
    // Group 12 Slice 3b (607): exclusivity lives on the agreement; the
    // operator sees the flag, never the agreement internals.
    db.query(
      `SELECT territory_exclusive
         FROM franchise_agreements
        WHERE application_id = $1
        LIMIT 1`,
      [applicationId]
    ),
    // Group 12 Slice 3b (609): the territory launch plan steps.
    db.query(
      `SELECT *
         FROM franchise_launch_plan_steps
        WHERE application_id = $1
        ORDER BY sort_order, id`,
      [applicationId]
    ),
    // Group 12 Slice 3b (610, D-310): the operator-facing assignment
    // history — the activity log, newest first, without metadata (which
    // can carry raw admin request bodies) and without the actor. Internal
    // note events are excluded; a shared note's arrival is still shown.
    db.query(
      `SELECT id, event_type, event_summary, created_at
         FROM franchise_activity_log
        WHERE application_id = $1
          AND NOT (event_type = 'note_added' AND metadata ->> 'visibility' = 'internal')
        ORDER BY created_at DESC, id DESC
        LIMIT 50`,
      [applicationId]
    ),
    // Group 12 Slice 3c (611/612/614/615): the open locations with their
    // milestones, service availability, opening team, and confirmations.
    fetchOpenLocations(applicationId),
    // Group 12 Slice 3c (614): the services the linked business can offer.
    fetchBusinessServices(applicationId),
    // Group 12 Slice 3c (613, D-313): the readiness review history —
    // outcome, notes, and date only, never the reviewer's identity.
    fetchReadinessReviews(applicationId),
    // Group 12 Slice 3c (612): the territory-wide opening team.
    fetchTerritoryOpeningTeam(applicationId),
    // Group 12 Slice 3d (616/618/620): territory invitations, training
    // distribution, and the HQ announcement feed (operator view: expired
    // hidden, `read_by_me` carried).
    fetchTerritoryInvitations(applicationId),
    fetchTrainingAssignments(applicationId),
    fetchAnnouncements(applicationId, { userId }),
  ]);

  const documents = await Promise.all(documentResult.rows.map(presentFranchiseDocument));
  // Group 12 Slice 3e (621/622/623): the standards library (with the
  // viewer's own acknowledgment state) and the brand asset store.
  const standards = await fetchFranchiseStandards(applicationId, { userId });
  const brandAssets = await fetchBrandAssets(applicationId);
  // Group 12 Slice 3f (628, D-327): the service exception summary.
  const exceptionSummary = await buildExceptionSummary(applicationId);
  // Group 12 Slice 3f (627, D-328): the per-location health view.
  const locationHealth = await buildLocationHealth(applicationId);
  // Group 12 Slice 3g (632, D-332): the territory members with names.
  const territoryMembers = await fetchTerritoryMembers(applicationId);
  // Group 12 Slice 3g (635, D-335): the per-exception resolution state.
  const exceptionResolution = await buildExceptionResolution(applicationId);
  // Group 12 Slice 3h (636, D-336): the candidate locations inside this
  // territory.
  const candidateLocations = await buildCandidateLocations(applicationId);
  // Group 12 Slice 3h (637, D-337): the structured per-area capacity view.
  const territoryCapacity = await buildTerritoryCapacity(applicationId);
  // Group 12 Slice 3h (638, D-338): the training resource planner.
  const trainingPlanner = await buildTrainingPlanner(applicationId);
  // Group 12 Slice 3h (639, D-339): the launch dependency overview.
  const launchDependencies = await buildLaunchDependencies(applicationId);
  // Group 12 Slice 3h (640, D-340): the operator-authored expansion
  // readiness notes.
  const expansionNotes = await buildExpansionNotes(applicationId);
  // Group 12 Slice 3i (641/643, D-341/D-343): the handoff flow and the
  // contact directory ride the operator detail too — the detail is
  // applicant-or-operator only, so the handoff record never leaks to a
  // stranger (a named incoming operator reads it via /my-handoffs).
  const handoffs = await buildHandoffs(applicationId);
  const contactDirectory = await buildContactDirectory(applicationId);
  // Group 12 Slice 3j (646, D-347): the territory's policy questions.
  const policyQuestions = await fetchPolicyQuestions(applicationId);

  return {
    application: {
      ...applicationResult.rows[0],
      territory_exclusive: agreementExclusiveResult.rows[0]?.territory_exclusive ?? false,
    },
    interviews: interviewResult.rows,
    documents,
    document_categories: documentCategorySummary(documentResult.rows),
    shared_notes: sharedNotesResult.rows,
    followup: followupResult.rows,
    responsibilities: responsibilityResult.rows,
    territory_areas: areaResult.rows,
    launch_plan_steps: launchPlanResult.rows,
    locations,
    business_services: businessServices,
    opening_team: openingTeam,
    territory_invitations: territoryInvitations,
    training_assignments: trainingAssignments,
    announcements,
    standards,
    brand_assets: brandAssets,
    exception_summary: exceptionSummary,
    location_health: locationHealth,
    territory_members: territoryMembers,
    exception_resolution: exceptionResolution,
    candidate_locations: candidateLocations,
    territory_capacity: territoryCapacity,
    training_planner: trainingPlanner,
    launch_dependencies: launchDependencies,
    expansion_notes: expansionNotes,
    handoffs,
    contact_directory: contactDirectory,
    policy_questions: policyQuestions,
    // Group 12 Slice 3h (640, D-340): HQ's own readiness fields,
    // surfaced read-only to the operator alongside their notes.
    hq_readiness_notes: {
      market_assessment: applicationResult.rows[0].market_assessment || null,
      hq_recommendation: applicationResult.rows[0].hq_recommendation || null,
      risk_notes: applicationResult.rows[0].risk_notes || null,
    },
    // Group 12 Slice 3e (624, D-325): the operator compliance checklist,
    // derived from the standards library, the acknowledgment state, and
    // readiness — viewer perspective.
    compliance_checklist: buildComplianceChecklist({
      standards,
      readinessStatus: applicationResult.rows[0].launch_readiness_status,
      perspective: 'viewer',
    }),
    readiness_reviews: readinessReviews,
    activity: activityResult.rows,
  };
}

// Ownership check shared by the applicant-scoped mutation endpoints. A
// stranger gets the same 404 as a missing application, so existence never
// leaks across applicants.
async function loadOwnedApplication(client, applicationId, userId) {
  const { rows } = await client.query(
    `SELECT id, applicant_user_id, owner_user_id
       FROM franchise_applications
      WHERE id = $1`,
    [applicationId]
  );
  const application = rows[0] || null;
  if (!application) return null;
  const owned = String(application.applicant_user_id) === String(userId)
    || String(application.owner_user_id) === String(userId);
  return owned ? application : null;
}

// Group 12 Slice 3c (612/614/615): the operator-only ownership check.
// Unlike loadOwnedApplication (applicant OR owner), these actions belong
// to the assigned operator only — the applicant record alone is not
// enough. Returns the row plus whether the caller is the operator, so
// handlers can tell a stranger (404) from a non-operator applicant (403
// franchise_operator_only) without leaking existence.
async function loadOperatorApplication(client, applicationId, userId) {
  const { rows } = await client.query(
    `SELECT id, applicant_user_id, owner_user_id
       FROM franchise_applications
      WHERE id = $1`,
    [applicationId]
  );
  const application = rows[0] || null;
  if (!application) return { application: null, isOperator: false, isAssociated: false };
  const isOperator = String(application.owner_user_id) === String(userId);
  const isAssociated = isOperator
    || String(application.applicant_user_id) === String(userId);
  return { application, isOperator, isAssociated };
}

function parseInterviewDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

async function createFranchiseApplication(req, res) {
  const firstName = asTrimmed(req.body.first_name);
  const lastName = asTrimmed(req.body.last_name);
  const email = asTrimmed(req.body.email);
  const phone = asTrimmed(req.body.phone);
  const desiredCountryRaw = asTrimmed(req.body.desired_country);

  if (!firstName || !lastName || !email || !desiredCountryRaw) {
    return res.status(400).json({ error: 'first_name, last_name, email, and desired_country are required.' });
  }

  if (!countriesUtil.isValidCountry(desiredCountryRaw)) {
    return res.status(400).json({ error: 'desired_country must be a valid ISO-2 country code.' });
  }

  const desiredCountry = countriesUtil.normalizeCountry(desiredCountryRaw);
  const desiredRegion = asTrimmed(req.body.desired_region);
  const desiredCity = asTrimmed(req.body.desired_city);
  const territorySummary = asTrimmed(req.body.territory_summary);
  const currentCompanyName = asTrimmed(req.body.current_company_name);
  const desiredBrandName = asTrimmed(req.body.desired_brand_name);
  const leadSource = asTrimmed(req.body.lead_source);
  const businessBackground = asTrimmed(req.body.business_background);
  const operationsBackground = asTrimmed(req.body.operations_background);
  const localMarketOverview = asTrimmed(req.body.local_market_overview);
  const timelineWindow = asTrimmed(req.body.timeline_window);
  const preferredStoreCount = parsePositiveInt(req.body.preferred_store_count, 1);
  const availableCapitalCents = parseMoney(req.body.available_capital);
  const liquidCapitalCents = parseMoney(req.body.liquid_capital);
  const linkedConsultingRequestId = asTrimmed(req.body.linked_consulting_request_id);

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const program = await ensureProgram(client);
      const result = await client.query(
        `INSERT INTO franchise_applications (
           program_id,
           applicant_user_id,
           owner_user_id,
           linked_consulting_request_id,
           first_name,
           last_name,
           email,
           phone,
           lead_source,
           current_company_name,
           desired_brand_name,
           desired_country,
           desired_region,
           desired_city,
           territory_summary,
           business_background,
           operations_background,
           local_market_overview,
           available_capital_cents,
           liquid_capital_cents,
           preferred_store_count,
           timeline_window
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
         )
         RETURNING id`,
        [
          program.id,
          req.user?.id || null,
          // owner_user_id is always the authenticated applicant; the client
          // must not supply it (lead form is public, so null for guests).
          req.user?.id || null,
          linkedConsultingRequestId,
          firstName,
          lastName,
          email,
          phone,
          leadSource,
          currentCompanyName,
          desiredBrandName,
          desiredCountry,
          desiredRegion,
          desiredCity,
          territorySummary,
          businessBackground,
          operationsBackground,
          localMarketOverview,
          availableCapitalCents,
          liquidCapitalCents,
          preferredStoreCount,
          timelineWindow,
        ]
      );

      const applicationId = result.rows[0].id;

      await client.query(
        `INSERT INTO franchise_agreements (
           application_id,
           agreement_version,
           initial_fee_cents,
           royalty_bps,
           marketing_fee_bps,
           term_years,
           currency
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          applicationId,
          'v1',
          program.initial_fee_cents,
          program.royalty_bps,
          program.marketing_fee_bps,
          program.term_years,
          // New agreements inherit the program's fee currency; without this
          // the fee was reported as dollars regardless of the program.
          normalizeCurrencyCode(program.default_currency),
        ]
      );

      await seedChecklist(client, applicationId);
      await seedResponsibilityItems(client, applicationId);
      await seedTerritoryArea(client, applicationId, {
        country: desiredCountry,
        region: desiredRegion,
        city: desiredCity,
      });
      await seedLaunchPlanSteps(client, applicationId);
      // Group 12 Slice 3c (611-615, D-311): the first location inside the
      // territory, so milestones, the opening team, services, and the
      // opening confirmation have a location from day one.
      await seedLocation(client, applicationId, {
        country: desiredCountry,
        region: desiredRegion,
        city: desiredCity,
      });
      await logActivity(
        client,
        applicationId,
        req.user?.id || null,
        'application_created',
        `Franchise application created for ${firstName} ${lastName}.`,
        { desired_country: desiredCountry, desired_region: desiredRegion, desired_city: desiredCity }
      );

      await client.query('COMMIT');

      // G-2: filing a franchise application completes the franchise
      // signup handoff (the owning page is /franchise/apply).
      try {
        const signupIntent = require('../services/access/signupIntent');
        await signupIntent.consumeIntent(req.user?.id, 'franchise');
      } catch (_consumeErr) { /* consumption never fails the application */ }

      const bundle = await fetchFranchiseApplicationBundle(applicationId);
      return res.status(201).json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error creating franchise application', { err: err.message });
    return res.status(500).json({ error: 'Failed to create franchise application.' });
  }
}

async function listMyFranchiseApplications(req, res) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const result = await db.query(
      `SELECT
          fa.id,
          fa.first_name,
          fa.last_name,
          fa.email,
          fa.phone,
          fa.lead_source,
          fa.current_company_name,
          fa.desired_brand_name,
          fa.desired_country,
          fa.desired_region,
          fa.desired_city,
          fa.territory_summary,
          fa.timeline_window,
          fa.preferred_store_count,
          fa.status,
          fa.agreement_status,
          fa.training_status,
          fa.launch_readiness_status,
          fa.available_capital_cents,
          fa.liquid_capital_cents,
          fa.linked_business_id,
          fa.acceptance_status,
          fa.linked_consulting_request_id,
          fa.submitted_at,
          fa.updated_at,
          b.business_name AS linked_business_name,
          COALESCE(progress.completed_count, 0)::int AS checklist_completed,
          COALESCE(progress.total_count, 0)::int AS checklist_total
        FROM franchise_applications fa
        LEFT JOIN businesses b ON b.id = fa.linked_business_id
        LEFT JOIN (
          SELECT
            application_id,
            COUNT(*) AS total_count,
            COUNT(*) FILTER (WHERE status IN ('completed', 'waived')) AS completed_count
          FROM franchise_application_checklist_items
          GROUP BY application_id
        ) progress ON progress.application_id = fa.id
        WHERE fa.applicant_user_id = $1 OR fa.owner_user_id = $1
        ORDER BY fa.submitted_at DESC, fa.id DESC`,
      [req.user.id]
    );

    return res.json({ applications: result.rows });
  } catch (err) {
    logger.error('Error listing my franchise applications', { userId: req.user.id, err: err.message });
    return res.status(500).json({ error: 'Failed to fetch your franchise applications.' });
  }
}

async function listFranchiseApplications(req, res) {
  const { page = 1, limit = 20, status, country, agreement_status, training_status, launch_status, search } = req.query;
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  try {
    const where = [];
    const params = [];
    let idx = 1;

    if (status) {
      where.push(`fa.status = $${idx++}`);
      params.push(status);
    }
    if (country && countriesUtil.isValidCountry(country)) {
      where.push(`fa.desired_country = $${idx++}`);
      params.push(countriesUtil.normalizeCountry(country));
    }
    if (agreement_status) {
      where.push(`fa.agreement_status = $${idx++}`);
      params.push(agreement_status);
    }
    if (training_status) {
      where.push(`fa.training_status = $${idx++}`);
      params.push(training_status);
    }
    if (launch_status) {
      where.push(`fa.launch_readiness_status = $${idx++}`);
      params.push(launch_status);
    }
    if (search) {
      where.push(`(
        fa.first_name ILIKE $${idx}
        OR fa.last_name ILIKE $${idx}
        OR fa.email ILIKE $${idx}
        OR COALESCE(fa.current_company_name, '') ILIKE $${idx}
        OR COALESCE(fa.desired_brand_name, '') ILIKE $${idx}
      )`);
      params.push(`%${String(search).trim()}%`);
      idx += 1;
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total
         FROM franchise_applications fa
         ${whereClause}`,
      params
    );

    const listResult = await db.query(
      `SELECT
          fa.id,
          fa.first_name,
          fa.last_name,
          fa.email,
          fa.phone,
          fa.lead_source,
          fa.current_company_name,
          fa.desired_brand_name,
          fa.desired_country,
          fa.desired_region,
          fa.desired_city,
          fa.preferred_store_count,
          fa.status,
          fa.agreement_status,
          fa.training_status,
          fa.launch_readiness_status,
          fa.available_capital_cents,
          fa.liquid_capital_cents,
          fa.owner_user_id,
          fa.linked_business_id,
          fa.submitted_at,
          fa.updated_at,
          b.business_name AS linked_business_name,
          owner.email AS owner_email,
          COALESCE(progress.completed_count, 0)::int AS checklist_completed,
          COALESCE(progress.total_count, 0)::int AS checklist_total
        FROM franchise_applications fa
        LEFT JOIN businesses b ON b.id = fa.linked_business_id
        LEFT JOIN users owner ON owner.id = fa.owner_user_id
        LEFT JOIN (
          SELECT
            application_id,
            COUNT(*) AS total_count,
            COUNT(*) FILTER (WHERE status IN ('completed', 'waived')) AS completed_count
          FROM franchise_application_checklist_items
          GROUP BY application_id
        ) progress ON progress.application_id = fa.id
        ${whereClause}
        ORDER BY fa.submitted_at DESC
        LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, safeLimit, offset]
    );

    return res.json({
      data: listResult.rows,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: countResult.rows[0]?.total || 0,
        pages: Math.ceil((countResult.rows[0]?.total || 0) / safeLimit),
      },
    });
  } catch (err) {
    logger.error('Error listing franchise applications', { err: err.message });
    return res.status(500).json({ error: 'Failed to fetch franchise applications.' });
  }
}

async function getFranchiseApplication(req, res) {
  try {
    const bundle = await fetchFranchiseApplicationBundle(req.params.id);
    if (!bundle) {
      return res.status(404).json({ error: 'Franchise application not found.' });
    }
    return res.json(bundle);
  } catch (err) {
    logger.error('Error fetching franchise application', { id: req.params.id, err: err.message });
    return res.status(500).json({ error: 'Failed to fetch franchise application.' });
  }
}

async function updateFranchiseApplication(req, res) {
  const applicationId = req.params.id;
  const body = req.body || {};

  const updates = [];
  const values = [];
  const touchedColumns = new Set();
  let idx = 1;
  const ownerUserId = body.owner_user_id !== undefined ? asTrimmed(body.owner_user_id) : undefined;

  const addUpdate = (column, value) => {
    if (touchedColumns.has(column)) return;
    touchedColumns.add(column);
    updates.push(`${column} = $${idx++}`);
    values.push(value);
  };

  if (body.status !== undefined) {
    if (!APPLICATION_STATUSES.has(body.status)) {
      return res.status(400).json({ error: 'Invalid franchise application status.' });
    }
    addUpdate('status', body.status);
    if (body.status !== 'inquiry') {
      updates.push(`reviewed_at = COALESCE(reviewed_at, NOW())`);
    }
    if (body.status === 'approved') {
      updates.push(`approved_at = COALESCE(approved_at, NOW())`);
    }
    if (body.status === 'launched') {
      updates.push(`launched_at = COALESCE(launched_at, NOW())`);
      addUpdate('launch_readiness_status', 'launched');
    }
  }

  if (body.agreement_status !== undefined) {
    if (!AGREEMENT_STATUSES.has(body.agreement_status)) {
      return res.status(400).json({ error: 'Invalid agreement status.' });
    }
    addUpdate('agreement_status', body.agreement_status);
  }

  if (body.training_status !== undefined) {
    if (!TRAINING_STATUSES.has(body.training_status)) {
      return res.status(400).json({ error: 'Invalid training status.' });
    }
    addUpdate('training_status', body.training_status);
  }

  if (body.launch_readiness_status !== undefined) {
    if (!READINESS_STATUSES.has(body.launch_readiness_status)) {
      return res.status(400).json({ error: 'Invalid launch readiness status.' });
    }
    addUpdate('launch_readiness_status', body.launch_readiness_status);
  }

  const desiredCountry = body.desired_country !== undefined
    ? (countriesUtil.isValidCountry(body.desired_country) ? countriesUtil.normalizeCountry(body.desired_country) : null)
    : undefined;
  if (body.desired_country !== undefined) {
    if (!desiredCountry) {
      return res.status(400).json({ error: 'desired_country must be a valid ISO-2 country code.' });
    }
    addUpdate('desired_country', desiredCountry);
  }

  const stringFields = [
    'linked_consulting_request_id',
    'first_name',
    'last_name',
    'email',
    'phone',
    'lead_source',
    'current_company_name',
    'desired_brand_name',
    'desired_region',
    'desired_city',
    'territory_summary',
    'business_background',
    'operations_background',
    'local_market_overview',
    'timeline_window',
    'market_assessment',
    'hq_recommendation',
    'risk_notes',
  ];

  if (ownerUserId !== undefined) {
    if (!ownerUserId) {
      return res.status(400).json({ error: 'owner_user_id must identify an active account.' });
    }
    addUpdate('owner_user_id', ownerUserId);
  }

  for (const field of stringFields) {
    if (body[field] !== undefined) {
      addUpdate(field, asTrimmed(body[field]));
    }
  }

  if (body.available_capital !== undefined) {
    addUpdate('available_capital_cents', parseMoney(body.available_capital));
  }
  if (body.liquid_capital !== undefined) {
    addUpdate('liquid_capital_cents', parseMoney(body.liquid_capital));
  }
  if (body.preferred_store_count !== undefined) {
    addUpdate('preferred_store_count', parsePositiveInt(body.preferred_store_count, 1));
  }
  if (body.touch_contacted_at === true) {
    updates.push('last_contacted_at = NOW()');
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'No valid updates supplied.' });
  }

  values.push(applicationId);

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Group 12 Slice 3b (606): email of the user being assigned as owner,
      // used below to tell applicant-linking apart from an assignment.
      let newOwnerEmail = null;

      if (ownerUserId !== undefined) {
        const ownerResult = await client.query(
          `SELECT id, email FROM users
            WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
          [ownerUserId]
        );
        if (!ownerResult.rows.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'owner_user_id must identify an active, non-deleted account.',
            code: 'franchise_owner_unavailable',
          });
        }
        newOwnerEmail = ownerResult.rows[0].email || null;
      }

      const before = await client.query(
        `SELECT status, applicant_user_id, owner_user_id, linked_business_id, acceptance_status, email,
                launch_readiness_status
           FROM franchise_applications
          WHERE id = $1`,
        [applicationId],
      );
      if (!before.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }

      // Group 12 Slice 3c (613, D-313): readiness moves to `ready` only
      // through a passed readiness review (POST /readiness-review) —
      // never through a bare admin status set. Re-saving an application
      // that is already `ready` is a no-op, not a move, so it still
      // passes (the HQ edit form always sends the current value).
      if (body.launch_readiness_status === 'ready'
        && before.rows[0].launch_readiness_status !== 'ready') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Launch readiness can only move to ready through a passed readiness review.',
          code: 'readiness_requires_review',
        });
      }

      const updateResult = await client.query(
        `UPDATE franchise_applications
            SET ${updates.join(', ')}, updated_at = NOW()
          WHERE id = $${idx}
          RETURNING id, status, owner_user_id, linked_business_id,
                    agreement_status, training_status, launch_readiness_status`,
        values
      );

      // Group 12 Slice 3b (606, D-295/D-307): admin assignment is an offer,
      // not an activation. Reassigning the territory to a different operator
      // (or approving with an owner when no offer exists yet) offers the
      // territory to the new operator; the previous decision is cleared.
      // Linking the applicant's own account is identity linking, not an
      // assignment, so it never offers: the public lead form creates the
      // row ownerless (applicant_user_id NULL too), and HQ links the
      // applicant — identified by applicant_user_id when set, else by the
      // application email matching the new owner's email. Rejected/archived
      // applications are never offered.
      const nextStatus = updateResult.rows[0].status;
      const nextOwnerId = updateResult.rows[0].owner_user_id;
      const isApplicantLink = ownerUserId !== undefined && (
        String(ownerUserId) === String(before.rows[0].applicant_user_id)
        || (newOwnerEmail && before.rows[0].email
          && String(newOwnerEmail).toLowerCase() === String(before.rows[0].email).toLowerCase())
      );
      const ownerChanged = ownerUserId !== undefined
        && String(ownerUserId) !== String(before.rows[0].owner_user_id)
        && !isApplicantLink;
      const newlyApproved = body.status === 'approved'
        && before.rows[0].acceptance_status === 'not_offered';
      if (nextOwnerId && !['rejected', 'archived'].includes(nextStatus) && (ownerChanged || newlyApproved)) {
        await client.query(
          `UPDATE franchise_applications
              SET acceptance_status = 'offered', acceptance_reason = NULL,
                  acceptance_decided_at = NULL, acceptance_decided_by = NULL,
                  updated_at = NOW()
            WHERE id = $1`,
          [applicationId]
        );
        await logActivity(
          client,
          applicationId,
          req.user?.id || null,
          'territory_offered',
          'Territory assignment offered to the operator; awaiting their accept or decline.',
          { owner_user_id: nextOwnerId }
        );
      }

      await syncFranchiseGrant(client, {
        applicationId,
        ownerUserId: updateResult.rows[0].owner_user_id,
        status: updateResult.rows[0].status,
        linkedBusinessId: updateResult.rows[0].linked_business_id,
        actorId: req.user?.id || null,
        revokeUserIds: before.rows[0].status === 'launched' && before.rows[0].linked_business_id
          ? [before.rows[0].owner_user_id]
          : [],
      });

      await logActivity(
        client,
        applicationId,
        req.user?.id || null,
        'application_updated',
        `Application updated from status ${before.rows[0].status} to ${updateResult.rows[0].status}.`,
        body
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const bundle = await fetchFranchiseApplicationBundle(applicationId);
    return res.json(bundle);
  } catch (err) {
    logger.error('Error updating franchise application', { id: applicationId, err: err.message });
    return res.status(500).json({ error: 'Failed to update franchise application.' });
  }
}

async function addFranchiseNote(req, res) {
  const noteText = asTrimmed(req.body.note_text);
  const visibility = asTrimmed(req.body.visibility) || 'internal';

  if (!noteText) {
    return res.status(400).json({ error: 'note_text is required.' });
  }
  if (!['internal', 'shared'].includes(visibility)) {
    return res.status(400).json({ error: 'visibility must be internal or shared.' });
  }

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [req.params.id]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }

      await client.query(
        `INSERT INTO franchise_application_notes
           (application_id, admin_id, visibility, note_text)
         VALUES ($1, $2, $3, $4)`,
        [req.params.id, req.user?.id || null, visibility, noteText]
      );

      await logActivity(
        client,
        req.params.id,
        req.user?.id || null,
        'note_added',
        'Added a franchise application note.',
        { visibility }
      );

      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(req.params.id);
      return res.status(201).json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error adding franchise note', { id: req.params.id, err: err.message });
    return res.status(500).json({ error: 'Failed to add note.' });
  }
}

async function updateChecklistItem(req, res) {
  const { id, itemId } = req.params;
  const body = req.body || {};
  const updates = [];
  const params = [];
  let idx = 1;

  if (body.status !== undefined) {
    if (!CHECKLIST_STATUSES.has(body.status)) {
      return res.status(400).json({ error: 'Invalid checklist status.' });
    }
    updates.push(`status = $${idx++}`);
    params.push(body.status);
    updates.push(`completed_at = ${body.status === 'completed' || body.status === 'waived' ? 'NOW()' : 'NULL'}`);
  }
  if (body.owner_role !== undefined) {
    updates.push(`owner_role = $${idx++}`);
    params.push(asTrimmed(body.owner_role));
  }
  if (body.notes !== undefined) {
    updates.push(`notes = $${idx++}`);
    params.push(asTrimmed(body.notes));
  }
  if (body.due_at !== undefined) {
    updates.push(`due_at = $${idx++}`);
    params.push(body.due_at || null);
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'No checklist updates supplied.' });
  }

  params.push(id);
  params.push(itemId);

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const updateResult = await client.query(
        `UPDATE franchise_application_checklist_items
            SET ${updates.join(', ')}, updated_at = NOW()
          WHERE application_id = $${idx++} AND id = $${idx++}
          RETURNING id, label, status`,
        params
      );

      if (!updateResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Checklist item not found.' });
      }

      await logActivity(
        client,
        id,
        req.user?.id || null,
        'checklist_updated',
        `Checklist item "${updateResult.rows[0].label}" updated to ${updateResult.rows[0].status}.`,
        body
      );

      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error updating franchise checklist item', { id, itemId, err: err.message });
    return res.status(500).json({ error: 'Failed to update checklist item.' });
  }
}

async function upsertFranchiseAgreement(req, res) {
  const { id } = req.params;
  const body = req.body || {};

  const initialFeeCents = body.initial_fee !== undefined ? parseMoney(body.initial_fee) : null;
  const royaltyBps = body.royalty_bps !== undefined ? parseNonNegativeInt(body.royalty_bps, null) : null;
  const marketingFeeBps = body.marketing_fee_bps !== undefined ? parseNonNegativeInt(body.marketing_fee_bps, null) : null;
  const termYears = body.term_years !== undefined ? parsePositiveInt(body.term_years, null) : null;

  // Franchise fee currency: accepted only as a validated 3-letter ISO code.
  // An invalid code is rejected rather than stored or silently read as USD.
  let agreementCurrency = null;
  if (body.currency !== undefined && body.currency !== null && body.currency !== '') {
    const code = String(body.currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      return res.status(400).json({ error: 'Invalid currency. Use a 3-letter ISO code.' });
    }
    agreementCurrency = code;
  }

  // Review P2-9-F09: agreement "signing" was admin-asserted — the applicant
  // never signed. The admin upsert now ignores any applicant signature
  // fields; only the applicant's own POST /applications/:id/agreement/sign
  // can record a signature. Likewise 'signed' can no longer be set through
  // application_agreement_status (it is derived from the signature row).
  if (body.signed_by_name !== undefined || body.signed_by_email !== undefined || body.signed_at !== undefined) {
    logger.warn('[franchise] Admin attempted to assert applicant signature fields; ignored', {
      applicationId: id, adminId: req.user?.id || null,
    });
  }
  if (body.application_agreement_status === 'signed') {
    return res.status(409).json({
      error: 'The agreement must be signed by the applicant through their own signing step; it cannot be marked signed by an admin.',
      code: 'franchise_signature_requires_applicant',
    });
  }

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }

      // Group 12 Slice 3b (607): pre-existing defect — the INSERT below
      // passed a NULL currency whenever the body omitted it, and Postgres
      // raises the NOT NULL violation before ON CONFLICT can resolve it,
      // so every HQ agreement save without a currency 500'd (the HQ form
      // never sends one). Fall back to the stored currency, then USD.
      const existingAgreement = await client.query(
        `SELECT currency FROM franchise_agreements WHERE application_id = $1`,
        [id]
      );
      const existingCurrency = existingAgreement.rows[0]?.currency || null;

      await client.query(
        `INSERT INTO franchise_agreements (
           application_id,
           agreement_version,
           document_url,
           initial_fee_cents,
           royalty_bps,
           marketing_fee_bps,
           territory_exclusive,
           term_years,
           signed_by_name,
           signed_by_email,
           signed_at,
           countersigned_by,
           countersigned_at,
           notes,
           currency
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
         )
         ON CONFLICT (application_id) DO UPDATE SET
           agreement_version = COALESCE(EXCLUDED.agreement_version, franchise_agreements.agreement_version),
           document_url = COALESCE(EXCLUDED.document_url, franchise_agreements.document_url),
           initial_fee_cents = COALESCE(EXCLUDED.initial_fee_cents, franchise_agreements.initial_fee_cents),
           royalty_bps = COALESCE(EXCLUDED.royalty_bps, franchise_agreements.royalty_bps),
           marketing_fee_bps = COALESCE(EXCLUDED.marketing_fee_bps, franchise_agreements.marketing_fee_bps),
           territory_exclusive = EXCLUDED.territory_exclusive,
           term_years = COALESCE(EXCLUDED.term_years, franchise_agreements.term_years),
           signed_by_name = franchise_agreements.signed_by_name,
           signed_by_email = franchise_agreements.signed_by_email,
           signed_at = franchise_agreements.signed_at,
           countersigned_by = COALESCE(EXCLUDED.countersigned_by, franchise_agreements.countersigned_by),
           countersigned_at = COALESCE(EXCLUDED.countersigned_at, franchise_agreements.countersigned_at),
           notes = COALESCE(EXCLUDED.notes, franchise_agreements.notes),
           currency = COALESCE(EXCLUDED.currency, franchise_agreements.currency),
           updated_at = NOW()`,
        [
          id,
          asTrimmed(body.agreement_version),
          asTrimmed(body.document_url),
          initialFeeCents,
          royaltyBps,
          marketingFeeBps,
          body.territory_exclusive === true,
          termYears,
          // Review P2-9-F09: applicant signature fields are always NULL on
          // admin upsert; only the applicant sign endpoint writes them.
          null, // signed_by_name
          null, // signed_by_email
          null, // signed_at
          body.countersigned_by || req.user?.id || null,
          body.countersigned_at || null,
          asTrimmed(body.notes),
          agreementCurrency || existingCurrency || 'USD',
        ]
      );

      if (body.application_agreement_status && AGREEMENT_STATUSES.has(body.application_agreement_status)) {
        await client.query(
          `UPDATE franchise_applications
              SET agreement_status = $1, updated_at = NOW()
            WHERE id = $2`,
          [body.application_agreement_status, id]
        );
      }

      await logActivity(
        client,
        id,
        req.user?.id || null,
        'agreement_updated',
        'Franchise agreement terms updated.',
        body
      );

      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error updating franchise agreement', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to update agreement.' });
  }
}

/**
 * POST /api/franchise/applications/:id/agreement/sign
 * Review P2-9-F09: the applicant (not an admin) signs the franchise
 * agreement. The typed name must match the applicant's account name; the
 * signature timestamp is server-set. Sets application.agreement_status to
 * 'signed'. Admins cannot use this endpoint.
 */
async function signFranchiseAgreement(req, res) {
  const { id } = req.params;
  const signedByName = asTrimmed(req.body?.signed_by_name);
  if (!signedByName) {
    return res.status(400).json({ error: 'signed_by_name is required.', code: 'signature_name_required' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows: appRows } = await client.query(
        `SELECT fa.id, fa.applicant_user_id, fa.owner_user_id, fa.agreement_status,
                u.first_name, u.last_name, u.email
           FROM franchise_applications fa
           LEFT JOIN users u ON u.id = $2
          WHERE fa.id = $1
          FOR UPDATE OF fa`,
        [id, req.user.id]
      );
      const application = appRows[0];
      if (!application) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      // Only the applicant (or the assigned owner) may sign; admins use the
      // countersignature on the admin upsert path.
      if (['admin', 'super_admin'].includes(req.user.role)) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Admins cannot sign as the applicant. The applicant signs from their own account.',
          code: 'franchise_admin_cannot_sign',
        });
      }
      if (req.user.id !== application.applicant_user_id && req.user.id !== application.owner_user_id) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Only the applicant can sign this agreement.' });
      }
      // The signature must match the name on the signer's account
      // (case- and whitespace-insensitive), mirroring the login signature.
      const normalize = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
      const accountName = normalize(`${application.first_name || ''} ${application.last_name || ''}`);
      if (!accountName || normalize(signedByName) !== accountName) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'The name you entered does not match the name on your account. Please use your full name exactly as registered.',
          code: 'signature_name_mismatch',
        });
      }
      const { rows: agreementRows } = await client.query(
        `SELECT id, signed_at FROM franchise_agreements WHERE application_id = $1`,
        [id]
      );
      if (!agreementRows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'No agreement has been prepared for this application yet.',
          code: 'franchise_agreement_missing',
        });
      }
      if (agreementRows[0].signed_at) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'This agreement has already been signed.',
          code: 'franchise_agreement_already_signed',
        });
      }
      await client.query(
        `UPDATE franchise_agreements
            SET signed_by_name = $2,
                signed_by_email = $3,
                signed_at = NOW(),
                updated_at = NOW()
          WHERE id = $1`,
        [agreementRows[0].id, signedByName, application.email]
      );
      await client.query(
        `UPDATE franchise_applications
            SET agreement_status = 'signed', updated_at = NOW()
          WHERE id = $1`,
        [id]
      );
      await logActivity(client, id, req.user.id, 'agreement_signed', 'Applicant signed the franchise agreement.', {
        signed_by_name: signedByName,
      });
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error signing franchise agreement', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to sign agreement.' });
  }
}

/**
 * POST /api/franchise/applications/:id/agreement/collect-fee
 * Review P2-9-F07: record collection of the franchise initial fee (or an
 * explicit waiver). Admin-only, audited. The fee is collected off-platform
 * (wire/Stripe dashboard); this records the external reference so
 * activateFranchiseStore can fail closed until the fee is accounted for.
 * Body: { amount_cents, collection_reference } or { waived: true, reason }.
 */
async function recordFranchiseFeeCollection(req, res) {
  const { id } = req.params;
  const body = req.body || {};
  const waived = body.waived === true;
  const amountCents = waived ? 0 : parsePositiveInt(body.amount_cents ?? body.amountCents, 0);
  const reference = asTrimmed(body.collection_reference || body.reference);
  const reason = asTrimmed(body.reason);
  if (!waived && amountCents <= 0) {
    return res.status(400).json({ error: 'amount_cents must be a positive integer.', code: 'invalid_fee_amount' });
  }
  if (!waived && !reference) {
    return res.status(400).json({ error: 'collection_reference is required to record a fee collection.', code: 'collection_reference_required' });
  }
  if (waived && !reason) {
    return res.status(400).json({ error: 'A reason is required to waive the initial fee.', code: 'waiver_reason_required' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, initial_fee_cents, COALESCE(initial_fee_collected_cents, 0) AS collected_cents,
                COALESCE(initial_fee_waived, FALSE) AS waived
           FROM franchise_agreements
          WHERE application_id = $1
          FOR UPDATE`,
        [id]
      );
      const agreement = rows[0];
      if (!agreement) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'No agreement found for this application.' });
      }
      if (waived) {
        await client.query(
          `UPDATE franchise_agreements
              SET initial_fee_waived = TRUE,
                  initial_fee_waived_reason = $2,
                  initial_fee_waived_by = $3,
                  initial_fee_waived_at = NOW(),
                  updated_at = NOW()
            WHERE id = $1`,
          [agreement.id, reason, req.user.id]
        );
        await logActivity(client, id, req.user.id, 'initial_fee_waived', `Initial fee waived: ${reason}`, { reason });
      } else {
        await client.query(
          `UPDATE franchise_agreements
              SET initial_fee_collected_cents = COALESCE(initial_fee_collected_cents, 0) + $2,
                  initial_fee_collected_at = NOW(),
                  initial_fee_collection_reference = $3,
                  updated_at = NOW()
            WHERE id = $1`,
          [agreement.id, amountCents, reference]
        );
        await logActivity(client, id, req.user.id, 'initial_fee_collected', `Initial fee collection recorded: ${amountCents}c (ref ${reference})`, {
          amount_cents: amountCents, collection_reference: reference,
        });
      }
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error recording franchise fee collection', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to record fee collection.' });
  }
}

async function activateFranchiseStore(req, res) {
  const applicationId = req.params.id;
  const businessName = asTrimmed(req.body.business_name);
  const businessType = asTrimmed(req.body.business_type) || 'corp';
  const website = asTrimmed(req.body.website);
  const description = asTrimmed(req.body.description) || 'Franchise store activated through the OxSteed global franchise program.';

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const appResult = await client.query(
        `SELECT *
           FROM franchise_applications
          WHERE id = $1
          FOR UPDATE`,
        [applicationId]
      );

      if (!appResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }

      const application = appResult.rows[0];
      if (application.linked_business_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'A business is already linked to this application.' });
      }
      if (!application.owner_user_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Assign an owner_user_id before activating the store.' });
      }

      const ownerResult = await client.query(
        `SELECT id FROM users
          WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
        [application.owner_user_id]
      );
      if (!ownerResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'The franchise owner account is inactive or deleted.',
          code: 'franchise_owner_unavailable',
        });
      }

      if (application.status !== 'approved') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'The franchise application must be approved before the store can be activated.',
          code: 'franchise_not_approved',
        });
      }
      if (!['signed', 'waived'].includes(application.agreement_status)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'The franchise agreement must be signed or waived before the store can be activated.',
          code: 'franchise_agreement_incomplete',
        });
      }
      // Review P2-9-F07: the initial fee was recorded on the agreement but
      // never collected. Fail closed: when a fee is configured it must be
      // recorded as collected (or explicitly waived) before the store can
      // launch.
      const feeResult = await client.query(
        `SELECT initial_fee_cents,
                COALESCE(initial_fee_collected_cents, 0) AS collected_cents,
                COALESCE(initial_fee_waived, FALSE) AS waived
           FROM franchise_agreements
          WHERE application_id = $1`,
        [applicationId]
      );
      const feeRow = feeResult.rows[0];
      const feeCents = Number(feeRow?.initial_fee_cents || 0);
      if (feeRow && feeCents > 0 && !feeRow.waived && Number(feeRow.collected_cents) < feeCents) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'The franchise initial fee has not been collected. Record the collection (or waive it) before activating the store.',
          code: 'franchise_initial_fee_uncollected',
          initial_fee_cents: feeCents,
          initial_fee_collected_cents: Number(feeRow.collected_cents),
        });
      }
      if (application.training_status !== 'completed') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Franchise training must be completed before the store can be activated.',
          code: 'franchise_training_incomplete',
        });
      }
      if (application.launch_readiness_status !== 'ready') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'The franchise launch checklist must be ready before the store can be activated.',
          code: 'franchise_launch_not_ready',
        });
      }

      const checklistResult = await client.query(
        `SELECT code, status
           FROM franchise_application_checklist_items
          WHERE application_id = $1`,
        [applicationId]
      );
      const incompleteChecklist = checklistResult.rows.filter(
        (item) => !['completed', 'waived'].includes(item.status)
      );
      if (incompleteChecklist.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'All franchise launch checklist items must be completed or waived before activation.',
          code: 'franchise_checklist_incomplete',
          incomplete_items: incompleteChecklist.map((item) => item.code),
        });
      }

      const existingCount = await client.query(
        'SELECT COUNT(*)::int AS count FROM businesses WHERE user_id = $1',
        [application.owner_user_id]
      );
      const isPrimary = (existingCount.rows[0]?.count || 0) === 0;

      const insertBusiness = await client.query(
        `INSERT INTO businesses (
           user_id,
           business_name,
           business_type,
           description,
           website,
           phone,
           address_city,
           address_state,
           address_country,
           is_primary,
           is_active
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE
         )
         RETURNING id, business_name`,
        [
          application.owner_user_id,
          businessName || application.desired_brand_name || application.current_company_name || `${application.first_name} ${application.last_name} OxSteed Franchise`,
          businessType,
          description,
          website,
          application.phone || null,
          application.desired_city || null,
          application.desired_region || null,
          countriesUtil.normalizeCountry(application.desired_country),
          isPrimary,
        ]
      );

      const business = insertBusiness.rows[0];

      await client.query(
        `UPDATE franchise_applications
            SET linked_business_id = $1,
                status = 'launched',
                launch_readiness_status = 'launched',
                launched_at = COALESCE(launched_at, NOW()),
                updated_at = NOW()
          WHERE id = $2`,
        [business.id, applicationId]
      );

      await syncFranchiseGrant(client, {
        applicationId,
        ownerUserId: application.owner_user_id,
        status: 'launched',
        linkedBusinessId: business.id,
        actorId: req.user?.id || null,
      });

      await logActivity(
        client,
        applicationId,
        req.user?.id || null,
        'store_activated',
        `Activated franchise store "${business.business_name}".`,
        { business_id: business.id }
      );

      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(applicationId);
      return res.status(201).json({ ...bundle, business });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error activating franchise store', { id: applicationId, err: err.message });
    return res.status(500).json({ error: 'Failed to activate franchise store.' });
  }
}

/**
 * GET /api/franchise/my-applications/:id
 * Group 12 Slice 3a (604/603/605): the applicant's own detail view —
 * interviews, document checklist, shared notes, and the follow-up thread.
 * Internal notes are never returned (D-301/D-305).
 */
async function getMyFranchiseApplication(req, res) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  try {
    const detail = await fetchApplicantApplicationDetail(req.params.id, req.user.id);
    if (!detail) {
      return res.status(404).json({ error: 'Franchise application not found.' });
    }
    return res.json(detail);
  } catch (err) {
    logger.error('Error fetching my franchise application', { id: req.params.id, err: err.message });
    return res.status(500).json({ error: 'Failed to fetch franchise application.' });
  }
}

/**
 * POST /api/franchise/applications/:id/interviews (admin)
 * 604 (D-300): HQ proposes an interview slot on the application. Slots must
 * start in the future; the end, when given, must be after the start.
 */
async function proposeInterviewSlot(req, res) {
  const body = req.body || {};
  const startsAt = parseInterviewDate(body.starts_at);
  const endsAt = parseInterviewDate(body.ends_at);
  if (!startsAt) {
    return res.status(400).json({ error: 'starts_at is required and must be a valid date.', code: 'invalid_interview_start' });
  }
  if (startsAt.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'Interview slots must start in the future.', code: 'interview_start_in_past' });
  }
  if (body.ends_at !== undefined && body.ends_at !== null && body.ends_at !== '' && !endsAt) {
    return res.status(400).json({ error: 'ends_at must be a valid date.', code: 'invalid_interview_end' });
  }
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    return res.status(400).json({ error: 'ends_at must be after starts_at.', code: 'invalid_interview_end' });
  }

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [req.params.id]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const { rows } = await client.query(
        `INSERT INTO franchise_interview_slots
           (application_id, proposed_by, interviewer_name, starts_at, ends_at, note)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          req.params.id,
          req.user?.id || null,
          asTrimmed(body.interviewer_name),
          startsAt.toISOString(),
          endsAt ? endsAt.toISOString() : null,
          asTrimmed(body.note),
        ]
      );
      await logActivity(
        client,
        req.params.id,
        req.user?.id || null,
        'interview_proposed',
        `Interview proposed for ${startsAt.toISOString()}.`,
        { slot_id: rows[0].id, interviewer_name: rows[0].interviewer_name }
      );
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(req.params.id);
      return res.status(201).json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error proposing franchise interview', { id: req.params.id, err: err.message });
    return res.status(500).json({ error: 'Failed to propose interview.' });
  }
}

/**
 * PATCH /api/franchise/applications/:id/interviews/:slotId (admin)
 * 604: HQ manages a slot. A proposed slot can be edited or cancelled; a
 * booked slot can be marked completed or cancelled. Completed/cancelled are
 * terminal. Cancelling never deletes the row — the history stays on the
 * application.
 */
async function updateInterviewSlot(req, res) {
  const body = req.body || {};
  const { id, slotId } = req.params;
  const nextStatus = body.status !== undefined ? asTrimmed(body.status) : undefined;
  if (nextStatus !== undefined && !INTERVIEW_STATUSES.has(nextStatus)) {
    return res.status(400).json({ error: 'Invalid interview status.', code: 'invalid_interview_status' });
  }
  if (nextStatus === 'proposed' || nextStatus === 'booked') {
    return res.status(400).json({
      error: 'Only HQ cancel/complete transitions are allowed here; proposing and booking use their own endpoints.',
      code: 'invalid_interview_transition',
    });
  }

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows: slotRows } = await client.query(
        `SELECT * FROM franchise_interview_slots WHERE id = $1 AND application_id = $2 FOR UPDATE`,
        [slotId, id]
      );
      const slot = slotRows[0];
      if (!slot) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Interview slot not found.' });
      }
      if (slot.status === 'completed' || slot.status === 'cancelled') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `A ${slot.status} interview cannot be changed.`,
          code: 'interview_terminal',
        });
      }

      const updates = [];
      const values = [];
      let idx = 1;
      if (nextStatus) {
        if (slot.status === 'proposed' && nextStatus === 'completed') {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: 'Only a booked interview can be marked completed.',
            code: 'interview_not_booked',
          });
        }
        updates.push(`status = $${idx++}`);
        values.push(nextStatus);
      }
      // Proposed slots may be rescheduled/renamed; a booked slot keeps its
      // time so the applicant is never moved without a cancel + re-propose.
      if (slot.status === 'proposed') {
        if (body.starts_at !== undefined) {
          const startsAt = parseInterviewDate(body.starts_at);
          if (!startsAt || startsAt.getTime() <= Date.now()) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'starts_at must be a valid future date.', code: 'invalid_interview_start' });
          }
          updates.push(`starts_at = $${idx++}`);
          values.push(startsAt.toISOString());
        }
        if (body.ends_at !== undefined) {
          const endsAt = parseInterviewDate(body.ends_at);
          if (body.ends_at && !endsAt) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'ends_at must be a valid date.', code: 'invalid_interview_end' });
          }
          updates.push(`ends_at = $${idx++}`);
          values.push(endsAt ? endsAt.toISOString() : null);
        }
        if (body.interviewer_name !== undefined) {
          updates.push(`interviewer_name = $${idx++}`);
          values.push(asTrimmed(body.interviewer_name));
        }
        if (body.note !== undefined) {
          updates.push(`note = $${idx++}`);
          values.push(asTrimmed(body.note));
        }
      }
      if (!updates.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'No interview updates supplied.' });
      }
      values.push(slotId);
      values.push(id);
      const { rows: updatedRows } = await client.query(
        `UPDATE franchise_interview_slots
            SET ${updates.join(', ')}, updated_at = NOW()
          WHERE id = $${idx++} AND application_id = $${idx++}
          RETURNING *`,
        values
      );
      await logActivity(
        client,
        id,
        req.user?.id || null,
        nextStatus === 'completed' ? 'interview_completed' : nextStatus === 'cancelled' ? 'interview_cancelled' : 'interview_updated',
        nextStatus ? `Interview ${nextStatus}.` : 'Interview updated.',
        { slot_id: slotId, status: updatedRows[0].status }
      );
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error updating franchise interview', { id, slotId, err: err.message });
    return res.status(500).json({ error: 'Failed to update interview.' });
  }
}

/**
 * POST /api/franchise/my-applications/:id/interviews/:slotId/book
 * 604 (D-300/D-303): the applicant books one proposed slot. One booked slot
 * per application — a second booking is a 409, enforced by the partial
 * unique index and re-checked in the transaction.
 */
async function bookInterviewSlot(req, res) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  const { id, slotId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOwnedApplication(client, id, req.user.id);
      if (!owned) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const { rows: slotRows } = await client.query(
        `SELECT * FROM franchise_interview_slots WHERE id = $1 AND application_id = $2 FOR UPDATE`,
        [slotId, id]
      );
      const slot = slotRows[0];
      if (!slot) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Interview slot not found.' });
      }
      if (slot.status !== 'proposed') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Only a proposed interview can be booked (this one is ${slot.status}).`,
          code: 'interview_not_proposed',
        });
      }
      const { rows: bookedRows } = await client.query(
        `SELECT id FROM franchise_interview_slots
          WHERE application_id = $1 AND status = 'booked' FOR UPDATE`,
        [id]
      );
      if (bookedRows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'This application already has a booked interview. Cancel it before booking another.',
          code: 'interview_already_booked',
        });
      }
      await client.query(
        `UPDATE franchise_interview_slots
            SET status = 'booked', booked_by = $2, booked_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [slotId, req.user.id]
      );
      await logActivity(
        client,
        id,
        req.user.id,
        'interview_booked',
        `Applicant booked the interview on ${new Date(slot.starts_at).toISOString()}.`,
        { slot_id: slotId }
      );
      await client.query('COMMIT');
      const detail = await fetchApplicantApplicationDetail(id, req.user.id);
      return res.json(detail);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error booking franchise interview', { id, slotId, err: err.message });
    return res.status(500).json({ error: 'Failed to book interview.' });
  }
}

/**
 * POST /api/franchise/my-applications/:id/interviews/:slotId/cancel
 * 604 (D-303): the applicant cancels their own booking. The slot returns to
 * `proposed` so it can be re-booked or replaced — a misclick never destroys
 * the slot, and the cancellation is logged for HQ.
 */
async function cancelInterviewBooking(req, res) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  const { id, slotId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOwnedApplication(client, id, req.user.id);
      if (!owned) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const { rows: slotRows } = await client.query(
        `SELECT * FROM franchise_interview_slots WHERE id = $1 AND application_id = $2 FOR UPDATE`,
        [slotId, id]
      );
      const slot = slotRows[0];
      if (!slot) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Interview slot not found.' });
      }
      if (slot.status !== 'booked' || String(slot.booked_by) !== String(req.user.id)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Only your own booked interview can be cancelled.',
          code: 'interview_not_booked_by_you',
        });
      }
      await client.query(
        `UPDATE franchise_interview_slots
            SET status = 'proposed', booked_by = NULL, booked_at = NULL, updated_at = NOW()
          WHERE id = $1`,
        [slotId]
      );
      await logActivity(
        client,
        id,
        req.user.id,
        'interview_booking_cancelled',
        'Applicant cancelled their interview booking; the slot is open again.',
        { slot_id: slotId }
      );
      await client.query('COMMIT');
      const detail = await fetchApplicantApplicationDetail(id, req.user.id);
      return res.json(detail);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error cancelling franchise interview booking', { id, slotId, err: err.message });
    return res.status(500).json({ error: 'Failed to cancel interview booking.' });
  }
}

/**
 * POST /api/franchise/my-applications/:id/documents
 * 603 (D-296/D-302): the applicant uploads a document for one of the four
 * categories. Stored through the staff-document vault path (`uploadFile`
 * into the private `franchise-documents/` prefix, signed-URL downloads
 * only). Multer + validateFileUpload run before this handler (10MB, pdf /
 * doc / docx / images).
 */
async function uploadApplicationDocument(req, res) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  const category = asTrimmed(req.body?.category);
  if (!DOCUMENT_CATEGORY_SET.has(category)) {
    return res.status(400).json({
      error: 'category must be one of identity, entity, financials, territory_plan.',
      code: 'invalid_document_category',
    });
  }
  if (!req.file?.buffer) {
    return res.status(400).json({ error: 'A document file is required.', code: 'file_required' });
  }

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOwnedApplication(client, req.params.id, req.user.id);
      if (!owned) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const storageKey = await uploadFile(
        req.file.buffer,
        `franchise-documents/${req.params.id}`,
        req.file.originalname || 'document',
        req.file.detectedMime || req.file.mimetype
      );
      if (!storageKey) {
        await client.query('ROLLBACK');
        return res.status(500).json({ error: 'Failed to store document.' });
      }
      const { rows } = await client.query(
        `INSERT INTO franchise_application_documents
           (application_id, category, file_name, storage_key, mime_type, file_size_bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          req.params.id,
          category,
          req.file.originalname || 'document',
          storageKey,
          req.file.detectedMime || req.file.mimetype || null,
          req.file.size || null,
          req.user.id,
        ]
      );
      await logActivity(
        client,
        req.params.id,
        req.user.id,
        'document_uploaded',
        `Applicant uploaded a ${category} document (${rows[0].file_name}).`,
        { document_id: rows[0].id, category }
      );
      await client.query('COMMIT');
      const detail = await fetchApplicantApplicationDetail(req.params.id, req.user.id);
      return res.status(201).json(detail);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error uploading franchise document', { id: req.params.id, err: err.message });
    return res.status(500).json({ error: 'Failed to upload document.' });
  }
}

/**
 * PATCH /api/franchise/applications/:id/documents/:docId (admin)
 * 603: HQ reviews one applicant document. A rejection needs a reason so the
 * applicant knows what to fix; the reason is shown to the applicant.
 */
async function reviewApplicationDocument(req, res) {
  const body = req.body || {};
  const nextStatus = asTrimmed(body.status);
  if (!DOCUMENT_REVIEW_STATUSES.has(nextStatus)) {
    return res.status(400).json({ error: 'status must be accepted or rejected.', code: 'invalid_document_status' });
  }
  const reason = asTrimmed(body.reason);
  if (nextStatus === 'rejected' && !reason) {
    return res.status(400).json({ error: 'A reason is required to reject a document.', code: 'document_rejection_reason_required' });
  }

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE franchise_application_documents
            SET status = $3, review_reason = $4, reviewed_by = $5, reviewed_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND application_id = $2
          RETURNING *`,
        [req.params.docId, req.params.id, nextStatus, reason, req.user?.id || null]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Document not found.' });
      }
      await logActivity(
        client,
        req.params.id,
        req.user?.id || null,
        'document_reviewed',
        `Document ${rows[0].file_name} ${nextStatus}${reason ? `: ${reason}` : ''}.`,
        { document_id: rows[0].id, category: rows[0].category, status: nextStatus }
      );
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(req.params.id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error reviewing franchise document', { id: req.params.id, docId: req.params.docId, err: err.message });
    return res.status(500).json({ error: 'Failed to review document.' });
  }
}

/**
 * POST /api/franchise/my-applications/:id/followup (applicant) and
 * POST /api/franchise/applications/:id/followup (admin)
 * 605 (D-301): replies in the decision follow-up thread. The thread is the
 * shared surface: HQ `shared` notes are read-only to the applicant, and
 * both sides reply here. Bodies are capped at 5000 characters.
 */
async function addFollowupMessageAs(req, res, authorRole) {
  const body = asTrimmed(req.body?.body);
  if (!body) {
    return res.status(400).json({ error: 'body is required.', code: 'followup_body_required' });
  }
  if (body.length > 5000) {
    return res.status(400).json({ error: 'Follow-up messages are limited to 5000 characters.', code: 'followup_body_too_long' });
  }

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (authorRole === 'applicant') {
        const owned = await loadOwnedApplication(client, req.params.id, req.user.id);
        if (!owned) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
      } else {
        const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [req.params.id]);
        if (!exists.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
      }
      await client.query(
        `INSERT INTO franchise_followup_messages
           (application_id, author_role, author_id, body)
         VALUES ($1, $2, $3, $4)`,
        [req.params.id, authorRole, req.user?.id || null, body]
      );
      await logActivity(
        client,
        req.params.id,
        req.user?.id || null,
        'followup_message_added',
        authorRole === 'applicant' ? 'Applicant replied in the decision follow-up.' : 'HQ replied in the decision follow-up.',
        { author_role: authorRole }
      );
      await client.query('COMMIT');
      if (authorRole === 'applicant') {
        const detail = await fetchApplicantApplicationDetail(req.params.id, req.user.id);
        return res.status(201).json(detail);
      }
      const bundle = await fetchFranchiseApplicationBundle(req.params.id);
      return res.status(201).json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error adding franchise follow-up message', { id: req.params.id, err: err.message });
    return res.status(500).json({ error: 'Failed to send follow-up message.' });
  }
}

async function addApplicantFollowupMessage(req, res) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  return addFollowupMessageAs(req, res, 'applicant');
}

async function addAdminFollowupMessage(req, res) {
  return addFollowupMessageAs(req, res, 'admin');
}

/**
 * POST /api/franchise/my-applications/:id/responsibilities/:itemId/acknowledge
 * 608 (D-306): the operator acknowledges one responsibility item on their
 * own application. Scoped like the other applicant mutations: a stranger
 * gets the same 404 as a missing application. Acknowledging twice is a
 * no-op success — the second call changes nothing and logs nothing.
 */
async function acknowledgeResponsibilityItem(req, res) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  const { id, itemId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOwnedApplication(client, id, req.user.id);
      if (!owned) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const { rows: itemRows } = await client.query(
        `SELECT * FROM franchise_responsibility_items
          WHERE id = $1 AND application_id = $2 FOR UPDATE`,
        [itemId, id]
      );
      const item = itemRows[0];
      if (!item) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Responsibility item not found.' });
      }
      if (item.status !== 'acknowledged') {
        await client.query(
          `UPDATE franchise_responsibility_items
              SET status = 'acknowledged', acknowledged_by = $2, acknowledged_at = NOW(), updated_at = NOW()
            WHERE id = $1`,
          [itemId, req.user.id]
        );
        await logActivity(
          client,
          id,
          req.user.id,
          'responsibility_acknowledged',
          `Operator acknowledged responsibility "${item.label}".`,
          { responsibility_id: itemId, code: item.code }
        );
      }
      await client.query('COMMIT');
      const detail = await fetchApplicantApplicationDetail(id, req.user.id);
      return res.json(detail);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error acknowledging franchise responsibility', { id, itemId, err: err.message });
    return res.status(500).json({ error: 'Failed to acknowledge responsibility.' });
  }
}

/**
 * POST /api/franchise/my-applications/:id/acceptance
 * 606 (D-295/D-307): the operator answers a territory offer. Only the
 * operator (owner_user_id) can answer — the applicant record alone is not
 * enough when HQ assigned someone else. Only an outstanding offer can be
 * answered (409 otherwise); a decline needs a reason so HQ knows why the
 * assignment goes back. Accepting does not change the pipeline status and
 * does not mint the grant — the grant still mints at launch (unchanged);
 * it unlocks the operator surface, which the territory endpoints gate on
 * acceptance (see franchiseTerritoryController).
 */
async function respondToTerritoryOffer(req, res) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  const decision = asTrimmed(req.body?.decision);
  if (decision !== 'accepted' && decision !== 'declined') {
    return res.status(400).json({
      error: 'decision must be accepted or declined.',
      code: 'invalid_acceptance_decision',
    });
  }
  const reason = asTrimmed(req.body?.reason);
  if (decision === 'declined' && !reason) {
    return res.status(400).json({
      error: 'A reason is required to decline a territory assignment.',
      code: 'acceptance_reason_required',
    });
  }
  const { id } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOwnedApplication(client, id, req.user.id);
      if (!owned) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (String(owned.owner_user_id) !== String(req.user.id)) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can accept or decline this territory.',
          code: 'acceptance_operator_only',
        });
      }
      const { rows: currentRows } = await client.query(
        `SELECT acceptance_status FROM franchise_applications WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (currentRows[0].acceptance_status !== 'offered') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `This territory is not awaiting an answer (acceptance is ${currentRows[0].acceptance_status}).`,
          code: 'acceptance_not_offered',
        });
      }
      await client.query(
        `UPDATE franchise_applications
            SET acceptance_status = $2, acceptance_reason = $3,
                acceptance_decided_at = NOW(), acceptance_decided_by = $4,
                updated_at = NOW()
          WHERE id = $1`,
        [id, decision, decision === 'declined' ? reason : null, req.user.id]
      );
      await logActivity(
        client,
        id,
        req.user.id,
        decision === 'accepted' ? 'territory_accepted' : 'territory_declined',
        decision === 'accepted'
          ? 'Operator accepted the territory assignment.'
          : `Operator declined the territory assignment: ${reason}.`,
        { decision, reason: decision === 'declined' ? reason : null }
      );
      await client.query('COMMIT');
      const detail = await fetchApplicantApplicationDetail(id, req.user.id);
      return res.json(detail);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error responding to franchise territory offer', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to answer the territory offer.' });
  }
}

/**
 * POST /api/franchise/applications/:id/areas (admin)
 * 607 (D-294/D-308): HQ adds one area to the assignment boundary. The
 * country must be a valid ISO-2 code; the type is included or excluded.
 * At most 50 areas per application.
 */
async function addTerritoryArea(req, res) {
  const areaType = asTrimmed(req.body?.area_type) || 'included';
  if (!['included', 'excluded'].includes(areaType)) {
    return res.status(400).json({ error: 'area_type must be included or excluded.', code: 'invalid_area_type' });
  }
  const countryRaw = asTrimmed(req.body?.country);
  if (!countryRaw || !countriesUtil.isValidCountry(countryRaw)) {
    return res.status(400).json({ error: 'country must be a valid ISO-2 country code.', code: 'invalid_area_country' });
  }
  const country = countriesUtil.normalizeCountry(countryRaw);
  const region = asTrimmed(req.body?.region);
  const city = asTrimmed(req.body?.city);
  const { id } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const { rows: countRows } = await client.query(
        'SELECT COUNT(*)::int AS n FROM franchise_territory_areas WHERE application_id = $1',
        [id]
      );
      if (countRows[0].n >= 50) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This territory already has the maximum of 50 boundary areas.', code: 'boundary_area_limit' });
      }
      const { rows: maxRows } = await client.query(
        'SELECT COALESCE(MAX(sort_order), 0)::int AS max_sort FROM franchise_territory_areas WHERE application_id = $1',
        [id]
      );
      const { rows } = await client.query(
        `INSERT INTO franchise_territory_areas
           (application_id, country, region, city, area_type, sort_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [id, country, region, city, areaType, maxRows[0].max_sort + 10, req.user?.id || null]
      );
      await logActivity(
        client,
        id,
        req.user?.id || null,
        'boundary_area_added',
        `Boundary area added: ${[city, region, country].filter(Boolean).join(', ')} (${areaType}).`,
        { area_id: rows[0].id, country, region, city, area_type: areaType }
      );
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.status(201).json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error adding franchise territory area', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to add boundary area.' });
  }
}

/**
 * DELETE /api/franchise/applications/:id/areas/:areaId (admin)
 * 607 (D-308): HQ removes one area from the boundary. The last included
 * area cannot be removed — a boundary must always name at least one
 * included area.
 */
async function removeTerritoryArea(req, res) {
  const { id, areaId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows: areaRows } = await client.query(
        `SELECT * FROM franchise_territory_areas WHERE id = $1 AND application_id = $2 FOR UPDATE`,
        [areaId, id]
      );
      const area = areaRows[0];
      if (!area) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Boundary area not found.' });
      }
      if (area.area_type === 'included') {
        const { rows: countRows } = await client.query(
          `SELECT COUNT(*)::int AS n FROM franchise_territory_areas
            WHERE application_id = $1 AND area_type = 'included'`,
          [id]
        );
        if (countRows[0].n <= 1) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: 'The last included area cannot be removed; a boundary must name at least one included area.',
            code: 'boundary_last_included_area',
          });
        }
      }
      await client.query('DELETE FROM franchise_territory_areas WHERE id = $1', [areaId]);
      await logActivity(
        client,
        id,
        req.user?.id || null,
        'boundary_area_removed',
        `Boundary area removed: ${[area.city, area.region, area.country].filter(Boolean).join(', ')} (${area.area_type}).`,
        { area_id: areaId, country: area.country, region: area.region, city: area.city, area_type: area.area_type }
      );
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error removing franchise territory area', { id, areaId, err: err.message });
    return res.status(500).json({ error: 'Failed to remove boundary area.' });
  }
}

function parseDueDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  return String(value);
}

/**
 * POST /api/franchise/applications/:id/launch-plan (admin)
 * 609 (D-309): HQ adds a launch plan step. The title is required; the due
 * date, when given, must be a YYYY-MM-DD date; the owner is operator, HQ,
 * or shared. Custom steps carry no code; seeded steps keep theirs.
 */
async function addLaunchPlanStep(req, res) {
  const title = asTrimmed(req.body?.title);
  if (!title) {
    return res.status(400).json({ error: 'title is required.', code: 'launch_plan_title_required' });
  }
  const ownerRole = asTrimmed(req.body?.owner_role) || 'operator';
  if (!LAUNCH_PLAN_OWNER_ROLES.has(ownerRole)) {
    return res.status(400).json({ error: 'owner_role must be operator, hq, or shared.', code: 'invalid_launch_plan_owner' });
  }
  const dueDate = parseDueDate(req.body?.due_date);
  if (dueDate === undefined) {
    return res.status(400).json({ error: 'due_date must be a YYYY-MM-DD date.', code: 'invalid_launch_plan_due_date' });
  }
  const { id } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const { rows: maxRows } = await client.query(
        'SELECT COALESCE(MAX(sort_order), 0)::int AS max_sort FROM franchise_launch_plan_steps WHERE application_id = $1',
        [id]
      );
      const { rows } = await client.query(
        `INSERT INTO franchise_launch_plan_steps
           (application_id, title, description, due_date, owner_role, sort_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [id, title, asTrimmed(req.body?.description), dueDate, ownerRole, maxRows[0].max_sort + 10, req.user?.id || null]
      );
      await logActivity(
        client,
        id,
        req.user?.id || null,
        'launch_plan_step_added',
        `Launch plan step added: "${title}".`,
        { step_id: rows[0].id, owner_role: ownerRole, due_date: dueDate }
      );
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.status(201).json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error adding franchise launch plan step', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to add launch plan step.' });
  }
}

/**
 * PATCH /api/franchise/applications/:id/launch-plan/:stepId (admin)
 * 609: HQ edits a launch plan step — title, description, due date, owner,
 * status, or order. At least one field must change.
 */
async function updateLaunchPlanStep(req, res) {
  const body = req.body || {};
  const { id, stepId } = req.params;
  const updates = [];
  const values = [];
  let idx = 1;
  if (body.title !== undefined) {
    const title = asTrimmed(body.title);
    if (!title) {
      return res.status(400).json({ error: 'title must not be empty.', code: 'launch_plan_title_required' });
    }
    updates.push(`title = $${idx++}`);
    values.push(title);
  }
  if (body.description !== undefined) {
    updates.push(`description = $${idx++}`);
    values.push(asTrimmed(body.description));
  }
  if (body.due_date !== undefined) {
    const dueDate = parseDueDate(body.due_date);
    if (dueDate === undefined) {
      return res.status(400).json({ error: 'due_date must be a YYYY-MM-DD date.', code: 'invalid_launch_plan_due_date' });
    }
    updates.push(`due_date = $${idx++}`);
    values.push(dueDate);
  }
  if (body.owner_role !== undefined) {
    if (!LAUNCH_PLAN_OWNER_ROLES.has(asTrimmed(body.owner_role))) {
      return res.status(400).json({ error: 'owner_role must be operator, hq, or shared.', code: 'invalid_launch_plan_owner' });
    }
    updates.push(`owner_role = $${idx++}`);
    values.push(asTrimmed(body.owner_role));
  }
  if (body.status !== undefined) {
    if (!LAUNCH_PLAN_STATUSES.has(asTrimmed(body.status))) {
      return res.status(400).json({ error: 'status must be pending, in_progress, completed, or blocked.', code: 'invalid_launch_plan_status' });
    }
    updates.push(`status = $${idx++}`);
    values.push(asTrimmed(body.status));
  }
  if (body.sort_order !== undefined) {
    const sortOrder = parseInt(body.sort_order, 10);
    if (!Number.isFinite(sortOrder)) {
      return res.status(400).json({ error: 'sort_order must be an integer.', code: 'invalid_launch_plan_sort' });
    }
    updates.push(`sort_order = $${idx++}`);
    values.push(sortOrder);
  }
  if (!updates.length) {
    return res.status(400).json({ error: 'No launch plan updates supplied.', code: 'launch_plan_no_updates' });
  }

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      values.push(stepId);
      values.push(id);
      const { rows } = await client.query(
        `UPDATE franchise_launch_plan_steps
            SET ${updates.join(', ')}, updated_at = NOW()
          WHERE id = $${idx++} AND application_id = $${idx++}
          RETURNING *`,
        values
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Launch plan step not found.' });
      }
      await logActivity(
        client,
        id,
        req.user?.id || null,
        'launch_plan_step_updated',
        `Launch plan step "${rows[0].title}" updated to ${rows[0].status}.`,
        { step_id: stepId, status: rows[0].status }
      );
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error updating franchise launch plan step', { id, stepId, err: err.message });
    return res.status(500).json({ error: 'Failed to update launch plan step.' });
  }
}

/**
 * DELETE /api/franchise/applications/:id/launch-plan/:stepId (admin)
 * 609: HQ removes a launch plan step. The step history stays in the
 * activity log.
 */
async function removeLaunchPlanStep(req, res) {
  const { id, stepId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `DELETE FROM franchise_launch_plan_steps
          WHERE id = $1 AND application_id = $2
          RETURNING title`,
        [stepId, id]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Launch plan step not found.' });
      }
      await logActivity(
        client,
        id,
        req.user?.id || null,
        'launch_plan_step_removed',
        `Launch plan step removed: "${rows[0].title}".`,
        { step_id: stepId }
      );
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error removing franchise launch plan step', { id, stepId, err: err.message });
    return res.status(500).json({ error: 'Failed to remove launch plan step.' });
  }
}

/**
 * POST /api/franchise/my-applications/:id/launch-plan/:stepId/status
 * 609 (D-309): the operator updates one plan step's status on their own
 * application. Status only — title, dates, and owners stay HQ-owned.
 * A stranger gets the same 404 as a missing application.
 */
async function updateLaunchPlanStepStatus(req, res) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  const nextStatus = asTrimmed(req.body?.status);
  if (!LAUNCH_PLAN_STATUSES.has(nextStatus)) {
    return res.status(400).json({
      error: 'status must be pending, in_progress, completed, or blocked.',
      code: 'invalid_launch_plan_status',
    });
  }
  const { id, stepId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOwnedApplication(client, id, req.user.id);
      if (!owned) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const { rows } = await client.query(
        `UPDATE franchise_launch_plan_steps
            SET status = $3, updated_at = NOW()
          WHERE id = $1 AND application_id = $2
          RETURNING *`,
        [stepId, id, nextStatus]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Launch plan step not found.' });
      }
      await logActivity(
        client,
        id,
        req.user.id,
        'launch_plan_step_updated',
        `Operator updated launch plan step "${rows[0].title}" to ${nextStatus}.`,
        { step_id: stepId, status: nextStatus }
      );
      await client.query('COMMIT');
      const detail = await fetchApplicantApplicationDetail(id, req.user.id);
      return res.json(detail);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error updating franchise launch plan step status', { id, stepId, err: err.message });
    return res.status(500).json({ error: 'Failed to update launch plan step.' });
  }
}

// ── Group 12 Slice 3c (611-615): open locations ──────────────────────────
// Locations are business/restaurant locations inside a territory (D-298).
// HQ creates locations; the operator reads them. Milestones (611) attach
// to a location; the opening team (612), service checklist (614), and
// opening confirmation (615) attach to one too.

async function loadLocation(client, applicationId, locationId) {
  const { rows } = await client.query(
    `SELECT * FROM franchise_locations WHERE id = $1 AND application_id = $2`,
    [locationId, applicationId]
  );
  return rows[0] || null;
}

/**
 * POST /api/franchise/applications/:id/locations (admin)
 * 611 (D-311): HQ adds a location inside the territory. The name is
 * required; the country, when given, must be a valid ISO-2 code.
 */
async function addLocation(req, res) {
  const name = asTrimmed(req.body?.name);
  if (!name) {
    return res.status(400).json({ error: 'name is required.', code: 'location_name_required' });
  }
  const countryRaw = asTrimmed(req.body?.country);
  if (countryRaw && !countriesUtil.isValidCountry(countryRaw)) {
    return res.status(400).json({ error: 'country must be a valid ISO-2 country code.', code: 'invalid_location_country' });
  }
  const { id } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const { rows } = await client.query(
        `INSERT INTO franchise_locations
           (application_id, name, city, region, country, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [id, name, asTrimmed(req.body?.city), asTrimmed(req.body?.region),
         countryRaw ? countriesUtil.normalizeCountry(countryRaw) : null, req.user?.id || null]
      );
      await logActivity(
        client,
        id,
        req.user?.id || null,
        'location_added',
        `Location added: "${name}".`,
        { location_id: rows[0].id }
      );
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.status(201).json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error adding franchise location', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to add location.' });
  }
}

/**
 * POST /api/franchise/applications/:id/locations/:locationId/milestones (admin)
 * 611 (D-311): HQ adds a launch milestone to a location — title, due
 * date, owner. `launch_plan_step_id`, when given, links the milestone to
 * one launch plan step: the step's reserved `milestone_id` is set, so the
 * plan step and the milestone stay in sync. A step can carry only one
 * milestone.
 */
async function addLocationMilestone(req, res) {
  const title = asTrimmed(req.body?.title);
  if (!title) {
    return res.status(400).json({ error: 'title is required.', code: 'milestone_title_required' });
  }
  const ownerRole = asTrimmed(req.body?.owner_role) || 'operator';
  if (!MILESTONE_OWNER_ROLES.has(ownerRole)) {
    return res.status(400).json({ error: 'owner_role must be operator, hq, or shared.', code: 'invalid_milestone_owner' });
  }
  const dueDate = parseDueDate(req.body?.due_date);
  if (dueDate === undefined) {
    return res.status(400).json({ error: 'due_date must be a YYYY-MM-DD date.', code: 'invalid_milestone_due_date' });
  }
  const stepId = asTrimmed(req.body?.launch_plan_step_id);
  const { id, locationId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const location = await loadLocation(client, id, locationId);
      if (!location) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise location not found.' });
      }
      if (stepId) {
        const { rows: stepRows } = await client.query(
          `SELECT id, milestone_id FROM franchise_launch_plan_steps
            WHERE id = $1 AND application_id = $2 FOR UPDATE`,
          [stepId, id]
        );
        if (!stepRows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Launch plan step not found.' });
        }
        if (stepRows[0].milestone_id) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: 'That launch plan step already has a milestone.',
            code: 'launch_plan_step_milestone_linked',
          });
        }
      }
      const { rows: maxRows } = await client.query(
        'SELECT COALESCE(MAX(sort_order), 0)::int AS max_sort FROM franchise_location_milestones WHERE location_id = $1',
        [locationId]
      );
      const { rows } = await client.query(
        `INSERT INTO franchise_location_milestones
           (application_id, location_id, title, description, due_date, owner_role, sort_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [id, locationId, title, asTrimmed(req.body?.description), dueDate, ownerRole,
         maxRows[0].max_sort + 10, req.user?.id || null]
      );
      if (stepId) {
        await client.query(
          `UPDATE franchise_launch_plan_steps SET milestone_id = $2 WHERE id = $1`,
          [stepId, rows[0].id]
        );
      }
      await logActivity(
        client,
        id,
        req.user?.id || null,
        'location_milestone_added',
        `Launch milestone added for "${location.name}": "${title}".`,
        { location_id: locationId, milestone_id: rows[0].id, launch_plan_step_id: stepId || null }
      );
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.status(201).json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error adding franchise location milestone', { id, locationId, err: err.message });
    return res.status(500).json({ error: 'Failed to add milestone.' });
  }
}

/**
 * PATCH /api/franchise/applications/:id/locations/:locationId/milestones/:milestoneId (admin)
 * 611: HQ edits a milestone — title, description, due date, owner,
 * status, or order. Completing a milestone stamps who completed it and
 * when; moving it back off completed clears the stamp.
 */
async function updateLocationMilestone(req, res) {
  const body = req.body || {};
  const { id, locationId, milestoneId } = req.params;
  const updates = [];
  const values = [];
  let idx = 1;
  let completing = false;
  if (body.title !== undefined) {
    const title = asTrimmed(body.title);
    if (!title) {
      return res.status(400).json({ error: 'title must not be empty.', code: 'milestone_title_required' });
    }
    updates.push(`title = $${idx++}`);
    values.push(title);
  }
  if (body.description !== undefined) {
    updates.push(`description = $${idx++}`);
    values.push(asTrimmed(body.description));
  }
  if (body.due_date !== undefined) {
    const dueDate = parseDueDate(body.due_date);
    if (dueDate === undefined) {
      return res.status(400).json({ error: 'due_date must be a YYYY-MM-DD date.', code: 'invalid_milestone_due_date' });
    }
    updates.push(`due_date = $${idx++}`);
    values.push(dueDate);
  }
  if (body.owner_role !== undefined) {
    if (!MILESTONE_OWNER_ROLES.has(asTrimmed(body.owner_role))) {
      return res.status(400).json({ error: 'owner_role must be operator, hq, or shared.', code: 'invalid_milestone_owner' });
    }
    updates.push(`owner_role = $${idx++}`);
    values.push(asTrimmed(body.owner_role));
  }
  if (body.status !== undefined) {
    if (!MILESTONE_STATUSES.has(asTrimmed(body.status))) {
      return res.status(400).json({ error: 'status must be pending, in_progress, completed, or blocked.', code: 'invalid_milestone_status' });
    }
    completing = asTrimmed(body.status) === 'completed';
    updates.push(`status = $${idx++}`);
    values.push(asTrimmed(body.status));
  }
  if (body.sort_order !== undefined) {
    const sortOrder = parseInt(body.sort_order, 10);
    if (!Number.isFinite(sortOrder)) {
      return res.status(400).json({ error: 'sort_order must be an integer.', code: 'invalid_milestone_sort' });
    }
    updates.push(`sort_order = $${idx++}`);
    values.push(sortOrder);
  }
  if (!updates.length) {
    return res.status(400).json({ error: 'No milestone updates supplied.', code: 'milestone_no_updates' });
  }

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      // The completing actor param, when present, goes right after the
      // SET values; the three WHERE ids follow it, in order.
      const setParams = [...values];
      let completedBySql = 'NULL';
      if (completing) {
        setParams.push(req.user?.id || null);
        completedBySql = `$${setParams.length}`;
      }
      const idPos = setParams.length + 1;
      const locationPos = setParams.length + 2;
      const appPos = setParams.length + 3;
      const { rows } = await client.query(
        `UPDATE franchise_location_milestones
            SET ${updates.join(', ')},
                completed_by = ${completedBySql},
                completed_at = ${completing ? 'NOW()' : 'NULL'},
                updated_at = NOW()
          WHERE id = $${idPos} AND location_id = $${locationPos} AND application_id = $${appPos}
          RETURNING *`,
        [...setParams, milestoneId, locationId, id]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Location milestone not found.' });
      }
      await logActivity(
        client,
        id,
        req.user?.id || null,
        'location_milestone_updated',
        `Launch milestone "${rows[0].title}" updated to ${rows[0].status}.`,
        { location_id: locationId, milestone_id: milestoneId, status: rows[0].status }
      );
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error updating franchise location milestone', { id, locationId, milestoneId, err: err.message });
    return res.status(500).json({ error: 'Failed to update milestone.' });
  }
}

/**
 * DELETE /api/franchise/applications/:id/locations/:locationId/milestones/:milestoneId (admin)
 * 611: HQ removes a milestone. A linked launch plan step keeps working
 * standalone — its `milestone_id` is cleared, never left dangling. The
 * removal stays in the activity log.
 */
async function removeLocationMilestone(req, res) {
  const { id, locationId, milestoneId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `DELETE FROM franchise_location_milestones
          WHERE id = $1 AND location_id = $2 AND application_id = $3
          RETURNING title`,
        [milestoneId, locationId, id]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Location milestone not found.' });
      }
      await client.query(
        `UPDATE franchise_launch_plan_steps SET milestone_id = NULL WHERE milestone_id = $1`,
        [milestoneId]
      );
      await logActivity(
        client,
        id,
        req.user?.id || null,
        'location_milestone_removed',
        `Launch milestone removed: "${rows[0].title}".`,
        { location_id: locationId, milestone_id: milestoneId }
      );
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error removing franchise location milestone', { id, locationId, milestoneId, err: err.message });
    return res.status(500).json({ error: 'Failed to remove milestone.' });
  }
}

/**
 * POST /api/franchise/my-applications/:id/locations/:locationId/milestones/:milestoneId/status
 * 611 (D-311): the operator updates one milestone's status on their own
 * application — status only, mirroring the 609 launch plan step control.
 * Titles, dates, and owners stay HQ-owned. A stranger gets the same 404
 * as a missing application.
 */
async function updateLocationMilestoneStatus(req, res) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  const nextStatus = asTrimmed(req.body?.status);
  if (!MILESTONE_STATUSES.has(nextStatus)) {
    return res.status(400).json({
      error: 'status must be pending, in_progress, completed, or blocked.',
      code: 'invalid_milestone_status',
    });
  }
  const { id, locationId, milestoneId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOwnedApplication(client, id, req.user.id);
      if (!owned) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const completing = nextStatus === 'completed';
      const { rows } = await client.query(
        `UPDATE franchise_location_milestones
            SET status = $4,
                completed_by = ${completing ? '$5' : 'NULL'},
                completed_at = ${completing ? 'NOW()' : 'NULL'},
                updated_at = NOW()
          WHERE id = $1 AND location_id = $2 AND application_id = $3
          RETURNING *`,
        completing
          ? [milestoneId, locationId, id, nextStatus, req.user.id]
          : [milestoneId, locationId, id, nextStatus]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Location milestone not found.' });
      }
      await logActivity(
        client,
        id,
        req.user.id,
        'location_milestone_updated',
        `Operator updated launch milestone "${rows[0].title}" to ${nextStatus}.`,
        { location_id: locationId, milestone_id: milestoneId, status: nextStatus }
      );
      await client.query('COMMIT');
      const detail = await fetchApplicantApplicationDetail(id, req.user.id);
      return res.json(detail);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error updating franchise location milestone status', { id, locationId, milestoneId, err: err.message });
    return res.status(500).json({ error: 'Failed to update milestone.' });
  }
}

/**
 * Shared core for the opening-team assignment (612, D-312). The helper
 * must hold a helper profile — enforced here, not by FK, because the
 * territory roster itself is best-effort city/region matching (the same
 * reason the roster query is fail-open). Returns `{ member }` on success
 * or `{ error }` with an HTTP status and code.
 */
async function assignOpeningTeamMemberCore(client, { applicationId, locationId, helperUserId, role, actorId }) {
  if (locationId) {
    const location = await loadLocation(client, applicationId, locationId);
    if (!location) {
      return { error: { status: 404, body: { error: 'Franchise location not found.' } } };
    }
  }
  const { rows: helperRows } = await client.query(
    `SELECT u.id FROM users u
       JOIN helper_profiles hp ON hp.user_id = u.id
      WHERE u.id = $1 AND u.is_active = TRUE AND u.deleted_at IS NULL`,
    [helperUserId]
  );
  if (!helperRows.length) {
    return { error: { status: 404, body: { error: 'Helper not found.', code: 'opening_team_helper_not_found' } } };
  }
  const { rows: existingRows } = await client.query(
    `SELECT 1 FROM franchise_opening_team_members
      WHERE application_id = $1 AND helper_user_id = $2
        AND location_id IS NOT DISTINCT FROM $3`,
    [applicationId, helperUserId, locationId || null]
  );
  if (existingRows.length) {
    return { error: { status: 409, body: { error: 'That helper is already on the opening team for this scope.', code: 'opening_team_already_assigned' } } };
  }
  const { rows } = await client.query(
    `INSERT INTO franchise_opening_team_members
       (application_id, location_id, helper_user_id, role, assigned_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [applicationId, locationId || null, helperUserId, role, actorId || null]
  );
  await logActivity(
    client,
    applicationId,
    actorId || null,
    'opening_team_assigned',
    `Helper assigned to the opening team as ${role}${locationId ? ' for a location launch' : ' for the territory'}.`,
    { location_id: locationId || null, helper_user_id: helperUserId, role }
  );
  return { member: rows[0] };
}

async function removeOpeningTeamMemberCore(client, { applicationId, memberId, actorId }) {
  const { rows } = await client.query(
    `DELETE FROM franchise_opening_team_members
      WHERE id = $1 AND application_id = $2
      RETURNING helper_user_id, location_id, role`,
    [memberId, applicationId]
  );
  if (!rows.length) {
    return { error: { status: 404, body: { error: 'Opening team member not found.' } } };
  }
  await logActivity(
    client,
    applicationId,
    actorId || null,
    'opening_team_removed',
    'Helper removed from the opening team.',
    { member_id: memberId, helper_user_id: rows[0].helper_user_id, role: rows[0].role }
  );
  return { removed: rows[0] };
}

/**
 * POST /api/franchise/my-applications/:id/opening-team
 * 612 (D-312): the operator designates a helper from the territory roster
 * as an opening-team member — for one location launch, or for the whole
 * territory when no location is given. Operator-only: the applicant
 * record alone gets 403 `franchise_operator_only`.
 */
async function assignOpeningTeamMember(req, res) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  const helperUserId = asTrimmed(req.body?.helper_user_id);
  if (!helperUserId) {
    return res.status(400).json({ error: 'helper_user_id is required.', code: 'opening_team_helper_required' });
  }
  const role = asTrimmed(req.body?.role) || 'member';
  if (!OPENING_TEAM_ROLES.has(role)) {
    return res.status(400).json({ error: 'role must be lead or member.', code: 'invalid_opening_team_role' });
  }
  const locationId = asTrimmed(req.body?.location_id) || null;
  const { id } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { application, isOperator, isAssociated } = await loadOperatorApplication(client, id, req.user.id);
      if (!application || !isAssociated) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!isOperator) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can designate the opening team.',
          code: 'franchise_operator_only',
        });
      }
      const result = await assignOpeningTeamMemberCore(client, {
        applicationId: id, locationId, helperUserId, role, actorId: req.user.id,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const detail = await fetchApplicantApplicationDetail(id, req.user.id);
      return res.status(201).json(detail);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error assigning franchise opening team member', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to assign opening team member.' });
  }
}

/**
 * DELETE /api/franchise/my-applications/:id/opening-team/:memberId
 * 612: the operator removes a helper from the opening team.
 */
async function removeOpeningTeamMember(req, res) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  const { id, memberId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { application, isOperator, isAssociated } = await loadOperatorApplication(client, id, req.user.id);
      if (!application || !isAssociated) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!isOperator) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can designate the opening team.',
          code: 'franchise_operator_only',
        });
      }
      const result = await removeOpeningTeamMemberCore(client, {
        applicationId: id, memberId, actorId: req.user.id,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const detail = await fetchApplicantApplicationDetail(id, req.user.id);
      return res.json(detail);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error removing franchise opening team member', { id, memberId, err: err.message });
    return res.status(500).json({ error: 'Failed to remove opening team member.' });
  }
}

/**
 * POST /api/franchise/applications/:id/opening-team (admin)
 * 612: HQ designates an opening-team member on the operator's behalf.
 */
async function assignOpeningTeamMemberAsAdmin(req, res) {
  const helperUserId = asTrimmed(req.body?.helper_user_id);
  if (!helperUserId) {
    return res.status(400).json({ error: 'helper_user_id is required.', code: 'opening_team_helper_required' });
  }
  const role = asTrimmed(req.body?.role) || 'member';
  if (!OPENING_TEAM_ROLES.has(role)) {
    return res.status(400).json({ error: 'role must be lead or member.', code: 'invalid_opening_team_role' });
  }
  const locationId = asTrimmed(req.body?.location_id) || null;
  const { id } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const result = await assignOpeningTeamMemberCore(client, {
        applicationId: id, locationId, helperUserId, role, actorId: req.user?.id || null,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.status(201).json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error assigning franchise opening team member', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to assign opening team member.' });
  }
}

/**
 * DELETE /api/franchise/applications/:id/opening-team/:memberId (admin)
 * 612: HQ removes an opening-team member.
 */
async function removeOpeningTeamMemberAsAdmin(req, res) {
  const { id, memberId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await removeOpeningTeamMemberCore(client, {
        applicationId: id, memberId, actorId: req.user?.id || null,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error removing franchise opening team member', { id, memberId, err: err.message });
    return res.status(500).json({ error: 'Failed to remove opening team member.' });
  }
}

// Group 12 Slice 3c (614, D-314): the services the linked business can
// offer — the catalogue the per-location availability checklist draws
// from. No linked business means no catalogue; the checklist still works
// with free-text service names.
async function fetchBusinessServices(applicationId) {
  const { rows } = await db.query(
    `SELECT bs.id, bs.name
       FROM business_services bs
       JOIN franchise_applications fa ON fa.linked_business_id = bs.business_id
      WHERE fa.id = $1 AND bs.is_active = TRUE
      ORDER BY bs.sort_order ASC, bs.name ASC, bs.id ASC`,
    [applicationId]
  );
  return rows;
}

// Group 12 Slice 3c (614, D-314): upsert one row of a location's service
// availability checklist. A catalogue service is validated against the
// linked business (404 `location_service_not_offered` otherwise) and the
// catalogue name wins over whatever the client sent; a free-text service
// needs a name. The two partial unique indexes make the upsert
// idempotent per scope: one row per catalogue service, one per name.
async function upsertLocationServiceCore(client, {
  applicationId, locationId, serviceId, serviceName, available, reason, actorId,
}) {
  const { rows: locationRows } = await client.query(
    `SELECT id FROM franchise_locations
      WHERE id = $1 AND application_id = $2 FOR UPDATE`,
    [locationId, applicationId]
  );
  if (!locationRows.length) {
    return { error: { status: 404, body: { error: 'Franchise location not found.' } } };
  }
  let resolvedServiceId = null;
  let resolvedName = asTrimmed(serviceName);
  if (serviceId !== null && serviceId !== undefined && serviceId !== '') {
    const parsed = Number.parseInt(serviceId, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return { error: { status: 400, body: { error: 'service_id must be a positive integer.', code: 'invalid_service_id' } } };
    }
    const { rows: serviceRows } = await client.query(
      `SELECT bs.id, bs.name
         FROM business_services bs
         JOIN franchise_applications fa ON fa.linked_business_id = bs.business_id
        WHERE bs.id = $1 AND fa.id = $2 AND bs.is_active = TRUE`,
      [parsed, applicationId]
    );
    if (!serviceRows.length) {
      return { error: { status: 404, body: { error: 'This service is not offered by the linked business.', code: 'location_service_not_offered' } } };
    }
    resolvedServiceId = parsed;
    resolvedName = serviceRows[0].name;
  }
  if (!resolvedName) {
    return { error: { status: 400, body: { error: 'service_name is required.', code: 'location_service_name_required' } } };
  }
  if (typeof available !== 'boolean') {
    return { error: { status: 400, body: { error: 'available must be a boolean.', code: 'invalid_service_available' } } };
  }
  const { rows } = await client.query(
    resolvedServiceId !== null
      ? `INSERT INTO franchise_location_services
           (location_id, application_id, service_id, service_name, available, reason, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (location_id, service_id) WHERE service_id IS NOT NULL
         DO UPDATE SET service_name = EXCLUDED.service_name,
                       available = EXCLUDED.available,
                       reason = EXCLUDED.reason,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = NOW()
         RETURNING *`
      : `INSERT INTO franchise_location_services
           (location_id, application_id, service_id, service_name, available, reason, updated_by)
         VALUES ($1, $2, NULL, $3, $4, $5, $6)
         ON CONFLICT (location_id, service_name) WHERE service_id IS NULL
         DO UPDATE SET available = EXCLUDED.available,
                       reason = EXCLUDED.reason,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = NOW()
         RETURNING *`,
    resolvedServiceId !== null
      ? [locationId, applicationId, resolvedServiceId, resolvedName, available, asTrimmed(reason), actorId]
      : [locationId, applicationId, resolvedName, available, asTrimmed(reason), actorId]
  );
  await logActivity(
    client,
    applicationId,
    actorId,
    'location_service_updated',
    `Service availability updated for a location: ${resolvedName} is ${available ? 'available' : 'unavailable'}.`,
    { location_id: locationId, service_id: resolvedServiceId, service_name: resolvedName, available }
  );
  return { row: rows[0] };
}

async function upsertLocationService(req, res) {
  const { id, locationId } = req.params;
  const body = req.body || {};
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can update a location service checklist.',
          code: 'franchise_operator_only',
        });
      }
      const result = await upsertLocationServiceCore(client, {
        applicationId: id,
        locationId,
        serviceId: body.service_id,
        serviceName: body.service_name,
        available: body.available,
        reason: body.reason,
        actorId: req.user?.id || null,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const detail = await fetchApplicantApplicationDetail(id, req.user?.id);
      return res.status(201).json(detail);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error updating franchise location service', { id, locationId, err: err.message });
    return res.status(500).json({ error: 'Failed to update location service.' });
  }
}

async function upsertLocationServiceAsAdmin(req, res) {
  const { id, locationId } = req.params;
  const body = req.body || {};
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await upsertLocationServiceCore(client, {
        applicationId: id,
        locationId,
        serviceId: body.service_id,
        serviceName: body.service_name,
        available: body.available,
        reason: body.reason,
        actorId: req.user?.id || null,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.status(201).json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error updating franchise location service', { id, locationId, err: err.message });
    return res.status(500).json({ error: 'Failed to update location service.' });
  }
}

// Group 12 Slice 3c (614, D-314): launch a location. The application
// itself must already be launched (the fail-closed activation gate), the
// location must still be planned, and at least one service on its
// checklist must be available — a location cannot launch with zero
// available services. The launch is only complete once the operator
// confirms the opening (615).
async function launchLocationCore(client, { applicationId, locationId, actorId }) {
  const { rows: applicationRows } = await client.query(
    `SELECT id, status FROM franchise_applications WHERE id = $1 FOR UPDATE`,
    [applicationId]
  );
  if (!applicationRows.length) {
    return { error: { status: 404, body: { error: 'Franchise application not found.' } } };
  }
  if (applicationRows[0].status !== 'launched') {
    return { error: { status: 409, body: { error: 'The application must be launched before a location can launch.', code: 'location_application_not_launched' } } };
  }
  const { rows: locationRows } = await client.query(
    `SELECT id, status FROM franchise_locations
      WHERE id = $1 AND application_id = $2 FOR UPDATE`,
    [locationId, applicationId]
  );
  if (!locationRows.length) {
    return { error: { status: 404, body: { error: 'Franchise location not found.' } } };
  }
  if (locationRows[0].status === 'launched') {
    return { error: { status: 409, body: { error: 'This location has already launched.', code: 'location_already_launched' } } };
  }
  const { rows: availableRows } = await client.query(
    `SELECT COUNT(*)::int AS available_count
       FROM franchise_location_services
      WHERE location_id = $1 AND available = TRUE`,
    [locationId]
  );
  if (!availableRows[0].available_count) {
    return { error: { status: 409, body: { error: 'A location cannot launch with no available services.', code: 'location_no_available_services' } } };
  }
  await client.query(
    `UPDATE franchise_locations
        SET status = 'launched', launched_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [locationId]
  );
  await logActivity(client, applicationId, actorId, 'location_launched', 'Location launched.', { location_id: locationId });
  return {};
}

async function launchLocation(req, res) {
  const { id, locationId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can launch a location.',
          code: 'franchise_operator_only',
        });
      }
      const result = await launchLocationCore(client, {
        applicationId: id, locationId, actorId: req.user?.id || null,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const detail = await fetchApplicantApplicationDetail(id, req.user?.id);
      return res.json(detail);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error launching franchise location', { id, locationId, err: err.message });
    return res.status(500).json({ error: 'Failed to launch location.' });
  }
}

async function launchLocationAsAdmin(req, res) {
  const { id, locationId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await launchLocationCore(client, {
        applicationId: id, locationId, actorId: req.user?.id || null,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error launching franchise location', { id, locationId, err: err.message });
    return res.status(500).json({ error: 'Failed to launch location.' });
  }
}

// Group 12 Slice 3c (615, D-315): the operator confirms a location
// opened, with the date it opened and notes. Only a launched location
// can be confirmed (409 `location_not_launched` otherwise); re-confirming
// corrects the record instead of creating a second one (one confirmation
// per location, UNIQUE on location_id). The launch is only complete once
// a confirmation exists — `launch_complete` in fetchOpenLocations stays
// false until then.
function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function confirmOpeningCore(client, { applicationId, locationId, openedDate, notes, actorId }) {
  const { rows: locationRows } = await client.query(
    `SELECT id, status FROM franchise_locations
      WHERE id = $1 AND application_id = $2 FOR UPDATE`,
    [locationId, applicationId]
  );
  if (!locationRows.length) {
    return { error: { status: 404, body: { error: 'Franchise location not found.' } } };
  }
  if (locationRows[0].status !== 'launched') {
    return { error: { status: 409, body: { error: 'Only a launched location can be confirmed open.', code: 'location_not_launched' } } };
  }
  const { rows: existingRows } = await client.query(
    `SELECT id FROM franchise_opening_confirmations WHERE location_id = $1`,
    [locationId]
  );
  const isNew = !existingRows.length;
  await client.query(
    `INSERT INTO franchise_opening_confirmations
       (application_id, location_id, confirmed_by, opened_date, notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (location_id)
     DO UPDATE SET confirmed_by = EXCLUDED.confirmed_by,
                   opened_date = EXCLUDED.opened_date,
                   notes = EXCLUDED.notes`,
    [applicationId, locationId, actorId, openedDate, notes || null]
  );
  await logActivity(
    client,
    applicationId,
    actorId,
    isNew ? 'opening_confirmed' : 'opening_confirmation_updated',
    isNew
      ? `Operator confirmed the location opened on ${openedDate}.`
      : `Operator updated the opening confirmation to ${openedDate}.`,
    { location_id: locationId, opened_date: openedDate }
  );
  return { isNew };
}

async function confirmOpening(req, res) {
  const { id, locationId } = req.params;
  const body = req.body || {};
  if (!isValidDateString(body.opened_date)) {
    return res.status(400).json({
      error: 'opened_date must be a valid YYYY-MM-DD date.',
      code: 'invalid_opened_date',
    });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can confirm a location opening.',
          code: 'franchise_operator_only',
        });
      }
      const result = await confirmOpeningCore(client, {
        applicationId: id,
        locationId,
        openedDate: body.opened_date,
        notes: asTrimmed(body.notes),
        actorId: req.user?.id || null,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const detail = await fetchApplicantApplicationDetail(id, req.user?.id);
      return res.status(result.isNew ? 201 : 200).json(detail);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error confirming franchise location opening', { id, locationId, err: err.message });
    return res.status(500).json({ error: 'Failed to confirm opening.' });
  }
}

/**
 * POST /api/franchise/applications/:id/readiness-review (admin)
 * 613 (D-313): HQ records a formal readiness review. A passed review is
 * the only way readiness moves to `ready` (the bare admin status set
 * refuses it — see updateFranchiseApplication); requesting changes sends
 * readiness back to `planning` and needs reasons, so the operator knows
 * what to fix. The review is recorded with the HQ reviewer and the time;
 * the operator sees outcome, notes, and date, never the reviewer. A
 * review on a launched, rejected, or archived application is a 409 —
 * there is nothing left to review.
 */
async function submitReadinessReview(req, res) {
  const outcome = asTrimmed(req.body?.outcome);
  if (!READINESS_REVIEW_OUTCOMES.has(outcome)) {
    return res.status(400).json({
      error: 'outcome must be passed or changes_requested.',
      code: 'invalid_readiness_outcome',
    });
  }
  const notes = asTrimmed(req.body?.notes);
  if (outcome === 'changes_requested' && !notes) {
    return res.status(400).json({
      error: 'Notes are required when requesting changes.',
      code: 'readiness_review_notes_required',
    });
  }
  const { id } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows: appRows } = await client.query(
        `SELECT id, status, launch_readiness_status
           FROM franchise_applications WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!appRows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (['launched', 'rejected', 'archived'].includes(appRows[0].status)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `This application is ${appRows[0].status}; readiness can no longer be reviewed.`,
          code: 'readiness_review_closed',
        });
      }
      const nextReadiness = outcome === 'passed' ? 'ready' : 'planning';
      await client.query(
        `INSERT INTO franchise_readiness_reviews
           (application_id, reviewer_id, outcome, notes)
         VALUES ($1, $2, $3, $4)`,
        [id, req.user?.id || null, outcome, notes]
      );
      await client.query(
        `UPDATE franchise_applications
            SET launch_readiness_status = $2, updated_at = NOW()
          WHERE id = $1`,
        [id, nextReadiness]
      );
      await logActivity(
        client,
        id,
        req.user?.id || null,
        outcome === 'passed' ? 'readiness_review_passed' : 'readiness_review_changes_requested',
        outcome === 'passed'
          ? 'HQ readiness review passed; launch readiness is ready.'
          : `HQ readiness review requested changes: ${notes}.`,
        { outcome, notes: notes || null }
      );
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.status(201).json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error submitting franchise readiness review', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to record readiness review.' });
  }
}

// ── Group 12 Slice 3d (616-620): guide teams ──────────────────────────
// Territory invitations (616), location managers (617), training task
// distribution (618), coverage planning (619), announcement feed (620).

const INVITE_ROLES = new Set(['member', 'manager']);
const TRAINING_ASSIGNMENT_STATUSES = new Set(['assigned', 'in_progress', 'completed']);

function isValidInviteEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function parseExpiry(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { ok: false, value: null };
  return { ok: true, value: parsed.toISOString() };
}

// 616 (D-316): territory-scoped invitation. One outstanding invite per
// email per application; the token is the invitee's handle and the
// invitee's account email must match, so a forwarded token is useless to
// anyone else. Invites expire after 14 days.
async function createTerritoryInvitationCore(client, { applicationId, email, role, invitedBy }) {
  const normalizedEmail = email.trim().toLowerCase();
  const { rows: pending } = await client.query(
    `SELECT id FROM franchise_territory_invitations
      WHERE application_id = $1 AND lower(email) = $2 AND status = 'invited'`,
    [applicationId, normalizedEmail]
  );
  if (pending.length) {
    return { error: { status: 409, body: { error: 'That email already has an outstanding territory invite.', code: 'territory_invite_exists' } } };
  }
  const token = randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const { rows } = await client.query(
    `INSERT INTO franchise_territory_invitations
       (application_id, email, role, invite_token, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, application_id, email, role, status, invited_by, expires_at, responded_at, created_at`,
    [applicationId, normalizedEmail, role, token, invitedBy, expiresAt]
  );
  await logActivity(client, applicationId, invitedBy, 'territory_invite_sent',
    `Invited ${normalizedEmail} to the territory.`, { invite_id: rows[0].id, email: normalizedEmail, role });
  return { invitation: rows[0], token };
}

async function createTerritoryInvitation(req, res) {
  const { id } = req.params;
  const email = asTrimmed(req.body?.email);
  const role = asTrimmed(req.body?.role) || 'member';
  if (!isValidInviteEmail(email)) {
    return res.status(400).json({ error: 'A valid invite email is required.', code: 'invalid_invite_email' });
  }
  if (!INVITE_ROLES.has(role)) {
    return res.status(400).json({ error: 'role must be member or manager.', code: 'invalid_invite_role' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can invite people to the territory.',
          code: 'franchise_operator_only',
        });
      }
      const result = await createTerritoryInvitationCore(client, {
        applicationId: id, email, role, invitedBy: req.user?.id || null,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const detail = await fetchApplicantApplicationDetail(id, req.user?.id);
      return res.status(201).json({ ...detail, new_invite_token: result.token });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error creating franchise territory invitation', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to invite to the territory.' });
  }
}

async function createTerritoryInvitationAsAdmin(req, res) {
  const { id } = req.params;
  const email = asTrimmed(req.body?.email);
  const role = asTrimmed(req.body?.role) || 'member';
  if (!isValidInviteEmail(email)) {
    return res.status(400).json({ error: 'A valid invite email is required.', code: 'invalid_invite_email' });
  }
  if (!INVITE_ROLES.has(role)) {
    return res.status(400).json({ error: 'role must be member or manager.', code: 'invalid_invite_role' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const result = await createTerritoryInvitationCore(client, {
        applicationId: id, email, role, invitedBy: req.user?.id || null,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.status(201).json({ ...bundle, new_invite_token: result.token });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error creating franchise territory invitation as admin', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to invite to the territory.' });
  }
}

async function cancelTerritoryInvitationCore(client, { applicationId, inviteId, actorId }) {
  const { rows } = await client.query(
    `SELECT id, email, status FROM franchise_territory_invitations
      WHERE id = $1 AND application_id = $2 FOR UPDATE`,
    [inviteId, applicationId]
  );
  if (!rows.length) {
    return { error: { status: 404, body: { error: 'Territory invitation not found.', code: 'territory_invite_not_found' } } };
  }
  if (rows[0].status !== 'invited') {
    return { error: { status: 409, body: { error: 'Only an outstanding invite can be cancelled.', code: 'territory_invite_not_pending' } } };
  }
  await client.query(
    `UPDATE franchise_territory_invitations SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
    [inviteId]
  );
  await logActivity(client, applicationId, actorId, 'territory_invite_cancelled',
    `Cancelled the territory invite for ${rows[0].email}.`, { invite_id: inviteId, email: rows[0].email });
  return {};
}

async function cancelTerritoryInvitation(req, res) {
  const { id, inviteId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can cancel territory invites.',
          code: 'franchise_operator_only',
        });
      }
      const result = await cancelTerritoryInvitationCore(client, {
        applicationId: id, inviteId, actorId: req.user?.id || null,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const detail = await fetchApplicantApplicationDetail(id, req.user?.id);
      return res.json(detail);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error cancelling franchise territory invitation', { id, inviteId, err: err.message });
    return res.status(500).json({ error: 'Failed to cancel territory invite.' });
  }
}

async function cancelTerritoryInvitationAsAdmin(req, res) {
  const { id, inviteId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const result = await cancelTerritoryInvitationCore(client, {
        applicationId: id, inviteId, actorId: req.user?.id || null,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error cancelling franchise territory invitation as admin', { id, inviteId, err: err.message });
    return res.status(500).json({ error: 'Failed to cancel territory invite.' });
  }
}

// 616: the invitee answers by token. The caller's account email must
// match the invited email, so a forwarded token cannot be answered by
// someone else; the invite must still be outstanding.
async function respondToTerritoryInvitation(req, res) {
  const { token } = req.params;
  const response = asTrimmed(req.body?.response);
  if (response !== 'accepted' && response !== 'declined') {
    return res.status(400).json({ error: 'response must be accepted or declined.', code: 'invalid_invite_response' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT * FROM franchise_territory_invitations WHERE invite_token = $1 FOR UPDATE`,
        [token]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Territory invitation not found.', code: 'territory_invite_not_found' });
      }
      const invite = rows[0];
      const callerEmail = String(req.user?.email || '').trim().toLowerCase();
      if (callerEmail !== String(invite.email).toLowerCase()) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'This invite was sent to a different email address.',
          code: 'territory_invite_email_mismatch',
        });
      }
      if (invite.status !== 'invited') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This invite has already been answered.', code: 'territory_invite_not_pending' });
      }
      if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
        await client.query(
          `UPDATE franchise_territory_invitations SET status = 'expired', updated_at = NOW() WHERE id = $1`,
          [invite.id]
        );
        await client.query('COMMIT');
        return res.status(409).json({ error: 'This invite has expired.', code: 'territory_invite_expired' });
      }
      const { rows: updated } = await client.query(
        `UPDATE franchise_territory_invitations
            SET status = $1, responded_at = NOW(), updated_at = NOW()
          WHERE id = $2
          RETURNING id, application_id, email, role, status, invited_by, expires_at, responded_at, created_at`,
        [response, invite.id]
      );
      await logActivity(client, invite.application_id, req.user?.id || null,
        response === 'accepted' ? 'territory_invite_accepted' : 'territory_invite_declined',
        `Territory invite for ${invite.email} was ${response}.`,
        { invite_id: invite.id, email: invite.email });
      await client.query('COMMIT');
      return res.json({ invitation: updated[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error responding to franchise territory invitation', { err: err.message });
    return res.status(500).json({ error: 'Failed to respond to territory invite.' });
  }
}

// 617 (D-318): location manager assignment is HQ-only — the operator
// sees the manager on the location, HQ assigns and removes. The
// assignee must be a territory member (owner, accepted invitee, or
// opening-team helper); one manager per location, reassignment replaces.
async function assignLocationManagerCore(client, { applicationId, locationId, managerUserId, actorId }) {
  const location = await loadLocation(client, applicationId, locationId);
  if (!location) {
    return { error: { status: 404, body: { error: 'Franchise location not found.' } } };
  }
  const { rows: userRows } = await client.query(
    'SELECT id FROM users WHERE id = $1 AND is_active = TRUE', [managerUserId]
  );
  if (!userRows.length) {
    return { error: { status: 404, body: { error: 'Manager not found.', code: 'location_manager_not_found' } } };
  }
  if (!(await isTerritoryMember(client, applicationId, managerUserId))) {
    return { error: { status: 404, body: { error: 'The manager must be a member of this territory.', code: 'location_manager_not_member' } } };
  }
  await client.query(
    `INSERT INTO franchise_location_managers
       (application_id, location_id, manager_user_id, assigned_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (location_id)
     DO UPDATE SET manager_user_id = EXCLUDED.manager_user_id,
                   assigned_by = EXCLUDED.assigned_by,
                   assigned_at = NOW(), updated_at = NOW()`,
    [applicationId, locationId, managerUserId, actorId]
  );
  await logActivity(client, applicationId, actorId, 'location_manager_assigned',
    `Assigned a manager to ${location.name}.`, { location_id: locationId, manager_user_id: managerUserId });
  return {};
}

async function assignLocationManagerAsAdmin(req, res) {
  const { id, locationId } = req.params;
  const managerUserId = asTrimmed(req.body?.manager_user_id);
  if (!managerUserId) {
    return res.status(400).json({ error: 'manager_user_id is required.', code: 'location_manager_required' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const result = await assignLocationManagerCore(client, {
        applicationId: id, locationId, managerUserId, actorId: req.user?.id || null,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.status(201).json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error assigning franchise location manager', { id, locationId, err: err.message });
    return res.status(500).json({ error: 'Failed to assign location manager.' });
  }
}

async function removeLocationManagerAsAdmin(req, res) {
  const { id, locationId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const location = await loadLocation(client, id, locationId);
      if (!location) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise location not found.' });
      }
      const { rowCount } = await client.query(
        'DELETE FROM franchise_location_managers WHERE location_id = $1 AND application_id = $2',
        [locationId, id]
      );
      if (!rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'No manager is assigned to this location.', code: 'location_manager_not_assigned' });
      }
      await logActivity(client, id, req.user?.id || null, 'location_manager_removed',
        `Removed the manager from ${location.name}.`, { location_id: locationId });
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error removing franchise location manager', { id, locationId, err: err.message });
    return res.status(500).json({ error: 'Failed to remove location manager.' });
  }
}

// 618 (D-317): territory-scoped training distribution. The module
// catalogue is the existing restaurant training modules (a title is
// resolved from the module when one is picked); assignment and
// completion state live in franchise_training_assignments, not in the
// restaurant-scoped table. The assignee must be a territory member.
async function assignTrainingCore(client, { applicationId, locationId, assigneeUserId, moduleId, moduleTitle, category, dueDate, actorId }) {
  if (locationId) {
    const location = await loadLocation(client, applicationId, locationId);
    if (!location) {
      return { error: { status: 404, body: { error: 'Franchise location not found.' } } };
    }
  }
  const { rows: userRows } = await client.query(
    'SELECT id FROM users WHERE id = $1 AND is_active = TRUE', [assigneeUserId]
  );
  if (!userRows.length) {
    return { error: { status: 404, body: { error: 'Assignee not found.', code: 'training_assignee_not_found' } } };
  }
  if (!(await isTerritoryMember(client, applicationId, assigneeUserId))) {
    return { error: { status: 404, body: { error: 'Training can only be assigned to a member of this territory.', code: 'training_assignee_not_member' } } };
  }
  let title = asTrimmed(moduleTitle);
  let moduleCategory = asTrimmed(category);
  if (moduleId) {
    const { rows: moduleRows } = await client.query(
      'SELECT id, title, category FROM restaurant_training_modules WHERE id = $1 AND is_active = TRUE',
      [moduleId]
    );
    if (!moduleRows.length) {
      return { error: { status: 404, body: { error: 'Training module not found.', code: 'training_module_not_found' } } };
    }
    if (!title) title = moduleRows[0].title;
    if (!moduleCategory) moduleCategory = moduleRows[0].category;
  }
  if (!title) {
    return { error: { status: 400, body: { error: 'module_title is required.', code: 'training_module_title_required' } } };
  }
  if (dueDate && !isValidDateString(dueDate)) {
    return { error: { status: 400, body: { error: 'due_date must be a valid YYYY-MM-DD date.', code: 'invalid_training_due_date' } } };
  }
  const { rows: existing } = await client.query(
    `SELECT id FROM franchise_training_assignments
      WHERE application_id = $1 AND assignee_user_id = $2 AND module_title = $3
        AND location_id IS NOT DISTINCT FROM $4 AND status <> 'completed'`,
    [applicationId, assigneeUserId, title, locationId || null]
  );
  if (existing.length) {
    return { error: { status: 409, body: { error: 'That training is already assigned to this person for this scope.', code: 'training_already_assigned' } } };
  }
  const { rows } = await client.query(
    `INSERT INTO franchise_training_assignments
       (application_id, location_id, assignee_user_id, module_id, module_title, category, due_date, assigned_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [applicationId, locationId || null, assigneeUserId, moduleId || null, title, moduleCategory || null, dueDate || null, actorId]
  );
  await logActivity(client, applicationId, actorId, 'training_assigned',
    `Assigned training "${title}" to a territory member.`,
    { assignment_id: rows[0].id, assignee_user_id: assigneeUserId, module_title: title });
  return { assignment: rows[0] };
}

async function assignTraining(req, res, { asAdmin = false } = {}) {
  const { id } = req.params;
  const assigneeUserId = asTrimmed(req.body?.assignee_user_id);
  if (!assigneeUserId) {
    return res.status(400).json({ error: 'assignee_user_id is required.', code: 'training_assignee_required' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (asAdmin) {
        const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
        if (!exists.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
      } else {
        const owned = await loadOperatorApplication(client, id, req.user?.id);
        if (!owned.application || !owned.isAssociated) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
        if (!owned.isOperator) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Only the assigned operator can distribute training in the territory.',
            code: 'franchise_operator_only',
          });
        }
      }
      const result = await assignTrainingCore(client, {
        applicationId: id,
        locationId: asTrimmed(req.body?.location_id) || null,
        assigneeUserId,
        moduleId: req.body?.module_id ? Number(req.body.module_id) : null,
        moduleTitle: asTrimmed(req.body?.module_title),
        category: asTrimmed(req.body?.category),
        dueDate: asTrimmed(req.body?.due_date),
        actorId: req.user?.id || null,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      if (asAdmin) {
        const bundle = await fetchFranchiseApplicationBundle(id);
        return res.status(201).json(bundle);
      }
      const detail = await fetchApplicantApplicationDetail(id, req.user?.id);
      return res.status(201).json(detail);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error assigning franchise training', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to assign training.' });
  }
}

async function assignTrainingAsAdmin(req, res) {
  return assignTraining(req, res, { asAdmin: true });
}

async function completeTrainingAssignment(req, res, { asAdmin = false } = {}) {
  const { id, assignmentId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (asAdmin) {
        const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
        if (!exists.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
      }
      const { rows } = await client.query(
        `SELECT * FROM franchise_training_assignments WHERE id = $1 AND application_id = $2 FOR UPDATE`,
        [assignmentId, id]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        // A missing application and a missing assignment read the same
        // 404, so existence never leaks across territories.
        return res.status(404).json({ error: 'Training assignment not found.', code: 'training_assignment_not_found' });
      }
      const assignment = rows[0];
      // The assignee marks their own training complete (an accepted
      // invitee is a member, not the operator, so they are admitted here
      // even though the operator-only loaders would 404 them); the
      // operator (or HQ) may also mark it complete. A stranger gets 404,
      // an associated non-operator (the applicant record) gets 403.
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      const callerIsOperator = owned.isOperator;
      const callerIsAssignee = String(assignment.assignee_user_id) === String(req.user?.id);
      if (!asAdmin && !callerIsAssignee && !callerIsOperator) {
        await client.query('ROLLBACK');
        if (!owned.application || !owned.isAssociated) {
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
        return res.status(403).json({
          error: 'Only the assignee or the assigned operator can mark training complete.',
          code: 'training_complete_forbidden',
        });
      }
      if (assignment.status !== 'completed') {
        await client.query(
          `UPDATE franchise_training_assignments
              SET status = 'completed', completed_at = NOW(), updated_at = NOW()
            WHERE id = $1`,
          [assignmentId]
        );
        await logActivity(client, id, req.user?.id || null, 'training_completed',
          `Training "${assignment.module_title}" was completed.`,
          { assignment_id: assignmentId, assignee_user_id: assignment.assignee_user_id });
      }
      await client.query('COMMIT');
      if (asAdmin) {
        const bundle = await fetchFranchiseApplicationBundle(id);
        return res.json(bundle);
      }
      if (callerIsOperator) {
        const detail = await fetchApplicantApplicationDetail(id, req.user?.id);
        return res.json(detail);
      }
      // The assignee is not the operator, so the operator detail payload
      // is not theirs to see — return the updated assignment instead.
      const { rows: updatedRows } = await db.query(
        'SELECT * FROM franchise_training_assignments WHERE id = $1', [assignmentId]
      );
      return res.json({ assignment: updatedRows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error completing franchise training assignment', { id, assignmentId, err: err.message });
    return res.status(500).json({ error: 'Failed to mark training complete.' });
  }
}

async function completeTrainingAssignmentAsAdmin(req, res) {
  return completeTrainingAssignment(req, res, { asAdmin: true });
}

async function removeTrainingAssignment(req, res, { asAdmin = false } = {}) {
  const { id, assignmentId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (asAdmin) {
        const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
        if (!exists.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
      } else {
        const owned = await loadOperatorApplication(client, id, req.user?.id);
        if (!owned.application || !owned.isAssociated) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
        if (!owned.isOperator) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Only the assigned operator can remove training assignments.',
            code: 'franchise_operator_only',
          });
        }
      }
      const { rows } = await client.query(
        `DELETE FROM franchise_training_assignments WHERE id = $1 AND application_id = $2 RETURNING module_title`,
        [assignmentId, id]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Training assignment not found.', code: 'training_assignment_not_found' });
      }
      await logActivity(client, id, req.user?.id || null, 'training_removed',
        `Removed training "${rows[0].module_title}".`, { assignment_id: assignmentId });
      await client.query('COMMIT');
      if (asAdmin) {
        const bundle = await fetchFranchiseApplicationBundle(id);
        return res.json(bundle);
      }
      const detail = await fetchApplicantApplicationDetail(id, req.user?.id);
      return res.json(detail);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error removing franchise training assignment', { id, assignmentId, err: err.message });
    return res.status(500).json({ error: 'Failed to remove training assignment.' });
  }
}

async function removeTrainingAssignmentAsAdmin(req, res) {
  return removeTrainingAssignment(req, res, { asAdmin: true });
}

// 619 (D-319): territory coverage planning — a read-only rollup over the
// linked business's existing staff shifts. Fourteen days from today:
// shifts and distinct staff per day, days with no shifts flagged as
// gaps. Per-location coverage is the manager + opening-team presence,
// not per-location shifts: shifts are business-scoped and a franchise
// location has no separate business id. No linked business means no
// shift data, reported explicitly instead of an empty-looking rollup.
async function buildTerritoryCoverage(applicationId) {
  const { rows: [application] } = await db.query(
    'SELECT linked_business_id FROM franchise_applications WHERE id = $1',
    [applicationId]
  );
  const locations = await fetchOpenLocations(applicationId);
  const locationSummaries = locations.map((location) => ({
    id: location.id,
    name: location.name,
    status: location.status,
    manager: location.manager
      ? {
          user_id: location.manager.manager_user_id,
          name: [location.manager.manager_first_name, location.manager.manager_last_name].filter(Boolean).join(' ') || location.manager.manager_email,
          email: location.manager.manager_email,
        }
      : null,
    opening_team_count: (location.opening_team || []).length,
    launch_complete: location.launch_complete,
  }));
  const businessId = application?.linked_business_id || null;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 13 * 24 * 60 * 60 * 1000);
  const coverageStart = start.toISOString().slice(0, 10);
  const coverageEnd = end.toISOString().slice(0, 10);
  if (!businessId) {
    return {
      linked_business_id: null,
      coverage_start: coverageStart,
      coverage_end: coverageEnd,
      days: [],
      locations: locationSummaries,
    };
  }
  const { rows } = await db.query(
    `SELECT shift_date, COUNT(*)::int AS shifts, COUNT(DISTINCT user_id)::int AS staff
       FROM business_staff_shifts
      WHERE business_id = $1 AND shift_date BETWEEN $2 AND $3
        AND cancelled_at IS NULL
      GROUP BY shift_date`,
    [businessId, coverageStart, coverageEnd]
  );
  const byDate = new Map(rows.map((row) => [new Date(row.shift_date).toISOString().slice(0, 10), row]));
  const days = [];
  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date(start.getTime() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const row = byDate.get(date);
    days.push({
      date,
      shifts: row?.shifts || 0,
      staff: row?.staff || 0,
      gap: !row || row.shifts === 0,
    });
  }
  return {
    linked_business_id: businessId,
    coverage_start: coverageStart,
    coverage_end: coverageEnd,
    days,
    locations: locationSummaries,
  };
}

// ── Group 12 Slice 3f (626-630): monitor locations ──────────────────────────
// 628 (D-327): the service exception summary. An exception IS a support
// ticket attached to a territory — no parallel exception store (D-293).
// The attachment is two nullable columns on support_tickets; the summary
// below derives on read, so it can never drift from the tickets.
const EXCEPTION_OPEN_STATUSES = ['open', 'assigned', 'in_progress', 'waiting_user'];
const EXCEPTION_OPEN_SQL = `('open', 'assigned', 'in_progress', 'waiting_user')`;
const UUID_RE = /^[0-9a-f-]{36}$/i;

// The territory's tickets, newest first, each carrying its location link
// (NULL location = territory-wide). `status` is 'all', 'open' (the four
// open statuses), or one concrete status; `locationId` is one location,
// 'unassigned' for territory-wide tickets, or null for every location.
// `limit` caps the rows (the summary takes 5). Callers validate the
// filters — this helper trusts them.
async function fetchTerritoryTickets(applicationId, { status = 'all', locationId = null, limit = 100, category = null } = {}) {
  const conditions = ['t.franchise_application_id = $1'];
  const params = [applicationId];
  if (status === 'open') {
    conditions.push(`t.status IN ${EXCEPTION_OPEN_SQL}`);
  } else if (status !== 'all') {
    params.push(status);
    conditions.push(`t.status = $${params.length}`);
  }
  if (category) {
    params.push(category);
    conditions.push(`t.category = $${params.length}`);
  }
  if (locationId === 'unassigned') {
    conditions.push('t.franchise_location_id IS NULL');
  } else if (locationId) {
    params.push(locationId);
    conditions.push(`t.franchise_location_id = $${params.length}`);
  }
  params.push(limit);
  const { rows } = await db.query(
    `SELECT t.id, t.ticket_number, t.subject, t.category, t.priority, t.status,
            t.user_id, t.name AS requester_name, t.email AS requester_email,
            t.created_at, t.updated_at, t.resolved_at, t.metadata,
            t.franchise_application_id AS application_id,
            t.franchise_location_id AS location_id,
            l.name AS location_name
       FROM support_tickets t
       LEFT JOIN franchise_locations l ON l.id = t.franchise_location_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

// 628 (D-327): the exception summary — totals, open/urgent counts, the
// breakdowns by status, category, and priority, the per-location split,
// the oldest open exception, and the five most recent open tickets so
// the summary is actionable without a second fetch.
async function buildExceptionSummary(applicationId) {
  const [totals, byStatus, byCategory, byPriority, byLocation] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status IN ${EXCEPTION_OPEN_SQL})::int AS open_count,
              COUNT(*) FILTER (WHERE status IN ('resolved', 'closed'))::int AS closed_count,
              COUNT(*) FILTER (WHERE status IN ${EXCEPTION_OPEN_SQL}
                                 AND priority IN ('urgent', 'high'))::int AS open_urgent_count,
              MIN(created_at) FILTER (WHERE status IN ${EXCEPTION_OPEN_SQL}) AS oldest_open_at
         FROM support_tickets
        WHERE franchise_application_id = $1`,
      [applicationId]
    ),
    db.query(
      `SELECT status, COUNT(*)::int AS count
         FROM support_tickets
        WHERE franchise_application_id = $1
        GROUP BY status
        ORDER BY count DESC, status ASC`,
      [applicationId]
    ),
    db.query(
      `SELECT category, COUNT(*)::int AS count
         FROM support_tickets
        WHERE franchise_application_id = $1
        GROUP BY category
        ORDER BY count DESC, category ASC`,
      [applicationId]
    ),
    db.query(
      `SELECT priority, COUNT(*)::int AS count
         FROM support_tickets
        WHERE franchise_application_id = $1
        GROUP BY priority
        ORDER BY count DESC, priority ASC`,
      [applicationId]
    ),
    db.query(
      `SELECT t.franchise_location_id AS location_id, l.name AS location_name,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE t.status IN ${EXCEPTION_OPEN_SQL})::int AS open_count,
              COUNT(*) FILTER (WHERE t.status IN ${EXCEPTION_OPEN_SQL}
                                 AND t.priority IN ('urgent', 'high'))::int AS open_urgent_count
         FROM support_tickets t
         LEFT JOIN franchise_locations l ON l.id = t.franchise_location_id
        WHERE t.franchise_application_id = $1
        GROUP BY t.franchise_location_id, l.name
        ORDER BY open_count DESC, total DESC, location_name ASC NULLS LAST`,
      [applicationId]
    ),
  ]);
  const recentOpen = await fetchTerritoryTickets(applicationId, { status: 'open', limit: 5 });
  const total = totals.rows[0] || {};
  return {
    application_id: applicationId,
    total: total.total || 0,
    open_count: total.open_count || 0,
    closed_count: total.closed_count || 0,
    open_urgent_count: total.open_urgent_count || 0,
    oldest_open_at: total.oldest_open_at || null,
    by_status: byStatus.rows,
    by_category: byCategory.rows,
    by_priority: byPriority.rows,
    by_location: byLocation.rows,
    recent_open: recentOpen,
  };
}

async function getExceptionSummary(req, res) {
  const { id } = req.params;
  try {
    const client = await db.connect();
    try {
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        return res.status(403).json({
          error: 'Only the assigned operator can view territory exceptions.',
          code: 'franchise_operator_only',
        });
      }
    } finally {
      client.release();
    }
    return res.json(await buildExceptionSummary(id));
  } catch (err) {
    logger.error('Error loading franchise exception summary', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to load exception summary.' });
  }
}

async function getExceptionSummaryAsAdmin(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Franchise application not found.' });
    }
    return res.json(await buildExceptionSummary(id));
  } catch (err) {
    logger.error('Error loading franchise exception summary as admin', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to load exception summary.' });
  }
}

// 628 (D-327): a ticket is addressed by its UUID or by the ticket
// number the operator sees (e.g. 1001) — the link form only ever has
// the number, so both resolve here.
async function findTicketByIdOrNumber(client, ticketParam, columns) {
  if (UUID_RE.test(ticketParam)) {
    const { rows } = await client.query(
      `SELECT ${columns} FROM support_tickets WHERE id = $1`,
      [ticketParam]
    );
    return rows[0] || null;
  }
  if (/^\d+$/.test(ticketParam)) {
    const { rows } = await client.query(
      `SELECT ${columns} FROM support_tickets WHERE ticket_number = $1`,
      [Number(ticketParam)]
    );
    return rows[0] || null;
  }
  return null;
}

// 628 (D-327): attach a ticket to a territory. The operator links only
// their own tickets (a stranger's ticket is the same 404 as a missing
// one, so ticket ownership never leaks); HQ links any ticket. The
// location, when given, must belong to the territory. The link is
// recorded in the territory activity log, so the exception has a
// provenance trail (610).
async function linkTerritoryTicket(client, applicationId, ticketId, locationId, actorId, { ownerOnly }) {
  const ticket = await findTicketByIdOrNumber(client, ticketId, 'id, ticket_number, user_id');
  if (!ticket || (ownerOnly && String(ticket.user_id) !== String(actorId))) {
    return { error: { status: 404, body: { error: 'Support ticket not found.', code: 'ticket_not_found' } } };
  }
  if (locationId) {
    const locationResult = await client.query(
      `SELECT id FROM franchise_locations WHERE id = $1 AND application_id = $2`,
      [locationId, applicationId]
    );
    if (!locationResult.rows.length) {
      return { error: { status: 404, body: { error: 'Location not found in this territory.', code: 'location_not_found' } } };
    }
  }
  const { rows } = await client.query(
    `UPDATE support_tickets
        SET franchise_application_id = $1, franchise_location_id = $2
      WHERE id = $3
      RETURNING id, ticket_number`,
    [applicationId, locationId, ticket.id]
  );
  await logActivity(client, applicationId, actorId, 'ticket_linked',
    `Ticket #${rows[0].ticket_number} linked to the territory.`,
    { ticket_id: ticketId, location_id: locationId });
  return { ticket: rows[0] };
}

async function linkTicketToTerritory(req, res) {
  const { id, ticketId } = req.params;
  if (!UUID_RE.test(ticketId) && !/^\d+$/.test(ticketId)) {
    return res.status(404).json({ error: 'Support ticket not found.', code: 'ticket_not_found' });
  }
  const locationId = asTrimmed(req.body?.location_id) || null;
  if (locationId && !UUID_RE.test(locationId)) {
    return res.status(404).json({ error: 'Location not found in this territory.', code: 'location_not_found' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can link tickets to the territory.',
          code: 'franchise_operator_only',
        });
      }
      const linked = await linkTerritoryTicket(client, id, ticketId, locationId, req.user?.id, { ownerOnly: true });
      if (linked.error) {
        await client.query('ROLLBACK');
        return res.status(linked.error.status).json(linked.error.body);
      }
      await client.query('COMMIT');
      const summary = await buildExceptionSummary(id);
      return res.json({ ticket: linked.ticket, exception_summary: summary });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error linking ticket to franchise territory', { id, ticketId, err: err.message });
    return res.status(500).json({ error: 'Failed to link ticket to the territory.' });
  }
}

async function linkTicketToTerritoryAsAdmin(req, res) {
  const { id, ticketId } = req.params;
  if (!UUID_RE.test(ticketId) && !/^\d+$/.test(ticketId)) {
    return res.status(404).json({ error: 'Support ticket not found.', code: 'ticket_not_found' });
  }
  const locationId = asTrimmed(req.body?.location_id) || null;
  if (locationId && !UUID_RE.test(locationId)) {
    return res.status(404).json({ error: 'Location not found in this territory.', code: 'location_not_found' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const linked = await linkTerritoryTicket(client, id, ticketId, locationId, req.user?.id, { ownerOnly: false });
      if (linked.error) {
        await client.query('ROLLBACK');
        return res.status(linked.error.status).json(linked.error.body);
      }
      await client.query('COMMIT');
      const summary = await buildExceptionSummary(id);
      return res.json({ ticket: linked.ticket, exception_summary: summary });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error linking ticket to franchise territory as admin', { id, ticketId, err: err.message });
    return res.status(500).json({ error: 'Failed to link ticket to the territory.' });
  }
}

// 628 (D-327): detach a ticket from a territory — the exception leaves
// the summary, the ticket itself is untouched.
async function unlinkTerritoryTicket(client, applicationId, ticketId, actorId, { ownerOnly }) {
  const ticket = await findTicketByIdOrNumber(
    client, ticketId, 'id, ticket_number, user_id, franchise_application_id');
  if (!ticket
    || String(ticket.franchise_application_id) !== String(applicationId)
    || (ownerOnly && String(ticket.user_id) !== String(actorId))) {
    return { error: { status: 404, body: { error: 'Support ticket not found.', code: 'ticket_not_found' } } };
  }
  const { rows } = await client.query(
    `UPDATE support_tickets
        SET franchise_application_id = NULL, franchise_location_id = NULL
      WHERE id = $1
      RETURNING id, ticket_number`,
    [ticket.id]
  );
  await logActivity(client, applicationId, actorId, 'ticket_unlinked',
    `Ticket #${rows[0].ticket_number} unlinked from the territory.`,
    { ticket_id: ticketId });
  return { ticket: rows[0] };
}

async function unlinkTicketFromTerritory(req, res) {
  const { id, ticketId } = req.params;
  if (!UUID_RE.test(ticketId) && !/^\d+$/.test(ticketId)) {
    return res.status(404).json({ error: 'Support ticket not found.', code: 'ticket_not_found' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can unlink tickets from the territory.',
          code: 'franchise_operator_only',
        });
      }
      const unlinked = await unlinkTerritoryTicket(client, id, ticketId, req.user?.id, { ownerOnly: true });
      if (unlinked.error) {
        await client.query('ROLLBACK');
        return res.status(unlinked.error.status).json(unlinked.error.body);
      }
      await client.query('COMMIT');
      const summary = await buildExceptionSummary(id);
      return res.json({ ticket: unlinked.ticket, exception_summary: summary });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error unlinking ticket from franchise territory', { id, ticketId, err: err.message });
    return res.status(500).json({ error: 'Failed to unlink ticket from the territory.' });
  }
}

async function unlinkTicketFromTerritoryAsAdmin(req, res) {
  const { id, ticketId } = req.params;
  if (!UUID_RE.test(ticketId) && !/^\d+$/.test(ticketId)) {
    return res.status(404).json({ error: 'Support ticket not found.', code: 'ticket_not_found' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const unlinked = await unlinkTerritoryTicket(client, id, ticketId, req.user?.id, { ownerOnly: false });
      if (unlinked.error) {
        await client.query('ROLLBACK');
        return res.status(unlinked.error.status).json(unlinked.error.body);
      }
      await client.query('COMMIT');
      const summary = await buildExceptionSummary(id);
      return res.json({ ticket: unlinked.ticket, exception_summary: summary });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error unlinking ticket from franchise territory as admin', { id, ticketId, err: err.message });
    return res.status(500).json({ error: 'Failed to unlink ticket from the territory.' });
  }
}

// ── Group 12 Slice 3g (631-635): resolve exceptions ──────────────────────────
// 631 (D-331): territory-scoped escalation. An exception IS a support ticket
// (D-293/D-327), so escalation is recorded ON the ticket — a priority bump
// to urgent, an escalation note on the ticket thread, and an escalation row
// for the per-territory HQ queue — never a parallel escalation system.
// One live escalation per ticket: re-escalating while the first is still
// live is 409; a reopen after the last escalation (support_ticket_events
// 'reopened') starts a new episode, so it may escalate again. Escalating a
// resolved/closed ticket is 409: reopen it first, then escalate.
async function fetchEscalations(applicationId) {
  const { rows } = await db.query(
    `SELECT e.*, t.ticket_number, t.subject, t.category, t.priority, t.status,
            t.franchise_location_id AS location_id, l.name AS location_name,
            u.first_name AS escalated_by_first_name,
            u.last_name AS escalated_by_last_name,
            u.email AS escalated_by_email
       FROM franchise_ticket_escalations e
       JOIN support_tickets t ON t.id = e.ticket_id
       LEFT JOIN franchise_locations l ON l.id = t.franchise_location_id
       LEFT JOIN users u ON u.id = e.escalated_by
      WHERE e.application_id = $1
      ORDER BY e.created_at DESC, e.id DESC`,
    [applicationId]
  );
  return rows.map((row) => ({
    ...row,
    escalated_by_name: [row.escalated_by_first_name, row.escalated_by_last_name].filter(Boolean).join(' ')
      || row.escalated_by_email || null,
  }));
}

async function escalateTerritoryTicket(client, applicationId, ticketId, actorId, reason, { ownerOnly, isAdmin }) {
  const ticket = await findTicketByIdOrNumber(
    client, ticketId, 'id, ticket_number, user_id, status, priority, franchise_application_id');
  if (!ticket || (ownerOnly && String(ticket.user_id) !== String(actorId))) {
    return { error: { status: 404, body: { error: 'Support ticket not found.', code: 'ticket_not_found' } } };
  }
  if (String(ticket.franchise_application_id) !== String(applicationId)) {
    return { error: { status: 404, body: { error: 'Support ticket is not linked to this territory.', code: 'exception_not_found' } } };
  }
  if (['resolved', 'closed'].includes(ticket.status)) {
    return { error: { status: 409, body: { error: 'A resolved or closed exception cannot be escalated.', code: 'exception_closed' } } };
  }
  const { rows: existing } = await client.query(
    `SELECT id, created_at FROM franchise_ticket_escalations
      WHERE ticket_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [ticket.id]
  );
  if (existing.length) {
    const { rows: reopened } = await client.query(
      `SELECT 1 FROM support_ticket_events
        WHERE ticket_id = $1 AND event_type = 'reopened' AND created_at > $2 LIMIT 1`,
      [ticket.id, existing[0].created_at]
    );
    if (!reopened.length) {
      return { error: { status: 409, body: { error: 'This exception is already escalated.', code: 'exception_already_escalated' } } };
    }
  }
  const priorityBefore = ticket.priority;
  const priorityAfter = 'urgent';
  const { rows } = await client.query(
    `INSERT INTO franchise_ticket_escalations
       (application_id, ticket_id, escalated_by, reason, priority_before, priority_after)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [applicationId, ticket.id, actorId, reason, priorityBefore, priorityAfter]
  );
  await client.query(
    'UPDATE support_tickets SET priority = $1, updated_at = NOW() WHERE id = $2',
    [priorityAfter, ticket.id]
  );
  const { rows: actorRows } = await client.query(
    'SELECT first_name, last_name, email FROM users WHERE id = $1', [actorId]
  );
  const actor = actorRows[0] || {};
  const actorName = [actor.first_name, actor.last_name].filter(Boolean).join(' ')
    || actor.email || 'Headquarters';
  await client.query(
    `INSERT INTO support_messages
       (ticket_id, sender_id, sender_name, sender_email, content, sender_language, is_internal, is_from_admin)
     VALUES ($1, $2, $3, $4, $5, 'en', false, $6)`,
    [ticket.id, actorId, actorName, actor.email || '',
      `Escalated to headquarters (priority ${priorityBefore} → urgent): ${reason}`, Boolean(isAdmin)]
  );
  await logActivity(client, applicationId, actorId, 'ticket_escalated',
    `Ticket #${ticket.ticket_number} escalated to headquarters (priority ${priorityBefore} → urgent).`,
    { ticket_id: ticket.id, escalation_id: rows[0].id });
  return { escalation: rows[0], ticket: { id: ticket.id, ticket_number: ticket.ticket_number, priority: priorityAfter, status: ticket.status } };
}

async function escalateTicketToTerritory(req, res, { asAdmin = false } = {}) {
  const { id, ticketId } = req.params;
  if (!UUID_RE.test(ticketId) && !/^\d+$/.test(ticketId)) {
    return res.status(404).json({ error: 'Support ticket not found.', code: 'ticket_not_found' });
  }
  const reason = asTrimmed(req.body?.reason);
  if (!reason) {
    return res.status(400).json({ error: 'A reason is required to escalate an exception.', code: 'escalation_reason_required' });
  }
  if (reason.length > 1000) {
    return res.status(400).json({ error: 'The escalation reason must be at most 1000 characters.', code: 'escalation_reason_too_long' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (!asAdmin) {
        const owned = await loadOperatorApplication(client, id, req.user?.id);
        if (!owned.application || !owned.isAssociated) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
        if (!owned.isOperator) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Only the assigned operator can escalate territory exceptions.',
            code: 'franchise_operator_only',
          });
        }
      } else {
        const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
        if (!exists.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
      }
      const escalated = await escalateTerritoryTicket(client, id, ticketId, req.user?.id, reason,
        { ownerOnly: !asAdmin, isAdmin: asAdmin });
      if (escalated.error) {
        await client.query('ROLLBACK');
        return res.status(escalated.error.status).json(escalated.error.body);
      }
      await client.query('COMMIT');
      const summary = await buildExceptionSummary(id);
      return res.status(201).json({ escalation: escalated.escalation, ticket: escalated.ticket, exception_summary: summary });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error escalating franchise exception', { id, ticketId, err: err.message });
    return res.status(500).json({ error: 'Failed to escalate the exception.' });
  }
}

async function escalateTicket(req, res) {
  return escalateTicketToTerritory(req, res, { asAdmin: false });
}

async function escalateTicketAsAdmin(req, res) {
  return escalateTicketToTerritory(req, res, { asAdmin: true });
}

// 631 (D-331): the per-territory escalation queue — HQ sees the
// escalations for one territory, with the ticket and location each one
// belongs to, so the queue never shows an escalation without context.
async function listEscalations(req, res, { asAdmin = false } = {}) {
  const { id } = req.params;
  try {
    if (!asAdmin) {
      const client = await db.connect();
      try {
        const owned = await loadOperatorApplication(client, id, req.user?.id);
        if (!owned.application || !owned.isAssociated) {
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
        if (!owned.isOperator) {
          return res.status(403).json({
            error: 'Only the assigned operator can view territory escalations.',
            code: 'franchise_operator_only',
          });
        }
      } finally {
        client.release();
      }
    } else {
      const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!rows.length) {
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
    }
    const escalations = await fetchEscalations(id);
    return res.json({ application_id: id, total: escalations.length, escalations });
  } catch (err) {
    logger.error('Error listing franchise escalations', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to list escalations.' });
  }
}

async function listEscalationsAsAdmin(req, res) {
  return listEscalations(req, res, { asAdmin: true });
}

// 632 (D-332): remediation owner assignment. One remediation per linked
// exception (ticket): an owner who must be a territory member — checked
// against live rows, never a role label — plus a due date. Set by HQ or
// the territory operator, for any linked ticket in the territory (not
// just the operator's own tickets); reassigning replaces the row. The
// owner sees their assignments via GET /franchise/my-remediations and
// the ?mine=true filter on the territory list.
async function loadTerritoryViewer(client, applicationId, userId) {
  const owned = await loadOperatorApplication(client, applicationId, userId);
  if (!owned.application) {
    return { application: null, isOperator: false, isMember: false, isAssociated: false };
  }
  const isMember = owned.isOperator
    ? true
    : await isTerritoryMember(client, applicationId, userId);
  return {
    application: owned.application,
    isOperator: owned.isOperator,
    isMember,
    isAssociated: owned.isAssociated || isMember,
  };
}

// Member-aware reads (632-635): a stranger gets 404, an applicant who is
// neither the operator nor a territory member gets 403, the operator and
// any territory member may read. Returns null when the read is allowed.
function territoryReadScope(viewer) {
  if (!viewer.application || !viewer.isAssociated) {
    return { status: 404, body: { error: 'Franchise application not found.' } };
  }
  if (!viewer.isOperator && !viewer.isMember) {
    return { status: 403, body: {
      error: 'Only the assigned operator or a territory member can view this.',
      code: 'franchise_operator_only',
    } };
  }
  return null;
}

// 632 (D-332): the territory members with names — the operator, anyone
// who accepted a territory invite, or an opening-team helper. The member
// picker for remediation assignment (and the bundle) draws from this,
// never from a role label.
async function fetchTerritoryMembers(applicationId) {
  const { rows } = await db.query(
    `SELECT u.id AS user_id, u.first_name, u.last_name, u.email, 'operator' AS kind
       FROM franchise_applications fa
       JOIN users u ON u.id = fa.owner_user_id
      WHERE fa.id = $1 AND fa.owner_user_id IS NOT NULL
     UNION
     SELECT iu.id, iu.first_name, iu.last_name, iu.email, 'invitee' AS kind
       FROM franchise_territory_invitations i
       JOIN users iu ON lower(iu.email) = lower(i.email)
      WHERE i.application_id = $1 AND i.status = 'accepted'
     UNION
     SELECT hu.id, hu.first_name, hu.last_name, hu.email, 'helper' AS kind
       FROM franchise_opening_team_members m
       JOIN users hu ON hu.id = m.helper_user_id
      WHERE m.application_id = $1
      ORDER BY kind, last_name, first_name`,
    [applicationId]
  );
  return rows.map((row) => ({
    ...row,
    name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email,
  }));
}

async function fetchRemediations(applicationId, { ownerId = null } = {}) {
  const conditions = ['r.application_id = $1'];
  const params = [applicationId];
  if (ownerId) {
    params.push(ownerId);
    conditions.push(`r.owner_user_id = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT r.*, t.ticket_number, t.subject, t.category, t.priority, t.status,
            t.franchise_location_id AS location_id, l.name AS location_name,
            u.first_name AS owner_first_name, u.last_name AS owner_last_name,
            u.email AS owner_email
       FROM franchise_remediations r
       JOIN support_tickets t ON t.id = r.ticket_id
       LEFT JOIN franchise_locations l ON l.id = t.franchise_location_id
       LEFT JOIN users u ON u.id = r.owner_user_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY r.due_date ASC, r.created_at DESC, r.id DESC`,
    params
  );
  return rows.map((row) => ({
    ...row,
    owner_name: [row.owner_first_name, row.owner_last_name].filter(Boolean).join(' ')
      || row.owner_email || null,
  }));
}

async function setRemediationCore(client, { applicationId, ticketId, ownerUserId, dueDate, actorId }) {
  const ticket = await findTicketByIdOrNumber(
    client, ticketId, 'id, ticket_number, user_id, franchise_application_id');
  if (!ticket) {
    return { error: { status: 404, body: { error: 'Support ticket not found.', code: 'ticket_not_found' } } };
  }
  if (String(ticket.franchise_application_id) !== String(applicationId)) {
    return { error: { status: 404, body: { error: 'Support ticket is not linked to this territory.', code: 'exception_not_found' } } };
  }
  const { rows: userRows } = await client.query(
    'SELECT id FROM users WHERE id = $1 AND is_active = TRUE', [ownerUserId]
  );
  if (!userRows.length) {
    return { error: { status: 404, body: { error: 'Remediation owner not found.', code: 'remediation_owner_not_found' } } };
  }
  if (!(await isTerritoryMember(client, applicationId, ownerUserId))) {
    return { error: { status: 404, body: { error: 'The remediation owner must be a member of this territory.', code: 'remediation_owner_not_member' } } };
  }
  if (!isValidDateString(dueDate)) {
    return { error: { status: 400, body: { error: 'due_date must be a valid YYYY-MM-DD date.', code: 'invalid_remediation_due_date' } } };
  }
  const { rows: existing } = await client.query(
    'SELECT id FROM franchise_remediations WHERE application_id = $1 AND ticket_id = $2',
    [applicationId, ticket.id]
  );
  const { rows } = await client.query(
    `INSERT INTO franchise_remediations
       (application_id, ticket_id, owner_user_id, due_date, assigned_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (application_id, ticket_id)
     DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id,
                   due_date = EXCLUDED.due_date,
                   assigned_by = EXCLUDED.assigned_by,
                   updated_at = NOW()
     RETURNING *`,
    [applicationId, ticket.id, ownerUserId, dueDate, actorId]
  );
  await logActivity(client, applicationId, actorId, 'remediation_assigned',
    `Remediation for ticket #${ticket.ticket_number} assigned to a territory member, due ${dueDate}.`,
    { ticket_id: ticket.id, remediation_id: rows[0].id, owner_user_id: ownerUserId, due_date: dueDate });
  return { remediation: rows[0], created: !existing.length, ticket };
}

async function setRemediation(req, res, { asAdmin = false } = {}) {
  const { id, ticketId } = req.params;
  if (!UUID_RE.test(ticketId) && !/^\d+$/.test(ticketId)) {
    return res.status(404).json({ error: 'Support ticket not found.', code: 'ticket_not_found' });
  }
  const ownerUserId = asTrimmed(req.body?.owner_user_id);
  if (!ownerUserId) {
    return res.status(400).json({ error: 'owner_user_id is required.', code: 'remediation_owner_required' });
  }
  const dueDate = asTrimmed(req.body?.due_date);
  if (!dueDate) {
    return res.status(400).json({ error: 'due_date is required.', code: 'remediation_due_date_required' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (!asAdmin) {
        const owned = await loadOperatorApplication(client, id, req.user?.id);
        if (!owned.application || !owned.isAssociated) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
        if (!owned.isOperator) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Only the assigned operator can assign remediation for territory exceptions.',
            code: 'franchise_operator_only',
          });
        }
      } else {
        const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
        if (!exists.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
      }
      const result = await setRemediationCore(client, {
        applicationId: id, ticketId, ownerUserId, dueDate, actorId: req.user?.id,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const remediations = await fetchRemediations(id);
      const remediation = remediations.find((row) => row.id === result.remediation.id) || result.remediation;
      return res.status(result.created ? 201 : 200).json({ remediation });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error assigning franchise remediation', { id, ticketId, err: err.message });
    return res.status(500).json({ error: 'Failed to assign remediation.' });
  }
}

async function setRemediationAsAdmin(req, res) {
  return setRemediation(req, res, { asAdmin: true });
}

async function listRemediations(req, res, { asAdmin = false } = {}) {
  const { id } = req.params;
  const mine = req.query?.mine === 'true';
  try {
    if (!asAdmin) {
      const client = await db.connect();
      try {
        const viewer = await loadTerritoryViewer(client, id, req.user?.id);
        const blocked = territoryReadScope(viewer);
        if (blocked) return res.status(blocked.status).json(blocked.body);
      } finally {
        client.release();
      }
    } else {
      const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!rows.length) {
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
    }
    const remediations = await fetchRemediations(id, { ownerId: mine ? req.user?.id : null });
    return res.json({ application_id: id, total: remediations.length, remediations });
  } catch (err) {
    logger.error('Error listing franchise remediations', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to list remediations.' });
  }
}

async function listRemediationsAsAdmin(req, res) {
  return listRemediations(req, res, { asAdmin: true });
}

// 632 (D-332): the remediations assigned to the viewer, across all
// territories — the assigned owner's own list, no application scoping.
async function listMyRemediations(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT r.*, t.ticket_number, t.subject, t.category, t.priority, t.status,
              t.franchise_location_id AS location_id, l.name AS location_name,
              u.first_name AS owner_first_name, u.last_name AS owner_last_name,
              u.email AS owner_email
         FROM franchise_remediations r
         JOIN support_tickets t ON t.id = r.ticket_id
         LEFT JOIN franchise_locations l ON l.id = t.franchise_location_id
         LEFT JOIN users u ON u.id = r.owner_user_id
        WHERE r.owner_user_id = $1
        ORDER BY r.due_date ASC, r.created_at DESC, r.id DESC`,
      [req.user?.id]
    );
    const remediations = rows.map((row) => ({
      ...row,
      owner_name: [row.owner_first_name, row.owner_last_name].filter(Boolean).join(' ')
        || row.owner_email || null,
    }));
    return res.json({ total: remediations.length, remediations });
  } catch (err) {
    logger.error('Error listing my franchise remediations', { err: err.message });
    return res.status(500).json({ error: 'Failed to list my remediations.' });
  }
}

// 633 (D-333): the franchise corrective-action checklist. One list per
// linked exception (ticket): create/list/update with the status workflow
// open -> in_progress -> resolved -> verified, server-enforced (the
// restaurant-audit workflow, territory-scoped). The assigned remediation
// owner updates status; HQ verifies. An action links to the ticket's
// remediation when one exists, so the owner is always derivable.
const CORRECTIVE_ACTION_STATUSES = new Set(['open', 'in_progress', 'resolved', 'verified']);
const CORRECTIVE_ACTION_TRANSITIONS = {
  open: ['in_progress'],
  in_progress: ['resolved'],
  resolved: ['verified', 'in_progress'],
  verified: [],
};

async function fetchCorrectiveActions(applicationId, { ticketId = null, status = null, ownerId = null } = {}) {
  const conditions = ['a.application_id = $1'];
  const params = [applicationId];
  if (ticketId) {
    params.push(ticketId);
    conditions.push(`a.ticket_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`a.status = $${params.length}`);
  }
  if (ownerId) {
    params.push(ownerId);
    conditions.push(`r.owner_user_id = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT a.*, t.ticket_number, t.subject AS ticket_subject,
            r.id AS remediation_id, r.owner_user_id AS remediation_owner_id,
            r.due_date AS remediation_due_date,
            u.first_name AS owner_first_name, u.last_name AS owner_last_name,
            u.email AS owner_email,
            (SELECT COUNT(*)::int FROM franchise_action_evidence e WHERE e.action_id = a.id) AS evidence_count
       FROM franchise_corrective_actions a
       JOIN support_tickets t ON t.id = a.ticket_id
       LEFT JOIN franchise_remediations r ON r.id = a.remediation_id
       LEFT JOIN users u ON u.id = r.owner_user_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.created_at ASC, a.id ASC`,
    params
  );
  return rows.map((row) => ({
    ...row,
    remediation_owner_name: row.remediation_owner_id
      ? ([row.owner_first_name, row.owner_last_name].filter(Boolean).join(' ') || row.owner_email || null)
      : null,
  }));
}

async function loadTerritoryTicket(client, applicationId, ticketId) {
  const ticket = await findTicketByIdOrNumber(
    client, ticketId, 'id, ticket_number, user_id, franchise_application_id');
  if (!ticket) {
    return { error: { status: 404, body: { error: 'Support ticket not found.', code: 'ticket_not_found' } } };
  }
  if (String(ticket.franchise_application_id) !== String(applicationId)) {
    return { error: { status: 404, body: { error: 'Support ticket is not linked to this territory.', code: 'exception_not_found' } } };
  }
  return { ticket };
}

async function createCorrectiveActionCore(client, { applicationId, ticketId, title, description, remediationId, actorId }) {
  const loaded = await loadTerritoryTicket(client, applicationId, ticketId);
  if (loaded.error) return loaded;
  const { ticket } = loaded;
  let remediation = null;
  if (remediationId) {
    const { rows } = await client.query(
      `SELECT id FROM franchise_remediations
        WHERE id = $1 AND application_id = $2 AND ticket_id = $3`,
      [remediationId, applicationId, ticket.id]
    );
    if (!rows.length) {
      return { error: { status: 404, body: { error: 'Remediation not found for this exception.', code: 'corrective_action_remediation_not_found' } } };
    }
    remediation = rows[0];
  } else {
    const { rows } = await client.query(
      `SELECT id FROM franchise_remediations
        WHERE application_id = $1 AND ticket_id = $2`,
      [applicationId, ticket.id]
    );
    remediation = rows[0] || null;
  }
  const { rows } = await client.query(
    `INSERT INTO franchise_corrective_actions
       (application_id, ticket_id, remediation_id, title, description, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [applicationId, ticket.id, remediation?.id || null, title, description || null, actorId]
  );
  await logActivity(client, applicationId, actorId, 'corrective_action_created',
    `Corrective action added for ticket #${ticket.ticket_number}: ${title}.`,
    { ticket_id: ticket.id, corrective_action_id: rows[0].id });
  return { action: rows[0] };
}

async function createCorrectiveAction(req, res, { asAdmin = false } = {}) {
  const { id, ticketId } = req.params;
  if (!UUID_RE.test(ticketId) && !/^\d+$/.test(ticketId)) {
    return res.status(404).json({ error: 'Support ticket not found.', code: 'ticket_not_found' });
  }
  const title = asTrimmed(req.body?.title);
  if (!title) {
    return res.status(400).json({ error: 'title is required.', code: 'corrective_action_title_required' });
  }
  if (title.length > 500) {
    return res.status(400).json({ error: 'title must be at most 500 characters.', code: 'corrective_action_title_too_long' });
  }
  const description = asTrimmed(req.body?.description);
  const remediationId = asTrimmed(req.body?.remediation_id) || null;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (!asAdmin) {
        const owned = await loadOperatorApplication(client, id, req.user?.id);
        if (!owned.application || !owned.isAssociated) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
        if (!owned.isOperator) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Only the assigned operator can add corrective actions for territory exceptions.',
            code: 'franchise_operator_only',
          });
        }
      } else {
        const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
        if (!exists.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
      }
      const result = await createCorrectiveActionCore(client, {
        applicationId: id, ticketId, title, description, remediationId, actorId: req.user?.id,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const actions = await fetchCorrectiveActions(id, { ticketId: result.action.ticket_id });
      const action = actions.find((row) => row.id === result.action.id) || result.action;
      return res.status(201).json({ action });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error creating franchise corrective action', { id, ticketId, err: err.message });
    return res.status(500).json({ error: 'Failed to create corrective action.' });
  }
}

async function createCorrectiveActionAsAdmin(req, res) {
  return createCorrectiveAction(req, res, { asAdmin: true });
}

async function listCorrectiveActions(req, res, { asAdmin = false } = {}) {
  const { id, ticketId } = req.params;
  const status = asTrimmed(req.query?.status);
  const mine = req.query?.mine === 'true';
  if (status && !CORRECTIVE_ACTION_STATUSES.has(status)) {
    return res.status(400).json({ error: 'status must be open, in_progress, resolved, or verified.', code: 'invalid_corrective_action_status' });
  }
  if (ticketId && !UUID_RE.test(ticketId) && !/^\d+$/.test(ticketId)) {
    return res.status(404).json({ error: 'Support ticket not found.', code: 'ticket_not_found' });
  }
  try {
    let ticketUuid = null;
    if (ticketId) {
      const client = await db.connect();
      try {
        const resolved = await loadTerritoryTicket(client, id, ticketId);
        if (resolved.error) return res.status(resolved.error.status).json(resolved.error.body);
        ticketUuid = resolved.ticket.id;
      } finally {
        client.release();
      }
    }
    if (!asAdmin) {
      const client = await db.connect();
      try {
        const viewer = await loadTerritoryViewer(client, id, req.user?.id);
        const blocked = territoryReadScope(viewer);
        if (blocked) return res.status(blocked.status).json(blocked.body);
      } finally {
        client.release();
      }
    } else {
      const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!rows.length) {
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
    }
    const actions = await fetchCorrectiveActions(id, {
      ticketId: ticketUuid, status: status || null, ownerId: mine ? req.user?.id : null,
    });
    return res.json({ application_id: id, total: actions.length, corrective_actions: actions });
  } catch (err) {
    logger.error('Error listing franchise corrective actions', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to list corrective actions.' });
  }
}

async function listCorrectiveActionsAsAdmin(req, res) {
  return listCorrectiveActions(req, res, { asAdmin: true });
}

// 633 (D-333): the status move. The remediation owner, the territory
// operator, or HQ may advance open -> in_progress and in_progress ->
// resolved; only HQ may verify (resolved -> verified) or send an action
// back (resolved -> in_progress). A member who is not the remediation
// owner may not move someone else's action. A no-op (same status)
// returns the row, like the restaurant workflow.
async function updateCorrectiveActionStatusCore(client, { applicationId, actionId, status, actorId, asAdmin, isOperator }) {
  const { rows } = await client.query(
    `SELECT a.*, r.owner_user_id AS remediation_owner_id
       FROM franchise_corrective_actions a
       LEFT JOIN franchise_remediations r ON r.id = a.remediation_id
      WHERE a.id = $1 AND a.application_id = $2`,
    [actionId, applicationId]
  );
  const action = rows[0] || null;
  if (!action) {
    return { error: { status: 404, body: { error: 'Corrective action not found.', code: 'corrective_action_not_found' } } };
  }
  if (!CORRECTIVE_ACTION_STATUSES.has(status)) {
    return { error: { status: 400, body: { error: 'status must be open, in_progress, resolved, or verified.', code: 'invalid_corrective_action_status' } } };
  }
  if (status === action.status) return { action };
  if (!CORRECTIVE_ACTION_TRANSITIONS[action.status].includes(status)) {
    return { error: { status: 409, body: { error: `A ${action.status} corrective action cannot move to ${status}.`, code: 'corrective_action_transition_invalid' } } };
  }
  if ((status === 'verified' || (action.status === 'resolved' && status === 'in_progress')) && !asAdmin) {
    return { error: { status: 403, body: { error: 'Only headquarters can verify or send back a resolved corrective action.', code: 'corrective_action_review_hq_only' } } };
  }
  if (!asAdmin && !isOperator && action.remediation_owner_id
    && String(action.remediation_owner_id) !== String(actorId)) {
    return { error: { status: 403, body: { error: 'Only the assigned remediation owner can update this corrective action.', code: 'corrective_action_not_assignee' } } };
  }
  if (!asAdmin && !isOperator && !action.remediation_owner_id) {
    return { error: { status: 403, body: { error: 'Only the assigned operator can update this corrective action.', code: 'corrective_action_not_assignee' } } };
  }
  const { rows: updated } = await client.query(
    `UPDATE franchise_corrective_actions
        SET status = $2::text,
            resolved_at = CASE WHEN $2::text = 'resolved' THEN NOW()
                               WHEN $2::text = 'in_progress' THEN NULL
                               ELSE resolved_at END,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [actionId, status]
  );
  await logActivity(client, applicationId, actorId, 'corrective_action_updated',
    `Corrective action moved from ${action.status} to ${status}.`,
    { corrective_action_id: actionId, ticket_id: action.ticket_id, from_status: action.status, to_status: status });
  return { action: updated[0] };
}

async function updateCorrectiveActionStatus(req, res, { asAdmin = false } = {}) {
  const { id, actionId } = req.params;
  const status = asTrimmed(req.body?.status);
  if (!UUID_RE.test(actionId)) {
    return res.status(404).json({ error: 'Corrective action not found.', code: 'corrective_action_not_found' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      let isOperator = false;
      if (!asAdmin) {
        const viewer = await loadTerritoryViewer(client, id, req.user?.id);
        const blocked = territoryReadScope(viewer);
        if (blocked) {
          await client.query('ROLLBACK');
          return res.status(blocked.status).json(blocked.body);
        }
        isOperator = viewer.isOperator;
      } else {
        const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
        if (!exists.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
      }
      const result = await updateCorrectiveActionStatusCore(client, {
        applicationId: id, actionId, status, actorId: req.user?.id, asAdmin, isOperator,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const actions = await fetchCorrectiveActions(id, { ticketId: result.action.ticket_id });
      const action = actions.find((row) => row.id === result.action.id) || result.action;
      return res.json({ action });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error updating franchise corrective action', { id, actionId, err: err.message });
    return res.status(500).json({ error: 'Failed to update corrective action.' });
  }
}

async function updateCorrectiveActionStatusAsAdmin(req, res) {
  return updateCorrectiveActionStatus(req, res, { asAdmin: true });
}

// 634 (D-334): evidence submission. File evidence attaches to a
// corrective action (and thereby its exception) through the vault upload
// path: private `franchise-evidence/<application>/<action>/` prefix,
// signed-URL downloads only, the storage key never leaves the server.
// The remediation owner, the territory operator, or HQ may upload;
// a member who is not the remediation owner may not.
async function presentFranchiseActionEvidence(evidence) {
  const { storage_key, ...rest } = evidence;
  try {
    const downloadUrl = await getSignedDownloadUrl(storage_key, 600);
    return { ...rest, download_url: downloadUrl, download_unavailable: false };
  } catch (_err) {
    return { ...rest, download_url: null, download_unavailable: true };
  }
}

async function fetchActionEvidence(applicationId, actionId) {
  const { rows } = await db.query(
    `SELECT e.*, u.first_name AS uploaded_by_first_name,
            u.last_name AS uploaded_by_last_name, u.email AS uploaded_by_email
       FROM franchise_action_evidence e
       LEFT JOIN users u ON u.id = e.uploaded_by
      WHERE e.application_id = $1 AND e.action_id = $2
      ORDER BY e.created_at DESC, e.id DESC`,
    [applicationId, actionId]
  );
  const presented = await Promise.all(rows.map(presentFranchiseActionEvidence));
  return presented.map((row) => ({
    ...row,
    uploaded_by_name: [row.uploaded_by_first_name, row.uploaded_by_last_name].filter(Boolean).join(' ')
      || row.uploaded_by_email || null,
  }));
}

async function loadTerritoryAction(client, applicationId, actionId) {
  const { rows } = await client.query(
    `SELECT a.*, r.owner_user_id AS remediation_owner_id
       FROM franchise_corrective_actions a
       LEFT JOIN franchise_remediations r ON r.id = a.remediation_id
      WHERE a.id = $1 AND a.application_id = $2`,
    [actionId, applicationId]
  );
  return rows[0] || null;
}

async function uploadActionEvidence(req, res, { asAdmin = false } = {}) {
  const { id, actionId } = req.params;
  if (!UUID_RE.test(actionId)) {
    return res.status(404).json({ error: 'Corrective action not found.', code: 'corrective_action_not_found' });
  }
  if (!req.file?.buffer?.length) {
    return res.status(400).json({ error: 'A file is required.', code: 'evidence_file_required' });
  }
  const note = asTrimmed(req.body?.note);
  if (note && note.length > 1000) {
    return res.status(400).json({ error: 'The evidence note must be at most 1000 characters.', code: 'evidence_note_too_long' });
  }
  try {
    const client = await db.connect();
    let action;
    let isOperator = false;
    try {
      if (!asAdmin) {
        const viewer = await loadTerritoryViewer(client, id, req.user?.id);
        const blocked = territoryReadScope(viewer);
        if (blocked) return res.status(blocked.status).json(blocked.body);
        isOperator = viewer.isOperator;
      } else {
        const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
        if (!exists.rows.length) {
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
      }
      action = await loadTerritoryAction(client, id, actionId);
      if (!action) {
        return res.status(404).json({ error: 'Corrective action not found.', code: 'corrective_action_not_found' });
      }
      if (!asAdmin && !isOperator
        && String(action.remediation_owner_id || '') !== String(req.user?.id)) {
        return res.status(403).json({
          error: 'Only the assigned remediation owner or the operator can submit evidence for this corrective action.',
          code: 'evidence_upload_not_assignee',
        });
      }
    } finally {
      client.release();
    }
    let storageKey = null;
    try {
      storageKey = await uploadFile(
        req.file.buffer,
        `franchise-evidence/${id}/${actionId}`,
        req.file.originalname,
        req.file.detectedMime || req.file.mimetype,
      );
      if (!storageKey) {
        return res.status(502).json({ error: 'Evidence upload failed.', code: 'upload_failed' });
      }
    } catch (err) {
      logger.error('Error uploading franchise corrective-action evidence', { id, actionId, err: err.message });
      return res.status(502).json({ error: 'Evidence upload failed.', code: 'upload_failed' });
    }
    const insertClient = await db.connect();
    try {
      await insertClient.query('BEGIN');
      const { rows } = await insertClient.query(
        `INSERT INTO franchise_action_evidence
           (application_id, ticket_id, action_id, storage_key, file_name, content_type, file_size_bytes, note, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [id, action.ticket_id, actionId, storageKey, req.file.originalname,
          req.file.detectedMime || req.file.mimetype || null, req.file.size || null, note, req.user?.id || null]
      );
      await logActivity(insertClient, id, req.user?.id || null, 'corrective_action_evidence_added',
        'Evidence added for a corrective action.',
        { corrective_action_id: actionId, ticket_id: action.ticket_id, evidence_id: rows[0].id });
      await insertClient.query('COMMIT');
      const [evidence] = await fetchActionEvidence(id, actionId);
      return res.status(201).json({ evidence: evidence || await presentFranchiseActionEvidence(rows[0]) });
    } catch (err) {
      await insertClient.query('ROLLBACK');
      throw err;
    } finally {
      insertClient.release();
    }
  } catch (err) {
    logger.error('Error saving franchise corrective-action evidence', { id, actionId, err: err.message });
    return res.status(500).json({ error: 'Failed to submit evidence.' });
  }
}

async function uploadActionEvidenceAsAdmin(req, res) {
  return uploadActionEvidence(req, res, { asAdmin: true });
}

async function listActionEvidence(req, res, { asAdmin = false } = {}) {
  const { id, actionId } = req.params;
  if (!UUID_RE.test(actionId)) {
    return res.status(404).json({ error: 'Corrective action not found.', code: 'corrective_action_not_found' });
  }
  try {
    const client = await db.connect();
    try {
      if (!asAdmin) {
        const viewer = await loadTerritoryViewer(client, id, req.user?.id);
        const blocked = territoryReadScope(viewer);
        if (blocked) return res.status(blocked.status).json(blocked.body);
      } else {
        const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
        if (!exists.rows.length) {
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
      }
      const action = await loadTerritoryAction(client, id, actionId);
      if (!action) {
        return res.status(404).json({ error: 'Corrective action not found.', code: 'corrective_action_not_found' });
      }
    } finally {
      client.release();
    }
    const evidence = await fetchActionEvidence(id, actionId);
    return res.json({ application_id: id, action_id: actionId, total: evidence.length, evidence });
  } catch (err) {
    logger.error('Error listing franchise corrective-action evidence', { id, actionId, err: err.message });
    return res.status(500).json({ error: 'Failed to list evidence.' });
  }
}

async function listActionEvidenceAsAdmin(req, res) {
  return listActionEvidence(req, res, { asAdmin: true });
}

// 635 (D-335): resolution review. HQ reviews a resolved corrective
// action: accept = verified, reject = back to in_progress with a reason.
// The linked exception closes only when its actions are verified —
// derived, never stored: an exception is `open` while its ticket is
// open, `awaiting_verification` while its ticket is resolved/closed but
// an action is still unverified, and `resolved` once the ticket is
// resolved/closed and every action is verified (or there are no
// actions). Reopening a ticket (the generic support reopen) flips its
// status back to open, so the derived exception reopens with it —
// no franchise code touches the generic reopen path.
async function buildExceptionResolution(applicationId) {
  const tickets = await fetchTerritoryTickets(applicationId, { status: 'all', limit: 500 });
  const actions = await fetchCorrectiveActions(applicationId);
  const remediations = await fetchRemediations(applicationId);
  const actionsByTicket = new Map();
  for (const action of actions) {
    if (!actionsByTicket.has(action.ticket_id)) actionsByTicket.set(action.ticket_id, []);
    actionsByTicket.get(action.ticket_id).push(action);
  }
  const remediationByTicket = new Map(remediations.map((row) => [row.ticket_id, row]));
  const items = tickets.map((ticket) => {
    const ticketActions = actionsByTicket.get(ticket.id) || [];
    const counts = {
      total: ticketActions.length,
      open: ticketActions.filter((a) => a.status === 'open').length,
      in_progress: ticketActions.filter((a) => a.status === 'in_progress').length,
      resolved: ticketActions.filter((a) => a.status === 'resolved').length,
      verified: ticketActions.filter((a) => a.status === 'verified').length,
    };
    const allVerified = ticketActions.length > 0
      && ticketActions.every((a) => a.status === 'verified');
    const ticketClosed = ['resolved', 'closed'].includes(ticket.status);
    const exceptionState = !ticketClosed
      ? 'open'
      : (ticketActions.length && !allVerified ? 'awaiting_verification' : 'resolved');
    const remediation = remediationByTicket.get(ticket.id) || null;
    return {
      ticket_id: ticket.id,
      ticket_number: ticket.ticket_number,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      location_id: ticket.location_id,
      location_name: ticket.location_name,
      exception_state: exceptionState,
      actions: counts,
      remediation: remediation
        ? {
            id: remediation.id,
            owner_user_id: remediation.owner_user_id,
            owner_name: remediation.owner_name,
            due_date: remediation.due_date,
          }
        : null,
    };
  });
  return {
    application_id: applicationId,
    total: items.length,
    open: items.filter((item) => item.exception_state === 'open').length,
    awaiting_verification: items.filter((item) => item.exception_state === 'awaiting_verification').length,
    resolved: items.filter((item) => item.exception_state === 'resolved').length,
    items,
  };
}

async function reviewCorrectiveActionAsAdmin(req, res) {
  const { id, actionId } = req.params;
  if (!UUID_RE.test(actionId)) {
    return res.status(404).json({ error: 'Corrective action not found.', code: 'corrective_action_not_found' });
  }
  const decision = asTrimmed(req.body?.decision);
  if (!['accept', 'reject'].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'accept' or 'reject'.", code: 'invalid_resolution_review_decision' });
  }
  const reason = asTrimmed(req.body?.reason);
  if (decision === 'reject' && !reason) {
    return res.status(400).json({ error: 'A reason is required to send a corrective action back.', code: 'resolution_review_reason_required' });
  }
  if (reason && reason.length > 1000) {
    return res.status(400).json({ error: 'The review reason must be at most 1000 characters.', code: 'resolution_review_reason_too_long' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const action = await loadTerritoryAction(client, id, actionId);
      if (!action) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Corrective action not found.', code: 'corrective_action_not_found' });
      }
      if (action.status !== 'resolved') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Only a resolved corrective action can be reviewed.',
          code: 'corrective_action_not_resolved',
        });
      }
      const nextStatus = decision === 'accept' ? 'verified' : 'in_progress';
      const { rows } = await client.query(
        `UPDATE franchise_corrective_actions
            SET status = $2::text,
                review_reason = $3,
                reviewed_by = $4,
                reviewed_at = NOW(),
                resolved_at = CASE WHEN $2::text = 'in_progress' THEN NULL ELSE resolved_at END,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [actionId, nextStatus, reason || null, req.user?.id || null]
      );
      await logActivity(client, id, req.user?.id || null, 'corrective_action_reviewed',
        decision === 'accept'
          ? 'Headquarters verified a corrective action.'
          : `Headquarters sent a corrective action back: ${reason}.`,
        { corrective_action_id: actionId, ticket_id: action.ticket_id, decision, reason: reason || null });
      await client.query('COMMIT');
      const actions = await fetchCorrectiveActions(id, { ticketId: action.ticket_id });
      const presented = actions.find((row) => row.id === actionId) || rows[0];
      const resolution = await buildExceptionResolution(id);
      return res.json({ action: presented, exception_resolution: resolution });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error reviewing franchise corrective action', { id, actionId, err: err.message });
    return res.status(500).json({ error: 'Failed to review corrective action.' });
  }
}

async function getExceptionResolution(req, res, { asAdmin = false } = {}) {
  const { id } = req.params;
  try {
    if (!asAdmin) {
      const client = await db.connect();
      try {
        const viewer = await loadTerritoryViewer(client, id, req.user?.id);
        const blocked = territoryReadScope(viewer);
        if (blocked) return res.status(blocked.status).json(blocked.body);
      } finally {
        client.release();
      }
    } else {
      const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!rows.length) {
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
    }
    return res.json(await buildExceptionResolution(id));
  } catch (err) {
    logger.error('Error loading franchise exception resolution', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to load exception resolution.' });
  }
}

async function getExceptionResolutionAsAdmin(req, res) {
  return getExceptionResolution(req, res, { asAdmin: true });
}

// 627 (D-328): the per-location health view. Health is derived on read
// from the open locations (fetchOpenLocations) plus each location's
// linked open exceptions (628) — never stored, so it can never drift
// from the launch, milestone, service, manager, and ticket state.
// at_risk: a blocked milestone, or an open urgent/high exception.
// attention: not launched, no manager, any open exception, or any
// unavailable service. healthy: launched and confirmed, manager
// assigned, no open exceptions, no blocked milestones, every service
// available. The brand-side store comparison is not reused: it is
// brand-facing and not territory-scoped.
async function buildLocationHealth(applicationId) {
  const locations = await fetchOpenLocations(applicationId);
  const { rows: exceptionRows } = await db.query(
    `SELECT franchise_location_id AS location_id,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status IN ${EXCEPTION_OPEN_SQL})::int AS open_count,
            COUNT(*) FILTER (WHERE status IN ${EXCEPTION_OPEN_SQL}
                               AND priority IN ('urgent', 'high'))::int AS open_urgent_count
       FROM support_tickets
      WHERE franchise_application_id = $1 AND franchise_location_id IS NOT NULL
      GROUP BY franchise_location_id`,
    [applicationId]
  );
  const exceptionsByLocation = new Map(
    exceptionRows.map((row) => [String(row.location_id), row])
  );
  const healthLocations = locations.map((location) => {
    const milestones = location.milestones || [];
    const services = location.services || [];
    const milestoneTotal = milestones.length;
    const milestonesDone = milestones.filter((m) => m.status === 'completed').length;
    const milestonesBlocked = milestones.filter((m) => m.status === 'blocked').length;
    const servicesTotal = services.length;
    const servicesAvailable = services.filter((s) => s.available).length;
    const exceptions = exceptionsByLocation.get(String(location.id)) || { total: 0, open_count: 0, open_urgent_count: 0 };
    const reasons = [];
    if (milestonesBlocked > 0) reasons.push('blocked_milestone');
    if (exceptions.open_urgent_count > 0) reasons.push('open_urgent_exception');
    if (location.status !== 'launched') reasons.push('not_launched');
    if (!location.manager) reasons.push('no_manager');
    if (exceptions.open_count > 0) reasons.push('open_exception');
    if (servicesTotal - servicesAvailable > 0) reasons.push('unavailable_service');
    const health = milestonesBlocked > 0 || exceptions.open_urgent_count > 0
      ? 'at_risk'
      : reasons.length > 0
        ? 'attention'
        : 'healthy';
    return {
      id: location.id,
      name: location.name,
      city: location.city,
      region: location.region,
      country: location.country,
      status: location.status,
      launched_at: location.launched_at,
      launch_complete: location.launch_complete,
      opened_date: location.opening_confirmation?.opened_date || null,
      manager: location.manager
        ? {
            user_id: location.manager.manager_user_id,
            name: [location.manager.manager_first_name, location.manager.manager_last_name].filter(Boolean).join(' ') || location.manager.manager_email,
            email: location.manager.manager_email,
          }
        : null,
      opening_team_count: (location.opening_team || []).length,
      milestones: { total: milestoneTotal, done: milestonesDone, blocked: milestonesBlocked },
      services: { total: servicesTotal, available: servicesAvailable, unavailable: servicesTotal - servicesAvailable },
      exceptions: { total: exceptions.total, open: exceptions.open_count, open_urgent: exceptions.open_urgent_count },
      health,
      reasons,
    };
  });
  return {
    application_id: applicationId,
    total: healthLocations.length,
    healthy: healthLocations.filter((l) => l.health === 'healthy').length,
    attention: healthLocations.filter((l) => l.health === 'attention').length,
    at_risk: healthLocations.filter((l) => l.health === 'at_risk').length,
    locations: healthLocations,
  };
}

const TICKET_STATUSES = new Set(['open', 'assigned', 'in_progress', 'waiting_user', 'resolved', 'closed']);

// 629 (D-329): the territory ticket queue — a filtered read over the
// tickets linked to the territory (628). Defaults to open requests;
// ?status=all (or one concrete status) and ?location_id= narrow it.
// Every row carries its franchise link, so the queue never shows a
// ticket without saying which application and location it belongs to.
function parseTicketListQuery(req) {
  const status = typeof req.query?.status === 'string' && req.query.status
    ? req.query.status
    : 'open';
  if (status !== 'all' && status !== 'open' && !TICKET_STATUSES.has(status)) {
    return { error: { status: 400, body: { error: 'status must be open, all, or a ticket status.', code: 'invalid_ticket_status' } } };
  }
  const locationId = typeof req.query?.location_id === 'string' && req.query.location_id
    ? req.query.location_id
    : null;
  if (locationId && locationId !== 'unassigned' && !UUID_RE.test(locationId)) {
    return { error: { status: 400, body: { error: 'location_id must be a location id or unassigned.', code: 'invalid_location_id' } } };
  }
  return { status, locationId };
}

async function listTerritoryTickets(req, res) {
  const { id } = req.params;
  const parsed = parseTicketListQuery(req);
  if (parsed.error) return res.status(parsed.error.status).json(parsed.error.body);
  try {
    const client = await db.connect();
    try {
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        return res.status(403).json({
          error: 'Only the assigned operator can view territory support requests.',
          code: 'franchise_operator_only',
        });
      }
      if (parsed.locationId && parsed.locationId !== 'unassigned') {
        const locationResult = await client.query(
          `SELECT id FROM franchise_locations WHERE id = $1 AND application_id = $2`,
          [parsed.locationId, id]
        );
        if (!locationResult.rows.length) {
          return res.status(404).json({ error: 'Location not found in this territory.', code: 'location_not_found' });
        }
      }
    } finally {
      client.release();
    }
    const tickets = await fetchTerritoryTickets(id, { status: parsed.status, locationId: parsed.locationId });
    return res.json({ application_id: id, tickets, total: tickets.length });
  } catch (err) {
    logger.error('Error loading franchise territory tickets', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to load territory support requests.' });
  }
}

async function listTerritoryTicketsAsAdmin(req, res) {
  const { id } = req.params;
  const parsed = parseTicketListQuery(req);
  if (parsed.error) return res.status(parsed.error.status).json(parsed.error.body);
  try {
    const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Franchise application not found.' });
    }
    if (parsed.locationId && parsed.locationId !== 'unassigned') {
      const locationResult = await db.query(
        `SELECT id FROM franchise_locations WHERE id = $1 AND application_id = $2`,
        [parsed.locationId, id]
      );
      if (!locationResult.rows.length) {
        return res.status(404).json({ error: 'Location not found in this territory.', code: 'location_not_found' });
      }
    }
    const tickets = await fetchTerritoryTickets(id, { status: parsed.status, locationId: parsed.locationId });
    return res.json({ application_id: id, tickets, total: tickets.length });
  } catch (err) {
    logger.error('Error loading franchise territory tickets as admin', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to load territory support requests.' });
  }
}

// Group 12 Slice 3j (646, D-347): the franchise-scoped policy-question
// intake. A policy question IS a support ticket with category
// 'policy_question' — it reuses the ticket machinery (thread, reply,
// reopen, the 629 queue, the 628 summary) instead of a parallel inbox.
// It is created through this franchise endpoint, never through the
// generic POST /support/request: the generic intake allowlists its
// categories and has no territory context, so a policy question filed
// there would downgrade to 'general' and never reach the HQ franchise
// queue. The ticket carries the territory link (and, when given, the
// location and the standard it asks about, 621) from creation, so HQ
// sees the full context in its queue and answers in-thread via the
// generic ticket reply. The question itself is the ticket's first
// message.
const POLICY_QUESTION_CATEGORY = 'policy_question';
const POLICY_QUESTION_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

async function fetchPolicyQuestions(applicationId) {
  return fetchTerritoryTickets(applicationId, { status: 'all', category: POLICY_QUESTION_CATEGORY, limit: 100 });
}

async function createPolicyQuestionCore(client, applicationId, actorId, {
  subject, question, locationId, standardId, priority,
}) {
  const { rows: actorRows } = await client.query(
    'SELECT first_name, last_name, email FROM users WHERE id = $1',
    [actorId]
  );
  const actor = actorRows[0] || {};
  const name = [actor.first_name, actor.last_name].filter(Boolean).join(' ') || actor.email || 'Franchise operator';
  const { rows: ticketRows } = await client.query(
    `INSERT INTO support_tickets
       (user_id, name, email, subject, category, priority, status, source,
        franchise_application_id, franchise_location_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, 'open', 'direct', $7, $8, $9::jsonb)
     RETURNING id, ticket_number, subject, category, priority, status,
               franchise_application_id AS application_id,
               franchise_location_id AS location_id, created_at`,
    [
      actorId,
      name,
      actor.email || '',
      subject,
      POLICY_QUESTION_CATEGORY,
      priority,
      applicationId,
      locationId,
      JSON.stringify(standardId ? { standard_id: standardId } : {}),
    ]
  );
  const ticket = ticketRows[0];
  await client.query(
    `INSERT INTO support_messages
       (ticket_id, sender_id, sender_name, sender_email, content,
        sender_language, is_internal, is_from_admin)
     VALUES ($1, $2, $3, $4, $5, 'en', false, false)`,
    [ticket.id, actorId, name, actor.email || '', question]
  );
  await logActivity(client, applicationId, actorId, 'policy_question_asked',
    `Policy question #${ticket.ticket_number} asked: ${subject}.`,
    { ticket_id: ticket.id, standard_id: standardId || null, location_id: locationId || null });
  return ticket;
}

async function createPolicyQuestion(req, res) {
  const { id } = req.params;
  const body = req.body || {};
  const subject = asTrimmed(body.subject);
  const question = asTrimmed(body.question);
  const locationId = asTrimmed(body.location_id) || null;
  const standardId = asTrimmed(body.standard_id) || null;
  const priority = typeof body.priority === 'string' && POLICY_QUESTION_PRIORITIES.has(body.priority)
    ? body.priority
    : 'normal';
  if (!subject) {
    return res.status(400).json({ error: 'A subject is required for a policy question.', code: 'policy_question_subject_required' });
  }
  if (subject.length > 500) {
    return res.status(400).json({ error: 'The subject must be at most 500 characters.', code: 'policy_question_subject_too_long' });
  }
  if (!question) {
    return res.status(400).json({ error: 'A question is required for a policy question.', code: 'policy_question_required' });
  }
  if (question.length > 5000) {
    return res.status(400).json({ error: 'The question must be at most 5000 characters.', code: 'policy_question_too_long' });
  }
  if (locationId && !UUID_RE.test(locationId)) {
    return res.status(404).json({ error: 'Location not found in this territory.', code: 'location_not_found' });
  }
  if (standardId && !UUID_RE.test(standardId)) {
    return res.status(404).json({ error: 'Standard not found for this territory.', code: 'standard_not_found' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can ask a policy question for the territory.',
          code: 'franchise_operator_only',
        });
      }
      if (locationId) {
        const locationResult = await client.query(
          `SELECT id FROM franchise_locations WHERE id = $1 AND application_id = $2`,
          [locationId, id]
        );
        if (!locationResult.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Location not found in this territory.', code: 'location_not_found' });
        }
      }
      if (standardId) {
        const standardResult = await client.query(
          `SELECT id FROM franchise_standards
            WHERE id = $1 AND (application_id IS NULL OR application_id = $2)`,
          [standardId, id]
        );
        if (!standardResult.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Standard not found for this territory.', code: 'standard_not_found' });
        }
      }
      const ticket = await createPolicyQuestionCore(client, id, req.user?.id, {
        subject, question, locationId, standardId, priority,
      });
      await client.query('COMMIT');
      const policyQuestions = await fetchPolicyQuestions(id);
      return res.status(201).json({ ticket, policy_questions: policyQuestions, total: policyQuestions.length });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error asking franchise policy question', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to ask the policy question.' });
  }
}

// 646 (D-347): the HQ franchise queue for policy questions — the same
// territory-scoped list the operator sees, so HQ answers from the same
// context. HQ answers in-thread on the ticket itself (the generic
// ticket reply), never here: the answer belongs to the ticket thread.
async function listPolicyQuestions(req, res, { asAdmin = false } = {}) {
  const { id } = req.params;
  try {
    if (!asAdmin) {
      const client = await db.connect();
      try {
        const owned = await loadOperatorApplication(client, id, req.user?.id);
        if (!owned.application || !owned.isAssociated) {
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
        if (!owned.isOperator) {
          return res.status(403).json({
            error: 'Only the assigned operator can view territory policy questions.',
            code: 'franchise_operator_only',
          });
        }
      } finally {
        client.release();
      }
    } else {
      const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!rows.length) {
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
    }
    const policyQuestions = await fetchPolicyQuestions(id);
    return res.json({ application_id: id, policy_questions: policyQuestions, total: policyQuestions.length });
  } catch (err) {
    logger.error('Error listing franchise policy questions', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to load policy questions.' });
  }
}

async function listPolicyQuestionsAsAdmin(req, res) {
  return listPolicyQuestions(req, res, { asAdmin: true });
}

async function getLocationHealth(req, res) {
  const { id } = req.params;
  try {
    const client = await db.connect();
    try {
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        return res.status(403).json({
          error: 'Only the assigned operator can view location health.',
          code: 'franchise_operator_only',
        });
      }
    } finally {
      client.release();
    }
    return res.json(await buildLocationHealth(id));
  } catch (err) {
    logger.error('Error loading franchise location health', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to load location health.' });
  }
}

async function getLocationHealthAsAdmin(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Franchise application not found.' });
    }
    return res.json(await buildLocationHealth(id));
  } catch (err) {
    logger.error('Error loading franchise location health as admin', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to load location health.' });
  }
}

// 630 (D-330): the territory coverage trend — the linked business's
// staff shifts as a trend over time, never a new scheduling system. One
// row per day (shifts, distinct staff, covered), 7-day buckets anchored
// at the window start, and an overall coverage % for the window. Default
// window is the 28 days ending today; ?from=/?to= override it, capped at
// 93 days like the schedule forecast. Cancelled shifts never count; the
// shift set matches the 619 rollup (non-cancelled shifts, drafts
// included). No linked business is an explicit empty trend.
const DATE_ONLY_RE_630 = /^\d{4}-\d{2}-\d{2}$/;

function parseCoverageTrendRange(query) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const defaultFrom = new Date(today.getTime() - 27 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const defaultTo = today.toISOString().slice(0, 10);
  const from = typeof query?.from === 'string' && query.from ? query.from : defaultFrom;
  const to = typeof query?.to === 'string' && query.to ? query.to : defaultTo;
  if (!DATE_ONLY_RE_630.test(from) || !DATE_ONLY_RE_630.test(to) || to < from) {
    return { error: { status: 400, body: { error: 'from and to are required as YYYY-MM-DD with to on or after from.', code: 'invalid_coverage_trend_range' } } };
  }
  const rangeDays = Math.round(
    (new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000
  ) + 1;
  if (rangeDays > 93) {
    return { error: { status: 400, body: { error: 'Coverage trend range is capped at 93 days.', code: 'coverage_trend_range_too_long' } } };
  }
  return { from, to, rangeDays };
}

async function buildCoverageTrend(applicationId, { from, to, rangeDays }) {
  const { rows: [application] } = await db.query(
    'SELECT linked_business_id FROM franchise_applications WHERE id = $1',
    [applicationId]
  );
  const businessId = application?.linked_business_id || null;
  if (!businessId) {
    return {
      application_id: applicationId,
      linked_business_id: null,
      from,
      to,
      days: [],
      weeks: [],
      coverage_pct: null,
    };
  }
  const { rows } = await db.query(
    `SELECT shift_date, COUNT(*)::int AS shifts, COUNT(DISTINCT user_id)::int AS staff
       FROM business_staff_shifts
      WHERE business_id = $1 AND shift_date BETWEEN $2 AND $3
        AND cancelled_at IS NULL
      GROUP BY shift_date`,
    [businessId, from, to]
  );
  const byDate = new Map(rows.map((row) => [new Date(row.shift_date).toISOString().slice(0, 10), row]));
  const start = new Date(`${from}T00:00:00Z`);
  const days = [];
  for (let offset = 0; offset < rangeDays; offset += 1) {
    const date = new Date(start.getTime() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const row = byDate.get(date);
    days.push({
      date,
      shifts: row?.shifts || 0,
      staff: row?.staff || 0,
      covered: Boolean(row && row.shifts > 0),
    });
  }
  const weeks = [];
  for (let weekStart = 0; weekStart < rangeDays; weekStart += 7) {
    const weekDays = days.slice(weekStart, weekStart + 7);
    const coveredDays = weekDays.filter((day) => day.covered).length;
    weeks.push({
      week_start: weekDays[0].date,
      week_end: weekDays[weekDays.length - 1].date,
      days: weekDays.length,
      covered_days: coveredDays,
      coverage_pct: Math.round((coveredDays / weekDays.length) * 100),
    });
  }
  const coveredDays = days.filter((day) => day.covered).length;
  return {
    application_id: applicationId,
    linked_business_id: businessId,
    from,
    to,
    days,
    weeks,
    coverage_pct: Math.round((coveredDays / days.length) * 100),
  };
}

async function getCoverageTrend(req, res) {
  const { id } = req.params;
  const parsed = parseCoverageTrendRange(req.query);
  if (parsed.error) return res.status(parsed.error.status).json(parsed.error.body);
  try {
    const client = await db.connect();
    try {
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        return res.status(403).json({
          error: 'Only the assigned operator can view territory coverage trends.',
          code: 'franchise_operator_only',
        });
      }
    } finally {
      client.release();
    }
    return res.json(await buildCoverageTrend(id, parsed));
  } catch (err) {
    logger.error('Error loading franchise coverage trend', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to load coverage trend.' });
  }
}

async function getCoverageTrendAsAdmin(req, res) {
  const { id } = req.params;
  const parsed = parseCoverageTrendRange(req.query);
  if (parsed.error) return res.status(parsed.error.status).json(parsed.error.body);
  try {
    const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Franchise application not found.' });
    }
    return res.json(await buildCoverageTrend(id, parsed));
  } catch (err) {
    logger.error('Error loading franchise coverage trend as admin', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to load coverage trend.' });
  }
}

async function getTerritoryCoverage(req, res) {
  const { id } = req.params;
  try {
    const client = await db.connect();
    try {
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        return res.status(403).json({
          error: 'Only the assigned operator can view territory coverage.',
          code: 'franchise_operator_only',
        });
      }
    } finally {
      client.release();
    }
    const coverage = await buildTerritoryCoverage(id);
    return res.json(coverage);
  } catch (err) {
    logger.error('Error loading franchise territory coverage', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to load territory coverage.' });
  }
}

async function getTerritoryCoverageAsAdmin(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Franchise application not found.' });
    }
    const coverage = await buildTerritoryCoverage(id);
    return res.json(coverage);
  } catch (err) {
    logger.error('Error loading franchise territory coverage as admin', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to load territory coverage.' });
  }
}

// 620 (D-320): HQ broadcast announcements. Posting and deleting are
// HQ-only; the operator reads the feed on the territory ops page and
// marks items read (idempotent). The activity log stays the event
// record — this feed carries HQ announcements, not territory events.
async function postAnnouncementAsAdmin(req, res) {
  const { id } = req.params;
  const title = asTrimmed(req.body?.title);
  const body = asTrimmed(req.body?.body);
  if (!title) {
    return res.status(400).json({ error: 'title is required.', code: 'announcement_title_required' });
  }
  if (!body) {
    return res.status(400).json({ error: 'body is required.', code: 'announcement_body_required' });
  }
  const expiry = parseExpiry(req.body?.expires_at);
  if (!expiry.ok) {
    return res.status(400).json({ error: 'expires_at must be a valid date.', code: 'invalid_announcement_expiry' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const { rows } = await client.query(
        `INSERT INTO franchise_announcements
           (application_id, title, body, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, title, body, expiry.value, req.user?.id || null]
      );
      await logActivity(client, id, req.user?.id || null, 'announcement_posted',
        `HQ posted an announcement: ${title}.`, { announcement_id: rows[0].id });
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.status(201).json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error posting franchise announcement', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to post announcement.' });
  }
}

async function deleteAnnouncementAsAdmin(req, res) {
  const { id, announcementId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `DELETE FROM franchise_announcements
          WHERE id = $1 AND application_id = $2 RETURNING title`,
        [announcementId, id]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Announcement not found.', code: 'announcement_not_found' });
      }
      await logActivity(client, id, req.user?.id || null, 'announcement_removed',
        `HQ removed an announcement: ${rows[0].title}.`, { announcement_id: announcementId });
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error deleting franchise announcement', { id, announcementId, err: err.message });
    return res.status(500).json({ error: 'Failed to remove announcement.' });
  }
}

async function markAnnouncementRead(req, res) {
  const { id, announcementId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can mark announcements read.',
          code: 'franchise_operator_only',
        });
      }
      const { rows } = await client.query(
        `SELECT id FROM franchise_announcements WHERE id = $1 AND application_id = $2`,
        [announcementId, id]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Announcement not found.', code: 'announcement_not_found' });
      }
      await client.query(
        `INSERT INTO franchise_announcement_reads (announcement_id, user_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [announcementId, req.user?.id]
      );
      await client.query('COMMIT');
      const detail = await fetchApplicantApplicationDetail(id, req.user?.id);
      return res.json(detail);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error marking franchise announcement read', { id, announcementId, err: err.message });
    return res.status(500).json({ error: 'Failed to mark announcement read.' });
  }
}

// Group 12 Slice 3e (621, D-321): HQ curates a Learn guide as a
// franchise standard, either for one territory (applicationId set) or
// franchise-wide (applicationId null). The guide must be a published
// Learn guide; a guide is a standard at most once per scope.
async function curateFranchiseStandardCore(client, { applicationId, guideId, curatedBy }) {
  const { rows: guideRows } = await client.query(
    `SELECT id FROM learn_guides WHERE id = $1 AND status = 'published'`,
    [guideId]
  );
  if (!guideRows.length) {
    return { error: { status: 404, body: { error: 'Learn guide not found.', code: 'standard_guide_not_found' } } };
  }
  const { rows: existing } = await client.query(
    `SELECT id FROM franchise_standards
      WHERE guide_id = $1 AND (
        ($2::uuid IS NULL AND application_id IS NULL) OR application_id = $2
      )`,
    [guideId, applicationId]
  );
  if (existing.length) {
    return { error: { status: 409, body: { error: 'That guide is already a franchise standard for this scope.', code: 'standard_already_curated' } } };
  }
  const { rows } = await client.query(
    `INSERT INTO franchise_standards (application_id, guide_id, curated_by)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [applicationId, guideId, curatedBy]
  );
  return { standard: rows[0] };
}

async function curateFranchiseStandard(req, res) {
  const { id } = req.params;
  const guideId = asTrimmed(req.body?.guide_id);
  if (!guideId) {
    return res.status(400).json({ error: 'guide_id is required.', code: 'standard_guide_required' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const result = await curateFranchiseStandardCore(client, {
        applicationId: id, guideId, curatedBy: req.user?.id || null,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await logActivity(client, id, req.user?.id || null, 'standard_curated',
        `HQ curated a franchise standard from Learn guide ${guideId}.`, { standard_id: result.standard.id, guide_id: guideId });
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.status(201).json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error curating franchise standard', { id, guideId, err: err.message });
    return res.status(500).json({ error: 'Failed to curate franchise standard.' });
  }
}

async function curateFranchiseStandardWide(req, res) {
  const guideId = asTrimmed(req.body?.guide_id);
  if (!guideId) {
    return res.status(400).json({ error: 'guide_id is required.', code: 'standard_guide_required' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await curateFranchiseStandardCore(client, {
        applicationId: null, guideId, curatedBy: req.user?.id || null,
      });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const standards = await fetchFranchiseStandards(null);
      return res.status(201).json({ standards });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error curating franchise-wide standard', { guideId, err: err.message });
    return res.status(500).json({ error: 'Failed to curate franchise standard.' });
  }
}

async function listFranchiseStandardsWide(req, res) {
  try {
    const standards = await fetchFranchiseStandards(null);
    return res.json({ standards });
  } catch (err) {
    logger.error('Error listing franchise-wide standards', { err: err.message });
    return res.status(500).json({ error: 'Failed to list franchise standards.' });
  }
}

async function removeFranchiseStandardCore(client, { applicationId, standardId }) {
  const { rows } = await client.query(
    `DELETE FROM franchise_standards
      WHERE id = $1 AND (
        ($2::uuid IS NULL AND application_id IS NULL) OR application_id = $2
      )
      RETURNING guide_id`,
    [standardId, applicationId]
  );
  if (!rows.length) {
    return { error: { status: 404, body: { error: 'Franchise standard not found.', code: 'standard_not_found' } } };
  }
  return { guideId: rows[0].guide_id };
}

async function removeFranchiseStandard(req, res) {
  const { id, standardId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await removeFranchiseStandardCore(client, { applicationId: id, standardId });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await logActivity(client, id, req.user?.id || null, 'standard_removed',
        `HQ removed a franchise standard (Learn guide ${result.guideId}).`, { standard_id: standardId, guide_id: result.guideId });
      await client.query('COMMIT');
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error removing franchise standard', { id, standardId, err: err.message });
    return res.status(500).json({ error: 'Failed to remove franchise standard.' });
  }
}

async function removeFranchiseStandardWide(req, res) {
  const { standardId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await removeFranchiseStandardCore(client, { applicationId: null, standardId });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      const standards = await fetchFranchiseStandards(null);
      return res.json({ standards });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error removing franchise-wide standard', { standardId, err: err.message });
    return res.status(500).json({ error: 'Failed to remove franchise standard.' });
  }
}

// Group 12 Slice 3e (622, D-323): version acknowledgment — a territory
// member acknowledges a standard's current version with a drawn
// e-signature (PNG, reusing the SOP read-and-sign pattern). The
// signature uploads through the existing upload path before the
// transaction; the version must match the standard's current version
// (409 otherwise), and re-acknowledging the same version returns the
// existing row instead of a second one. Group 12 Slice 3e (625) wires
// the policy-change reminder into the publish handlers below.
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

async function acknowledgeFranchiseStandard(req, res) {
  const { id, standardId } = req.params;
  const version = Number.parseInt(req.body?.version, 10);
  if (!req.file?.buffer?.length) {
    return res.status(400).json({ error: 'A drawn signature is required to acknowledge.', code: 'signature_required' });
  }
  if (req.file.buffer.length > MAX_SIGNATURE_BYTES) {
    return res.status(413).json({ error: 'Signature too large.', code: 'signature_too_large' });
  }
  if (req.file.buffer.length < 8 || !req.file.buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    return res.status(400).json({ error: 'PNG signature required.', code: 'invalid_signature' });
  }
  if (!Number.isInteger(version) || version < 1) {
    return res.status(400).json({ error: 'version is required.', code: 'standard_version_required' });
  }
  let signatureKey = null;
  try {
    signatureKey = await uploadFile(
      req.file.buffer,
      `franchise-standards/signatures/${req.user.id}`,
      `signature-standard${standardId}-v${version}.png`,
      'image/png',
    );
    if (!signatureKey) {
      return res.status(502).json({ error: 'Signature upload failed.', code: 'upload_failed' });
    }
  } catch (err) {
    logger.error('Error uploading franchise standard signature', { id, standardId, err: err.message });
    return res.status(502).json({ error: 'Signature upload failed.', code: 'upload_failed' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows: appRows } = await client.query(
        `SELECT id, applicant_user_id, owner_user_id
           FROM franchise_applications WHERE id = $1`,
        [id]
      );
      if (!appRows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const application = appRows[0];
      const isMember = await isTerritoryMember(client, id, req.user?.id);
      if (!isMember) {
        await client.query('ROLLBACK');
        const isAssociated = String(application.applicant_user_id) === String(req.user?.id)
          || String(application.owner_user_id) === String(req.user?.id);
        if (isAssociated) {
          return res.status(403).json({
            error: 'Only territory members can acknowledge franchise standards.',
            code: 'franchise_standard_acknowledge_not_member',
          });
        }
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const { rows: standardRows } = await client.query(
        `SELECT * FROM franchise_standards
          WHERE id = $1 AND (application_id IS NULL OR application_id = $2)
          FOR UPDATE`,
        [standardId, id]
      );
      if (!standardRows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise standard not found.', code: 'standard_not_found' });
      }
      const standard = standardRows[0];
      if (standard.version !== version) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'That standard version changed; review the current version first.',
          code: 'standard_version_conflict',
        });
      }
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [`franchise-standard-sign:${standardId}:${req.user.id}:${version}`]
      );
      const { rows: existingRows } = await client.query(
        `SELECT id FROM franchise_standard_acknowledgments
          WHERE standard_id = $1 AND user_id = $2 AND version = $3`,
        [standardId, req.user.id, version]
      );
      let isNew = false;
      if (!existingRows.length) {
        await client.query(
          `INSERT INTO franchise_standard_acknowledgments
             (standard_id, user_id, version, signature_storage_key)
           VALUES ($1, $2, $3, $4)`,
          [standardId, req.user.id, version, signatureKey]
        );
        await logActivity(client, id, req.user?.id || null, 'standard_acknowledged',
          `Acknowledged franchise standard version ${version}.`, { standard_id: standardId, version });
        isNew = true;
      }
      await client.query('COMMIT');
      const detail = await fetchApplicantApplicationDetail(id, req.user?.id);
      return res.status(isNew ? 201 : 200).json(detail);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error acknowledging franchise standard', { id, standardId, err: err.message });
    return res.status(500).json({ error: 'Failed to acknowledge franchise standard.' });
  }
}

async function publishFranchiseStandardVersionCore(client, { applicationId, standardId }) {
  const { rows } = await client.query(
    `UPDATE franchise_standards SET version = version + 1, updated_at = NOW()
      WHERE id = $1 AND (
        ($2::uuid IS NULL AND application_id IS NULL) OR application_id = $2
      )
      RETURNING *`,
    [standardId, applicationId]
  );
  if (!rows.length) {
    return { error: { status: 404, body: { error: 'Franchise standard not found.', code: 'standard_not_found' } } };
  }
  return { standard: rows[0] };
}

async function publishFranchiseStandardVersion(req, res) {
  const { id, standardId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const result = await publishFranchiseStandardVersionCore(client, { applicationId: id, standardId });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await logActivity(client, id, req.user?.id || null, 'standard_version_published',
        `HQ published franchise standard version ${result.standard.version}.`, { standard_id: standardId, version: result.standard.version });
      await client.query('COMMIT');
      // Group 12 Slice 3e (625, D-326): the version change reminds the
      // members who have not yet acknowledged the new version,
      // immediately. A reminder failure never fails the publish.
      try {
        await sendFranchiseStandardReminders({ force: true, standardId });
      } catch (err) {
        logger.error('Error sending franchise standard reminders', { id, standardId, err: err.message });
      }
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error publishing franchise standard version', { id, standardId, err: err.message });
    return res.status(500).json({ error: 'Failed to publish franchise standard version.' });
  }
}

async function publishFranchiseStandardVersionWide(req, res) {
  const { standardId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await publishFranchiseStandardVersionCore(client, { applicationId: null, standardId });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      // Group 12 Slice 3e (625, D-326): the version change reminds the
      // members of every territory who have not yet acknowledged the new
      // version, immediately. A reminder failure never fails the publish.
      try {
        await sendFranchiseStandardReminders({ force: true, standardId });
      } catch (err) {
        logger.error('Error sending franchise standard reminders', { standardId, err: err.message });
      }
      const standards = await fetchFranchiseStandards(null);
      return res.json({ standards });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error publishing franchise-wide standard version', { standardId, err: err.message });
    return res.status(500).json({ error: 'Failed to publish franchise standard version.' });
  }
}

// Group 12 Slice 3e (625, D-326): HQ manually re-sends the policy
// change reminder for one standard, now. This is an explicit HQ
// action, so it bypasses the daily 24h dedupe (force) — the members
// who have not yet acknowledged the current version are reminded
// again. Members who already acknowledged are never reminded.
async function remindFranchiseStandard(req, res) {
  const { id, standardId } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT id FROM franchise_standards WHERE id = $1 AND application_id = $2`,
      [standardId, id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Franchise standard not found.', code: 'standard_not_found' });
    }
    const { reminded } = await sendFranchiseStandardReminders({ force: true, standardId });
    const bundle = await fetchFranchiseApplicationBundle(id);
    return res.json({ ...bundle, reminded_user_ids: reminded });
  } catch (err) {
    logger.error('Error sending franchise standard reminder', { id, standardId, err: err.message });
    return res.status(500).json({ error: 'Failed to send franchise standard reminder.' });
  }
}

async function remindFranchiseStandardWide(req, res) {
  const { standardId } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT id FROM franchise_standards WHERE id = $1 AND application_id IS NULL`,
      [standardId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Franchise standard not found.', code: 'standard_not_found' });
    }
    const { reminded } = await sendFranchiseStandardReminders({ force: true, standardId });
    const standards = await fetchFranchiseStandards(null);
    return res.json({ standards, reminded_user_ids: reminded });
  } catch (err) {
    logger.error('Error sending franchise-wide standard reminder', { standardId, err: err.message });
    return res.status(500).json({ error: 'Failed to send franchise standard reminder.' });
  }
}

// Group 12 Slice 3e (623, D-324): HQ uploads a brand asset for one
// territory (applicationId set) or franchise-wide (null). The file
// uploads through the existing upload path into the private
// `franchise-brand-assets/` prefix before the row is written; a failed
// upload never creates a row.
async function uploadFranchiseBrandAssetCore(req, res, { applicationId }) {
  if (!req.file?.buffer?.length) {
    return res.status(400).json({ error: 'A file is required.', code: 'brand_asset_file_required' });
  }
  const name = (asTrimmed(req.body?.name) || req.file.originalname || 'Brand asset').slice(0, 200);
  const description = asTrimmed(req.body?.description);
  let storageKey = null;
  try {
    storageKey = await uploadFile(
      req.file.buffer,
      `franchise-brand-assets/${applicationId || 'franchise'}`,
      req.file.originalname,
      req.file.detectedMime || req.file.mimetype,
    );
    if (!storageKey) {
      return res.status(502).json({ error: 'Brand asset upload failed.', code: 'upload_failed' });
    }
  } catch (err) {
    logger.error('Error uploading franchise brand asset', { applicationId, err: err.message });
    return res.status(502).json({ error: 'Brand asset upload failed.', code: 'upload_failed' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (applicationId) {
        const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [applicationId]);
        if (!exists.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
      }
      const { rows } = await client.query(
        `INSERT INTO franchise_brand_assets
           (application_id, name, description, storage_key, file_name, content_type, file_size_bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [applicationId, name, description, storageKey, req.file.originalname,
          req.file.detectedMime || req.file.mimetype || null, req.file.size || null, req.user?.id || null]
      );
      if (applicationId) {
        await logActivity(client, applicationId, req.user?.id || null, 'brand_asset_uploaded',
          `HQ uploaded a brand asset: ${name}.`, { brand_asset_id: rows[0].id });
      }
      await client.query('COMMIT');
      if (applicationId) {
        const bundle = await fetchFranchiseApplicationBundle(applicationId);
        return res.status(201).json(bundle);
      }
      const brandAssets = await fetchBrandAssets(null);
      return res.status(201).json({ brand_assets: brandAssets });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error saving franchise brand asset', { applicationId, err: err.message });
    return res.status(500).json({ error: 'Failed to upload brand asset.' });
  }
}

async function uploadFranchiseBrandAsset(req, res) {
  return uploadFranchiseBrandAssetCore(req, res, { applicationId: req.params.id });
}

async function uploadFranchiseBrandAssetWide(req, res) {
  return uploadFranchiseBrandAssetCore(req, res, { applicationId: null });
}

async function listFranchiseBrandAssetsWide(req, res) {
  try {
    const brandAssets = await fetchBrandAssets(null);
    return res.json({ brand_assets: brandAssets });
  } catch (err) {
    logger.error('Error listing franchise-wide brand assets', { err: err.message });
    return res.status(500).json({ error: 'Failed to list brand assets.' });
  }
}

async function deleteFranchiseBrandAssetCore(client, { applicationId, assetId }) {
  const { rows } = await client.query(
    `DELETE FROM franchise_brand_assets
      WHERE id = $1 AND (
        ($2::uuid IS NULL AND application_id IS NULL) OR application_id = $2
      )
      RETURNING storage_key, name`,
    [assetId, applicationId]
  );
  if (!rows.length) {
    return { error: { status: 404, body: { error: 'Brand asset not found.', code: 'brand_asset_not_found' } } };
  }
  return { storageKey: rows[0].storage_key, name: rows[0].name };
}

async function deleteFranchiseBrandAsset(req, res) {
  const { id, assetId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await deleteFranchiseBrandAssetCore(client, { applicationId: id, assetId });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await logActivity(client, id, req.user?.id || null, 'brand_asset_removed',
        `HQ removed a brand asset: ${result.name}.`, { brand_asset_id: assetId });
      await client.query('COMMIT');
      // The stored file is best-effort: a failed storage delete never
      // fails the removal — the row is gone and the key is unreferenced.
      try { await deleteFile(result.storageKey); } catch (err) {
        logger.warn('Franchise brand asset file delete failed', { assetId, err: err.message });
      }
      const bundle = await fetchFranchiseApplicationBundle(id);
      return res.json(bundle);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error removing franchise brand asset', { id, assetId, err: err.message });
    return res.status(500).json({ error: 'Failed to remove brand asset.' });
  }
}

async function deleteFranchiseBrandAssetWide(req, res) {
  const { assetId } = req.params;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await deleteFranchiseBrandAssetCore(client, { applicationId: null, assetId });
      if (result.error) {
        await client.query('ROLLBACK');
        return res.status(result.error.status).json(result.error.body);
      }
      await client.query('COMMIT');
      try { await deleteFile(result.storageKey); } catch (err) {
        logger.warn('Franchise brand asset file delete failed', { assetId, err: err.message });
      }
      const brandAssets = await fetchBrandAssets(null);
      return res.json({ brand_assets: brandAssets });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error removing franchise-wide brand asset', { assetId, err: err.message });
    return res.status(500).json({ error: 'Failed to remove brand asset.' });
  }
}

// ── Group 12 Slice 3h (636-640): plan development ──────────────────────────
// 636 (D-336): the candidate location tracker. Candidate locations are
// business/restaurant locations inside a territory (D-298) — the HQ list
// tracks candidate territories, this tracks the locations a territory is
// scouting. The operator proposes; HQ reviews. Status flows
// scouting -> shortlisted -> approved/rejected, with rejected -> scouting
// as the reopen path; approved and rejected are otherwise terminal.
const CANDIDATE_STATUSES = new Set(['scouting', 'shortlisted', 'approved', 'rejected']);
const CANDIDATE_TRANSITIONS = {
  scouting: ['shortlisted', 'rejected'],
  shortlisted: ['approved', 'rejected', 'scouting'],
  approved: [],
  rejected: ['scouting'],
};
// The operator may submit a candidate for review (scouting -> shortlisted)
// and withdraw one (shortlisted -> scouting); every other move is an HQ
// review decision (D-336).
const CANDIDATE_OPERATOR_TRANSITIONS = new Set(['scouting:shortlisted', 'shortlisted:scouting']);

async function fetchCandidateLocations(applicationId, { status = null } = {}) {
  const conditions = ['c.application_id = $1'];
  const params = [applicationId];
  if (status) {
    params.push(status);
    conditions.push(`c.status = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT c.*, u.first_name AS proposer_first_name, u.last_name AS proposer_last_name,
            u.email AS proposer_email,
            r.first_name AS reviewer_first_name, r.last_name AS reviewer_last_name,
            r.email AS reviewer_email
       FROM franchise_candidate_locations c
       LEFT JOIN users u ON u.id = c.proposed_by
       LEFT JOIN users r ON r.id = c.reviewed_by
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.created_at DESC, c.id DESC`,
    params
  );
  return rows.map((row) => ({
    ...row,
    area: [row.city, row.region, row.country].filter(Boolean).join(', ') || null,
    proposed_by_name: [row.proposer_first_name, row.proposer_last_name].filter(Boolean).join(' ')
      || row.proposer_email || null,
    reviewed_by_name: [row.reviewer_first_name, row.reviewer_last_name].filter(Boolean).join(' ')
      || row.reviewer_email || null,
  }));
}

async function buildCandidateLocations(applicationId) {
  const candidateLocations = await fetchCandidateLocations(applicationId);
  const byStatus = { scouting: 0, shortlisted: 0, approved: 0, rejected: 0 };
  for (const candidate of candidateLocations) {
    if (Object.prototype.hasOwnProperty.call(byStatus, candidate.status)) byStatus[candidate.status] += 1;
  }
  return {
    application_id: applicationId,
    total: candidateLocations.length,
    by_status: byStatus,
    candidate_locations: candidateLocations,
  };
}

function validateCandidateLocationFields(body) {
  const name = asTrimmed(body?.proposed_name);
  if (!name) return { error: { status: 400, body: { error: 'proposed_name is required.', code: 'candidate_name_required' } } };
  if (name.length > 200) return { error: { status: 400, body: { error: 'proposed_name must be at most 200 characters.', code: 'candidate_name_too_long' } } };
  const countryRaw = asTrimmed(body?.country);
  if (countryRaw && !countriesUtil.isValidCountry(countryRaw)) {
    return { error: { status: 400, body: { error: 'country must be a valid ISO-2 country code.', code: 'invalid_candidate_country' } } };
  }
  const notes = asTrimmed(body?.notes);
  if (notes && notes.length > 1000) return { error: { status: 400, body: { error: 'notes must be at most 1000 characters.', code: 'candidate_notes_too_long' } } };
  return {
    value: {
      name,
      city: asTrimmed(body?.city) || null,
      region: asTrimmed(body?.region) || null,
      country: countryRaw ? countriesUtil.normalizeCountry(countryRaw) : null,
      notes: notes || null,
    },
  };
}

async function createCandidateLocation(req, res, { asAdmin = false } = {}) {
  const validated = validateCandidateLocationFields(req.body);
  if (validated.error) return res.status(validated.error.status).json(validated.error.body);
  const { id } = req.params;
  const { name, city, region, country, notes } = validated.value;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (!asAdmin) {
        const owned = await loadOperatorApplication(client, id, req.user?.id);
        if (!owned.application || !owned.isAssociated) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
        if (!owned.isOperator) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Only the assigned operator can propose candidate locations.',
            code: 'franchise_operator_only',
          });
        }
      } else {
        const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
        if (!exists.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
      }
      const { rows } = await client.query(
        `INSERT INTO franchise_candidate_locations
           (application_id, proposed_name, city, region, country, notes, proposed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [id, name, city, region, country, notes, req.user?.id || null]
      );
      await logActivity(client, id, req.user?.id || null, 'candidate_location_proposed',
        `Candidate location proposed: "${name}".`, { candidate_location_id: rows[0].id });
      await client.query('COMMIT');
      const candidateLocations = await buildCandidateLocations(id);
      const created = candidateLocations.candidate_locations.find((row) => row.id === rows[0].id) || rows[0];
      return res.status(201).json({ candidate_location: created, candidate_locations: candidateLocations });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error proposing franchise candidate location', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to propose candidate location.' });
  }
}

async function createCandidateLocationAsAdmin(req, res) {
  return createCandidateLocation(req, res, { asAdmin: true });
}

async function getCandidateLocations(req, res, { asAdmin = false } = {}) {
  const { id } = req.params;
  const status = asTrimmed(req.query?.status);
  if (status && !CANDIDATE_STATUSES.has(status)) {
    return res.status(400).json({ error: 'status must be scouting, shortlisted, approved, or rejected.', code: 'invalid_candidate_status' });
  }
  try {
    if (!asAdmin) {
      const client = await db.connect();
      try {
        const owned = await loadOperatorApplication(client, id, req.user?.id);
        if (!owned.application || !owned.isAssociated) {
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
        if (!owned.isOperator) {
          return res.status(403).json({
            error: 'Only the assigned operator can view candidate locations.',
            code: 'franchise_operator_only',
          });
        }
      } finally {
        client.release();
      }
    } else {
      const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!rows.length) {
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
    }
    const all = await buildCandidateLocations(id);
    if (!status) return res.json(all);
    return res.json({
      ...all,
      total: all.by_status[status],
      candidate_locations: all.candidate_locations.filter((row) => row.status === status),
    });
  } catch (err) {
    logger.error('Error loading franchise candidate locations', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to load candidate locations.' });
  }
}

async function getCandidateLocationsAsAdmin(req, res) {
  return getCandidateLocations(req, res, { asAdmin: true });
}

async function updateCandidateLocation(req, res, { asAdmin = false } = {}) {
  const { id, candidateId } = req.params;
  if (!UUID_RE.test(candidateId)) {
    return res.status(404).json({ error: 'Candidate location not found.', code: 'candidate_not_found' });
  }
  const body = req.body || {};
  const nextStatus = body.status !== undefined ? asTrimmed(body.status) : undefined;
  if (nextStatus !== undefined && !CANDIDATE_STATUSES.has(nextStatus)) {
    return res.status(400).json({
      error: 'status must be scouting, shortlisted, approved, or rejected.',
      code: 'invalid_candidate_status',
    });
  }
  const hasFieldEdits = ['proposed_name', 'city', 'region', 'country', 'notes']
    .some((field) => body[field] !== undefined);
  // A partial edit validates only the fields supplied: the name is
  // required on create, but an edit that only changes the notes must not
  // be forced to resend the name.
  let validatedFields = null;
  if (hasFieldEdits) {
    validatedFields = {};
    if (body.proposed_name !== undefined) {
      const name = asTrimmed(body.proposed_name);
      if (!name) {
        return res.status(400).json({ error: 'proposed_name is required.', code: 'candidate_name_required' });
      }
      if (name.length > 200) {
        return res.status(400).json({ error: 'proposed_name must be at most 200 characters.', code: 'candidate_name_too_long' });
      }
      validatedFields.name = name;
    }
    if (body.city !== undefined) validatedFields.city = asTrimmed(body.city) || null;
    if (body.region !== undefined) validatedFields.region = asTrimmed(body.region) || null;
    if (body.country !== undefined) {
      const countryRaw = asTrimmed(body.country);
      if (countryRaw && !countriesUtil.isValidCountry(countryRaw)) {
        return res.status(400).json({ error: 'country must be a valid ISO-2 country code.', code: 'invalid_candidate_country' });
      }
      validatedFields.country = countryRaw ? countriesUtil.normalizeCountry(countryRaw) : null;
    }
    if (body.notes !== undefined) {
      const notes = asTrimmed(body.notes);
      if (notes && notes.length > 1000) {
        return res.status(400).json({ error: 'notes must be at most 1000 characters.', code: 'candidate_notes_too_long' });
      }
      validatedFields.notes = notes || null;
    }
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (!asAdmin) {
        const owned = await loadOperatorApplication(client, id, req.user?.id);
        if (!owned.application || !owned.isAssociated) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
        if (!owned.isOperator) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Only the assigned operator can update candidate locations.',
            code: 'franchise_operator_only',
          });
        }
      } else {
        const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
        if (!exists.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
      }
      const { rows: found } = await client.query(
        `SELECT * FROM franchise_candidate_locations WHERE id = $1 AND application_id = $2`,
        [candidateId, id]
      );
      const candidate = found[0] || null;
      if (!candidate) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Candidate location not found.', code: 'candidate_not_found' });
      }
      if (nextStatus !== undefined && nextStatus !== candidate.status) {
        if (!CANDIDATE_TRANSITIONS[candidate.status].includes(nextStatus)) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: `A ${candidate.status} candidate location cannot move to ${nextStatus}.`,
            code: 'candidate_transition_invalid',
          });
        }
        if (!asAdmin && !CANDIDATE_OPERATOR_TRANSITIONS.has(`${candidate.status}:${nextStatus}`)) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Only headquarters can review a candidate location.',
            code: 'candidate_review_hq_only',
          });
        }
      }
      if (hasFieldEdits) {
        const locked = !asAdmin
          ? candidate.status !== 'scouting'
          : candidate.status === 'approved';
        if (locked) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Candidate location details can no longer be edited.',
            code: 'candidate_edit_locked',
          });
        }
      }
      const updates = [];
      const values = [candidateId];
      const set = (column, value) => {
        values.push(value);
        updates.push(`${column} = $${values.length}`);
      };
      if (validatedFields) {
        if (validatedFields.name !== undefined) set('proposed_name', validatedFields.name);
        if (validatedFields.city !== undefined) set('city', validatedFields.city);
        if (validatedFields.region !== undefined) set('region', validatedFields.region);
        if (validatedFields.country !== undefined) set('country', validatedFields.country);
        if (validatedFields.notes !== undefined) set('notes', validatedFields.notes);
      }
      if (nextStatus !== undefined && nextStatus !== candidate.status) {
        set('status', nextStatus);
        if (asAdmin) {
          set('reviewed_by', req.user?.id || null);
          updates.push('reviewed_at = NOW()');
        }
      }
      let updated = candidate;
      if (updates.length) {
        const { rows } = await client.query(
          `UPDATE franchise_candidate_locations
              SET ${updates.join(', ')}, updated_at = NOW()
            WHERE id = $1
            RETURNING *`,
          values
        );
        updated = rows[0];
        await logActivity(client, id, req.user?.id || null, 'candidate_location_updated',
          `Candidate location "${updated.proposed_name}" updated to ${updated.status}.`,
          { candidate_location_id: candidateId, status: updated.status });
      }
      await client.query('COMMIT');
      const candidateLocations = await buildCandidateLocations(id);
      const presented = candidateLocations.candidate_locations.find((row) => row.id === candidateId) || updated;
      return res.json({ candidate_location: presented, candidate_locations: candidateLocations });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error updating franchise candidate location', { id, candidateId, err: err.message });
    return res.status(500).json({ error: 'Failed to update candidate location.' });
  }
}

async function updateCandidateLocationAsAdmin(req, res) {
  return updateCandidateLocation(req, res, { asAdmin: true });
}

async function deleteCandidateLocation(req, res, { asAdmin = false } = {}) {
  const { id, candidateId } = req.params;
  if (!UUID_RE.test(candidateId)) {
    return res.status(404).json({ error: 'Candidate location not found.', code: 'candidate_not_found' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (!asAdmin) {
        const owned = await loadOperatorApplication(client, id, req.user?.id);
        if (!owned.application || !owned.isAssociated) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
        if (!owned.isOperator) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Only the assigned operator can remove candidate locations.',
            code: 'franchise_operator_only',
          });
        }
      } else {
        const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
        if (!exists.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
      }
      const { rows: found } = await client.query(
        `SELECT * FROM franchise_candidate_locations WHERE id = $1 AND application_id = $2`,
        [candidateId, id]
      );
      const candidate = found[0] || null;
      if (!candidate) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Candidate location not found.', code: 'candidate_not_found' });
      }
      const locked = !asAdmin
        ? candidate.status !== 'scouting'
        : candidate.status === 'approved';
      if (locked) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'This candidate location can no longer be removed.',
          code: 'candidate_delete_locked',
        });
      }
      await client.query(
        `DELETE FROM franchise_candidate_locations WHERE id = $1`, [candidateId]
      );
      await logActivity(client, id, req.user?.id || null, 'candidate_location_removed',
        `Candidate location removed: "${candidate.proposed_name}".`,
        { candidate_location_id: candidateId });
      await client.query('COMMIT');
      return res.json({ candidate_locations: await buildCandidateLocations(id) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error removing franchise candidate location', { id, candidateId, err: err.message });
    return res.status(500).json({ error: 'Failed to remove candidate location.' });
  }
}

async function deleteCandidateLocationAsAdmin(req, res) {
  return deleteCandidateLocation(req, res, { asAdmin: true });
}

// 637 (D-337): the territory capacity view — a structured per-area
// capacity view, NOT a geographic map (D-294: the boundary is a
// structured area list). For each boundary area: the HQ-set target
// location count, the open/planned locations matched to the area, the
// candidates in each status, the staffing load (opening-team members +
// managers on those locations), and the open-exception load. Matching is
// by city first, then region, then country (case-insensitive); locations
// and candidates that match no area land in the unassigned bucket.
// Everything here is derived on read from existing territory data — the
// only stored figure is the HQ target per area.
function matchAreaId(area, place) {
  const norm = (value) => String(value || '').trim().toLowerCase();
  const city = norm(place.city);
  const region = norm(place.region);
  const country = norm(place.country);
  if (city && norm(area.city) === city) return 3;
  if (region && !area.city && norm(area.region) === region) return 2;
  if (country && !area.city && !area.region && norm(area.country) === country) return 1;
  return 0;
}

async function buildTerritoryCapacity(applicationId) {
  const [areaResult, targetResult, exceptionResult] = await Promise.all([
    db.query(
      `SELECT * FROM franchise_territory_areas
        WHERE application_id = $1
        ORDER BY sort_order ASC, id ASC`,
      [applicationId]
    ),
    db.query(
      `SELECT * FROM franchise_capacity_targets WHERE application_id = $1`,
      [applicationId]
    ),
    db.query(
      `SELECT franchise_location_id AS location_id,
              COUNT(*) FILTER (WHERE status IN ${EXCEPTION_OPEN_SQL})::int AS open_count
         FROM support_tickets
        WHERE franchise_application_id = $1 AND franchise_location_id IS NOT NULL
        GROUP BY franchise_location_id`,
      [applicationId]
    ),
  ]);
  const areas = areaResult.rows;
  const includedAreas = areas.filter((area) => area.area_type === 'included');
  const targetsByArea = new Map(
    targetResult.rows.map((row) => [String(row.area_id), row.target_locations])
  );
  const exceptionsByLocation = new Map(
    exceptionResult.rows.map((row) => [String(row.location_id), row.open_count])
  );
  const locations = await fetchOpenLocations(applicationId);
  const candidates = await fetchCandidateLocations(applicationId);

  const emptyCounts = () => ({
    open_locations: 0,
    planned_locations: 0,
    team_members: 0,
    managers: 0,
    open_exceptions: 0,
    candidates: { total: 0, scouting: 0, shortlisted: 0, approved: 0, rejected: 0 },
  });
  const areaViews = areas.map((area) => ({
    area_id: area.id,
    country: area.country,
    region: area.region,
    city: area.city,
    area_type: area.area_type,
    target_locations: targetsByArea.get(String(area.id)) ?? null,
    utilization_pct: null,
    ...emptyCounts(),
  }));
  const areaById = new Map(areaViews.map((view) => [String(view.area_id), view]));
  const unassigned = {
    area_id: null,
    country: null,
    region: null,
    city: null,
    area_type: 'unassigned',
    target_locations: null,
    utilization_pct: null,
    ...emptyCounts(),
  };
  const matchView = (place) => {
    let best = null;
    let bestScore = 0;
    for (const area of includedAreas) {
      const score = matchAreaId(area, place);
      if (score > bestScore) {
        bestScore = score;
        best = areaById.get(String(area.id));
      }
    }
    return best || unassigned;
  };

  let territoryTeam = 0;
  for (const location of locations) {
    const view = matchView(location);
    if (location.status === 'launched') view.open_locations += 1;
    else view.planned_locations += 1;
    view.team_members += (location.opening_team || []).length;
    if (location.manager) view.managers += 1;
    view.open_exceptions += exceptionsByLocation.get(String(location.id)) || 0;
  }
  // The territory-wide opening team (no location) belongs to no single
  // area: it counts in the territory totals only, never in an area.
  const territoryWideTeam = await fetchTerritoryOpeningTeam(applicationId);
  territoryTeam = territoryWideTeam.length;
  for (const candidate of candidates) {
    const view = matchView(candidate);
    view.candidates.total += 1;
    if (Object.prototype.hasOwnProperty.call(view.candidates, candidate.status)) {
      view.candidates[candidate.status] += 1;
    }
  }
  const finishView = (view) => {
    const committed = view.open_locations + view.candidates.approved;
    view.utilization_pct = view.target_locations
      ? Math.round((committed / view.target_locations) * 100)
      : null;
    return view;
  };
  const views = [...areaViews.map(finishView), finishView(unassigned)];
  const sum = (pick) => views.reduce((total, view) => total + pick(view), 0);
  const targetTotal = areaViews.reduce((total, view) => total + (view.target_locations || 0), 0);
  const openTotal = sum((view) => view.open_locations);
  const approvedTotal = sum((view) => view.candidates.approved);
  return {
    application_id: applicationId,
    areas: views,
    totals: {
      areas: includedAreas.length,
      target_locations: targetTotal || null,
      open_locations: openTotal,
      planned_locations: sum((view) => view.planned_locations),
      candidates: {
        total: sum((view) => view.candidates.total),
        scouting: sum((view) => view.candidates.scouting),
        shortlisted: sum((view) => view.candidates.shortlisted),
        approved: approvedTotal,
        rejected: sum((view) => view.candidates.rejected),
      },
      team_members: sum((view) => view.team_members) + territoryTeam,
      territory_team_members: territoryTeam,
      managers: sum((view) => view.managers),
      open_exceptions: sum((view) => view.open_exceptions),
      utilization_pct: targetTotal
        ? Math.round(((openTotal + approvedTotal) / targetTotal) * 100)
        : null,
    },
  };
}

async function getTerritoryCapacity(req, res, { asAdmin = false } = {}) {
  const { id } = req.params;
  try {
    if (!asAdmin) {
      const client = await db.connect();
      try {
        const owned = await loadOperatorApplication(client, id, req.user?.id);
        if (!owned.application || !owned.isAssociated) {
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
        if (!owned.isOperator) {
          return res.status(403).json({
            error: 'Only the assigned operator can view territory capacity.',
            code: 'franchise_operator_only',
          });
        }
      } finally {
        client.release();
      }
    } else {
      const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!rows.length) {
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
    }
    return res.json(await buildTerritoryCapacity(id));
  } catch (err) {
    logger.error('Error loading franchise territory capacity', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to load territory capacity.' });
  }
}

async function getTerritoryCapacityAsAdmin(req, res) {
  return getTerritoryCapacity(req, res, { asAdmin: true });
}

// 637 (D-337): HQ sets the target location count for one structured
// boundary area. Upsert: setting a target again replaces it. The target
// is a planning figure only — it never gates launches or approvals.
async function setCapacityTargetAsAdmin(req, res) {
  const { id } = req.params;
  const areaId = asTrimmed(req.body?.area_id);
  const target = req.body?.target_locations;
  if (!areaId || !UUID_RE.test(areaId)) {
    return res.status(404).json({ error: 'Territory area not found.', code: 'area_not_found' });
  }
  if (!Number.isInteger(target) || target < 1 || target > 1000) {
    return res.status(400).json({
      error: 'target_locations must be a whole number between 1 and 1000.',
      code: 'invalid_capacity_target',
    });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const { rows: areaRows } = await client.query(
        `SELECT * FROM franchise_territory_areas WHERE id = $1 AND application_id = $2`,
        [areaId, id]
      );
      if (!areaRows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Territory area not found.', code: 'area_not_found' });
      }
      const { rows } = await client.query(
        `INSERT INTO franchise_capacity_targets
           (application_id, area_id, target_locations, set_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (application_id, area_id)
         DO UPDATE SET target_locations = EXCLUDED.target_locations,
                       set_by = EXCLUDED.set_by,
                       updated_at = NOW()
         RETURNING *`,
        [id, areaId, target, req.user?.id || null]
      );
      await logActivity(client, id, req.user?.id || null, 'capacity_target_set',
        `HQ set the capacity target for ${[areaRows[0].city, areaRows[0].region, areaRows[0].country].filter(Boolean).join(', ')} to ${target} locations.`,
        { area_id: areaId, target_locations: target });
      await client.query('COMMIT');
      return res.json({ capacity_target: rows[0], territory_capacity: await buildTerritoryCapacity(id) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error setting franchise capacity target', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to set capacity target.' });
  }
}

// 638 (D-338): the training resource planner — who needs what training
// by when, and how much of the required training is covered. Derived on
// read from the territory's training assignments (618), its roster, and
// the Learn program catalogue: no second training system is built
// (D-292/D-317). A member's required training is the set of modules
// assigned to them; a location's required training is the set assigned
// for that location (territory-wide assignments count for every
// location's team). Learn programs link by category: an assignment
// category that matches an active Learn program category surfaces that
// program as the place to take the training. Overdue means a due date in
// the past on an assignment that is not completed.
function trainingPlannerDateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

async function buildTrainingPlanner(applicationId) {
  const [members, assignments, locations, programs] = await Promise.all([
    fetchTerritoryMembers(applicationId),
    fetchTrainingAssignments(applicationId),
    fetchOpenLocations(applicationId),
    db.query(
      `SELECT slug, category FROM learn_programs WHERE is_active = TRUE ORDER BY slug ASC`
    ).then((result) => result.rows),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const programsByCategory = new Map();
  for (const program of programs) {
    if (!programsByCategory.has(program.category)) programsByCategory.set(program.category, []);
    programsByCategory.get(program.category).push(program.slug);
  }
  const memberById = new Map(members.map((member) => [String(member.user_id), member]));
  const presentAssignment = (assignment) => {
    const dueDate = trainingPlannerDateOnly(assignment.due_date);
    return {
      id: assignment.id,
      location_id: assignment.location_id,
      assignee_user_id: assignment.assignee_user_id,
      assignee_name: [assignment.assignee_first_name, assignment.assignee_last_name].filter(Boolean).join(' ')
        || assignment.assignee_email || null,
      module_id: assignment.module_id,
      module_title: assignment.module_title,
      category: assignment.category,
      learn_programs: assignment.category ? (programsByCategory.get(assignment.category) || []) : [],
      due_date: dueDate,
      status: assignment.status,
      overdue: Boolean(dueDate) && dueDate < today && assignment.status !== 'completed',
      completed_at: assignment.completed_at || null,
    };
  };
  const presented = assignments.map(presentAssignment);
  const byMember = new Map(members.map((member) => [String(member.user_id), []]));
  for (const assignment of presented) {
    if (byMember.has(String(assignment.assignee_user_id))) {
      byMember.get(String(assignment.assignee_user_id)).push(assignment);
    }
  }
  const memberPlans = members.map((member) => {
    const mine = byMember.get(String(member.user_id)) || [];
    const dueDates = mine.filter((a) => a.due_date).map((a) => a.due_date).sort();
    return {
      user_id: member.user_id,
      name: member.name,
      email: member.email,
      kind: member.kind,
      assignments: mine,
      assigned: mine.filter((a) => a.status === 'assigned').length,
      in_progress: mine.filter((a) => a.status === 'in_progress').length,
      completed: mine.filter((a) => a.status === 'completed').length,
      overdue: mine.filter((a) => a.overdue).length,
      next_due_date: dueDates[0] || null,
      has_no_training: mine.length === 0,
    };
  });
  const locationPlans = locations.map((location) => {
    const team = [
      ...(location.opening_team || []).map((row) => ({
        user_id: row.helper_user_id,
        name: [row.helper_first_name, row.helper_last_name].filter(Boolean).join(' ') || row.helper_email,
        role: row.role,
      })),
    ];
    if (location.manager) {
      team.push({ user_id: location.manager.manager_user_id, name: location.manager.name, role: 'manager' });
    }
    const teamIds = new Set(team.map((row) => String(row.user_id)));
    const forLocation = presented.filter((a) => String(a.location_id) === String(location.id));
    const territoryWide = presented.filter((a) => !a.location_id);
    // A location's required training is everything assigned for that
    // location, plus the territory-wide assignments of its own team.
    const teamAssignments = [
      ...forLocation,
      ...territoryWide.filter((a) => teamIds.has(String(a.assignee_user_id))),
    ];
    const modules = [...new Set(teamAssignments.map((a) => a.module_title))];
    const withoutTraining = team.filter((row) => !(byMember.get(String(row.user_id)) || []).length)
      .map((row) => ({ user_id: row.user_id, name: row.name }));
    const total = teamAssignments.length;
    const done = teamAssignments.filter((a) => a.status === 'completed').length;
    return {
      location_id: location.id,
      location_name: location.name,
      status: location.status,
      team,
      team_size: team.length,
      assignments: { total, completed: done, overdue: teamAssignments.filter((a) => a.overdue).length },
      completion_pct: total ? Math.round((done / total) * 100) : null,
      modules,
      members_without_training: withoutTraining,
    };
  });
  const modulesByTitle = new Map();
  for (const assignment of presented) {
    if (!modulesByTitle.has(assignment.module_title)) {
      modulesByTitle.set(assignment.module_title, {
        module_title: assignment.module_title,
        category: assignment.category,
        learn_programs: assignment.learn_programs,
        assignees: [],
        completed: 0,
      });
    }
    const row = modulesByTitle.get(assignment.module_title);
    if (!row.assignees.some((a) => String(a.user_id) === String(assignment.assignee_user_id))) {
      row.assignees.push({ user_id: assignment.assignee_user_id, name: assignment.assignee_name });
    }
    if (assignment.status === 'completed') row.completed += 1;
  }
  const modulePlans = [...modulesByTitle.values()].map((row) => ({
    ...row,
    assigned: row.assignees.length,
    coverage_pct: row.assignees.length
      ? Math.round((row.completed / presented.filter((a) => a.module_title === row.module_title).length) * 100)
      : null,
  }));
  const gaps = [];
  for (const member of memberPlans) {
    if (member.has_no_training) {
      gaps.push({ kind: 'no_training', user_id: member.user_id, name: member.name, detail: null });
    }
    for (const assignment of member.assignments.filter((a) => a.overdue)) {
      gaps.push({
        kind: 'overdue',
        user_id: member.user_id,
        name: member.name,
        detail: `${assignment.module_title} (due ${assignment.due_date})`,
      });
    }
  }
  const total = presented.length;
  const completed = presented.filter((a) => a.status === 'completed').length;
  return {
    application_id: applicationId,
    totals: {
      members: members.length,
      assignments: total,
      completed,
      completion_pct: total ? Math.round((completed / total) * 100) : null,
      overdue: presented.filter((a) => a.overdue).length,
      members_without_training: memberPlans.filter((m) => m.has_no_training).length,
    },
    members: memberPlans,
    locations: locationPlans,
    modules: modulePlans,
    gaps,
    learn_programs: programs.map((program) => ({ slug: program.slug, category: program.category })),
  };
}

async function getTrainingPlanner(req, res, { asAdmin = false } = {}) {
  const { id } = req.params;
  try {
    if (!asAdmin) {
      const client = await db.connect();
      try {
        const owned = await loadOperatorApplication(client, id, req.user?.id);
        if (!owned.application || !owned.isAssociated) {
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
        if (!owned.isOperator) {
          return res.status(403).json({
            error: 'Only the assigned operator can view the training planner.',
            code: 'franchise_operator_only',
          });
        }
      } finally {
        client.release();
      }
    } else {
      const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!rows.length) {
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
    }
    return res.json(await buildTrainingPlanner(id));
  } catch (err) {
    logger.error('Error loading franchise training planner', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to load training planner.' });
  }
}

async function getTrainingPlannerAsAdmin(req, res) {
  return getTrainingPlanner(req, res, { asAdmin: true });
}

// 639 (D-339): the launch dependency overview — per location, the
// dependencies a launch needs (agreement, training, staffing,
// milestones, compliance, readiness, services, exceptions), each with a
// blocked/pending/satisfied status derived from existing state. There is
// no dependency graph store: every dependency reads the state its own
// slice already owns (609/611/613/614/617/618/624/628), so the overview
// can never drift from it. A dependency is `blocked` only when it stops
// a launch (unsigned agreement, a blocked milestone, no available
// service, an open urgent exception); anything merely incomplete is
// `pending`. A location is ready to launch only when every dependency
// is satisfied.
async function buildLaunchDependencies(applicationId) {
  const { rows: [application] } = await db.query(
    `SELECT agreement_status, launch_readiness_status
       FROM franchise_applications WHERE id = $1`,
    [applicationId]
  );
  const [locations, assignments, standards] = await Promise.all([
    fetchOpenLocations(applicationId),
    fetchTrainingAssignments(applicationId),
    fetchFranchiseStandards(applicationId),
  ]);
  const standardsDone = (standards || []).length === 0
    || (standards || []).every((standard) => standard.member_count > 0
      && (standard.acknowledged_count ?? 0) >= standard.member_count);
  const agreementSatisfied = ['signed', 'waived'].includes(application?.agreement_status);
  const readinessSatisfied = ['ready', 'launched'].includes(application?.launch_readiness_status);

  const locationViews = locations.map((location) => {
    const milestones = location.milestones || [];
    const services = location.services || [];
    const team = location.opening_team || [];
    const teamIds = new Set(team.map((row) => String(row.helper_user_id)));
    const locationAssignments = assignments.filter(
      (a) => String(a.location_id) === String(location.id)
    );
    const teamWideAssignments = assignments.filter(
      (a) => !a.location_id && teamIds.has(String(a.assignee_user_id))
    );
    const training = [...locationAssignments, ...teamWideAssignments];
    const trainingDone = training.length > 0 && training.every((a) => a.status === 'completed');
    const trainingPending = training.length > 0 && !trainingDone;
    const milestonesBlocked = milestones.filter((m) => m.status === 'blocked').length;
    const milestonesDone = milestones.length > 0 && milestones.every((m) => m.status === 'completed');
    const servicesAvailable = services.filter((s) => s.available).length;

    const dependencies = [
      {
        code: 'agreement',
        status: agreementSatisfied ? 'satisfied' : 'blocked',
        blocks_launch: !agreementSatisfied,
        detail: agreementSatisfied
          ? `Agreement ${application.agreement_status}.`
          : `Agreement is ${application?.agreement_status || 'not set'}; it must be signed or waived before launch.`,
      },
      {
        code: 'training',
        status: trainingDone ? 'satisfied' : 'pending',
        blocks_launch: false,
        detail: training.length === 0
          ? 'No training assigned for this location yet.'
          : trainingPending
            ? `${training.filter((a) => a.status === 'completed').length}/${training.length} training assignments completed.`
            : `${training.length}/${training.length} training assignments completed.`,
      },
      {
        code: 'staffing',
        status: location.manager && team.length > 0 ? 'satisfied' : 'pending',
        blocks_launch: false,
        detail: location.manager && team.length > 0
          ? `Manager assigned with ${team.length} opening-team member(s).`
          : !location.manager && team.length === 0
            ? 'No manager and no opening team assigned yet.'
            : !location.manager
              ? 'No manager assigned yet.'
              : 'No opening team assigned yet.',
      },
      {
        code: 'milestones',
        status: milestonesBlocked > 0 ? 'blocked' : milestonesDone ? 'satisfied' : 'pending',
        blocks_launch: milestonesBlocked > 0,
        detail: milestones.length === 0
          ? 'No launch milestones for this location yet.'
          : milestonesBlocked > 0
            ? `${milestonesBlocked} milestone(s) blocked.`
            : `${milestones.filter((m) => m.status === 'completed').length}/${milestones.length} milestones completed.`,
      },
      {
        code: 'compliance',
        status: standardsDone ? 'satisfied' : 'pending',
        blocks_launch: false,
        detail: (standards || []).length === 0
          ? 'No franchise standards curated for this territory yet.'
          : standardsDone
            ? 'Every member acknowledged every current standard.'
            : 'Not every member acknowledged every current standard yet.',
      },
      {
        code: 'readiness',
        status: readinessSatisfied ? 'satisfied' : 'pending',
        blocks_launch: false,
        detail: readinessSatisfied
          ? `Launch readiness is ${application.launch_readiness_status}.`
          : `Launch readiness is ${application?.launch_readiness_status || 'not set'}; a passed HQ review is required.`,
      },
      {
        code: 'services',
        status: servicesAvailable > 0 ? 'satisfied' : 'blocked',
        blocks_launch: servicesAvailable === 0,
        detail: servicesAvailable > 0
          ? `${servicesAvailable}/${services.length} service(s) available.`
          : 'No service is available at this location yet.',
      },
      {
        code: 'exceptions',
        // Finished below from the ticket aggregation: an open urgent or
        // high exception blocks the launch, any other open exception is
        // pending, none is satisfied.
        status: 'pending',
        blocks_launch: false,
        detail: '',
      },
    ];
    return { location, dependencies };
  });

  // Exceptions are not on the location bundle rows, so fetch them here
  // (the same aggregation buildLocationHealth uses) and finish the
  // exception dependency per location.
  const { rows: exceptionRows } = await db.query(
    `SELECT franchise_location_id AS location_id,
            COUNT(*) FILTER (WHERE status IN ${EXCEPTION_OPEN_SQL})::int AS open_count,
            COUNT(*) FILTER (WHERE status IN ${EXCEPTION_OPEN_SQL}
                               AND priority IN ('urgent', 'high'))::int AS open_urgent_count
       FROM support_tickets
      WHERE franchise_application_id = $1 AND franchise_location_id IS NOT NULL
      GROUP BY franchise_location_id`,
    [applicationId]
  );
  const exceptionsByLocation = new Map(
    exceptionRows.map((row) => [String(row.location_id), row])
  );
  const views = locationViews.map(({ location, dependencies }) => {
    const counts = exceptionsByLocation.get(String(location.id))
      || { open_count: 0, open_urgent_count: 0 };
    const exceptionDep = dependencies.find((d) => d.code === 'exceptions');
    exceptionDep.status = counts.open_urgent_count > 0
      ? 'blocked'
      : counts.open_count > 0 ? 'pending' : 'satisfied';
    exceptionDep.blocks_launch = counts.open_urgent_count > 0;
    exceptionDep.detail = counts.open_count === 0
      ? 'No open exceptions linked to this location.'
      : counts.open_urgent_count > 0
        ? `${counts.open_urgent_count} open urgent or high exception(s) linked to this location.`
        : `${counts.open_count} open exception(s) linked to this location.`;
    const blocked = dependencies.filter((d) => d.status === 'blocked').map((d) => d.code);
    const pending = dependencies.filter((d) => d.status === 'pending').map((d) => d.code);
    const overall = blocked.length > 0
      ? 'blocked'
      : pending.length > 0 ? 'pending' : 'ready';
    return {
      location_id: location.id,
      location_name: location.name,
      location_status: location.status,
      launch_complete: location.launch_complete,
      overall,
      ready_to_launch: overall === 'ready',
      blocked_dependencies: blocked,
      pending_dependencies: pending,
      dependencies,
    };
  });
  return {
    application_id: applicationId,
    total: views.length,
    ready: views.filter((v) => v.overall === 'ready').length,
    pending: views.filter((v) => v.overall === 'pending').length,
    blocked: views.filter((v) => v.overall === 'blocked').length,
    locations: views,
  };
}

async function getLaunchDependencies(req, res, { asAdmin = false } = {}) {
  const { id } = req.params;
  try {
    if (!asAdmin) {
      const client = await db.connect();
      try {
        const owned = await loadOperatorApplication(client, id, req.user?.id);
        if (!owned.application || !owned.isAssociated) {
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
        if (!owned.isOperator) {
          return res.status(403).json({
            error: 'Only the assigned operator can view launch dependencies.',
            code: 'franchise_operator_only',
          });
        }
      } finally {
        client.release();
      }
    } else {
      const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!rows.length) {
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
    }
    return res.json(await buildLaunchDependencies(id));
  } catch (err) {
    logger.error('Error loading franchise launch dependencies', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to load launch dependencies.' });
  }
}

async function getLaunchDependenciesAsAdmin(req, res) {
  return getLaunchDependencies(req, res, { asAdmin: true });
}

// 640 (D-340): expansion readiness notes. The admin readiness fields
// (risk_notes, hq_recommendation, market_assessment) already exist on
// the application and are HQ-written; this is the missing half —
// operator-authored notes per territory (location_id NULL) or per
// location, stored in franchise_expansion_notes. The admin fields are
// NOT duplicated here: the operator detail carries them read-only as
// hq_readiness_notes, and HQ reads both sets in one view. Notes belong
// to the territory, so the assigned operator may edit or remove any of
// them; HQ never writes operator notes.
async function fetchExpansionNotes(applicationId) {
  const { rows } = await db.query(
    `SELECT n.*, l.name AS location_name,
            u.first_name AS author_first_name, u.last_name AS author_last_name,
            u.email AS author_email
       FROM franchise_expansion_notes n
       LEFT JOIN franchise_locations l ON l.id = n.location_id
       LEFT JOIN users u ON u.id = n.author_user_id
      WHERE n.application_id = $1
      ORDER BY n.created_at DESC, n.id DESC`,
    [applicationId]
  );
  return rows.map((row) => ({
    id: row.id,
    application_id: row.application_id,
    location_id: row.location_id,
    location_name: row.location_name || null,
    author_user_id: row.author_user_id,
    author_name: [row.author_first_name, row.author_last_name].filter(Boolean).join(' ')
      || row.author_email || null,
    body: row.body,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

async function buildExpansionNotes(applicationId) {
  const notes = await fetchExpansionNotes(applicationId);
  return { application_id: applicationId, total: notes.length, notes };
}

function validateExpansionNoteBody(body) {
  const text = asTrimmed(body?.body);
  if (!text) return { error: { status: 400, body: { error: 'body is required.', code: 'expansion_note_body_required' } } };
  if (text.length > 2000) return { error: { status: 400, body: { error: 'body must be at most 2000 characters.', code: 'expansion_note_too_long' } } };
  return { value: text };
}

async function createExpansionNote(req, res) {
  const validated = validateExpansionNoteBody(req.body);
  if (validated.error) return res.status(validated.error.status).json(validated.error.body);
  const { id } = req.params;
  const locationId = asTrimmed(req.body?.location_id) || null;
  if (locationId && !UUID_RE.test(locationId)) {
    return res.status(404).json({ error: 'Franchise location not found.', code: 'location_not_found' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can record expansion readiness notes.',
          code: 'franchise_operator_only',
        });
      }
      if (locationId) {
        const location = await loadLocation(client, id, locationId);
        if (!location) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise location not found.', code: 'location_not_found' });
        }
      }
      const { rows } = await client.query(
        `INSERT INTO franchise_expansion_notes
           (application_id, location_id, author_user_id, body)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [id, locationId, req.user?.id || null, validated.value]
      );
      await logActivity(client, id, req.user?.id || null, 'expansion_note_added',
        locationId ? 'Operator added an expansion readiness note for a location.' : 'Operator added an expansion readiness note for the territory.',
        { expansion_note_id: rows[0].id, location_id: locationId });
      await client.query('COMMIT');
      const expansionNotes = await buildExpansionNotes(id);
      const created = expansionNotes.notes.find((row) => row.id === rows[0].id) || rows[0];
      return res.status(201).json({ expansion_note: created, expansion_notes: expansionNotes });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error adding franchise expansion note', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to add expansion note.' });
  }
}

async function getExpansionNotes(req, res, { asAdmin = false } = {}) {
  const { id } = req.params;
  try {
    if (!asAdmin) {
      const client = await db.connect();
      try {
        const viewer = await loadTerritoryViewer(client, id, req.user?.id);
        const blocked = territoryReadScope(viewer);
        if (blocked) return res.status(blocked.status).json(blocked.body);
      } finally {
        client.release();
      }
    } else {
      const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!rows.length) {
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
    }
    return res.json(await buildExpansionNotes(id));
  } catch (err) {
    logger.error('Error loading franchise expansion notes', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to load expansion notes.' });
  }
}

async function getExpansionNotesAsAdmin(req, res) {
  return getExpansionNotes(req, res, { asAdmin: true });
}

async function updateExpansionNote(req, res) {
  const validated = validateExpansionNoteBody(req.body);
  if (validated.error) return res.status(validated.error.status).json(validated.error.body);
  const { id, noteId } = req.params;
  if (!UUID_RE.test(noteId)) {
    return res.status(404).json({ error: 'Expansion note not found.', code: 'expansion_note_not_found' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can edit expansion readiness notes.',
          code: 'franchise_operator_only',
        });
      }
      const { rows } = await client.query(
        `UPDATE franchise_expansion_notes
            SET body = $2, updated_at = NOW()
          WHERE id = $1 AND application_id = $3
          RETURNING *`,
        [noteId, validated.value, id]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Expansion note not found.', code: 'expansion_note_not_found' });
      }
      await client.query('COMMIT');
      const expansionNotes = await buildExpansionNotes(id);
      const updated = expansionNotes.notes.find((row) => row.id === noteId) || rows[0];
      return res.json({ expansion_note: updated, expansion_notes: expansionNotes });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error updating franchise expansion note', { id, noteId, err: err.message });
    return res.status(500).json({ error: 'Failed to update expansion note.' });
  }
}

async function deleteExpansionNote(req, res) {
  const { id, noteId } = req.params;
  if (!UUID_RE.test(noteId)) {
    return res.status(404).json({ error: 'Expansion note not found.', code: 'expansion_note_not_found' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can remove expansion readiness notes.',
          code: 'franchise_operator_only',
        });
      }
      const { rows } = await client.query(
        `DELETE FROM franchise_expansion_notes
          WHERE id = $1 AND application_id = $2 RETURNING id`,
        [noteId, id]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Expansion note not found.', code: 'expansion_note_not_found' });
      }
      await logActivity(client, id, req.user?.id || null, 'expansion_note_removed',
        'Operator removed an expansion readiness note.', { expansion_note_id: noteId });
      await client.query('COMMIT');
      return res.json({ expansion_notes: await buildExpansionNotes(id) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error removing franchise expansion note', { id, noteId, err: err.message });
    return res.status(500).json({ error: 'Failed to remove expansion note.' });
  }
}

// ── Group 12 Slice 3i (641-645, D-341..D-346): transition ────────────────
// One operator handoff flow: the outgoing operator initiates (641), HQ
// approves or rejects; only approval transfers open issues (642), hands
// the records over by access/visibility (644), and revokes the outgoing
// operator's access through syncFranchiseGrant (645). The contact
// directory (643) is operator-maintained; explicit HQ removal of a
// territory member's access (645) is audited separately.

const HANDOFF_STATUSES = new Set(['pending', 'approved', 'rejected', 'cancelled']);
const HANDOFF_ACTIVE_STATUSES = new Set(['approved', 'launched']);

// 641 (D-341): the handoff checklist is derived on read from live state —
// open exceptions, open corrective actions, unacknowledged standards
// (team perspective), pending training, open locations — never stored, so
// it can never drift. The approval transaction snapshots it onto the
// handoff row as the audit record.
async function buildHandoffChecklist(applicationId) {
  const [exceptionSummary, standards, trainingResult, locationResult, actionResult] = await Promise.all([
    buildExceptionSummary(applicationId),
    fetchFranchiseStandards(applicationId),
    db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status <> 'completed')::int AS pending
         FROM franchise_training_assignments WHERE application_id = $1`,
      [applicationId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'planned')::int AS planned
         FROM franchise_locations WHERE application_id = $1`,
      [applicationId]
    ),
    db.query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('open', 'in_progress'))::int AS open_count,
              COUNT(*) FILTER (WHERE status = 'resolved')::int AS awaiting_verification
         FROM franchise_corrective_actions WHERE application_id = $1`,
      [applicationId]
    ),
  ]);
  const compliance = buildComplianceChecklist({
    standards,
    readinessStatus: null,
    perspective: 'team',
  });
  const unacknowledged = compliance.items
    .filter((item) => item.kind === 'standard' && !item.done).length;
  const training = trainingResult.rows[0] || {};
  const locations = locationResult.rows[0] || {};
  const actions = actionResult.rows[0] || {};
  const items = [
    {
      code: 'open_exceptions',
      count: exceptionSummary.open_count || 0,
      open_urgent_count: exceptionSummary.open_urgent_count || 0,
      total: exceptionSummary.total || 0,
    },
    {
      code: 'open_corrective_actions',
      count: actions.open_count || 0,
      awaiting_verification: actions.awaiting_verification || 0,
    },
    {
      code: 'unacknowledged_standards',
      count: unacknowledged,
      total_standards: (standards || []).length,
    },
    {
      code: 'pending_training',
      count: training.pending || 0,
      total: training.total || 0,
    },
    {
      code: 'open_locations',
      count: locations.planned || 0,
      total: locations.total || 0,
    },
  ];
  return {
    items,
    open_count: items.reduce((sum, item) => sum + (item.count || 0), 0),
  };
}

// 644 (D-344): the records manifest — counts of the territory's records at
// transfer time. No file is moved or duplicated: the manifest plus the
// handoff row is the audit trail, and the incoming operator sees the same
// per-application records once they become owner.
async function buildRecordsManifest(client, applicationId) {
  const count = async (sql) => {
    const { rows } = await client.query(sql, [applicationId]);
    return rows[0]?.n || 0;
  };
  const [documents, acknowledgments, training, exceptions, notes, activity] = await Promise.all([
    count('SELECT COUNT(*)::int AS n FROM franchise_application_documents WHERE application_id = $1'),
    // Acknowledgments carry no application id: they hang off the standard,
    // so count the ones on this territory's own standards.
    count(`SELECT COUNT(*)::int AS n FROM franchise_standard_acknowledgments a
            JOIN franchise_standards s ON s.id = a.standard_id
           WHERE s.application_id = $1`),
    count('SELECT COUNT(*)::int AS n FROM franchise_training_assignments WHERE application_id = $1'),
    count('SELECT COUNT(*)::int AS n FROM support_tickets WHERE franchise_application_id = $1'),
    count('SELECT COUNT(*)::int AS n FROM franchise_expansion_notes WHERE application_id = $1'),
    count('SELECT COUNT(*)::int AS n FROM franchise_activity_log WHERE application_id = $1'),
  ]);
  return { documents, standard_acknowledgments: acknowledgments, training_assignments: training, exceptions, expansion_notes: notes, activity_entries: activity };
}

function presentHandoff(row) {
  return {
    id: row.id,
    application_id: row.application_id,
    outgoing_operator_id: row.outgoing_operator_id,
    outgoing_operator_name: [row.outgoing_first_name, row.outgoing_last_name].filter(Boolean).join(' ') || row.outgoing_email || null,
    outgoing_operator_email: row.outgoing_email || null,
    incoming_operator_id: row.incoming_operator_id,
    incoming_operator_name: [row.incoming_first_name, row.incoming_last_name].filter(Boolean).join(' ') || row.incoming_email || null,
    incoming_operator_email: row.incoming_email || null,
    status: row.status,
    reason: row.reason,
    checklist_snapshot: row.checklist_snapshot || null,
    records_snapshot: row.records_snapshot || null,
    decided_by: row.decided_by,
    decided_by_name: [row.decided_first_name, row.decided_last_name].filter(Boolean).join(' ') || row.decided_email || null,
    decided_at: row.decided_at,
    decision_reason: row.decision_reason,
    completed_at: row.completed_at,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function fetchHandoffs(applicationId, { partyUserId = null } = {}) {
  const conditions = ['h.application_id = $1'];
  const params = [applicationId];
  if (partyUserId) {
    params.push(partyUserId);
    conditions.push(`(h.outgoing_operator_id = $2 OR h.incoming_operator_id = $2)`);
  }
  const { rows } = await db.query(
    `SELECT h.*,
            o.first_name AS outgoing_first_name, o.last_name AS outgoing_last_name, o.email AS outgoing_email,
            i.first_name AS incoming_first_name, i.last_name AS incoming_last_name, i.email AS incoming_email,
            d.first_name AS decided_first_name, d.last_name AS decided_last_name, d.email AS decided_email
       FROM franchise_handoffs h
       LEFT JOIN users o ON o.id = h.outgoing_operator_id
       LEFT JOIN users i ON i.id = h.incoming_operator_id
       LEFT JOIN users d ON d.id = h.decided_by
      WHERE ${conditions.join(' AND ')}
      ORDER BY h.created_at DESC, h.id DESC`,
    params
  );
  return Promise.all(rows.map(presentHandoff));
}

async function buildHandoffs(applicationId) {
  const handoffs = await fetchHandoffs(applicationId);
  const checklist = await buildHandoffChecklist(applicationId);
  return {
    application_id: applicationId,
    total: handoffs.length,
    pending: handoffs.filter((handoff) => handoff.status === 'pending').length,
    handoffs,
    checklist,
  };
}

async function isHandoffParty(client, applicationId, userId) {
  if (!userId) return false;
  const { rows } = await client.query(
    `SELECT 1 FROM franchise_handoffs
      WHERE application_id = $1
        AND (outgoing_operator_id = $2 OR incoming_operator_id = $2)
      LIMIT 1`,
    [applicationId, userId]
  );
  return rows.length > 0;
}

// Handoff read scope: HQ reads everything; the operator and any territory
// member read the full list; a named party (outgoing/incoming) who is
// neither reads only the handoffs naming them — the incoming operator
// sees the handoff record before approval, never the territory itself.
// A stranger gets 404, an associated non-operator applicant 403.
async function handoffReadScope(client, applicationId, userId) {
  const owned = await loadOperatorApplication(client, applicationId, userId);
  if (!owned.application) {
    if (await isHandoffParty(client, applicationId, userId)) {
      return { partyOnly: true };
    }
    return { status: 404, body: { error: 'Franchise application not found.' } };
  }
  if (owned.isOperator) return { partyOnly: false };
  if (await isTerritoryMember(client, applicationId, userId)) return { partyOnly: false };
  if (await isHandoffParty(client, applicationId, userId)) return { partyOnly: true };
  if (!owned.isAssociated) {
    return { status: 404, body: { error: 'Franchise application not found.' } };
  }
  return { status: 403, body: {
    error: 'Only the assigned operator or a territory member can view this.',
    code: 'franchise_operator_only',
  } };
}

async function loadHandoffRow(client, applicationId, handoffId) {
  const { rows } = await client.query(
    'SELECT * FROM franchise_handoffs WHERE id = $1 AND application_id = $2',
    [handoffId, applicationId]
  );
  return rows[0] || null;
}

// 641: the outgoing operator initiates a handoff to a named incoming
// operator. Initiation creates a pending record only — it grants nothing,
// changes no owner, and touches no issue. HQ approval is the only path
// that moves anything (D-341/D-346).
async function createHandoff(req, res) {
  const { id } = req.params;
  let incomingOperatorId = asTrimmed(req.body?.incoming_operator_id);
  const incomingEmail = asTrimmed(req.body?.incoming_operator_email);
  const reason = asTrimmed(req.body?.reason);
  if (!incomingOperatorId && !incomingEmail) {
    return res.status(400).json({ error: 'incoming_operator_id or incoming_operator_email is required.', code: 'handoff_incoming_required' });
  }
  if (incomingOperatorId && !UUID_RE.test(incomingOperatorId)) {
    return res.status(400).json({ error: 'incoming_operator_id is required.', code: 'handoff_incoming_required' });
  }
  if (incomingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(incomingEmail)) {
    return res.status(400).json({ error: 'incoming_operator_email must be a valid email address.', code: 'handoff_incoming_email_invalid' });
  }
  if (reason && reason.length > 1000) {
    return res.status(400).json({ error: 'reason must be at most 1000 characters.', code: 'handoff_reason_too_long' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can initiate a handoff.',
          code: 'franchise_operator_only',
        });
      }
      const { rows: appRows } = await client.query(
        'SELECT status FROM franchise_applications WHERE id = $1', [id]
      );
      if (!HANDOFF_ACTIVE_STATUSES.has(appRows[0].status)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'A handoff can only start once the territory is approved or launched.',
          code: 'handoff_territory_not_active',
        });
      }
      const { rows: userRows } = await client.query(
        incomingOperatorId
          ? 'SELECT id FROM users WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL'
          : 'SELECT id FROM users WHERE lower(email) = lower($1) AND is_active = TRUE AND deleted_at IS NULL',
        [incomingOperatorId || incomingEmail]
      );
      if (!userRows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'The incoming operator must be an active account.',
          code: 'handoff_incoming_not_found',
        });
      }
      incomingOperatorId = userRows[0].id;
      // The same-operator check runs after email resolution, so naming
      // your own email is the same 400 as naming your own id — the
      // table CHECK would otherwise turn it into a 500.
      if (String(incomingOperatorId) === String(req.user?.id)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'The incoming operator must be someone other than the outgoing operator.',
          code: 'handoff_incoming_same_operator',
        });
      }
      const { rows: pendingRows } = await client.query(
        `SELECT id FROM franchise_handoffs
          WHERE application_id = $1 AND status = 'pending' LIMIT 1`,
        [id]
      );
      if (pendingRows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'This territory already has a handoff awaiting HQ review.',
          code: 'handoff_already_pending',
        });
      }
      const { rows } = await client.query(
        `INSERT INTO franchise_handoffs
           (application_id, outgoing_operator_id, incoming_operator_id, reason, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, req.user?.id, incomingOperatorId, reason, req.user?.id || null]
      );
      await logActivity(client, id, req.user?.id || null, 'handoff_initiated',
        'Operator initiated a handoff; awaiting HQ review. Nothing has moved yet.',
        { handoff_id: rows[0].id, incoming_operator_id: incomingOperatorId });
      await client.query('COMMIT');
      const handoffs = await buildHandoffs(id);
      const handoff = handoffs.handoffs.find((row) => row.id === rows[0].id) || rows[0];
      return res.status(201).json({ handoff, handoffs });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error initiating franchise handoff', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to initiate handoff.' });
  }
}

async function getHandoffs(req, res, { asAdmin = false } = {}) {
  const { id } = req.params;
  try {
    if (!asAdmin) {
      const client = await db.connect();
      try {
        const scope = await handoffReadScope(client, id, req.user?.id);
        if (scope.status) return res.status(scope.status).json(scope.body);
        const handoffs = await fetchHandoffs(id, { partyUserId: scope.partyOnly ? req.user?.id : null });
        const checklist = await buildHandoffChecklist(id);
        return res.json({
          application_id: id,
          total: handoffs.length,
          pending: handoffs.filter((handoff) => handoff.status === 'pending').length,
          handoffs,
          checklist,
        });
      } finally {
        client.release();
      }
    }
    const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Franchise application not found.' });
    }
    return res.json(await buildHandoffs(id));
  } catch (err) {
    logger.error('Error listing franchise handoffs', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to list handoffs.' });
  }
}

async function getHandoffsAsAdmin(req, res) {
  return getHandoffs(req, res, { asAdmin: true });
}

async function getHandoff(req, res, { asAdmin = false } = {}) {
  const { id, handoffId } = req.params;
  if (!UUID_RE.test(handoffId)) {
    return res.status(404).json({ error: 'Handoff not found.', code: 'handoff_not_found' });
  }
  try {
    if (!asAdmin) {
      const client = await db.connect();
      try {
        const scope = await handoffReadScope(client, id, req.user?.id);
        if (scope.status) return res.status(scope.status).json(scope.body);
        const row = await loadHandoffRow(client, id, handoffId);
        if (!row) return res.status(404).json({ error: 'Handoff not found.', code: 'handoff_not_found' });
        if (scope.partyOnly
          && String(row.outgoing_operator_id) !== String(req.user?.id)
          && String(row.incoming_operator_id) !== String(req.user?.id)) {
          return res.status(404).json({ error: 'Handoff not found.', code: 'handoff_not_found' });
        }
        const handoffs = await fetchHandoffs(id);
        return res.json({ handoff: handoffs.find((h) => h.id === handoffId) || row });
      } finally {
        client.release();
      }
    }
    const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Franchise application not found.' });
    }
    const handoffs = await fetchHandoffs(id);
    const handoff = handoffs.find((row) => row.id === handoffId);
    if (!handoff) return res.status(404).json({ error: 'Handoff not found.', code: 'handoff_not_found' });
    return res.json({ handoff });
  } catch (err) {
    logger.error('Error loading franchise handoff', { id, handoffId, err: err.message });
    return res.status(500).json({ error: 'Failed to load handoff.' });
  }
}

async function getHandoffAsAdmin(req, res) {
  return getHandoff(req, res, { asAdmin: true });
}

// The outgoing operator (or HQ) cancels a pending handoff. Cancelling
// changes nothing else: no owner, grant, or issue ever moved while the
// handoff was pending, so there is nothing to undo.
async function cancelHandoff(req, res, { asAdmin = false } = {}) {
  const { id, handoffId } = req.params;
  if (!UUID_RE.test(handoffId)) {
    return res.status(404).json({ error: 'Handoff not found.', code: 'handoff_not_found' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (!asAdmin) {
        const owned = await loadOperatorApplication(client, id, req.user?.id);
        if (!owned.application || !owned.isAssociated) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
        if (!owned.isOperator) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Only the assigned operator can cancel a handoff.',
            code: 'franchise_operator_only',
          });
        }
      } else {
        const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
        if (!exists.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Franchise application not found.' });
        }
      }
      const row = await loadHandoffRow(client, id, handoffId);
      if (!row) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Handoff not found.', code: 'handoff_not_found' });
      }
      if (row.status !== 'pending') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Only a pending handoff can be cancelled.',
          code: 'handoff_not_pending',
        });
      }
      await client.query(
        `UPDATE franchise_handoffs
            SET status = 'cancelled', decided_by = $2, decided_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [handoffId, req.user?.id || null]
      );
      await logActivity(client, id, req.user?.id || null, 'handoff_cancelled',
        'A pending handoff was cancelled; the territory stays with its operator.',
        { handoff_id: handoffId });
      await client.query('COMMIT');
      return res.json({ handoffs: await buildHandoffs(id) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error cancelling franchise handoff', { id, handoffId, err: err.message });
    return res.status(500).json({ error: 'Failed to cancel handoff.' });
  }
}

async function cancelHandoffAsAdmin(req, res) {
  return cancelHandoff(req, res, { asAdmin: true });
}

// 642 (D-342): the transfer, executed only inside the approval
// transaction. Remediations owned by the outgoing operator move to the
// incoming operator with due dates preserved; corrective actions move
// with their remediation (their owner is derived from it); escalations
// move as a responsibility note — the ticket itself is never reassigned.
// Every moved issue writes a franchise_handoff_transfers row first.
async function executeHandoffTransfer(client, { handoffId, applicationId, outgoingId, incomingId, actorId }) {
  const transfers = [];
  const logTransfer = async (row) => {
    const { rows } = await client.query(
      `INSERT INTO franchise_handoff_transfers
         (handoff_id, application_id, kind, ticket_id, remediation_id, action_id,
          from_user_id, to_user_id, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [handoffId, applicationId, row.kind, row.ticket_id || null, row.remediation_id || null,
        row.action_id || null, row.from_user_id || null, row.to_user_id || null, row.due_date || null]
    );
    transfers.push(rows[0]);
  };

  const { rows: remediations } = await client.query(
    `SELECT * FROM franchise_remediations
      WHERE application_id = $1 AND owner_user_id = $2`,
    [applicationId, outgoingId]
  );
  for (const remediation of remediations) {
    await client.query(
      `UPDATE franchise_remediations
          SET owner_user_id = $2, assigned_by = $3, updated_at = NOW()
        WHERE id = $1`,
      [remediation.id, incomingId, actorId || null]
    );
    await logTransfer({
      kind: 'remediation',
      ticket_id: remediation.ticket_id,
      remediation_id: remediation.id,
      from_user_id: outgoingId,
      to_user_id: incomingId,
      due_date: remediation.due_date,
    });
  }
  const remediationIds = new Set(remediations.map((row) => String(row.id)));

  const { rows: actions } = await client.query(
    `SELECT a.*, r.owner_user_id AS remediation_owner
       FROM franchise_corrective_actions a
       LEFT JOIN franchise_remediations r ON r.id = a.remediation_id
      WHERE a.application_id = $1 AND a.status IN ('open', 'in_progress', 'resolved')`,
    [applicationId]
  );
  for (const action of actions) {
    if (action.remediation_id && !remediationIds.has(String(action.remediation_id))) continue;
    if (!action.remediation_id && String(action.created_by) !== String(outgoingId)) continue;
    await logTransfer({
      kind: 'corrective_action',
      ticket_id: action.ticket_id,
      remediation_id: action.remediation_id || null,
      action_id: action.id,
      from_user_id: action.remediation_id ? outgoingId : action.created_by,
      to_user_id: incomingId,
      due_date: action.remediation_id
        ? (remediations.find((r) => String(r.id) === String(action.remediation_id)) || {}).due_date || null
        : null,
    });
  }

  const { rows: escalations } = await client.query(
    `SELECT * FROM franchise_ticket_escalations
      WHERE application_id = $1 AND escalated_by = $2`,
    [applicationId, outgoingId]
  );
  for (const escalation of escalations) {
    await logTransfer({
      kind: 'escalation',
      ticket_id: escalation.ticket_id,
      from_user_id: outgoingId,
      to_user_id: incomingId,
    });
  }
  return transfers;
}

async function fetchHandoffTransfers(applicationId, handoffId) {
  const { rows } = await db.query(
    `SELECT t.*, tk.ticket_number, tk.subject,
            fu.first_name AS from_first_name, fu.last_name AS from_last_name, fu.email AS from_email,
            tu.first_name AS to_first_name, tu.last_name AS to_last_name, tu.email AS to_email
       FROM franchise_handoff_transfers t
       LEFT JOIN support_tickets tk ON tk.id = t.ticket_id
       LEFT JOIN users fu ON fu.id = t.from_user_id
       LEFT JOIN users tu ON tu.id = t.to_user_id
      WHERE t.application_id = $1 AND t.handoff_id = $2
      ORDER BY t.created_at DESC, t.id DESC`,
    [applicationId, handoffId]
  );
  return rows.map((row) => ({
    ...row,
    from_name: [row.from_first_name, row.from_last_name].filter(Boolean).join(' ') || row.from_email || null,
    to_name: [row.to_first_name, row.to_last_name].filter(Boolean).join(' ') || row.to_email || null,
  }));
}

// 641/642/644/645: HQ reviews a pending handoff. Approval executes the
// whole transition in one transaction — owner change, grant sync (the
// outgoing operator's per-territory grant is revoked here and only here),
// open-issue transfer, records manifest — so a handoff can never be
// half-applied. Rejection needs a reason and moves nothing.
async function reviewHandoffAsAdmin(req, res) {
  const { id, handoffId } = req.params;
  if (!UUID_RE.test(handoffId)) {
    return res.status(404).json({ error: 'Handoff not found.', code: 'handoff_not_found' });
  }
  const decision = asTrimmed(req.body?.decision);
  const reason = asTrimmed(req.body?.reason);
  if (decision !== 'approve' && decision !== 'reject') {
    return res.status(400).json({ error: "decision must be 'approve' or 'reject'.", code: 'invalid_handoff_decision' });
  }
  if (decision === 'reject' && !reason) {
    return res.status(400).json({ error: 'A reason is required to reject a handoff.', code: 'handoff_decision_reason_required' });
  }
  if (reason && reason.length > 1000) {
    return res.status(400).json({ error: 'reason must be at most 1000 characters.', code: 'handoff_reason_too_long' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows: appRows } = await client.query(
        'SELECT id, status, owner_user_id, linked_business_id FROM franchise_applications WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (!appRows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const application = appRows[0];
      const { rows: handoffRows } = await client.query(
        'SELECT * FROM franchise_handoffs WHERE id = $1 AND application_id = $2 FOR UPDATE',
        [handoffId, id]
      );
      if (!handoffRows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Handoff not found.', code: 'handoff_not_found' });
      }
      const handoff = handoffRows[0];
      if (handoff.status !== 'pending') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Only a pending handoff can be decided.',
          code: 'handoff_not_pending',
        });
      }
      if (String(handoff.outgoing_operator_id) !== String(application.owner_user_id)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'The outgoing operator is no longer the territory operator.',
          code: 'handoff_operator_changed',
        });
      }

      if (decision === 'reject') {
        await client.query(
          `UPDATE franchise_handoffs
              SET status = 'rejected', decided_by = $2, decided_at = NOW(),
                  decision_reason = $3, updated_at = NOW()
            WHERE id = $1`,
          [handoffId, req.user?.id || null, reason]
        );
        await logActivity(client, id, req.user?.id || null, 'handoff_rejected',
          'HQ rejected a handoff; the territory stays with its operator.',
          { handoff_id: handoffId, decision_reason: reason });
        await client.query('COMMIT');
        return res.json({ handoffs: await buildHandoffs(id) });
      }

      // Approval: re-check the incoming operator is still an active
      // account at decision time, not just at initiation time.
      const { rows: incomingRows } = await client.query(
        'SELECT id FROM users WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL',
        [handoff.incoming_operator_id]
      );
      if (!incomingRows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'The incoming operator is no longer an active account.',
          code: 'handoff_incoming_unavailable',
        });
      }
      if (!HANDOFF_ACTIVE_STATUSES.has(application.status)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'The territory is no longer approved or launched.',
          code: 'handoff_territory_not_active',
        });
      }

      const checklistSnapshot = await buildHandoffChecklist(id);
      const recordsSnapshot = await buildRecordsManifest(client, id);
      const transfers = await executeHandoffTransfer(client, {
        handoffId,
        applicationId: id,
        outgoingId: handoff.outgoing_operator_id,
        incomingId: handoff.incoming_operator_id,
        actorId: req.user?.id || null,
      });
      await client.query(
        `UPDATE franchise_applications
            SET owner_user_id = $2, updated_at = NOW()
          WHERE id = $1`,
        [id, handoff.incoming_operator_id]
      );
      await syncFranchiseGrant(client, {
        applicationId: id,
        ownerUserId: handoff.incoming_operator_id,
        status: application.status,
        linkedBusinessId: application.linked_business_id,
        actorId: req.user?.id || null,
        revokeUserIds: [handoff.outgoing_operator_id],
      });
      await client.query(
        `UPDATE franchise_handoffs
            SET status = 'approved', decided_by = $2, decided_at = NOW(),
                decision_reason = $3, checklist_snapshot = $4::jsonb,
                records_snapshot = $5::jsonb, completed_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [handoffId, req.user?.id || null, reason,
          JSON.stringify(checklistSnapshot), JSON.stringify(recordsSnapshot)]
      );
      await logActivity(client, id, req.user?.id || null, 'handoff_approved',
        `HQ approved the handoff; the territory moves to the incoming operator with ${transfers.length} open issue(s) transferred.`,
        { handoff_id: handoffId, incoming_operator_id: handoff.incoming_operator_id,
          transfers: transfers.length });
      await logActivity(client, id, req.user?.id || null, 'handoff_records_transferred',
        'Territory records (documents, acknowledgments, training, exceptions, notes) now visible to the incoming operator; no files were moved.',
        { handoff_id: handoffId, records: recordsSnapshot });
      await client.query('COMMIT');
      const handoffs = await buildHandoffs(id);
      return res.json({
        handoff: handoffs.handoffs.find((row) => row.id === handoffId),
        handoffs,
        transfers: await fetchHandoffTransfers(id, handoffId),
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error reviewing franchise handoff', { id, handoffId, err: err.message });
    return res.status(500).json({ error: 'Failed to review handoff.' });
  }
}

async function listHandoffTransfers(req, res, { asAdmin = false } = {}) {
  const { id, handoffId } = req.params;
  if (!UUID_RE.test(handoffId)) {
    return res.status(404).json({ error: 'Handoff not found.', code: 'handoff_not_found' });
  }
  try {
    if (!asAdmin) {
      const client = await db.connect();
      try {
        const scope = await handoffReadScope(client, id, req.user?.id);
        if (scope.status) return res.status(scope.status).json(scope.body);
        const row = await loadHandoffRow(client, id, handoffId);
        if (!row) return res.status(404).json({ error: 'Handoff not found.', code: 'handoff_not_found' });
        if (scope.partyOnly
          && String(row.outgoing_operator_id) !== String(req.user?.id)
          && String(row.incoming_operator_id) !== String(req.user?.id)) {
          return res.status(404).json({ error: 'Handoff not found.', code: 'handoff_not_found' });
        }
      } finally {
        client.release();
      }
    } else {
      const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!rows.length) {
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      const { rows: handoffRows } = await db.query(
        'SELECT id FROM franchise_handoffs WHERE id = $1 AND application_id = $2',
        [handoffId, id]
      );
      if (!handoffRows.length) {
        return res.status(404).json({ error: 'Handoff not found.', code: 'handoff_not_found' });
      }
    }
    const transfers = await fetchHandoffTransfers(id, handoffId);
    return res.json({ application_id: id, handoff_id: handoffId, total: transfers.length, transfers });
  } catch (err) {
    logger.error('Error listing handoff transfers', { id, handoffId, err: err.message });
    return res.status(500).json({ error: 'Failed to list handoff transfers.' });
  }
}

async function listHandoffTransfersAsAdmin(req, res) {
  return listHandoffTransfers(req, res, { asAdmin: true });
}

// 644: handoffs naming the viewer — the incoming operator's pre-approval
// view of the handoff record, and the outgoing operator's record after
// the move. This lists handoff rows only, never territory records.
async function listMyHandoffs(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT h.*,
              fa.desired_city, fa.desired_region, fa.desired_country, fa.status AS application_status,
              o.first_name AS outgoing_first_name, o.last_name AS outgoing_last_name, o.email AS outgoing_email,
              i.first_name AS incoming_first_name, i.last_name AS incoming_last_name, i.email AS incoming_email,
              d.first_name AS decided_first_name, d.last_name AS decided_last_name, d.email AS decided_email
         FROM franchise_handoffs h
         JOIN franchise_applications fa ON fa.id = h.application_id
         LEFT JOIN users o ON o.id = h.outgoing_operator_id
         LEFT JOIN users i ON i.id = h.incoming_operator_id
         LEFT JOIN users d ON d.id = h.decided_by
        WHERE h.outgoing_operator_id = $1 OR h.incoming_operator_id = $1
        ORDER BY h.created_at DESC, h.id DESC`,
      [req.user?.id]
    );
    const handoffs = rows.map((row) => ({
      ...presentHandoff(row),
      territory_city: row.desired_city,
      territory_region: row.desired_region,
      territory_country: row.desired_country,
      application_status: row.application_status,
    }));
    return res.json({ total: handoffs.length, handoffs });
  } catch (err) {
    logger.error('Error listing my franchise handoffs', { err: err.message });
    return res.status(500).json({ error: 'Failed to list my handoffs.' });
  }
}

// ── 643: contact directory ──────────────────────────────────────────────────

function presentDirectoryEntry(row) {
  const linked = Boolean(row.contact_user_id);
  return {
    id: row.id,
    application_id: row.application_id,
    contact_user_id: row.contact_user_id,
    name: linked
      ? ([row.user_first_name, row.user_last_name].filter(Boolean).join(' ') || row.user_email || null)
      : row.name,
    email: linked ? row.user_email : row.email,
    phone: row.phone,
    role: row.role,
    notes: row.notes,
    source: linked ? 'roster' : 'manual',
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function fetchContactDirectoryEntries(applicationId) {
  const { rows } = await db.query(
    `SELECT d.*,
            u.first_name AS user_first_name, u.last_name AS user_last_name, u.email AS user_email
       FROM franchise_contact_directory d
       LEFT JOIN users u ON u.id = d.contact_user_id
      WHERE d.application_id = $1
      ORDER BY d.created_at ASC, d.id ASC`,
    [applicationId]
  );
  return rows.map(presentDirectoryEntry);
}

async function buildContactDirectory(applicationId) {
  const entries = await fetchContactDirectoryEntries(applicationId);
  const roster = await fetchTerritoryMembers(applicationId);
  const listedUserIds = new Set(entries.filter((e) => e.contact_user_id).map((e) => String(e.contact_user_id)));
  return {
    application_id: applicationId,
    total: entries.length,
    entries,
    roster: roster.map((member) => ({ ...member, listed: listedUserIds.has(String(member.user_id)) })),
  };
}

function validateDirectoryFields(body, { manual, partial = false }) {
  const phone = asTrimmed(body?.phone);
  const role = asTrimmed(body?.role);
  const notes = asTrimmed(body?.notes);
  if (phone && phone.length > 50) {
    return { error: { status: 400, body: { error: 'phone must be at most 50 characters.', code: 'contact_phone_too_long' } } };
  }
  if (role && role.length > 100) {
    return { error: { status: 400, body: { error: 'role must be at most 100 characters.', code: 'contact_role_too_long' } } };
  }
  if (notes && notes.length > 1000) {
    return { error: { status: 400, body: { error: 'notes must be at most 1000 characters.', code: 'contact_notes_too_long' } } };
  }
  if (manual) {
    const name = asTrimmed(body?.name);
    const email = asTrimmed(body?.email);
    if (!partial && !name) {
      return { error: { status: 400, body: { error: 'name is required.', code: 'contact_name_required' } } };
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { error: { status: 400, body: { error: 'email must be a valid email address.', code: 'contact_email_invalid' } } };
    }
    if (!partial && !email) {
      return { error: { status: 400, body: { error: 'email must be a valid email address.', code: 'contact_email_invalid' } } };
    }
    return { value: { name, email, phone, role, notes } };
  }
  return { value: { phone, role, notes } };
}

async function createContactDirectoryEntry(req, res) {
  const { id } = req.params;
  const contactUserId = asTrimmed(req.body?.contact_user_id);
  const manual = !contactUserId;
  const validated = validateDirectoryFields(req.body, { manual });
  if (validated.error) return res.status(validated.error.status).json(validated.error.body);
  if (contactUserId && !UUID_RE.test(contactUserId)) {
    return res.status(404).json({ error: 'Territory member not found.', code: 'contact_member_not_found' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can maintain the contact directory.',
          code: 'franchise_operator_only',
        });
      }
      if (contactUserId) {
        if (!(await isTerritoryMember(client, id, contactUserId))) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            error: 'The contact must be a member of this territory.',
            code: 'contact_member_not_found',
          });
        }
        const { rows: existing } = await client.query(
          `SELECT id FROM franchise_contact_directory
            WHERE application_id = $1 AND contact_user_id = $2`,
          [id, contactUserId]
        );
        if (existing.length) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: 'That territory member is already in the contact directory.',
            code: 'contact_already_listed',
          });
        }
      }
      const { rows } = await client.query(
        `INSERT INTO franchise_contact_directory
           (application_id, contact_user_id, name, email, phone, role, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [id, contactUserId || null, validated.value.name || null, validated.value.email || null,
          validated.value.phone, validated.value.role, validated.value.notes, req.user?.id || null]
      );
      await logActivity(client, id, req.user?.id || null, 'contact_directory_added',
        contactUserId ? 'Operator added a territory member to the contact directory.' : 'Operator added a contact to the directory.',
        { contact_directory_id: rows[0].id, contact_user_id: contactUserId || null });
      await client.query('COMMIT');
      const directory = await buildContactDirectory(id);
      const entry = directory.entries.find((row) => row.id === rows[0].id) || rows[0];
      return res.status(201).json({ contact: entry, contact_directory: directory });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error adding franchise directory contact', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to add contact.' });
  }
}

async function getContactDirectory(req, res, { asAdmin = false } = {}) {
  const { id } = req.params;
  try {
    if (!asAdmin) {
      const client = await db.connect();
      try {
        const viewer = await loadTerritoryViewer(client, id, req.user?.id);
        const blocked = territoryReadScope(viewer);
        if (blocked) return res.status(blocked.status).json(blocked.body);
      } finally {
        client.release();
      }
    } else {
      const { rows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!rows.length) {
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
    }
    return res.json(await buildContactDirectory(id));
  } catch (err) {
    logger.error('Error loading franchise contact directory', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to load contact directory.' });
  }
}

async function getContactDirectoryAsAdmin(req, res) {
  return getContactDirectory(req, res, { asAdmin: true });
}

async function updateContactDirectoryEntry(req, res) {
  const { id, entryId } = req.params;
  if (!UUID_RE.test(entryId)) {
    return res.status(404).json({ error: 'Contact not found.', code: 'contact_not_found' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can maintain the contact directory.',
          code: 'franchise_operator_only',
        });
      }
      const { rows: existing } = await client.query(
        'SELECT * FROM franchise_contact_directory WHERE id = $1 AND application_id = $2',
        [entryId, id]
      );
      if (!existing.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Contact not found.', code: 'contact_not_found' });
      }
      const manual = !existing[0].contact_user_id;
      const validated = validateDirectoryFields(req.body, { manual, partial: true });
      if (validated.error) {
        await client.query('ROLLBACK');
        return res.status(validated.error.status).json(validated.error.body);
      }
      const updates = [];
      const values = [];
      let idx = 1;
      const set = (column, value) => {
        updates.push(`${column} = $${idx++}`);
        values.push(value);
      };
      if (manual && validated.value.name !== undefined) set('name', validated.value.name);
      if (manual && validated.value.email !== undefined) set('email', validated.value.email);
      if (req.body?.phone !== undefined) set('phone', validated.value.phone);
      if (req.body?.role !== undefined) set('role', validated.value.role);
      if (req.body?.notes !== undefined) set('notes', validated.value.notes);
      if (!updates.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'No valid updates supplied.', code: 'contact_no_updates' });
      }
      values.push(entryId, id);
      const { rows } = await client.query(
        `UPDATE franchise_contact_directory
            SET ${updates.join(', ')}, updated_at = NOW()
          WHERE id = $${idx++} AND application_id = $${idx}
          RETURNING *`,
        values
      );
      await client.query('COMMIT');
      const directory = await buildContactDirectory(id);
      const entry = directory.entries.find((row) => row.id === entryId) || rows[0];
      return res.json({ contact: entry, contact_directory: directory });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error updating franchise directory contact', { id, entryId, err: err.message });
    return res.status(500).json({ error: 'Failed to update contact.' });
  }
}

async function deleteContactDirectoryEntry(req, res) {
  const { id, entryId } = req.params;
  if (!UUID_RE.test(entryId)) {
    return res.status(404).json({ error: 'Contact not found.', code: 'contact_not_found' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await loadOperatorApplication(client, id, req.user?.id);
      if (!owned.application || !owned.isAssociated) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (!owned.isOperator) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only the assigned operator can maintain the contact directory.',
          code: 'franchise_operator_only',
        });
      }
      const { rows } = await client.query(
        `DELETE FROM franchise_contact_directory
          WHERE id = $1 AND application_id = $2 RETURNING id`,
        [entryId, id]
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Contact not found.', code: 'contact_not_found' });
      }
      await logActivity(client, id, req.user?.id || null, 'contact_directory_removed',
        'Operator removed a contact from the directory.', { contact_directory_id: entryId });
      await client.query('COMMIT');
      return res.json({ contact_directory: await buildContactDirectory(id) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error removing franchise directory contact', { id, entryId, err: err.message });
    return res.status(500).json({ error: 'Failed to remove contact.' });
  }
}

// ── 645: explicit HQ removal of a territory member's access ────────────────
// The missing half of 645, verified firsthand: revocation already exists
// server-side (syncFranchiseGrant on status/owner change), but there is no
// explicit removal action, no UI, and no audit surface. This endpoint is
// that action: it removes the member's membership (accepted invitation
// cancelled, opening-team row deleted), revokes any per-territory grant
// the member holds, and writes the audit row. The operator is never
// removed here — operator access ends only through a completed handoff
// (or an HQ owner change), so removing the operator is 409.
async function removeTerritoryAccessAsAdmin(req, res) {
  const { id } = req.params;
  const userId = asTrimmed(req.body?.user_id);
  const reason = asTrimmed(req.body?.reason);
  if (!userId || !UUID_RE.test(userId)) {
    return res.status(400).json({ error: 'user_id is required.', code: 'access_removal_user_required' });
  }
  if (!reason) {
    return res.status(400).json({ error: 'A reason is required to remove territory access.', code: 'access_removal_reason_required' });
  }
  if (reason.length > 1000) {
    return res.status(400).json({ error: 'reason must be at most 1000 characters.', code: 'access_removal_reason_too_long' });
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows: appRows } = await client.query(
        'SELECT id, owner_user_id, status, linked_business_id FROM franchise_applications WHERE id = $1',
        [id]
      );
      if (!appRows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }
      if (String(appRows[0].owner_user_id) === String(userId)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'The operator cannot be removed this way; use a handoff or reassign the territory.',
          code: 'access_removal_use_handoff',
        });
      }
      const { rows: userRows } = await client.query(
        'SELECT id, email FROM users WHERE id = $1', [userId]
      );
      if (!userRows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'User not found.', code: 'access_removal_user_not_found' });
      }
      const email = userRows[0].email;
      const { rows: inviteRows } = await client.query(
        `SELECT id FROM franchise_territory_invitations
          WHERE application_id = $1 AND lower(email) = lower($2) AND status = 'accepted'`,
        [id, email || '']
      );
      const { rows: teamRows } = await client.query(
        `SELECT id FROM franchise_opening_team_members
          WHERE application_id = $1 AND helper_user_id = $2`,
        [id, userId]
      );
      if (!inviteRows.length && !teamRows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'That user is not a member of this territory.',
          code: 'access_removal_not_member',
        });
      }
      const membershipKind = inviteRows.length ? 'invitee' : 'helper';
      if (inviteRows.length) {
        await client.query(
          `UPDATE franchise_territory_invitations
              SET status = 'cancelled', updated_at = NOW()
            WHERE application_id = $1 AND lower(email) = lower($2) AND status = 'accepted'`,
          [id, email || '']
        );
      }
      if (teamRows.length) {
        await client.query(
          `DELETE FROM franchise_opening_team_members
            WHERE application_id = $1 AND helper_user_id = $2`,
          [id, userId]
        );
      }
      // Belt and braces: revoke any per-territory grant the member holds
      // (members normally hold none — only the operator does — but a
      // removal must never leave a grant behind).
      const { rows: revoked } = await client.query(
        `UPDATE access_grants
            SET status = 'revoked', status_changed_at = NOW(), status_changed_by = $2,
                status_reason_code = 'territory_assignment_ended', version = version + 1,
                updated_at = NOW()
          WHERE user_id = $1 AND capability = 'franchise.operate'
            AND subject_type = 'franchise_application' AND subject_id = $3
            AND status IN ('active', 'suspended')
          RETURNING user_id`,
        [userId, req.user?.id || null, String(id)]
      );
      if (revoked.length) await access.bumpProjection(client, userId);
      const { rows } = await client.query(
        `INSERT INTO franchise_access_removals
           (application_id, user_id, membership_kind, reason, removed_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, userId, membershipKind, reason, req.user?.id || null]
      );
      await logActivity(client, id, req.user?.id || null, 'territory_access_removed',
        `HQ removed a territory member's access (${membershipKind}).`,
        { access_removal_id: rows[0].id, user_id: userId, membership_kind: membershipKind, reason });
      await client.query('COMMIT');
      return res.status(201).json({ access_removal: rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('Error removing franchise territory access', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to remove territory access.' });
  }
}

async function listAccessRemovalsAsAdmin(req, res) {
  const { id } = req.params;
  try {
    const { rows: appRows } = await db.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
    if (!appRows.length) {
      return res.status(404).json({ error: 'Franchise application not found.' });
    }
    const { rows } = await db.query(
      `SELECT r.*,
              u.first_name, u.last_name, u.email,
              rb.first_name AS removed_by_first_name, rb.last_name AS removed_by_last_name,
              rb.email AS removed_by_email
         FROM franchise_access_removals r
         LEFT JOIN users u ON u.id = r.user_id
         LEFT JOIN users rb ON rb.id = r.removed_by
        WHERE r.application_id = $1
        ORDER BY r.created_at DESC, r.id DESC`,
      [id]
    );
    const removals = rows.map((row) => ({
      ...row,
      user_name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email || null,
      removed_by_name: [row.removed_by_first_name, row.removed_by_last_name].filter(Boolean).join(' ')
        || row.removed_by_email || null,
    }));
    return res.json({ application_id: id, total: removals.length, access_removals: removals });
  } catch (err) {
    logger.error('Error listing franchise access removals', { id, err: err.message });
    return res.status(500).json({ error: 'Failed to list access removals.' });
  }
}

module.exports = {
  createFranchiseApplication,
  listMyFranchiseApplications,
  listFranchiseApplications,
  getFranchiseApplication,
  updateFranchiseApplication,
  addFranchiseNote,
  updateChecklistItem,
  upsertFranchiseAgreement,
  signFranchiseAgreement,
  recordFranchiseFeeCollection,
  activateFranchiseStore,
  getMyFranchiseApplication,
  proposeInterviewSlot,
  updateInterviewSlot,
  bookInterviewSlot,
  cancelInterviewBooking,
  uploadApplicationDocument,
  reviewApplicationDocument,
  addApplicantFollowupMessage,
  addAdminFollowupMessage,
  acknowledgeResponsibilityItem,
  respondToTerritoryOffer,
  addTerritoryArea,
  removeTerritoryArea,
  addLaunchPlanStep,
  updateLaunchPlanStep,
  removeLaunchPlanStep,
  updateLaunchPlanStepStatus,
  addLocation,
  addLocationMilestone,
  updateLocationMilestone,
  removeLocationMilestone,
  updateLocationMilestoneStatus,
  assignOpeningTeamMember,
  removeOpeningTeamMember,
  assignOpeningTeamMemberAsAdmin,
  removeOpeningTeamMemberAsAdmin,
  submitReadinessReview,
  upsertLocationService,
  upsertLocationServiceAsAdmin,
  launchLocation,
  launchLocationAsAdmin,
  confirmOpening,
  createTerritoryInvitation,
  createTerritoryInvitationAsAdmin,
  cancelTerritoryInvitation,
  cancelTerritoryInvitationAsAdmin,
  respondToTerritoryInvitation,
  assignLocationManagerAsAdmin,
  removeLocationManagerAsAdmin,
  assignTraining,
  assignTrainingAsAdmin,
  completeTrainingAssignment,
  completeTrainingAssignmentAsAdmin,
  removeTrainingAssignment,
  removeTrainingAssignmentAsAdmin,
  getTerritoryCoverage,
  getTerritoryCoverageAsAdmin,
  getExceptionSummary,
  getExceptionSummaryAsAdmin,
  getLocationHealth,
  getLocationHealthAsAdmin,
  listTerritoryTickets,
  listTerritoryTicketsAsAdmin,
  createPolicyQuestion,
  listPolicyQuestions,
  listPolicyQuestionsAsAdmin,
  getCoverageTrend,
  getCoverageTrendAsAdmin,
  linkTicketToTerritory,
  linkTicketToTerritoryAsAdmin,
  unlinkTicketFromTerritory,
  unlinkTicketFromTerritoryAsAdmin,
  escalateTicket,
  escalateTicketAsAdmin,
  listEscalations,
  listEscalationsAsAdmin,
  setRemediation,
  setRemediationAsAdmin,
  listRemediations,
  listRemediationsAsAdmin,
  listMyRemediations,
  createCorrectiveAction,
  createCorrectiveActionAsAdmin,
  listCorrectiveActions,
  listCorrectiveActionsAsAdmin,
  updateCorrectiveActionStatus,
  updateCorrectiveActionStatusAsAdmin,
  uploadActionEvidence,
  uploadActionEvidenceAsAdmin,
  listActionEvidence,
  listActionEvidenceAsAdmin,
  reviewCorrectiveActionAsAdmin,
  getExceptionResolution,
  getExceptionResolutionAsAdmin,
  createCandidateLocation,
  createCandidateLocationAsAdmin,
  getCandidateLocations,
  getCandidateLocationsAsAdmin,
  updateCandidateLocation,
  updateCandidateLocationAsAdmin,
  deleteCandidateLocation,
  deleteCandidateLocationAsAdmin,
  getTerritoryCapacity,
  getTerritoryCapacityAsAdmin,
  setCapacityTargetAsAdmin,
  getTrainingPlanner,
  getTrainingPlannerAsAdmin,
  getLaunchDependencies,
  getLaunchDependenciesAsAdmin,
  createExpansionNote,
  getExpansionNotes,
  getExpansionNotesAsAdmin,
  updateExpansionNote,
  deleteExpansionNote,
  postAnnouncementAsAdmin,
  deleteAnnouncementAsAdmin,
  markAnnouncementRead,
  curateFranchiseStandard,
  curateFranchiseStandardWide,
  listFranchiseStandardsWide,
  removeFranchiseStandard,
  removeFranchiseStandardWide,
  acknowledgeFranchiseStandard,
  publishFranchiseStandardVersion,
  publishFranchiseStandardVersionWide,
  remindFranchiseStandard,
  remindFranchiseStandardWide,
  uploadFranchiseBrandAsset,
  uploadFranchiseBrandAssetWide,
  listFranchiseBrandAssetsWide,
  deleteFranchiseBrandAsset,
  deleteFranchiseBrandAssetWide,
  listMyHandoffs,
  createHandoff,
  getHandoffs,
  getHandoffsAsAdmin,
  getHandoff,
  getHandoffAsAdmin,
  cancelHandoff,
  cancelHandoffAsAdmin,
  reviewHandoffAsAdmin,
  listHandoffTransfers,
  listHandoffTransfersAsAdmin,
  createContactDirectoryEntry,
  getContactDirectory,
  getContactDirectoryAsAdmin,
  updateContactDirectoryEntry,
  deleteContactDirectoryEntry,
  removeTerritoryAccessAsAdmin,
  listAccessRemovalsAsAdmin,
  // Exported for the legacy access backfill (R-4), which reuses the same
  // territory-assignment grant shape instead of duplicating the insert.
  syncFranchiseGrant,
};
