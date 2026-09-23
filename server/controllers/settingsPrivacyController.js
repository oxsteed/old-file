const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { getClientRequestId } = require('../utils/idempotency');
const { scheduleSupportMessageNotifications } = require('../services/supportNotificationService');

const HELPER_ROLES = new Set(['helper', 'helper_pro', 'broker']);

/**
 * PATCH /api/settings/privacy
 * Body: {
 *   allow_guest_contact?: boolean,
 *   allow_booking?: boolean,
 *   allow_scheduling?: boolean,
 *   allow_live_chat?: boolean
 * }
 * Updates helper_profiles for helper-tier users only.
 */
async function patchPrivacySettings(req, res, next) {
  try {
    if (!HELPER_ROLES.has(req.user.role)) {
      throw new AppError('Only helpers can update this setting', 403, 'forbidden');
    }

    const {
      allow_guest_contact,
      allow_booking,
      allow_scheduling,
      allow_live_chat,
    } = req.body;

    // Validate that at least one setting is provided
    const settingsToUpdate = {};
    let hasValidSetting = false;

    if (typeof allow_guest_contact === 'boolean') {
      settingsToUpdate.allow_guest_contact = allow_guest_contact;
      hasValidSetting = true;
    }

    if (typeof allow_booking === 'boolean') {
      settingsToUpdate.allow_booking = allow_booking;
      hasValidSetting = true;
    }

    if (typeof allow_scheduling === 'boolean') {
      settingsToUpdate.allow_scheduling = allow_scheduling;
      hasValidSetting = true;
    }

    if (typeof allow_live_chat === 'boolean') {
      settingsToUpdate.allow_live_chat = allow_live_chat;
      hasValidSetting = true;
    }

    if (!hasValidSetting) {
      throw new AppError('At least one privacy setting must be provided as boolean', 400, 'validation_failed', {
        allow_guest_contact: 'Must be boolean if provided',
        allow_booking: 'Must be boolean if provided',
        allow_scheduling: 'Must be boolean if provided',
        allow_live_chat: 'Must be boolean if provided',
      });
    }

    // Build dynamic UPDATE query
    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(settingsToUpdate)) {
      setClauses.push(`${key} = $${paramIndex}`);
      params.push(value);
      paramIndex++;
    }

    params.push(req.user.id);

    const { rowCount } = await pool.query(
      `UPDATE helper_profiles SET ${setClauses.join(', ')} WHERE user_id = $${paramIndex}`,
      params,
    );

    if (!rowCount) {
      throw new AppError('Helper profile not found', 404, 'not_found');
    }

    // Return updated settings
    res.json(settingsToUpdate);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/settings/app-report
 * Creates a support ticket from the mobile Settings → Report a Problem flow.
 */
async function submitAppReport(req, res, next) {
  const client = await pool.connect();
  try {
    const details = typeof req.body.details === 'string' ? req.body.details.trim() : '';
    if (!details) {
      throw new AppError('Report details are required', 400, 'validation_failed', {
        details: 'Required',
      });
    }
    if (details.length > 4000) {
      throw new AppError('Report details must be 4000 characters or less', 400, 'validation_failed', {
        details: 'Max 4000 characters',
      });
    }

    const appVersion = req.body.app_version || req.get('X-OxSteed-App-Version') || 'unknown';
    const buildNumber = req.body.build_number || req.get('X-OxSteed-Build') || 'unknown';
    const gitSha = req.body.git_sha || req.get('X-OxSteed-Git-SHA') || null;
    const platform = req.body.platform || req.get('X-OxSteed-Platform') || 'ios';
    const requestId = req.id || req.get('X-Request-ID') || null;
    const clientRequestId = getClientRequestId(req);
    if (clientRequestId === false) {
      throw new AppError('clientRequestId must be a valid UUID', 400, 'validation_failed');
    }
    const name = [req.user.first_name, req.user.last_name].filter(Boolean).join(' ').trim() || 'OxSteed User';
    const email = (req.body.contact_email || req.user.email || '').trim().toLowerCase();
    const subject = `iOS Settings Report - build ${buildNumber}`.slice(0, 500);
    const content = [
      details,
      '',
      '---',
      `platform: ${platform}`,
      `app_version: ${appVersion}`,
      `build_number: ${buildNumber}`,
      gitSha ? `git_sha: ${gitSha}` : null,
      requestId ? `request_id: ${requestId}` : null,
    ].filter(Boolean).join('\n');

    await client.query('BEGIN');
    const ticketRes = await client.query(
      clientRequestId
        ? `INSERT INTO support_tickets
             (user_id, name, email, subject, category, priority, status, source, client_request_id)
           VALUES ($1, $2, $3, $4, 'technical', 'normal', 'open', 'ios_settings', $5)
           ON CONFLICT (client_request_id)
           WHERE client_request_id IS NOT NULL DO NOTHING
           RETURNING id, ticket_number`
        : `INSERT INTO support_tickets
             (user_id, name, email, subject, category, priority, status, source)
           VALUES ($1, $2, $3, $4, 'technical', 'normal', 'open', 'ios_settings')
           RETURNING id, ticket_number`,
      clientRequestId
        ? [req.user.id, name, email, subject, clientRequestId]
        : [req.user.id, name, email, subject],
    );
    let ticket = ticketRes.rows[0];
    let replayed = false;
    if (!ticket && clientRequestId) {
      const existingTicket = await client.query(
        `SELECT id, ticket_number FROM support_tickets WHERE client_request_id = $1 LIMIT 1`,
        [clientRequestId],
      );
      ticket = existingTicket.rows[0];
      replayed = Boolean(ticket);
    }
    if (!ticket) throw new AppError('Support report could not be created or recovered', 500, 'processing_error');

    let messageId = null;
    if (!replayed) {
      const { rows: messageRows } = await client.query(
        clientRequestId
          ? `INSERT INTO support_messages
               (ticket_id, sender_id, sender_name, sender_email, content,
                sender_language, is_internal, is_from_admin, client_message_id)
             VALUES ($1, $2, $3, $4, $5, $6, false, false, $7)
             ON CONFLICT (ticket_id, client_message_id)
             WHERE client_message_id IS NOT NULL DO NOTHING`
          : `INSERT INTO support_messages
               (ticket_id, sender_id, sender_name, sender_email, content,
                sender_language, is_internal, is_from_admin)
             VALUES ($1, $2, $3, $4, $5, $6, false, false)
             RETURNING id`,
        clientRequestId
          ? [
              ticket.id,
              req.user.id,
              name,
              email,
              content,
              req.user.preferred_language || 'en',
              clientRequestId,
            ]
          : [
              ticket.id,
              req.user.id,
              name,
              email,
              content,
              req.user.preferred_language || 'en',
            ],
      );
      messageId = messageRows[0]?.id || null;
    }
    await client.query('COMMIT');

    scheduleSupportMessageNotifications({
      ticketId: ticket.id,
      messageId,
      body: content,
      title: 'New support report',
    });

    logger.info('Settings app report submitted', {
      userId: req.user.id,
      ticketId: ticket.id,
      ticketNumber: ticket.ticket_number,
      platform,
      appVersion,
      buildNumber,
      gitSha,
      requestId,
    });

    res.status(replayed ? 200 : 201).json({
      ticket_id: String(ticket.id),
      ticket_number: String(ticket.ticket_number || ticket.id),
      message: 'Your report has been received.',
      idempotent: replayed,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* non-fatal */ }
    next(err);
  } finally {
    client.release();
  }
}

module.exports = { patchPrivacySettings, submitAppReport };
