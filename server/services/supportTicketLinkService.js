'use strict';

async function createLinkedSupportTicket(client, {
  userId,
  name,
  email,
  subject,
  category = 'general',
  priority = 'normal',
  source = 'direct',
  metadata = {},
  initialMessage,
  clientRequestId = null,
}) {
  const safeName = String(name || 'OxSteed user').trim().slice(0, 255) || 'OxSteed user';
  const safeEmail = String(email || 'support@oxsteed.com').trim().toLowerCase().slice(0, 255) || 'support@oxsteed.com';
  const safeSubject = String(subject || 'Support Request').trim().slice(0, 500) || 'Support Request';
  const safeCategory = String(category || 'general').trim().toLowerCase().replace(/\s+/g, '_').slice(0, 100) || 'general';
  const safePriority = ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal';
  const safeSource = ['widget', 'escalation', 'direct', 'email'].includes(source) ? source : 'direct';
  const content = String(initialMessage || safeSubject).trim().slice(0, 10000) || safeSubject;

  const ticketResult = await client.query(
    clientRequestId
      ? `INSERT INTO support_tickets
           (user_id, name, email, subject, category, priority, status, source, metadata, client_request_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9)
         ON CONFLICT (client_request_id)
         WHERE client_request_id IS NOT NULL DO NOTHING
         RETURNING id, ticket_number, status, priority, created_at`
      : `INSERT INTO support_tickets
           (user_id, name, email, subject, category, priority, status, source, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8)
         RETURNING id, ticket_number, status, priority, created_at`,
    clientRequestId
      ? [
          userId || null,
          safeName,
          safeEmail,
          safeSubject,
          safeCategory,
          safePriority,
          safeSource,
          JSON.stringify(metadata || {}),
          clientRequestId,
        ]
      : [
          userId || null,
          safeName,
          safeEmail,
          safeSubject,
          safeCategory,
          safePriority,
          safeSource,
          JSON.stringify(metadata || {}),
        ],
  );

  let ticket = ticketResult.rows[0];
  let replayed = false;
  if (!ticket && clientRequestId) {
    const existing = await client.query(
      `SELECT id, ticket_number, status, priority, created_at
         FROM support_tickets
        WHERE client_request_id = $1
        LIMIT 1`,
      [clientRequestId],
    );
    ticket = existing.rows[0];
    replayed = Boolean(ticket);
  }
  if (!ticket) throw new Error('Linked support ticket could not be created or recovered');

  if (!replayed) {
    await client.query(
      clientRequestId
        ? `INSERT INTO support_messages
             (ticket_id, sender_id, sender_name, sender_email, content, is_internal, is_from_admin, client_message_id)
           VALUES ($1, $2, $3, $4, $5, FALSE, FALSE, $6)
           ON CONFLICT (ticket_id, client_message_id)
           WHERE client_message_id IS NOT NULL DO NOTHING`
        : `INSERT INTO support_messages
             (ticket_id, sender_id, sender_name, sender_email, content, is_internal, is_from_admin)
           VALUES ($1, $2, $3, $4, $5, FALSE, FALSE)`,
      clientRequestId
        ? [ticket.id, userId || null, safeName, safeEmail, content, clientRequestId]
        : [ticket.id, userId || null, safeName, safeEmail, content],
    );
  }

  return { ...ticket, replayed };
}

module.exports = { createLinkedSupportTicket };
