// OxSteed Restaurants — Staff training lifecycle (S-12) + certificate
// expiry alerts (S-14).
//
// Shared by restaurantTrainingController (manual flows), the nightly
// restaurantTrainingOverdueJob (overdue marking, recertification,
// auto-assignment sweep for new hires, certificate alerts) and the staff
// document vault. All functions take a pg client/pool so they can run
// inside a caller transaction or standalone.

const logger = require('../utils/logger');
const { sendNotification } = require('./notificationService');

const MEMBER_ROLES = ['manager', 'representative', 'employee', 'support_agent'];

// Insert the immutable snapshot of a module's current content. The caller
// passes the module row AFTER the write that produced this version; the
// questions are read back from restaurant_training_questions so the
// snapshot always matches what staff will be scored against.
async function snapshotModuleVersion(client, module, createdBy) {
  const { rows: questions } = await client.query(
    `SELECT question, options, correct_index, sort_order
       FROM restaurant_training_questions
      WHERE module_id = $1
      ORDER BY sort_order ASC, id ASC`,
    [module.id]
  );
  const { rows: [row] } = await client.query(
    `INSERT INTO restaurant_training_module_versions
       (module_id, version, title, description, content, category, pass_score_pct, questions, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     ON CONFLICT (module_id, version) DO NOTHING
     RETURNING *`,
    [
      module.id, module.current_version, module.title, module.description,
      module.content, module.category, module.pass_score_pct,
      JSON.stringify(questions), createdBy || module.created_by || null,
    ]
  );
  return row || null;
}

// Best-effort assignment notification (S-12: assignments used to be
// silent). Failures are logged, never thrown into the write path.
async function notifyTrainingAssigned(userId, { assignmentId, moduleId, moduleTitle, restaurantId, restaurantName = null, dueAt, recertification = false }) {
  try {
    await sendNotification({
      userId,
      type: recertification ? 'training_recertification_due' : 'training_assigned',
      title: recertification ? 'Training recertification due' : 'New training assigned',
      body: recertification
        ? `Your certification for "${moduleTitle}" has expired. Please complete the training again.`
        : `You have been assigned the training module "${moduleTitle}".`,
      data: {
        assignment_id: assignmentId,
        module_id: moduleId,
        restaurant_id: restaurantId,
        due_at: dueAt || null,
        recertification,
        // S-19: clients localize from type + params rather than the
        // English title/body above (kept as the fallback rendering).
        params: {
          restaurantName,
          moduleTitle,
        },
      },
      action_url: '/restaurants/merchant?tab=myshift',
      idempotencyKey: `${recertification ? 'training-recert' : 'training-assigned'}:${assignmentId}:${userId}`,
    });
  } catch (err) {
    logger.warn('Training assignment notification failed', { userId, assignmentId, error: err.message });
  }
}

// Apply active auto-assign rules. With `moduleId`, only that module's
// rules; otherwise every active rule of the restaurant. With
// `onlyOnHire` (the nightly sweep), rules that opted out of on-hire
// assignment are skipped: those applied once, when the rule was made.
// Creates the assignment rows that are missing (idempotent) and returns
// the newly created ones so the caller can notify outside any
// transaction.
async function applyAutoAssignRules(db, { restaurantId, businessId, moduleId = null, assignedBy = null, onlyOnHire = false }) {
  const { rows: allRules } = await db.query(
    `SELECT r.*, m.title AS module_title, m.is_active AS module_is_active
       FROM restaurant_training_auto_assign_rules r
       JOIN restaurant_training_modules m ON m.id = r.module_id
      WHERE r.restaurant_id = $1 AND r.is_active = TRUE AND m.is_active = TRUE
        ${moduleId ? 'AND r.module_id = $2' : ''}`,
    moduleId ? [restaurantId, moduleId] : [restaurantId]
  );
  const rules = onlyOnHire ? allRules.filter((r) => r.on_hire) : allRules;
  const created = [];
  for (const rule of rules) {
    const { rows: members } = await db.query(
      `SELECT member_id FROM business_members
        WHERE business_id = $1 AND status = 'active'
          ${rule.target_role ? 'AND role = $2' : ''}`,
      rule.target_role ? [businessId, rule.target_role] : [businessId]
    );
    for (const member of members) {
      const { rows: [assignment] } = await db.query(
        `INSERT INTO restaurant_training_assignments
           (module_id, restaurant_id, user_id, assigned_by, due_at)
         VALUES ($1, $2, $3, $4,
                 CASE WHEN $5::int IS NULL THEN NULL
                      ELSE NOW() + ($5::int * INTERVAL '1 day') END)
         ON CONFLICT (module_id, user_id) DO NOTHING
         RETURNING *`,
        [rule.module_id, restaurantId, member.member_id, assignedBy || rule.created_by || null, rule.due_days]
      );
      if (assignment) {
        created.push({
          assignmentId: assignment.id,
          userId: member.member_id,
          moduleId: rule.module_id,
          moduleTitle: rule.module_title,
          restaurantId,
          dueAt: assignment.due_at,
        });
      }
    }
  }
  return created;
}

