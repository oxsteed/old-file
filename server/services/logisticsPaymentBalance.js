'use strict';
async function refundedCents(client, subject, installment) {
    const { rows } = await client.query(`SELECT COALESCE(SUM(r.amount_cents),0) AS refunded_cents
 FROM logistics_refund_cases r JOIN logistics_payment_attempts a
 ON r.original_payment_attempt_id::text=a.id::text
 WHERE a.subject_type=$1 AND a.purchase_order_id IS NOT DISTINCT FROM $2::int
 AND a.participant_id IS NOT DISTINCT FROM $3::int AND a.installment=$4
 AND a.status='succeeded' AND r.status='processed'`, [subject.subjectType, subject.purchaseOrderId || null, subject.participantId || null, installment]);
    return Number(rows[0]?.refunded_cents || 0);
}
module.exports = { refundedCents };
