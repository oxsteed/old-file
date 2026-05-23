const db = require('../db');
const logger = require('../utils/logger');
const countriesUtil = require('../utils/countries');

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

  const checklist = checklistResult.rows;
  const completedChecklist = checklist.filter((item) => item.status === 'completed' || item.status === 'waived').length;

  return {
    application: {
      ...applicationResult.rows[0],
      checklist_total: checklist.length,
      checklist_completed: completedChecklist,
    },
    checklist,
    agreement: agreementResult.rows[0] || null,
    notes: notesResult.rows,
    activity: activityResult.rows,
  };
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
          asTrimmed(req.body.owner_user_id),
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
           term_years
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          applicationId,
          'v1',
          program.initial_fee_cents,
          program.royalty_bps,
          program.marketing_fee_bps,
          program.term_years,
        ]
      );

      await seedChecklist(client, applicationId);
      await logActivity(
        client,
        applicationId,
        req.user?.id || null,
        'application_created',
        `Franchise application created for ${firstName} ${lastName}.`,
        { desired_country: desiredCountry, desired_region: desiredRegion, desired_city: desiredCity }
      );

      await client.query('COMMIT');

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
    'owner_user_id',
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

      const before = await client.query('SELECT status FROM franchise_applications WHERE id = $1', [applicationId]);
      if (!before.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }

      const updateResult = await client.query(
        `UPDATE franchise_applications
            SET ${updates.join(', ')}, updated_at = NOW()
          WHERE id = $${idx}
          RETURNING id, status, agreement_status, training_status, launch_readiness_status`,
        values
      );

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

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const exists = await client.query('SELECT id FROM franchise_applications WHERE id = $1', [id]);
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Franchise application not found.' });
      }

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
           notes
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
         )
         ON CONFLICT (application_id) DO UPDATE SET
           agreement_version = COALESCE(EXCLUDED.agreement_version, franchise_agreements.agreement_version),
           document_url = COALESCE(EXCLUDED.document_url, franchise_agreements.document_url),
           initial_fee_cents = COALESCE(EXCLUDED.initial_fee_cents, franchise_agreements.initial_fee_cents),
           royalty_bps = COALESCE(EXCLUDED.royalty_bps, franchise_agreements.royalty_bps),
           marketing_fee_bps = COALESCE(EXCLUDED.marketing_fee_bps, franchise_agreements.marketing_fee_bps),
           territory_exclusive = EXCLUDED.territory_exclusive,
           term_years = COALESCE(EXCLUDED.term_years, franchise_agreements.term_years),
           signed_by_name = COALESCE(EXCLUDED.signed_by_name, franchise_agreements.signed_by_name),
           signed_by_email = COALESCE(EXCLUDED.signed_by_email, franchise_agreements.signed_by_email),
           signed_at = COALESCE(EXCLUDED.signed_at, franchise_agreements.signed_at),
           countersigned_by = COALESCE(EXCLUDED.countersigned_by, franchise_agreements.countersigned_by),
           countersigned_at = COALESCE(EXCLUDED.countersigned_at, franchise_agreements.countersigned_at),
           notes = COALESCE(EXCLUDED.notes, franchise_agreements.notes),
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
          asTrimmed(body.signed_by_name),
          asTrimmed(body.signed_by_email),
          body.signed_at || null,
          body.countersigned_by || req.user?.id || null,
          body.countersigned_at || null,
          asTrimmed(body.notes),
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

module.exports = {
  createFranchiseApplication,
  listMyFranchiseApplications,
  listFranchiseApplications,
  getFranchiseApplication,
  updateFranchiseApplication,
  addFranchiseNote,
  updateChecklistItem,
  upsertFranchiseAgreement,
  activateFranchiseStore,
};