// Nightly sweep part 1: assignments past their due date that are not
// completed become 'overdue'. Returns the flipped rows.
async function markOverdueAssignments(db) {
  const { rows } = await db.query(
    `UPDATE restaurant_training_assignments
        SET status = 'overdue', updated_at = NOW()
      WHERE status IN ('assigned', 'in_progress')
        AND due_at IS NOT NULL
        AND due_at < NOW()
      RETURNING id, user_id, module_id, restaurant_id, due_at`
  );
  return rows;
}

// Nightly sweep part 2: a passing completion whose validity window has
// elapsed re-opens its assignment for recertification. Only the latest
// passing completion per assignment counts, and only while the
// assignment is still 'completed'. Returns re-opened assignments.
async function expireCompletionsForRecertification(db) {
  const { rows } = await db.query(
    `UPDATE restaurant_training_assignments a
        SET status = 'assigned',
            attempts_used = 0,
            due_at = NOW() + INTERVAL '30 days',
            updated_at = NOW()
       FROM restaurant_training_completions c
      WHERE c.assignment_id = a.id
        AND a.status = 'completed'
        AND c.passed = TRUE
        AND c.expires_at IS NOT NULL
        AND c.expires_at <= NOW()
        AND NOT EXISTS (
          SELECT 1 FROM restaurant_training_completions newer
           WHERE newer.assignment_id = a.id
             AND newer.passed = TRUE
             AND newer.completed_at > c.completed_at
        )
      RETURNING a.id, a.user_id, a.module_id, a.restaurant_id, a.due_at,
                (SELECT title FROM restaurant_training_modules WHERE id = a.module_id) AS module_title`
  );
  return rows;
}

// S-14: alert restaurant managers about staff certificates/documents
// expiring within `withinDays` (and not yet alerted for this expiry
// date). Alerts go to the business owner and active managers. Returns
// the number of documents alerted.
async function sendCertificateExpiryAlerts(db, { withinDays = 30 } = {}) {
  const { rows: documents } = await db.query(
    `SELECT d.*, fr.business_id, fr.owner_user_id,
            u.first_name, u.last_name
       FROM restaurant_staff_documents d
       JOIN food_restaurants fr ON fr.id = d.restaurant_id
       JOIN users u ON u.id = d.user_id
      WHERE d.expires_on IS NOT NULL
        AND d.expiry_alert_sent_at IS NULL
        AND d.expires_on <= CURRENT_DATE + ($1::int * INTERVAL '1 day')
        AND d.verification_status <> 'rejected'`,
    [withinDays]
  );
  let alerted = 0;
  for (const doc of documents) {
    const { rows: managers } = await db.query(
      `SELECT member_id AS user_id FROM business_members
        WHERE business_id = $1 AND status = 'active' AND role = 'manager'
       UNION
       SELECT $2::uuid AS user_id`,
      [doc.business_id, doc.owner_user_id]
    );
    const staffName = [doc.first_name, doc.last_name].filter(Boolean).join(' ') || 'A staff member';
    for (const manager of managers) {
      try {
        await sendNotification({
          userId: manager.user_id,
          type: 'staff_document_expiring',
          title: 'Staff document expiring',
          body: `${staffName}'s document "${doc.title}" expires on ${new Date(doc.expires_on).toISOString().slice(0, 10)}.`,
          data: {
            document_id: doc.id,
            restaurant_id: doc.restaurant_id,
            staff_user_id: doc.user_id,
            expires_on: doc.expires_on,
          },
          action_url: '/food/merchant',
          idempotencyKey: `staff-doc-expiry:${doc.id}:${manager.user_id}`,
        });
      } catch (err) {
        logger.warn('Certificate expiry alert failed', { documentId: doc.id, error: err.message });
      }
    }
    await db.query(
      `UPDATE restaurant_staff_documents SET expiry_alert_sent_at = NOW() WHERE id = $1`,
      [doc.id]
    );
    alerted += 1;
  }
  return alerted;
}

module.exports = {
  MEMBER_ROLES,
  snapshotModuleVersion,
  notifyTrainingAssigned,
  applyAutoAssignRules,
  markOverdueAssignments,
  expireCompletionsForRecertification,
  sendCertificateExpiryAlerts,
};
