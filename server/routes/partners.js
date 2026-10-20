"use strict";
const crypto = require("crypto");
const router = require("express").Router();
const db = require("../db");
const { withTransaction } = require("../utils/transaction");
const { strictLimiter } = require("../middleware/rateLimiter");
const fraud = require("../growth/partners/fraud");
router.post("/:code/postback", strictLimiter, async (req, res) => {
  try {
    if (process.env.GROWTH_PARTNER_OFFERS_ENABLED !== "true")
      return res.sendStatus(404);
    const code = String(req.params.code);
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(code)) return res.sendStatus(404);
    const stamp = req.get("x-growth-timestamp"),
      signature = req.get("x-growth-signature");
    const secret =
      process.env[`GROWTH_PARTNER_POSTBACK_${code.toUpperCase()}_SECRET`];
    if (
      !secret ||
      secret.length < 32 ||
      !/^\d{13}$/.test(stamp || "") ||
      Math.abs(Date.now() - Number(stamp)) > 300000 ||
      !/^[a-f0-9]{64}$/.test(signature || "") ||
      !req.growthRawBody
    )
      return res.sendStatus(401);
    const expected = crypto
      .createHmac("sha256", secret)
      .update(stamp)
      .update(".")
      .update(req.growthRawBody)
      .digest();
    if (!crypto.timingSafeEqual(expected, Buffer.from(signature, "hex")))
      return res.sendStatus(401);
    const b = JSON.parse(req.growthRawBody.toString("utf8"));
    if (
      !b ||
      typeof b !== "object" ||
      Array.isArray(b) ||
      Object.keys(b).some(
        (k) =>
          ![
            "event_id",
            "click_id",
            "order_ref",
            "sale_minor",
            "commission_minor",
            "currency",
            "status",
            "assisted",
            "helper_id",
          ].includes(k),
      ) ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(b.event_id || "") ||
      !/^[a-f0-9-]{36}$/.test(b.click_id || "") ||
      typeof b.order_ref !== "string" ||
      b.order_ref.length > 200 ||
      ![b.sale_minor, b.commission_minor].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) ||
      b.commission_minor > b.sale_minor ||
      !["pending", "approved", "paid", "reversed"].includes(b.status) ||
      (b.assisted !== undefined && typeof b.assisted !== "boolean") ||
      (b.helper_id !== undefined &&
        b.helper_id !== null &&
        !/^[a-f0-9-]{36}$/i.test(b.helper_id)) ||
      !/^[A-Z]{3}$/.test(b.currency || "")
    )
      return res.sendStatus(400);
    await withTransaction(
      db,
      async (conn) => {
        const {
          rows: [partner],
        } = await conn.query(
          "SELECT id,currencies,cookie_window_days FROM affiliate_partners WHERE code=$1 AND status='active'",
          [code],
        );
        if (!partner || !partner.currencies.includes(b.currency))
          throw new Error("partner_inactive");
        const {
          rows: [click],
        } = await conn.query(
          `SELECT c.offer_id,c.created_at,r.user_id AS recipient_user_id
           FROM offer_clicks c JOIN offers o ON o.id=c.offer_id
           JOIN offer_campaign_deliveries d ON d.id=c.delivery_id
           JOIN offer_campaign_recipients r ON r.id=d.recipient_id
           WHERE c.click_id=$1 AND o.partner_id=$2 AND o.currency=$3`,
          [b.click_id, partner.id, b.currency],
        );
        if (!click) throw new Error("click_unknown");
        const orderHash = require("../growth/identity").key(
          `order:${code}`,
          b.order_ref,
        );
        const existing = (
          await conn.query(
            "SELECT * FROM affiliate_conversions WHERE partner_id=$1 AND order_ref_hash=$2 FOR UPDATE",
            [partner.id, orderHash],
          )
        ).rows[0];
        if (existing && existing.click_id !== b.click_id)
          throw new Error("conversion_click_mismatch");
        if (
          !existing &&
          Date.now() - new Date(click.created_at).getTime() >
            partner.cookie_window_days * 86400000
        )
          throw new Error("attribution_window_expired");
        // A reversal or status update for an order never recorded cannot be
        // applied; the partner must send the original conversion first.
        if (!existing && b.status === "reversed")
          throw new Error("conversion_unknown");
        const { rowCount } = await conn.query(
          "INSERT INTO growth_partner_receipts(partner_id,event_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [partner.id, b.event_id],
        );
        if (!rowCount) return;
        // Helper-assisted attribution (spec 13.1): a sale through a helper's
        // shared cart belongs to the helper program. The engine records it
        // as assisted only; finance views never count it as an engine
        // conversion, so the sale is never double-counted.
        let assisted = existing?.assisted === true,
          assistedHelperId = existing?.assisted_helper_id || null;
        if (b.assisted === true) {
          assisted = true;
          if (b.helper_id) {
            const {
              rows: [helper],
            } = await conn.query(
              "SELECT id FROM users WHERE id=$1 AND is_active=TRUE",
              [b.helper_id],
            );
            if (!helper) throw new Error("assisted_helper_unknown");
            assistedHelperId = helper.id;
          }
        }
        if (!existing) {
          const flags = await fraud.screenConversion(conn, {
            partnerId: partner.id,
            clickId: b.click_id,
            recipientUserId: click.recipient_user_id,
            saleMinor: b.sale_minor,
            commissionMinor: b.commission_minor,
          });
          const status = fraud.shouldHold(flags) ? "flagged" : b.status;
          await conn.query(
            `INSERT INTO affiliate_conversions(partner_id,click_id,order_ref_hash,sale_minor,commission_minor,currency,status,assisted,assisted_helper_id,fraud_flags)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              partner.id,
              b.click_id,
              orderHash,
              b.sale_minor,
              b.commission_minor,
              b.currency,
              status,
              assisted,
              assistedHelperId,
              JSON.stringify(flags),
            ],
          );
          return;
        }
        // Late status updates, adjustments and reversals on an existing
        // conversion. Currency is pinned to the click's offer (checked
        // above); amounts may only move as a pre-approval correction or a
        // partial reversal (fraud.amountsChangeAllowed).
        if (existing.currency !== b.currency)
          throw new Error("conversion_currency_mismatch");
        if (
          !fraud.amountsChangeAllowed(existing, {
            sale_minor: b.sale_minor,
            commission_minor: b.commission_minor,
            status: b.status,
          })
        )
          throw new Error("conversion_amount_change_denied");
        if (!fraud.transitionAllowed(existing.status, b.status))
          throw new Error("conversion_transition_denied");
        const amountsChanged =
          Number(existing.sale_minor) !== b.sale_minor ||
          Number(existing.commission_minor) !== b.commission_minor;
        let flags = JSON.parse(JSON.stringify(existing.fraud_flags || []));
        if (amountsChanged && b.status !== "reversed") {
          flags = await fraud.screenConversion(conn, {
            partnerId: partner.id,
            clickId: b.click_id,
            recipientUserId: click.recipient_user_id,
            saleMinor: b.sale_minor,
            commissionMinor: b.commission_minor,
          });
        }
        const status =
          b.status !== "reversed" && fraud.shouldHold(flags)
            ? "flagged"
            : b.status;
        await conn.query(
          `UPDATE affiliate_conversions SET sale_minor=$3,commission_minor=$4,
             status=$5,assisted=$6,assisted_helper_id=$7,fraud_flags=$8,updated_at=NOW()
           WHERE partner_id=$1 AND order_ref_hash=$2`,
          [
            partner.id,
            orderHash,
            b.sale_minor,
            b.commission_minor,
            status,
            assisted,
            assistedHelperId,
            JSON.stringify(flags),
          ],
        );
      },
      "growth_partner_postback",
    );
    res.sendStatus(204);
  } catch {
    res.status(400).json({ error: "partner_postback_rejected" });
  }
});
module.exports = router;
