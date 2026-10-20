"use strict";
const router = require("express").Router();
const db = require("../db");
const { withTransaction } = require("../utils/transaction");
const {
  requireAdmin,
  requireRegionalPermission,
  requirePermission,
} = require("../middleware/adminAuth");
const { strictLimiter } = require("../middleware/rateLimiter");
const { logAdminAction } = require("../services/auditService");
const access = require("../growth/access");
const segments = require("../growth/segments/compile");
const campaigns = require("../growth/campaigns");
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const grant = requireRegionalPermission;
const id = (value) => {
  if (!/^[1-9]\d{0,15}$/.test(String(value)))
    throw Object.assign(new Error("invalid_growth_id"), { status: 400 });
  return String(value);
};
router.use(requireAdmin, strictLimiter);
router.use((req, res, next) =>
  req.isImpersonated ? res.sendStatus(403) : next(),
);
router.get(
  "/overview",
  grant("view_growth_insights"),
  wrap(async (req, res) => {
    const boundary = await access.scope(req.user, "view_growth_insights");
    const {
      rows: [rollout],
    } = await db.query(
      "SELECT state,policy_version,effective_at,planned_effective_at,rights_verified,translations_reviewed FROM activity_tracking_rollout WHERE id=1",
    );
    // Counts of global campaigns are not disclosed under a regional-only grant.
    const { rows: counts } = boundary.global
      ? await db.query(
          "SELECT status,COUNT(*)::int AS count FROM offer_campaigns GROUP BY status",
        )
      : { rows: [] };
    res.json({
      rollout,
      campaigns: counts,
      scope: boundary.global ? "global" : "regional",
    });
  }),
);
router.get(
  "/demand",
  grant("view_growth_insights"),
  wrap(async (req, res) => {
    const boundary = await access.scope(req.user, "view_growth_insights"),
      params = [];
    const where = access.predicate(boundary, "g", params);
    if (req.query.intent) params.push(String(req.query.intent).slice(0, 120));
    const { rows } = await db.query(
      `WITH d AS(SELECT postal_ref,node_id,MAX(subjects) AS demand FROM demand_daily
    WHERE day>=CURRENT_DATE-28 GROUP BY 1,2),s AS(SELECT postal_ref,node_id,MAX(providers) AS supply FROM supply_daily
    WHERE day>=CURRENT_DATE-28 GROUP BY 1,2)
    SELECT g.id,g.place_name,g.country,g.postal_code,g.h3_r5,g.h3_r7,n.code,n.labels,d.demand,s.supply,
      CASE WHEN s.supply IS NOT NULL THEN d.demand::numeric/(s.supply+1) END AS gap
    FROM d JOIN geo_postal_centroids g ON g.id=d.postal_ref JOIN demand_taxonomy_nodes n ON n.id=d.node_id
    LEFT JOIN s USING(postal_ref,node_id) WHERE ${where} AND d.demand>=5
    ${req.query.intent ? `AND n.code=$${params.length}` : ""} ORDER BY gap DESC LIMIT 500`,
      params,
    );
    res.json({
      rows,
      attribution: "GeoNames CC BY 4.0",
      window_days: 28,
      counts: "maximum daily distinct subjects; not summed across days",
      k: 5,
    });
  }),
);
router.get(
  "/taxonomy",
  grant("manage_marketing"),
  wrap(async (req, res) => {
    const { rows } = await db.query(
      "SELECT * FROM demand_taxonomy_nodes ORDER BY code",
    );
    res.json({ rows });
  }),
);
router.get(
  "/clusters/options",
  grant("view_growth_insights"),
  wrap(async (req, res) => {
    const { rows } = await db.query(
      "SELECT code,labels FROM demand_taxonomy_nodes WHERE status='active' AND NOT sensitive ORDER BY code",
    );
    res.json({ rows });
  }),
);
router.get(
  "/clusters",
  grant("view_growth_insights"),
  wrap(async (req, res) => {
    const boundary = await access.scope(req.user, "view_growth_insights");
    const rows = await withTransaction(
      db,
      async (conn) => {
        await conn.query("SET TRANSACTION READ ONLY");
        await conn.query("SET LOCAL statement_timeout='30s'");
        return require("../growth/geo/clusters").find(
          conn,
          {
            intent: req.query.intent,
            role: req.query.role,
            country: req.query.country,
            miles: Number(req.query.miles || 35),
            min_n: Number(req.query.min_n || 5),
          },
          boundary,
        );
      },
      "growth_clusters",
    );
    res.json({ rows, k: 5, location_basis: "postal_centroids" });
  }),
);
router.put(
  "/eligibility/:userId",
  requirePermission("manage_users"),
  requirePermission("manage_settings"),
  wrap(async (req, res) => {
    const { adult_confirmed, is_internal, evidence_ref } = req.body;
    if (
      typeof adult_confirmed !== "boolean" ||
      typeof is_internal !== "boolean" ||
      typeof evidence_ref !== "string" ||
      evidence_ref.length < 5 ||
      evidence_ref.length > 500
    )
      return res.status(400).json({ error: "eligibility_evidence_required" });
    await withTransaction(
      db,
      async (conn) => {
        const {
          rows: [user],
        } = await conn.query("SELECT role FROM users WHERE id=$1", [
          req.params.userId,
        ]);
        if (!user || ["admin", "super_admin"].includes(user.role))
          throw new Error("excluded_subject");
        await conn.query(
          `INSERT INTO growth_subject_eligibility(user_id,adult_confirmed,is_internal,evidence_ref,reviewed_at,subject_key)
      VALUES($1,$2,$3,$4,NOW(),$5) ON CONFLICT(user_id) DO UPDATE SET adult_confirmed=EXCLUDED.adult_confirmed,
      is_internal=EXCLUDED.is_internal,evidence_ref=EXCLUDED.evidence_ref,reviewed_at=NOW(),subject_key=EXCLUDED.subject_key`,
          [
            req.params.userId,
            adult_confirmed,
            is_internal,
            evidence_ref,
            require("../growth/identity").key("subject", req.params.userId),
          ],
        );
        if (!adult_confirmed || is_internal)
          await require("../growth/rights").erase(
            conn,
            req.params.userId,
            "eligibility_removed",
          );
        await logAdminAction({
          adminId: req.user.id,
          action: "growth_eligibility_reviewed",
          targetType: "user",
          targetId: req.params.userId,
          after: { adult_confirmed, is_internal, evidence_ref },
          client: conn,
        });
      },
      "growth_eligibility",
    );
    res.sendStatus(204);
  }),
);
router.post(
  "/taxonomy",
  requirePermission("manage_marketing"),
  wrap(async (req, res) => {
    const { code, labels, sensitive } = req.body;
    if (
      !/^[a-z][a-z0-9_.]{1,120}$/.test(code || "") ||
      !campaigns.LOCALES.every(
        (l) => typeof labels?.[l] === "string" && labels[l].length <= 120,
      )
    )
      return res.status(400).json({ error: "invalid_taxonomy" });
    const node = await withTransaction(
      db,
      async (conn) => {
        const {
          rows: [n],
        } = await conn.query(
          "INSERT INTO demand_taxonomy_nodes(code,labels,sensitive,status) VALUES($1,$2,$3,'draft') RETURNING *",
          [code, labels, sensitive === true],
        );
        await logAdminAction({
          adminId: req.user.id,
          action: "growth_taxonomy_created",
          targetType: "taxonomy",
          targetKey: n.id,
          client: conn,
        });
        return n;
      },
      "growth_taxonomy",
    );
    res.status(201).json(node);
  }),
);
router.get(
  "/segments",
  grant("view_growth_insights"),
  wrap(async (req, res) => {
    // Definitions can encode locations; regional authors see their own drafts.
    const boundary = await access.scope(req.user, "view_growth_insights");
    const { rows } = await db.query(
      `SELECT s.*,v.id AS version_id,v.version,v.definition FROM growth_segments s
    JOIN LATERAL(SELECT * FROM growth_segment_versions WHERE segment_id=s.id ORDER BY version DESC LIMIT 1)v ON TRUE
    WHERE ($1::boolean OR s.created_by=$2) ORDER BY s.id DESC LIMIT 100`,
      [boundary.global, req.user.id],
    );
    res.json({ rows });
  }),
);
router.post(
  "/segments",
  grant("manage_marketing"),
  wrap(async (req, res) => {
    segments.validate(req.body.definition);
    const name = String(req.body.name || "").trim();
    if (!name || name.length > 120)
      return res.status(400).json({ error: "invalid_name" });
    const result = await withTransaction(
      db,
      async (conn) => {
        const {
          rows: [s],
        } = await conn.query(
          "INSERT INTO growth_segments(name,created_by) VALUES($1,$2) RETURNING id",
          [name, req.user.id],
        );
        const {
          rows: [v],
        } = await conn.query(
          "INSERT INTO growth_segment_versions(segment_id,version,definition,created_by) VALUES($1,1,$2,$3) RETURNING *",
          [s.id, req.body.definition, req.user.id],
        );
        await logAdminAction({
          adminId: req.user.id,
          action: "growth_segment_created",
          targetType: "growth_segment",
          targetKey: s.id,
          client: conn,
        });
        return v;
      },
      "growth_segment",
    );
    res.status(201).json(result);
  }),
);
router.post(
  "/segments/preview",
  grant("manage_marketing"),
  wrap(async (req, res) => {
    const boundary = await access.scope(req.user, "manage_marketing");
    const rows = await withTransaction(
      db,
      async (conn) => {
        await conn.query("SET TRANSACTION READ ONLY");
        await conn.query("SET LOCAL statement_timeout='30s'");
        return segments.evaluate(
          conn,
          req.body.definition,
          boundary,
          req.body.partner === true ? "partner_offers" : "activity_offers",
        );
      },
      "growth_preview",
    );
    // Never publish small cells in breakdowns, nor an exact sub-k total.
    const breakdown = (field) => {
      const groups = {};
      for (const r of rows) groups[r[field]] = (groups[r[field]] || 0) + 1;
      return Object.entries(groups)
        .filter(([, n]) => n >= 5)
        .map(([value, count]) => ({ value, count }));
    };
    res.json({
      count: rows.length >= 5 ? rows.length : null,
      below_k: rows.length < 5,
      countries: breakdown("country"),
      languages: breakdown("preferred_language"),
      roles: breakdown("role"),
    });
  }),
);
for (const [route, table, permission] of [
  ["offers", "offers", "manage_marketing"],
  ["suggestions", "offer_suggestions", "manage_marketing"],
  ["partners", "affiliate_partners", "manage_affiliate_partners"],
]) {
  router.get(
    `/${route}`,
    requirePermission(permission),
    wrap(async (req, res) => {
      // Partner secret references and money fields do not leave this endpoint.
      const columns =
        route === "partners"
          ? "id,code,name,network,status,countries_allowed,allowed_channels,link_domains_allowlist"
          : route === "offers"
            ? "id,type,title,status,intent_codes,countries,currency,value_minor,channels,copy,expires_at,partner_id"
            : "id,offer_id,segment_version_id,predicted_reach,rationale,status,created_at";
      const { rows } = await db.query(
        `SELECT ${columns} FROM ${table} ORDER BY id DESC LIMIT 100`,
      );
      res.json({ rows });
    }),
  );
}
router.post(
  "/offers",
  requirePermission("manage_marketing"),
  wrap(async (req, res) => {
    const b = req.body;
    if (
      !["affiliate_product", "promo", "plan"].includes(b.type) ||
      !Array.isArray(b.channels) ||
      !b.channels.length ||
      b.channels.some((c) => !["in_app", "push"].includes(c)) ||
      typeof b.title !== "string" ||
      b.title.length > 120 ||
      !Array.isArray(b.countries) ||
      !b.countries.length ||
      b.countries.some((c) => !/^[A-Z]{2}$/.test(c)) ||
      !/^[A-Z]{3}$/.test(b.currency) ||
      !Number.isSafeInteger(b.value_minor) ||
      b.value_minor < 0 ||
      !Number.isFinite(Date.parse(b.expires_at))
    )
      return res.status(400).json({ error: "invalid_offer" });
    campaigns.validateCopy(b.copy, b.channels, {
      affiliate: b.type === "affiliate_product",
    });
    const result = await withTransaction(
      db,
      async (conn) => {
        const {
          rows: [o],
        } = await conn.query(
          `INSERT INTO offers(type,title,countries,currency,value_minor,channels,copy,expires_at,partner_id,destination_url)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [
            b.type,
            b.title,
            b.countries,
            b.currency,
            b.value_minor,
            b.channels,
            b.copy,
            b.expires_at,
            b.partner_id || null,
            b.destination_url || null,
          ],
        );
        await logAdminAction({
          adminId: req.user.id,
          action: "growth_offer_created",
          targetType: "offer",
          targetKey: o.id,
          client: conn,
        });
        return o;
      },
      "growth_offer",
    );
    res.status(201).json(result);
  }),
);
router.post(
  "/offers/:id/activate",
  requirePermission("manage_marketing"),
  wrap(async (req, res) => {
    await withTransaction(
      db,
      async (conn) => {
        const {
          rows: [o],
        } = await conn.query("SELECT * FROM offers WHERE id=$1 FOR UPDATE", [
          id(req.params.id),
        ]);
        if (!o || new Date(o.expires_at) <= new Date())
          throw new Error("offer_expired");
        campaigns.validateCopy(o.copy, o.channels, {
          affiliate: o.type === "affiliate_product",
        });
        if (o.type === "affiliate_product") {
          const {
            rows: [p],
          } = await conn.query(
            "SELECT * FROM affiliate_partners WHERE id=$1 AND status='active'",
            [o.partner_id],
          );
          if (
            !p ||
            o.channels.some((c) => !p.allowed_channels.includes(c)) ||
            o.countries.some((c) => !p.countries_allowed.includes(c)) ||
            !p.currencies.includes(o.currency)
          )
            throw new Error("partner_rules_conflict");
          require("../growth/partners/tokens").destination(
            o.destination_url,
            p.link_domains_allowlist,
            "validation",
          );
        } else if (
          !/^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(o.destination_url || "") ||
          /credit|wallet|payment/i.test(o.destination_url)
        )
          throw new Error("invalid_offer_destination");
        await conn.query("UPDATE offers SET status='active' WHERE id=$1", [
          o.id,
        ]);
        await logAdminAction({
          adminId: req.user.id,
          action: "growth_offer_activated",
          targetType: "offer",
          targetKey: o.id,
          client: conn,
        });
      },
      "growth_offer_activate",
    );
    res.sendStatus(204);
  }),
);
router.post(
  "/partners",
  requirePermission("manage_affiliate_partners"),
  wrap(async (req, res) => {
    const b = req.body;
    if (
      !/^[a-z][a-z0-9_]{1,30}$/.test(b.code || "") ||
      typeof b.name !== "string" ||
      !b.name.trim() ||
      b.name.length > 120 ||
      typeof b.network !== "string" ||
      b.network.length > 60 ||
      !Array.isArray(b.countries_allowed) ||
      !b.countries_allowed.length ||
      b.countries_allowed.some((c) => !/^[A-Z]{2}$/.test(c)) ||
      !Array.isArray(b.currencies) ||
      b.currencies.some((c) => !/^[A-Z]{3}$/.test(c)) ||
      !b.currencies.length ||
      !Array.isArray(b.allowed_channels) ||
      !b.allowed_channels.length ||
      b.allowed_channels.some((c) => !["in_app", "push"].includes(c)) ||
      !Array.isArray(b.link_domains_allowlist) ||
      !b.link_domains_allowlist.length ||
      b.link_domains_allowlist.some(
        (d) => !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(d) || d.endsWith(".local"),
      ) ||
      !campaigns.LOCALES.every(
        (l) =>
          typeof b.disclosure?.[l] === "string" &&
          b.disclosure[l].trim() &&
          b.disclosure[l].length <= 500,
      )
    )
      return res.status(400).json({ error: "invalid_partner" });
    const result = await withTransaction(
      db,
      async (conn) => {
        const {
          rows: [partner],
        } = await conn.query(
          `INSERT INTO affiliate_partners(code,name,network,countries_allowed,currencies,allowed_channels,link_domains_allowlist,disclosure,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            b.code,
            b.name,
            b.network,
            b.countries_allowed,
            b.currencies,
            b.allowed_channels,
            b.link_domains_allowlist,
            b.disclosure,
            req.user.id,
          ],
        );
        await logAdminAction({
          adminId: req.user.id,
          action: "growth_partner_created",
          targetType: "affiliate_partner",
          targetKey: partner.id,
          client: conn,
        });
        return partner;
      },
      "growth_partner_create",
    );
    res.status(201).json(result);
  }),
);
router.post(
  "/partners/:id/activate",
  requirePermission("manage_affiliate_partners"),
  wrap(async (req, res) => {
    if (
      typeof req.body.review_ref !== "string" ||
      req.body.review_ref.length < 5
    )
      return res.status(400).json({ error: "partner_review_required" });
    await withTransaction(
      db,
      async (conn) => {
        const { rowCount } = await conn.query(
          "UPDATE affiliate_partners SET status='active',approved_by=$2 WHERE id=$1",
          [id(req.params.id), req.user.id],
        );
        if (!rowCount) throw new Error("partner_not_found");
        await logAdminAction({
          adminId: req.user.id,
          action: "growth_partner_approved",
          targetType: "affiliate_partner",
          targetKey: req.params.id,
          after: { review_ref: req.body.review_ref },
          client: conn,
        });
      },
      "growth_partner_activate",
    );
    res.sendStatus(204);
  }),
);
router.get(
  "/partners/:id/feeds",
  requirePermission("manage_affiliate_partners"),
  wrap(async (req, res) => {
    const partnerId = id(req.params.id);
    const { rows } = await db.query(
      `SELECT f.*, (SELECT row_to_json(r) FROM partner_feed_runs r
        WHERE r.feed_id=f.id ORDER BY r.started_at DESC LIMIT 1) AS last_run
       FROM partner_feeds f WHERE f.partner_id=$1 ORDER BY f.id`,
      [partnerId],
    );
    res.json({ rows });
  }),
);
router.post(
  "/partners/:id/feeds",
  requirePermission("manage_affiliate_partners"),
  wrap(async (req, res) => {
    const partnerId = id(req.params.id);
    const b = req.body || {};
    let host = null;
    try {
      const url = new URL(b.url);
      if (url.protocol === "https:" && !url.username && !url.password)
        host = url.hostname.toLowerCase();
    } catch {
      host = null;
    }
    if (
      !host ||
      !["csv", "json", "xml", "google_merchant"].includes(b.format) ||
      (b.field_mapping !== undefined &&
        (typeof b.field_mapping !== "object" ||
          b.field_mapping === null ||
          Array.isArray(b.field_mapping) ||
          Object.entries(b.field_mapping).some(
            ([k, v]) =>
              !require("../growth/partners/feedParse").CANONICAL_FIELDS.includes(k) ||
              typeof v !== "string" ||
              !v ||
              v.length > 120,
          ))) ||
      (b.schedule_hours !== undefined &&
        (!Number.isInteger(b.schedule_hours) ||
          b.schedule_hours < 1 ||
          b.schedule_hours > 168))
    )
      return res.status(400).json({ error: "invalid_feed" });
    const result = await withTransaction(
      db,
      async (conn) => {
        const {
          rows: [partner],
        } = await conn.query(
          "SELECT link_domains_allowlist FROM affiliate_partners WHERE id=$1",
          [partnerId],
        );
        if (!partner) throw new Error("partner_not_found");
        // The feed host must be the partner's own allowlisted domain (or be
        // added to it by a partner edit first): feeds are never fetched from
        // arbitrary hosts.
        if (!partner.link_domains_allowlist.includes(host))
          throw Object.assign(new Error("feed_host_not_allowlisted"), {
            status: 400,
          });
        const {
          rows: [feed],
        } = await conn.query(
          `INSERT INTO partner_feeds(partner_id,url,format,field_mapping,schedule_hours)
           VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [
            partnerId,
            b.url,
            b.format,
            b.field_mapping || {},
            b.schedule_hours || 24,
          ],
        );
        await logAdminAction({
          adminId: req.user.id,
          action: "growth_partner_feed_created",
          targetType: "partner_feed",
          targetKey: feed.id,
          after: { partner_id: partnerId, format: b.format, host },
          client: conn,
        });
        return feed;
      },
      "growth_partner_feed_create",
    );
    res.status(201).json(result);
  }),
);
router.post(
  "/partners/feeds/:id/run",
  requirePermission("manage_affiliate_partners"),
  wrap(async (req, res) => {
    const feedId = id(req.params.id);
    const result = await require("../jobs/partnerFeedImport").runFeed(
      Number(feedId),
    );
    await logAdminAction({
      adminId: req.user.id,
      action: "growth_partner_feed_run",
      targetType: "partner_feed",
      targetKey: feedId,
      after: result?.skipped ? { skipped: true } : { status: result?.status },
    });
    res.json(result);
  }),
);
router.get(
  "/partners/category-map",
  requirePermission("manage_affiliate_partners"),
  wrap(async (req, res) => {
    const partnerId = id(req.query.partner_id);
    const { rows } = await db.query(
      `SELECT m.*, n.code AS node_code FROM partner_category_map m
       JOIN demand_taxonomy_nodes n ON n.id=m.node_id
       WHERE m.partner_id=$1 ORDER BY m.category_path`,
      [partnerId],
    );
    res.json({ rows });
  }),
);
router.post(
  "/partners/category-map",
  requirePermission("manage_affiliate_partners"),
  wrap(async (req, res) => {
    const b = req.body || {};
    const partnerId = id(b.partner_id),
      nodeId = id(b.node_id);
    if (
      typeof b.category_path !== "string" ||
      !b.category_path.trim() ||
      b.category_path.length > 500
    )
      return res.status(400).json({ error: "invalid_category_map" });
    await withTransaction(
      db,
      async (conn) => {
        const { rows } = await conn.query(
          `SELECT 1 FROM affiliate_partners WHERE id=$1
           UNION ALL SELECT 1 FROM demand_taxonomy_nodes WHERE id=$2`,
          [partnerId, nodeId],
        );
        if (rows.length < 2) throw new Error("category_map_target_missing");
        await conn.query(
          `INSERT INTO partner_category_map(partner_id,category_path,node_id,approved_by)
           VALUES($1,$2,$3,$4)
           ON CONFLICT(partner_id,category_path,node_id) DO NOTHING`,
          [partnerId, b.category_path.trim(), nodeId, req.user.id],
        );
        await logAdminAction({
          adminId: req.user.id,
          action: "growth_partner_category_mapped",
          targetType: "affiliate_partner",
          targetKey: partnerId,
          after: { category_path: b.category_path.trim(), node_id: nodeId },
          client: conn,
        });
      },
      "growth_partner_category_map",
    );
    res.sendStatus(204);
  }),
);
router.get(
  "/partners/unmapped-categories",
  requirePermission("manage_affiliate_partners"),
  wrap(async (req, res) => {
    const partnerId = id(req.query.partner_id);
    // Raw feed categories with no reviewed mapping (exact or parent). They
    // stay unmapped for admin review; nothing is guessed live (spec 13.3).
    const { rows } = await db.query(
      `SELECT p.category_path, COUNT(*)::int AS products
       FROM marketplace_products p
       WHERE p.partner_id=$1 AND p.category_path IS NOT NULL
         AND NOT EXISTS(
           SELECT 1 FROM partner_category_map m WHERE m.partner_id=$1
             AND (p.category_path=m.category_path
               OR p.category_path LIKE m.category_path || ' > %'))
       GROUP BY p.category_path ORDER BY products DESC LIMIT 200`,
      [partnerId],
    );
    res.json({ rows });
  }),
);
// Conversions are finance data (spec 13.5/15.1): the list is visible with
// manage_affiliate_partners, but money columns are returned only to admins
// holding view_financials. Assisted conversions (spec 13.1) are listed for
// reconciliation and never counted in engine totals.
async function financeVisible(user) {
  if (user.role === "super_admin") return true;
  return require("../middleware/adminAuth").hasGlobalGrant(
    user.id,
    "view_financials",
  );
}
router.get(
  "/conversions",
  requirePermission("manage_affiliate_partners"),
  wrap(async (req, res) => {
    const boundary = await access.scope(req.user, "manage_affiliate_partners");
    const finance = await financeVisible(req.user);
    const params = [];
    const where = [];
    if (req.query.partner_id) {
      params.push(id(req.query.partner_id));
      where.push(`c.partner_id=$${params.length}`);
    }
    if (
      ["pending", "approved", "reversed", "paid", "flagged"].includes(
        req.query.status,
      )
    ) {
      params.push(req.query.status);
      where.push(`c.status=$${params.length}`);
    }
    if (!boundary.global)
      where.push(access.predicate(boundary, "g", params));
    const money = finance
      ? "c.sale_minor, c.commission_minor, c.currency, c.order_ref_hash,"
      : "";
    const { rows } = await db.query(
      `SELECT c.id, c.partner_id, p.code AS partner_code, c.click_id, ${money}
        c.status, c.assisted, c.fraud_flags, c.created_at, c.updated_at
       FROM affiliate_conversions c JOIN affiliate_partners p ON p.id=c.partner_id
       JOIN offer_clicks oc ON oc.click_id=c.click_id
       JOIN offer_campaign_deliveries d ON d.id=oc.delivery_id
       JOIN offer_campaign_recipients r ON r.id=d.recipient_id
       JOIN users u ON u.id=r.user_id
       LEFT JOIN geo_postal_centroids g ON g.country=u.country AND g.postal_code=u.zip_code
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY c.id DESC LIMIT 200`,
      params,
    );
    const { rows: totals } = await db.query(
      `SELECT c.currency, c.status, COUNT(*)::int AS n,
        ${finance ? "SUM(c.sale_minor)::bigint AS sale_minor, SUM(c.commission_minor)::bigint AS commission_minor" : "NULL AS sale_minor, NULL AS commission_minor"}
       FROM affiliate_conversions c
       JOIN offer_clicks oc ON oc.click_id=c.click_id
       JOIN offer_campaign_deliveries d ON d.id=oc.delivery_id
       JOIN offer_campaign_recipients r ON r.id=d.recipient_id
       JOIN users u ON u.id=r.user_id
       LEFT JOIN geo_postal_centroids g ON g.country=u.country AND g.postal_code=u.zip_code
       WHERE NOT c.assisted ${where.length ? `AND ${where.join(" AND ")}` : ""}
       GROUP BY c.currency, c.status`,
      params,
    );
    res.json({ rows, totals, finance });
  }),
);
router.get(
  "/conversions/export",
  requirePermission("view_financials"),
  requirePermission("export_data"),
  wrap(async (req, res) => {
    const boundary = await access.scope(req.user, "view_financials");
    const params = [];
    const where = [];
    if (req.query.partner_id) {
      params.push(id(req.query.partner_id));
      where.push(`c.partner_id=$${params.length}`);
    }
    if (!boundary.global)
      where.push(access.predicate(boundary, "g", params));
    // Fail-closed: the audit row is written in the same transaction as the
    // read; if it cannot be written, no data leaves (spec 15.2).
    const rows = await withTransaction(
      db,
      async (conn) => {
        await logAdminAction({
          adminId: req.user.id,
          action: "growth_conversions_exported",
          targetType: "affiliate_conversions",
          after: { partner_id: req.query.partner_id || null },
          client: conn,
        });
        const { rows: data } = await conn.query(
          `SELECT c.id, p.code AS partner_code, c.click_id, c.order_ref_hash,
            c.sale_minor, c.commission_minor, c.currency, c.status,
            c.assisted, c.created_at, c.updated_at
           FROM affiliate_conversions c JOIN affiliate_partners p ON p.id=c.partner_id
           JOIN offer_clicks oc ON oc.click_id=c.click_id
           JOIN offer_campaign_deliveries d ON d.id=oc.delivery_id
           JOIN offer_campaign_recipients r ON r.id=d.recipient_id
           JOIN users u ON u.id=r.user_id
           LEFT JOIN geo_postal_centroids g ON g.country=u.country AND g.postal_code=u.zip_code
           ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
           ORDER BY c.id DESC LIMIT 10000`,
          params,
        );
        return data;
      },
      "growth_conversions_export",
    );
    const cell = (v) => {
      const s = v === null || v === undefined ? "" : String(v);
      // Formula-safe CSV, matching the query builder export convention.
      return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
    };
    const header = [
      "id",
      "partner_code",
      "click_id",
      "order_ref_hash",
      "sale_minor",
      "commission_minor",
      "currency",
      "status",
      "assisted",
      "created_at",
      "updated_at",
    ];
    const csv = [
      header.join(","),
      ...rows.map((r) => header.map((h) => cell(r[h])).join(",")),
    ].join("\n");
    res
      .set("Content-Type", "text/csv")
      .set(
        "Content-Disposition",
        "attachment; filename=growth-conversions.csv",
      )
      .send(csv);
  }),
);
router.get(
  "/campaigns",
  grant("manage_marketing"),
  wrap(async (req, res) => {
    const boundary = await access.scope(req.user, "manage_marketing");
    const { rows } = await db.query(
      `SELECT c.*, (SELECT COUNT(*)::int FROM offer_campaign_recipients r WHERE r.campaign_id=c.id) AS recipients
    FROM offer_campaigns c WHERE ($1::boolean OR c.created_by=$2) ORDER BY id DESC LIMIT 100`,
      [boundary.global, req.user.id],
    );
    res.json({ rows });
  }),
);
router.post(
  "/campaigns",
  grant("manage_marketing"),
  wrap(async (req, res) => {
    const b = req.body;
    if (
      !Array.isArray(b.channels) ||
      !b.channels.length ||
      b.channels.some((c) => !["in_app", "push"].includes(c)) ||
      typeof b.name !== "string" ||
      !b.name.trim() ||
      b.name.length > 120
    )
      return res.status(400).json({ error: "invalid_campaign" });
    campaigns.validateCopy(b.copy, b.channels);
    const result = await withTransaction(
      db,
      async (conn) => {
        const {
          rows: [s],
        } = await conn.query(
          "SELECT created_by FROM growth_segment_versions WHERE id=$1",
          [id(b.segment_version_id)],
        );
        const boundary = await access.scope(req.user, "manage_marketing");
        if (!s || (!boundary.global && s.created_by !== req.user.id))
          throw Object.assign(new Error("segment_access_denied"), {
            status: 403,
          });
        const {
          rows: [c],
        } = await conn.query(
          `INSERT INTO offer_campaigns(name,offer_id,segment_version_id,channels,copy,holdout_pct,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            b.name,
            id(b.offer_id),
            id(b.segment_version_id),
            b.channels,
            b.copy,
            b.holdout_pct ?? 10,
            req.user.id,
          ],
        );
        await logAdminAction({
          adminId: req.user.id,
          action: "growth_campaign_created",
          targetType: "offer_campaign",
          targetKey: c.id,
          client: conn,
        });
        return c;
      },
      "growth_campaign",
    );
    res.status(201).json(result);
  }),
);
router.post(
  "/campaigns/:id/:action",
  wrap(async (req, res, next) => {
    const action = req.params.action;
    if (!["review", "approve", "queue", "cancel", "pause"].includes(action))
      return res.sendStatus(404);
    const permission = ["approve", "queue"].includes(action)
      ? "approve_growth_campaigns"
      : "manage_marketing";
    return grant(permission)(req, res, () =>
      Promise.resolve(
        withTransaction(
          db,
          async (conn) => {
            const {
              rows: [c],
            } = await conn.query(
              "SELECT * FROM offer_campaigns WHERE id=$1 FOR UPDATE",
              [id(req.params.id)],
            );
            if (!c)
              throw Object.assign(new Error("campaign_not_found"), {
                status: 404,
              });
            const boundary = await access.scope(req.user, permission);
            if (
              !boundary.global &&
              c.created_by !== req.user.id &&
              !["approve", "queue"].includes(action)
            )
              throw Object.assign(new Error("campaign_access_denied"), {
                status: 403,
              });
            if (action === "approve")
              return campaigns.approve(
                conn,
                c,
                req.user,
                req.body.totp,
                req.body.checklist,
              );
            if (action === "queue") return campaigns.queue(conn, c, req.user);
            if (action === "review") {
              if (!["draft", "changes_requested"].includes(c.status))
                throw new Error("invalid_campaign_transition");
              campaigns.validateCopy(c.copy, c.channels);
            } else if (["sent", "cancelled"].includes(c.status))
              throw new Error("invalid_campaign_transition");
            const status = {
              review: "in_review",
              cancel: "cancelled",
              pause: "paused",
            }[action];
            await conn.query(
              "UPDATE offer_campaigns SET status=$2,updated_at=NOW() WHERE id=$1",
              [c.id, status],
            );
            await logAdminAction({
              adminId: req.user.id,
              action: `growth_campaign_${action}`,
              targetType: "offer_campaign",
              targetKey: c.id,
              client: conn,
            });
            return { status };
          },
          `growth_${action}`,
        ),
      )
        .then((result) => res.json(result))
        .catch(next),
    );
  }),
);
router.get(
  "/settings",
  requirePermission("manage_settings"),
  wrap(async (req, res) => {
    const {
      rows: [rollout],
    } = await db.query("SELECT * FROM activity_tracking_rollout WHERE id=1");
    const rules = await require("../growth/jurisdictions").load(db);
    const { rows: settings } = await db.query(
      "SELECT key,value FROM platform_settings WHERE key LIKE 'growth.%'",
    );
    res.json({ rollout, rules, settings });
  }),
);
router.post(
  "/notice/schedule",
  requirePermission("manage_settings"),
  wrap(async (req, res) => {
    const campaign = await withTransaction(
      db,
      (conn) =>
        require("../growth/policyNotice").schedule(conn, {
          ...req.body,
          user: req.user,
        }),
      "growth_notice_plan",
    );
    res.status(201).json({ campaign });
  }),
);
router.post(
  "/notice/:id/start",
  requirePermission("manage_settings"),
  wrap(async (req, res) => {
    if (process.env.GROWTH_POLICY_NOTICE_DELIVERY_ENABLED !== "true")
      return res.status(409).json({ error: "growth_notice_delivery_disabled" });
    await withTransaction(
      db,
      async (conn) => {
        const {
          rows: [c],
        } = await conn.query(
          "UPDATE policy_notice_campaigns SET status='sending' WHERE id=$1 AND status='scheduled' RETURNING *",
          [id(req.params.id)],
        );
        if (!c) throw new Error("invalid_notice_transition");
        await conn.query(
          "UPDATE activity_tracking_rollout SET state='notice_sending' WHERE id=1 AND state='notice_scheduled'",
        );
        await logAdminAction({
          adminId: req.user.id,
          action: "growth_notice_started",
          targetType: "policy_notice",
          targetKey: c.id,
          client: conn,
        });
      },
      "growth_notice_start",
    );
    res.sendStatus(204);
  }),
);
// Growth errors expose stable codes only, never payloads, SQL or provider errors.
router.use((error, req, res, next) => {
  const code = /^[a-z_]+(?::[a-z_:]+)?$/.test(error.message || "")
    ? error.message
    : "growth_request_failed";
  res.status(error.status || error.statusCode || 400).json({ error: code });
});
module.exports = router;
