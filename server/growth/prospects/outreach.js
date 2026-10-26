"use strict";
// D23: per-country cold-outreach rules for licensed prospect businesses.
//
// Fail closed: a country whose B2B rules legal has not reviewed
// (b2b_rules_reviewed_at IS NULL), an 'unset' or 'prohibited' basis, and any
// basis that needs consent we do not hold ('consent', 'implied_or_consent')
// all mean NO outreach. Only a reviewed 'opt_out' basis (e.g. US CAN-SPAM,
// UK PECR for corporate subscribers) allows a first contact, and then only
// with the listed requirements met by the sender.
const CHANNELS = new Set(["email", "phone"]);
const INDIVIDUAL_LIKE = new Set(["sole_trader", "partnership", "unknown"]);

function basisFor(rule, { channel, entityType }) {
  if (channel === "phone") return rule.b2b_phone_basis;
  // PECR/ePrivacy treat sole traders and partnerships like individuals; an
  // unknown entity type is treated the same way (safer).
  return INDIVIDUAL_LIKE.has(entityType) ? rule.b2b_sole_trader_email_basis : rule.b2b_email_basis;
}

function evaluate(rule, { channel = "email", entityType = "unknown", permittedUses = [], usable = true, matched = false, suppressed = false } = {}) {
  const no = (reason) => ({ allowed: false, reason });
  if (!CHANNELS.has(channel)) return no("channel_not_supported");
  if (!usable) return no("record_unusable");
  if (matched) return no("already_on_oxsteed");
  if (suppressed) return no("suppressed");
  if (!permittedUses.includes("marketing_outreach")) return no("licence_not_marketing");
  if (!rule) return no("country_rules_missing");
  if (!rule.b2b_rules_reviewed_at || !rule.b2b_rules_legal_ref) return no("country_rules_unreviewed");
  const basis = basisFor(rule, { channel, entityType });
  if (basis !== "opt_out") return no(`basis_${basis || "unset"}`);
  return {
    allowed: true,
    basis,
    law: rule.b2b_law || null,
    requirements: [
      ...(channel === "email" ? ["identified_sender", "non_deceptive_subject", "ad_label", "working_unsubscribe"] : ["do_not_call_check"]),
      ...(rule.b2b_requires_postal_address ? ["postal_address"] : []),
      ...(rule.b2b_requires_art14_notice ? ["gdpr_art14_notice_within_one_month"] : []),
    ],
  };
}

async function rulesFor(conn, countries) {
  const { rows } = await conn.query(
    `SELECT code, b2b_email_basis, b2b_sole_trader_email_basis, b2b_phone_basis, b2b_requires_postal_address,
            b2b_requires_art14_notice, b2b_law, b2b_rules_reviewed_at, b2b_rules_legal_ref
       FROM jurisdiction_rules WHERE code = ANY($1::text[])`,
    [[...new Set(countries)]],
  );
  return new Map(rows.map((r) => [r.code, r]));
}

module.exports = { evaluate, rulesFor, basisFor };
