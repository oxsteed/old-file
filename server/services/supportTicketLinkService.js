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
}) {
  const safeName = String(name || 'OxSteed user').trim().slice(0, 255) || 'OxSteed user';
  const safeEmail = String(email || 'support@oxsteed.com').trim().toLowerCase().slice(0, 255) || 'support@oxsteed.com';
  const safeSubject = String(subject || 'Support Request').trim().slice(0, 500) || 'Support Request';
  const safeCategory = String(category || 'general').trim().toLowerCase().replace(/\s+/g, '_').slice(0, 100) || 'general';
  const safePriority = ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal';
  const safeSource = ['widget', 'escalation', 'direct', 'email'].includes(source) ? source : 'direct';
  const content = String(initialMessage || safeSubject).trim().slice(0, 10000) || safeSubject;

  const { rows: [ticket] } = await client.query(
    `INSERT INTO support_tickets
       (user_id, name, email, subject, category, priority, status, source, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8)
     RETURNING id, ticket_number, status, priority, created_at`,
    [
      userId || null,
      safeName,
      safeEmail,
      safeSubject,
      safeCategory,
      safePriority,
      safeSource,
      JSON.stringify(metadata || {}),
    ]
  );

  await client.query(
    `INSERT INTO support_messages
       (ticket_id, sender_id, sender_name, sender_email, content, is_internal, is_from_admin)
     VALUES ($1, $2, $3, $4, $5, FALSE, FALSE)`,
    [ticket.id, userId || null, safeName, safeEmail, content]
  );

  return ticket;
}

module.exports = { createLinkedSupportTicket };
