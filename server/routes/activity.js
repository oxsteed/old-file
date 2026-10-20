"use strict";
const express = require("express");
const { optionalAuth, authenticate } = require("../middleware/auth");
const { generalLimiter, strictLimiter } = require("../middleware/rateLimiter");
const db = require("../db");
const { withTransaction } = require("../utils/transaction");
const gate = require("../growth/gate");
const { validateEvent } = require("../growth/events/validate");
const { record } = require("../growth/consents");
const router = express.Router();
const handled = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
// Cookie-authenticated writes must originate in the app. Native bearer clients
// are authenticated explicitly. Do not trust a caller-supplied subject/device id.
function sameOrigin(req, res, next) {
  if (req.headers.authorization?.startsWith("Bearer ")) return next();
  const origin = req.headers.origin;
  const allowed = [
    process.env.APP_URL,
    process.env.CLIENT_URL,
    "https://oxsteed.com",
  ].filter(Boolean);
  if (
    !origin ||
    !allowed.some((value) => {
      try {
        return new URL(value).origin === origin;
      } catch {
        return false;
      }
    })
  )
    return res.status(403).json({ error: "origin_required" });
  next();
}
async function publicRollout() {
  const { rows } =
    await db.query(`SELECT policy_version,state,planned_effective_at,effective_at,first_notice_sent_at,
    legal_review_ref IS NOT NULL AND translations_reviewed AS published FROM activity_tracking_rollout WHERE id=1`);
  return rows[0];
}
router.get(
  "/policy",
  generalLimiter,
  optionalAuth,
  handled(async (req, res) => {
    const r = await publicRollout();
    const { rows: acks } =
      req.user && r?.published
        ? await db.query(
            "SELECT dismissed_at FROM policy_notice_acknowledgements WHERE user_id=$1 AND policy_version=$2",
            [req.user.id, r.policy_version],
          )
        : { rows: [] };
    res.set("Cache-Control", "no-store").json(
      r?.published
        ? {
            policy_version: r.policy_version,
            state: r.state,
            effective_at: r.effective_at,
            planned_effective_at: r.planned_effective_at,
            notice_started: Boolean(r.first_notice_sent_at),
            authenticated: Boolean(req.user),
            dismissed: acks.length > 0,
          }
        : { state: "draft", notice_started: false },
    );
  }),
);
router.get(
  "/config",
  generalLimiter,
  optionalAuth,
  handled(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const result = await gate.allow({ userId: req.user?.id, req });
    const ctx = result.context;
    // Persist GPC only in reviewed opt-out jurisdictions. A request can restrict
    // eligibility immediately even if the subsequent ledger write fails.
    if (
      ctx?.user &&
      ctx.gpc &&
      ctx.jurisdiction.saleShare &&
      ctx.consents.sale_share_optout !== true
    ) {
      await withTransaction(
        db,
        (conn) =>
          record(conn, {
            userId: ctx.user.id,
            purpose: "sale_share_optout",
            granted: true,
            source: "gpc",
            jurisdiction: ctx.jurisdiction.code,
            version: ctx.rollout.policy_version,
            ip: req.ip,
          }),
        "growth_gpc",
      );
    }
    const { rows: prefs } = req.user
      ? await db.query(
          "SELECT offer_push,offer_in_app,timezone FROM offer_preferences WHERE user_id=$1",
          [req.user.id],
        )
      : { rows: [] };
    const jurisdiction = ctx?.jurisdiction;
    res.json({
      enabled: result.allowed,
      schema_version: 1,
      sample_rate: 1,
      flush_interval_ms: 5000,
      basis: jurisdiction?.basis || "consent",
      offers_basis: jurisdiction?.offersBasis || "consent",
      sale_share_control: Boolean(jurisdiction?.saleShare),
      policy_version: ctx?.rollout?.policy_version || "growth-v1",
      choices: ctx?.consents || {},
      preferences: prefs[0] || { offer_push: false, offer_in_app: true },
    });
  }),
);
router.post("/batch", optionalAuth, async (req, res) => {
  try {
    if (Buffer.byteLength(JSON.stringify(req.body || {})) > 65536)
      return res.sendStatus(204);
    const body = req.body;
    if (
      !Array.isArray(body?.events) ||
      body.events.length > 50 ||
      !["web", "ios", "android"].includes(body.surface) ||
      !/^\d[\w.-]{0,39}$/.test(body.app_version || "") ||
      !/^[a-z]{2}$/.test(body.locale || "") ||
      !/^[a-f0-9-]{36}$/i.test(body.session || "")
    )
      return res.sendStatus(204);
    const permission = await gate.allow({ userId: req.user?.id, req });
    if (!permission.allowed) return res.sendStatus(204);
    if (!(await require("../growth/ingest/limit").permit(req)))
      return res.sendStatus(204);
    if (/bot|crawl|spider|headless/i.test(req.headers["user-agent"] || ""))
      return res.sendStatus(204);
    const events = body.events.map((e) => validateEvent(e)).filter(Boolean);
    await withTransaction(
      db,
      async (conn) => {
        const subject = require("../growth/identity").key(
          "subject",
          req.user.id,
        );
        await conn.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [require("../growth/identity").consentLock(subject)],
        );
        const latest = await gate.allow({
          userId: req.user.id,
          req,
          db: conn,
          lockPolicy: true,
        });
        if (!latest.allowed) return;
        if (
          latest.context.gpc &&
          latest.context.jurisdiction.saleShare &&
          latest.context.consents.sale_share_optout !== true
        )
          await record(conn, {
            userId: req.user.id,
            purpose: "sale_share_optout",
            granted: true,
            source: "gpc",
            jurisdiction: latest.context.jurisdiction.code,
            version: latest.context.rollout.policy_version,
            ip: req.ip,
          });
        await require("../growth/queue").enqueue(
          events.map((event) => ({
            userId: req.user.id,
            domain: false,
            event,
            trustedSignals: latest.context.trustedSignals,
            surface: body.surface,
            app_version: body.app_version,
            locale: body.locale,
            session: body.session,
          })),
        );
      },
      "growth_activity_batch",
    );
  } catch {
    /* Analytics failure never interrupts the user journey. No payload logging. */
  }
  res.sendStatus(204);
});
async function trackingConsent(req, res) {
  const { purpose, granted, source, consent_text_version } = req.body || {};
  if (!["banner", "settings", "signup", "do_not_sell_page"].includes(source))
    return res.status(400).json({ error: "invalid_consent_source" });
  const ctx = await gate.context({ userId: req.user.id, req });
  if (consent_text_version !== ctx.rollout.policy_version)
    return res.status(409).json({ error: "consent_text_changed" });
  if (purpose === "sale_share_optout" && !ctx.jurisdiction.saleShare)
    return res.status(400).json({ error: "jurisdiction_not_applicable" });
  if (purpose === "sale_share_optout" && ctx.gpc && granted === false)
    return res.status(409).json({ error: "gpc_active" });
  await withTransaction(
    db,
    (conn) =>
      record(conn, {
        userId: req.user.id,
        purpose,
        granted,
        source,
        jurisdiction: ctx.jurisdiction.code,
        version: ctx.rollout.policy_version,
        ip: req.ip,
      }),
    "growth_consent",
  );
  res.sendStatus(204);
}
router.post(
  "/consent",
  strictLimiter,
  authenticate,
  sameOrigin,
  handled(trackingConsent),
);
router.put(
  "/preferences",
  strictLimiter,
  authenticate,
  sameOrigin,
  handled(async (req, res) => {
    if (
      typeof req.body?.offer_in_app !== "boolean" ||
      Object.keys(req.body).some(
        (k) => !["offer_in_app", "timezone"].includes(k),
      )
    )
      return res.status(400).json({ error: "invalid_offer_preferences" });
    let timezone = req.body.timezone || null;
    if (timezone) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: timezone });
      } catch {
        return res.status(400).json({ error: "invalid_timezone" });
      }
    }
    await db.query(
      `INSERT INTO offer_preferences(user_id,offer_in_app,timezone) VALUES($1,$2,$3)
    ON CONFLICT(user_id) DO UPDATE SET offer_in_app=EXCLUDED.offer_in_app,timezone=EXCLUDED.timezone,updated_at=NOW()`,
      [req.user.id, req.body.offer_in_app, timezone],
    );
    res.sendStatus(204);
  }),
);
router.post(
  "/notice/dismiss",
  strictLimiter,
  optionalAuth,
  sameOrigin,
  handled(async (req, res) => {
    const r = await publicRollout();
    if (req.user && r?.published && r.first_notice_sent_at)
      await db.query(
        `INSERT INTO policy_notice_acknowledgements(user_id,policy_version) VALUES($1,$2)
    ON CONFLICT DO NOTHING`,
        [req.user.id, r.policy_version],
      );
    res.sendStatus(204);
  }),
);
router.get(
  "/offers",
  generalLimiter,
  authenticate,
  handled(async (req, res) => {
    const { rows } = await db.query(
      `SELECT d.id,c.copy,o.title,o.expires_at FROM offer_campaign_deliveries d
    JOIN offer_campaign_recipients r ON r.id=d.recipient_id JOIN offer_campaigns c ON c.id=d.campaign_id
    JOIN offers o ON o.id=c.offer_id LEFT JOIN offer_preferences p ON p.user_id=r.user_id
    WHERE r.user_id=$1 AND d.channel='in_app' AND d.status='sent' AND COALESCE(p.offer_in_app,TRUE)
    AND o.expires_at>NOW() AND o.status='active' ORDER BY d.sent_at DESC LIMIT 1`,
      [req.user.id],
    );
    const permission = await gate.allow(
      { userId: req.user.id, req },
      "activity_offers",
    );
    res.json({ rows: permission.allowed ? rows : [] });
  }),
);
router.get(
  "/offers/:id",
  generalLimiter,
  authenticate,
  handled(async (req, res) => {
    if (!/^[1-9]\d{0,15}$/.test(req.params.id)) return res.sendStatus(404);
    const {
      rows: [row],
    } = await db.query(
      `SELECT d.id,c.copy,o.id AS offer_id,o.type,o.expires_at,o.destination_url
    FROM offer_campaign_deliveries d JOIN offer_campaign_recipients r ON r.id=d.recipient_id
    JOIN offer_campaigns c ON c.id=d.campaign_id JOIN offers o ON o.id=c.offer_id
    WHERE d.id=$1 AND r.user_id=$2 AND d.status='sent' AND o.status='active' AND o.expires_at>NOW()`,
      [req.params.id, req.user.id],
    );
    if (!row) return res.sendStatus(404);
    if (
      !(
        await gate.allow(
          { userId: req.user.id, req },
          row.type === "affiliate_product"
            ? "partner_offers"
            : "activity_offers",
        )
      ).allowed
    )
      return res.sendStatus(404);
    await db.query(
      "UPDATE offer_campaign_deliveries SET opened_at=COALESCE(opened_at,NOW()) WHERE id=$1",
      [row.id],
    );
    if (row.type === "affiliate_product")
      row.link = `/api/o/${require("../growth/partners/tokens").sign({ delivery_id: String(row.id), offer_id: String(row.offer_id), exp: new Date(row.expires_at).getTime() })}`;
    else if (
      /^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(row.destination_url || "") &&
      !/credit|wallet|payment/i.test(row.destination_url)
    )
      row.link = row.destination_url;
    delete row.destination_url;
    res.json(row);
  }),
);
router.post(
  "/offers/:id/dismiss",
  strictLimiter,
  authenticate,
  sameOrigin,
  handled(async (req, res) => {
    if (!/^[1-9]\d{0,15}$/.test(req.params.id)) return res.sendStatus(404);
    await db.query(
      `INSERT INTO growth_intent_dismissals(user_id,node_id,expires_at)
    SELECT $1,m.node_id,NOW()+interval '30 days' FROM offer_campaign_deliveries d
    JOIN offer_campaign_recipients r ON r.id=d.recipient_id JOIN offer_campaigns c ON c.id=d.campaign_id
    JOIN offer_intent_map m ON m.offer_id=c.offer_id WHERE d.id=$2 AND r.user_id=$1
    ON CONFLICT(user_id,node_id) DO UPDATE SET expires_at=EXCLUDED.expires_at`,
      [req.user.id, req.params.id],
    );
    res.sendStatus(204);
  }),
);
module.exports = router;
module.exports.trackingConsent = handled(trackingConsent);
module.exports.sameOrigin = sameOrigin;
