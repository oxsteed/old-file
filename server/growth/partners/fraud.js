"use strict";
// Postback conversion sanity checks (spec 13.1/13.5), reusing the patterns
// in server/services/affiliateAntiFraudService.js (velocity, impossible
// commission ratios) adapted to partner postbacks, where there is no
// marketplace order row: the click and its recipient are the subject.
//
// Returns a list of {flag, severity}. A conversion with a critical or high
// flag is stored as 'flagged': visible to finance, excluded from payable
// totals, and never auto-approved by later postbacks.
async function screenConversion(
  conn,
  { partnerId, clickId, recipientUserId, saleMinor, commissionMinor },
) {
  const flags = [];
  if (saleMinor === 0 && commissionMinor > 0)
    flags.push({ flag: "commission_without_sale", severity: "critical" });
  // Anti-fraud pattern: commission above 50% of the sale is implausible.
  if (saleMinor > 0 && commissionMinor * 2 > saleMinor)
    flags.push({ flag: "excessive_commission", severity: "high" });
  const {
    rows: [clickVelocity],
  } = await conn.query(
    `SELECT COUNT(*)::int AS n FROM affiliate_conversions
     WHERE click_id=$1 AND created_at>NOW()-interval '1 hour'`,
    [clickId],
  );
  if (clickVelocity.n >= 5)
    flags.push({ flag: "rapid_conversions_per_click", severity: "high" });
  if (recipientUserId) {
    const {
      rows: [userVelocity],
    } = await conn.query(
      `SELECT COUNT(*)::int AS n FROM affiliate_conversions c
       JOIN offer_clicks oc ON oc.click_id=c.click_id
       JOIN offer_campaign_deliveries d ON d.id=oc.delivery_id
       JOIN offer_campaign_recipients r ON r.id=d.recipient_id
       WHERE r.user_id=$1 AND c.partner_id=$2 AND c.created_at>NOW()-interval '24 hours'`,
      [recipientUserId, partnerId],
    );
    if (userVelocity.n >= 10)
      flags.push({ flag: "rapid_conversions_per_user", severity: "medium" });
  }
  return flags;
}

function shouldHold(flags) {
  return flags.some((f) => f.severity === "critical" || f.severity === "high");
}

// Status machine for postback updates on an existing conversion.
// 'flagged' can only be left through a reversal (the money claim dies) or a
// finance decision recorded outside the postback flow; 'reversed' is
// terminal; 'paid' can still be reversed (post-payout chargeback).
const TRANSITIONS = {
  pending: ["pending", "approved", "paid", "reversed"],
  approved: ["approved", "paid", "reversed"],
  paid: ["paid", "reversed"],
  flagged: ["reversed"],
  reversed: [],
};
function transitionAllowed(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

// Amounts may change only as a pre-approval correction (pending -> pending)
// or as a partial reversal (amounts shrink or hold, status becomes
// 'reversed'). Every other update must restate the original amounts.
function amountsChangeAllowed(existing, next) {
  const sale = Number(existing.sale_minor),
    commission = Number(existing.commission_minor);
  if (sale === next.sale_minor && commission === next.commission_minor)
    return true;
  if (existing.status === "pending" && next.status === "pending") return true;
  if (
    next.status === "reversed" &&
    next.sale_minor <= sale &&
    next.commission_minor <= commission
  )
    return true;
  return false;
}

module.exports = { screenConversion, shouldHold, transitionAllowed, amountsChangeAllowed };
