const db = require('../db');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');

/**
 * Add a note to a Business Launch request
 * POST /api/consulting/business-launch/requests/:id/notes
 */
async function addNote(req, res) {
  const { id } = req.params;
  const { note_text, is_internal } = req.body;
  const admin_id = req.user?.id;

  if (!note_text || note_text.trim().length === 0) {
    return res.status(400).json({ error: 'Note text is required' });
  }

  if (!admin_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Verify request exists
    const requestCheck = await db.query(
      'SELECT id FROM consulting_requests WHERE id = $1',
      [id]
    );

    if (requestCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    // Add note
    const result = await db.query(
      `INSERT INTO consulting_request_notes (request_id, admin_id, note_text, is_internal)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, admin_id, note_text.trim(), is_internal !== false]
    );

    logger.info('Business launch note added', {
      requestId: id,
      adminId: admin_id,
      isInternal: is_internal !== false,
    });

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error('Error adding note', { requestId: id, err });
    return res.status(500).json({ error: 'Failed to add note' });
  }
}

/**
 * Get all notes for a Business Launch request
 * GET /api/consulting/business-launch/requests/:id/notes
 */
async function getNotes(req, res) {
  const { id } = req.params;

  try {
    const result = await db.query(
      `SELECT n.*, u.first_name, u.last_name
       FROM consulting_request_notes n
       LEFT JOIN users u ON n.admin_id = u.id
       WHERE n.request_id = $1
       ORDER BY n.created_at DESC`,
      [id]
    );

    return res.json(result.rows);
  } catch (err) {
    logger.error('Error fetching notes', { requestId: id, err });
    return res.status(500).json({ error: 'Failed to fetch notes' });
  }
}

/**
 * Delete a note
 * DELETE /api/consulting/business-launch/notes/:noteId
 */
async function deleteNote(req, res) {
  const { noteId } = req.params;
  const admin_id = req.user?.id;

  try {
    // Get note to verify admin is owner or super admin
    const noteCheck = await db.query(
      'SELECT admin_id FROM consulting_request_notes WHERE id = $1',
      [noteId]
    );

    if (noteCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }

    // Only creator or super admin can delete
    if (noteCheck.rows[0].admin_id !== admin_id && req.user?.role !== 'super_admin') {
      return res.status(403).json({ error: 'Not authorized to delete this note' });
    }

    // Delete with authorization safeguard and RETURNING
    const delResult = await db.query(
      'DELETE FROM consulting_request_notes WHERE id = $1 AND (admin_id = $2 OR admin_id IN (SELECT id FROM users WHERE role = $3)) RETURNING id',
      [noteId, admin_id, 'super_admin']
    );

    if (!delResult.rows.length) {
      return res.status(403).json({ error: 'Delete authorization check failed' });
    }

    logger.info('Business launch note deleted', { noteId, adminId: admin_id });

    return res.json({ message: 'Note deleted successfully' });
  } catch (err) {
    logger.error('Error deleting note', { noteId, err });
    return res.status(500).json({ error: 'Failed to delete note' });
  }
}

/**
 * Send a custom message to a client
 * POST /api/consulting/business-launch/requests/:id/send-message
 */
async function sendCustomMessage(req, res) {
  const { id } = req.params;
  const { subject, message_html, message_plain } = req.body;
  const admin_id = req.user?.id;

  if (!subject || !message_html) {
    return res.status(400).json({ error: 'Subject and message HTML are required' });
  }

  try {
    // Get request details
    const requestCheck = await db.query(
      'SELECT email, first_name, last_name FROM consulting_requests WHERE id = $1',
      [id]
    );

    if (requestCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const request = requestCheck.rows[0];

    // Create message record
    const messageResult = await db.query(
      `INSERT INTO consulting_request_messages (request_id, admin_id, recipient_email, subject, message_html, message_plain)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [id, admin_id, request.email, subject, message_html, message_plain || '']
    );

    const messageId = messageResult.rows[0].id;

    // Send email (non-blocking)
    sendEmailWithTracking(messageId, request.email, subject, message_html).catch(err => {
      logger.error('Failed to send custom message', { messageId, email: request.email, err });
    });

    logger.info('Custom message queued', {
      requestId: id,
      messageId,
      adminId: admin_id,
      recipientEmail: request.email,
    });

    return res.status(201).json({
      message: 'Message sent successfully',
      messageId,
    });
  } catch (err) {
    logger.error('Error sending custom message', { requestId: id, err });
    return res.status(500).json({ error: 'Failed to send message' });
  }
}

/**
 * Get message history for a request
 * GET /api/consulting/business-launch/requests/:id/messages
 */
async function getMessages(req, res) {
  const { id } = req.params;

  try {
    const result = await db.query(
      `SELECT m.*, u.first_name, u.last_name
       FROM consulting_request_messages m
       LEFT JOIN users u ON m.admin_id = u.id
       WHERE m.request_id = $1
       ORDER BY m.created_at DESC`,
      [id]
    );

    return res.json(result.rows);
  } catch (err) {
    logger.error('Error fetching messages', { requestId: id, err });
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
}

/**
 * Get message templates (pre-made messages)
 * GET /api/consulting/business-launch/message-templates
 */
async function getMessageTemplates(req, res) {
  const templates = [
    {
      id: 'kickoff-prep',
      name: 'Kickoff Preparation',
      subject: 'Preparing for Your Business Launch Kickoff Call',
      body: `Hi {{first_name}},

Your kickoff call is coming up! To make the most of our time together, please prepare:

✓ Your government-issued ID (for identity verification)
✓ 3 business name options you're considering
✓ A brief description of your top 1-2 services
✓ Any existing accounts you want to connect (Google, Apple ID, existing domain, etc.)

This preparation will help us move quickly and get your business setup on track.

Looking forward to our call!

Best regards,
OxSteed Team`,
    },
    {
      id: 'post-kickoff',
      name: 'Post-Kickoff Follow-up',
      subject: 'Thank You for Your Kickoff Call - Next Steps',
      body: `Hi {{first_name}},

Thank you for taking the time to meet with us during your kickoff call. We're excited to help you launch {{business_name}}!

Based on our discussion, we're moving forward with:
- {{package_selected}} Package
- Implementation timeline: {{timeline}}

Your setup work will begin this week. You'll receive updates as each component is completed.

Questions? Reach out to support@oxsteed.com anytime.

Best regards,
OxSteed Team`,
    },
    {
      id: 'update-complete',
      name: 'Setup Component Complete',
      subject: 'Your {{component_name}} is Ready!',
      body: `Hi {{first_name}},

Great news! Your {{component_name}} has been completed and is ready to use.

Details:
{{details}}

Next steps:
{{next_steps}}

Let us know if you have any questions!

Best regards,
OxSteed Team`,
    },
    {
      id: 'final-checklist',
      name: 'Pre-Launch Checklist',
      subject: 'Final Checklist Before Your Business Launch',
      body: `Hi {{first_name}},

You're almost there! Before we officially launch {{business_name}}, please verify:

☐ Website is live and functioning
☐ Payment processor is active and tested
☐ Business email is set up and working
☐ Online calendar/scheduling is configured
☐ Social media accounts are created and branded
☐ Google Business Profile is live
☐ Service templates are saved and ready

Once you've confirmed everything above, reply to this email and we'll schedule your official launch!

Congratulations on taking this step!

Best regards,
OxSteed Team`,
    },
  ];

  return res.json(templates);
}

/**
 * Internal helper to send email with tracking
 */
async function sendEmailWithTracking(messageId, to, subject, html) {
  try {
    await sendEmail({
      to,
      subject,
      html,
    });

    // Mark as sent
    await db.query(
      `UPDATE consulting_request_messages
       SET status = 'sent', sent_at = NOW()
       WHERE id = $1`,
      [messageId]
    );

    logger.info('Custom message sent successfully', { messageId, to });
  } catch (err) {
    // Mark as failed
    await db.query(
      `UPDATE consulting_request_messages
       SET status = 'failed', error_message = $1
       WHERE id = $2`,
      [err.message, messageId]
    );

    logger.error('Failed to send custom message email', { messageId, to, err });
    throw err;
  }
}

module.exports = {
  addNote,
  getNotes,
  deleteNote,
  sendCustomMessage,
  getMessages,
  getMessageTemplates,
};
