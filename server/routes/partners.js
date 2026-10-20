"use strict";
const crypto = require("crypto");
const router = require("express").Router();
const db = require("../db");
const { withTransaction } = require("../utils/transaction");
const { strictLimiter } = require("../middleware/rateLimiter");
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
          `SELECT c.offer_id,c.created_at FROM offer_clicks c JOIN offers o ON o.id=c.offer_id
        WHERE c.click_id=$1 AND o.partner_id=$2 AND o.currency=$3`,
          [b.click_id, partner.id, b.currency],
        );
        if (!click) throw new Error("click_unknown");
        const existing = (
          await conn.query(
            "SELECT click_id FROM affiliate_conversions WHERE partner_id=$1 AND order_ref_hash=$2 FOR UPDATE",
            [
              partner.id,
              require("../growth/identity").key(`order:${code}`, b.order_ref),
            ],
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
        const { rowCount } = await conn.query(
          "INSERT INTO growth_partner_receipts(partner_id,event_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [partner.id, b.event_id],
        );
        if (!rowCount) return;
        const orderHash = require("../growth/identity").key(
          `order:${code}`,
          b.order_ref,
        );
        await conn.query(
          `INSERT INTO affiliate_conversions(partner_id,click_id,order_ref_hash,sale_minor,commission_minor,currency,status)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(partner_id,order_ref_hash) DO UPDATE
        SET status=EXCLUDED.status,updated_at=NOW()
        WHERE affiliate_conversions.currency=EXCLUDED.currency AND affiliate_conversions.sale_minor=EXCLUDED.sale_minor
        AND affiliate_conversions.commission_minor=EXCLUDED.commission_minor AND affiliate_conversions.status<>'reversed'
        AND (EXCLUDED.status='reversed' OR (affiliate_conversions.status='pending' AND EXCLUDED.status IN ('approved','paid'))
          OR (affiliate_conversions.status='approved' AND EXCLUDED.status='paid'))`,
          [
            partner.id,
            b.click_id,
            orderHash,
            b.sale_minor,
            b.commission_minor,
            b.currency,
            b.status,
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
