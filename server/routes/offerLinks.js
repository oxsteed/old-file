"use strict";
const crypto = require("crypto");
const router = require("express").Router();
const db = require("../db");
const { verify, destination } = require("../growth/partners/tokens");
const { generalLimiter } = require("../middleware/rateLimiter");
router.get("/:token", generalLimiter, async (req, res) => {
  res.set("Referrer-Policy", "no-referrer");
  res.set("Cache-Control", "no-store");
  try {
    if (process.env.GROWTH_PARTNER_OFFERS_ENABLED !== "true")
      return res.redirect(303, "/offers/ended");
    const token = verify(req.params.token);
    if (!token?.delivery_id || !token.offer_id)
      return res.redirect(303, "/offers/ended");
    const {
      rows: [offer],
    } = await db.query(
      `SELECT o.*,(c.is_personalized IS NOT FALSE OR COALESCE(sv.is_personalized,TRUE)) AS is_personalized,
      c.amazon_tracking_tag,p.network AS partner_network,p.link_domains_allowlist,p.status AS partner_status,r.user_id
      FROM offer_campaign_deliveries d JOIN offer_campaigns c ON c.id=d.campaign_id JOIN offers o ON o.id=c.offer_id
      LEFT JOIN growth_segment_versions sv ON sv.id=c.segment_version_id
      JOIN offer_campaign_recipients r ON r.id=d.recipient_id
      JOIN affiliate_partners p ON p.id=o.partner_id WHERE d.id=$1 AND o.id=$2 AND d.status='sent'`,
      [token.delivery_id, token.offer_id],
    );
    if (
      !offer ||
      offer.status !== "active" ||
      offer.partner_status !== "active" ||
      new Date(offer.expires_at) <= new Date()
    )
      return res.redirect(303, "/offers/ended");
    if (
      !(
        await require("../growth/gate").allow(
          { userId: offer.user_id },
          "partner_offers",
          { personalized: offer.is_personalized !== false },
        )
      ).allowed
    )
      return res.redirect(303, "/offers/ended");
    const amazonWiring = require("../growth/partners/amazonWiring");
    const isAmazon = amazonWiring.isAmazon(offer.partner_network);
    if (isAmazon) {
      const {
        rows: [item],
      } = await db.query("SELECT available,last_refreshed_at FROM amazon_offer_items WHERE offer_id=$1", [offer.id]);
      if (!amazonWiring.itemFresh(item)) return res.redirect(303, "/offers/ended");
    }
    const clickId = offer.is_personalized === false ? null : crypto.randomUUID(),
      // D21: Amazon gets only the campaign tracking tag, never a click id.
      target = isAmazon
        ? amazonWiring.amazonDestination(
            offer.destination_url,
            offer.link_domains_allowlist,
            amazonWiring.trackingTagFor(offer.amazon_tracking_tag),
          )
        : destination(offer.destination_url, offer.link_domains_allowlist, clickId);
    if (clickId)
      await db.query(
        "INSERT INTO offer_clicks(click_id,delivery_id,offer_id) VALUES($1,$2,$3)",
        [clickId, token.delivery_id, token.offer_id],
      );
    await db.query(
      "UPDATE offer_campaign_deliveries SET clicked_at=COALESCE(clicked_at,NOW()) WHERE id=$1",
      [token.delivery_id],
    );
    res.redirect(302, target);
  } catch {
    res.redirect(303, "/offers/ended");
  }
});
module.exports = router;
