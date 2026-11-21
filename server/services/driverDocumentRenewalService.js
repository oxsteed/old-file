// server/services/driverDocumentRenewalService.js
// Group 9 Slice A (item 453): driver document renewal reminders.
//
// A driver document with an expiry date gets one reminder per window:
// 30, 7, and 1 days before expiry. Each window stamps its own column
// (reminder_30_sent_at / reminder_7_sent_at / reminder_1_sent_at), so a
// re-run never repeats a window and a document entering a nearer window
// still gets that window's reminder. Expired documents get no reminder
// here; they surface as failed on the readiness checklist and on the
// driver profile instead. The sweep is a record-plus-notice only: it
// never blocks claiming and never verifies anything.
'use strict';

const REMINDER_WINDOWS = [30, 7, 1];
const BATCH_SIZE = 500;

function windowForDays(daysUntilExpiry) {
  if (daysUntilExpiry <= 1) return 1;
  if (daysUntilExpiry <= 7) return 7;
  return 30;
}

async function sweepDriverDocumentRenewalReminders(db, { now = new Date(), send = null } = {}) {
  const sender = send || require('./notificationService').sendNotification;
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();
  const { rows } = await db.query(
    `SELECT id, driver_user_id, document_type, title, expires_at,
            reminder_30_sent_at, reminder_7_sent_at, reminder_1_sent_at
       FROM driver_documents
      WHERE expires_at IS NOT NULL
        AND expires_at > $1::timestamptz
        AND expires_at <= $1::timestamptz + INTERVAL '30 days'
      ORDER BY expires_at ASC
      LIMIT $2`,
    [nowIso, BATCH_SIZE],
  );
  let notified = 0;
  let skipped = 0;
  let failed = 0;
  for (const doc of rows) {
    const days = Math.ceil((new Date(doc.expires_at).getTime() - new Date(nowIso).getTime()) / 86400000);
    const windowDays = windowForDays(days);
    const column = `reminder_${windowDays}_sent_at`;
    if (doc[column]) { skipped += 1; continue; }
    try {
      await sender({
        userId: doc.driver_user_id,
        type: 'driver_document_renewal',
        title: 'Driver document expiring soon',
        body: `Your ${doc.title} expires in ${days} day${days === 1 ? '' : 's'}. Renew it and update the expiry date on your driver profile.`,
        data: { documentId: doc.id, documentType: doc.document_type, daysUntilExpiry: days, windowDays },
        action_url: '/delivery',
      });
      const { rowCount } = await db.query(
        `UPDATE driver_documents SET ${column} = NOW() WHERE id = $1 AND ${column} IS NULL`,
        [doc.id],
      );
      if (rowCount) notified += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
    }
  }
  return { notified, skipped, failed, examined: rows.length };
}

module.exports = { sweepDriverDocumentRenewalReminders, windowForDays, REMINDER_WINDOWS };
