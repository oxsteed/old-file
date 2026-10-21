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
const { validateRegexPattern } = require("../growth/classify");
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
    const boundary = await access.scope(req.user, "view_growth_insights");
    // Exact distinct windows over the daily subject sets (migration 939):
    // demand is the spec 10.1 weighted score, people is the exact count
    // of distinct people in the trailing 28 days, trend compares the
    // prior 28 days. Nothing here sums daily counts.
    const cells = await require("../growth/insights").computeCells(
      db,
      boundary,
      { intent: req.query.intent || null },
    );
    const freshness = await require("../growth/insights").freshness(db);
    res.json({
      rows: cells.slice(0, 500).map((c) => ({
        id: c.id,
        place_name: c.place_name,
        country: c.country,
        postal_code: c.postal_code,
        lat: c.lat,
        lng: c.lng,
        h3_r5: c.h3_r5,
        h3_r7: c.h3_r7,
        code: c.code,
        labels: c.labels,
        demand: c.demand,
        people: c.people,
        supply: c.supply,
        gap: c.gap,
        trend_pct: c.trend_pct,
        trend_state: c.trend_state,
        anomaly: c.anomaly,
      })),
      attribution: "GeoNames CC BY 4.0",
      window_days: 28,
      counts:
        "exact distinct people, trailing 28 days vs prior 28 days; cells below k are hidden",
      k: 5,
      freshness,
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
  "/taxonomy/review-queue",
  requirePermission("manage_marketing"),
  wrap(async (req, res) => {
    const status = String(req.query.status || "pending");
    if (!["pending", "approved", "rejected"].includes(status))
      return res.status(400).json({ error: "invalid_review_status" });
    const limit = Number(req.query.limit || 50);
    const offset = Number(req.query.offset || 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      return res.status(400).json({ error: "invalid_review_limit" });
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
      return res.status(400).json({ error: "invalid_review_offset" });
    const { rows } = await db.query(
      `SELECT q.id,q.entity_type,q.entity_id,q.proposed_node_id,q.reason,q.status,
              q.created_at,q.reviewed_by,q.reviewed_at,q.review_note,
              pn.code AS proposed_code,pn.labels AS proposed_labels
         FROM classification_review_queue q
         LEFT JOIN demand_taxonomy_nodes pn ON pn.id=q.proposed_node_id
        WHERE q.status=$1
        ORDER BY q.created_at ASC,q.id ASC
        LIMIT $2 OFFSET $3`,
      [status, limit, offset],
    );
    res.json({ rows, status, limit, offset });
  }),
);
router.post(
  "/taxonomy/review-queue/:reviewId/review",
  requirePermission("manage_marketing"),
  wrap(async (req, res) => {
    const reviewId = id(req.params.reviewId);
    const decision = String(req.body?.decision || "");
    if (!["approve", "reject"].includes(decision))
      return res.status(400).json({ error: "invalid_review_decision" });
    const reviewNote = req.body?.review_note == null
      ? null
      : String(req.body.review_note).trim();
    if (reviewNote && reviewNote.length > 500)
      return res.status(400).json({ error: "invalid_review_note" });

    let keywordRule = null;
    if (req.body?.keyword_rule != null) {
      const candidate = req.body.keyword_rule;
      const locale = String(candidate.locale || "");
      const kind = String(candidate.kind || "keyword");
      const pattern = String(candidate.pattern || "").trim();
      const weight = candidate.weight == null ? 0.7 : Number(candidate.weight);
      if (
        decision !== "approve" ||
        !campaigns.LOCALES.includes(locale) ||
        !["keyword", "regex"].includes(kind) ||
        !pattern ||
        pattern.length > (kind === "regex" ? 200 : 120) ||
        /[\r\n]/.test(pattern) ||
        (kind === "regex" && !validateRegexPattern(pattern)) ||
        !Number.isFinite(weight) ||
        weight < 0 ||
        weight > 1
      )
        return res.status(400).json({ error: "invalid_keyword_rule" });
      keywordRule = { locale, kind, pattern, weight };
    }
    if (decision === "approve" && req.body?.node_id == null && !req.body?.node_code)
      return res.status(400).json({ error: "review_node_required" });

    const result = await withTransaction(
      db,
      async (conn) => {
        const {
          rows: [queue],
        } = await conn.query(
          "SELECT * FROM classification_review_queue WHERE id=$1 FOR UPDATE",
          [reviewId],
        );
        if (!queue)
          throw Object.assign(new Error("review_not_found"), { status: 404 });
        if (queue.status !== "pending")
          throw Object.assign(new Error("review_not_pending"), { status: 409 });

        let node = null;
        if (decision === "approve") {
          if (req.body.node_id != null && !/^[1-9]\d{0,15}$/.test(String(req.body.node_id)))
            throw Object.assign(new Error("invalid_review_node"), { status: 400 });
          if (req.body.node_code != null && !/^[a-z][a-z0-9_.]{1,120}$/.test(String(req.body.node_code)))
            throw Object.assign(new Error("invalid_review_node"), { status: 400 });
          const selector = req.body.node_id != null ? "id=$1" : "code=$1";
          const value = req.body.node_id != null ? String(req.body.node_id) : String(req.body.node_code);
          const nodeResult = await conn.query(
            `SELECT id,code,status,sensitive FROM demand_taxonomy_nodes WHERE ${selector}`,
            [value],
          );
          node = nodeResult.rows[0];
          if (!node || node.status !== "active")
            throw Object.assign(new Error("review_node_not_active"), { status: 400 });
        }

        let intent = null;
        if (node) {
          await conn.query(
            "UPDATE entity_intents SET superseded_at=NOW() WHERE entity_type=$1 AND entity_id=$2 AND superseded_at IS NULL",
            [queue.entity_type, queue.entity_id],
          );
          const {
            rows: [createdIntent],
          } = await conn.query(
            `INSERT INTO entity_intents(entity_type,entity_id,node_id,confidence,source)
             VALUES($1,$2,$3,1,'admin') RETURNING *`,
            [queue.entity_type, queue.entity_id, node.id],
          );
          intent = createdIntent;
          if (keywordRule) {
            const {
              rows: [createdRule],
            } = await conn.query(
              `INSERT INTO demand_taxonomy_rules(node_id,locale,kind,pattern,weight)
               VALUES($1,$2,$3,$4,$5)
               ON CONFLICT(node_id,locale,kind,pattern) DO UPDATE SET weight=EXCLUDED.weight
               RETURNING *`,
              [node.id, keywordRule.locale, keywordRule.kind, keywordRule.pattern, keywordRule.weight],
            );
            keywordRule = createdRule;
          }
        }
        const {
          rows: [updatedQueue],
        } = await conn.query(
          `UPDATE classification_review_queue
              SET status=$2,reviewed_by=$3,reviewed_at=NOW(),review_note=$4
            WHERE id=$1 RETURNING *`,
          [reviewId, decision === "approve" ? "approved" : "rejected", req.user.id, reviewNote],
        );
        await logAdminAction({
          adminId: req.user.id,
          action: "growth_classification_overridden",
          targetType: "classification_review",
          targetKey: queue.id,
          before: { status: queue.status, proposed_node_id: queue.proposed_node_id },
          after: {
            decision,
            node_id: node?.id || null,
            keyword_rule: keywordRule ? { locale: keywordRule.locale, pattern: keywordRule.pattern } : null,
            review_note: reviewNote,
          },
          client: conn,
        });
        return { queue: updatedQueue, intent, keyword_rule: keywordRule };
      },
      "growth_classification_review",
    );
    res.json(result);
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
    // Persist finder results under stable ids so segment definitions can
    // pin a cluster area (spec 11.1). First write wins: a cluster id must
    // keep meaning the exact area a campaign pinned.
    try {
      for (const row of rows) {
        const key = require("../growth/geo/clusters").clusterKey({
          intent_code: req.query.intent,
          role: req.query.role,
          country: req.query.country,
          anchor_postal_ref: row.anchor_id,
          miles: row.miles,
          postal_refs: row.postal_refs,
        });
        let {
          rows: [savedCluster],
        } = await db.query(
          `INSERT INTO growth_clusters(cluster_key,intent_code,role,country,anchor_postal_ref,place_name,member_count,radius_miles,postal_refs,definition,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) ON CONFLICT(cluster_key) DO NOTHING RETURNING id`,
          [
            key,
            req.query.intent,
            req.query.role,
            req.query.country,
            row.anchor_id,
            row.place_name || null,
            row.member_count,
            row.miles,
            row.postal_refs,
            JSON.stringify({ source: "cluster_finder" }),
            req.user.id,
          ],
        );
        if (!savedCluster) {
          const { rows: existing } = await db.query(
            "SELECT id FROM growth_clusters WHERE cluster_key=$1",
            [key],
          );
          savedCluster = existing[0];
        }
        row.cluster_id = String(savedCluster.id);
      }
    } catch {
      // Persistence is additive; the finder result still returns.
    }
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
  "/segments/:segmentId/versions",
  grant("manage_marketing"),
  wrap(async (req, res) => {
    // Editing a segment creates version N+1; existing versions are
    // immutable and campaigns keep pointing at the version they used.
    segments.validate(req.body.definition);
    const result = await withTransaction(
      db,
      async (conn) => {
        const {
          rows: [s],
        } = await conn.query(
          "SELECT id,created_by FROM growth_segments WHERE id=$1 FOR UPDATE",
          [id(req.params.segmentId)],
        );
        if (!s)
          throw Object.assign(new Error("segment_not_found"), { status: 404 });
        const boundary = await access.scope(req.user, "manage_marketing");
        if (!boundary.global && s.created_by !== req.user.id)
          throw Object.assign(new Error("segment_access_denied"), {
            status: 403,
          });
        const {
          rows: [latest],
        } = await conn.query(
          "SELECT COALESCE(MAX(version),0)::int AS v FROM growth_segment_versions WHERE segment_id=$1",
          [s.id],
        );
        const {
          rows: [v],
        } = await conn.query(
          "INSERT INTO growth_segment_versions(segment_id,version,definition,created_by) VALUES($1,$2,$3,$4) RETURNING *",
          [s.id, latest.v + 1, req.body.definition, req.user.id],
        );
        await logAdminAction({
          adminId: req.user.id,
          action: "growth_segment_version_created",
          targetType: "growth_segment",
          targetKey: s.id,
          after: { version: v.version },
          client: conn,
        });
        return v;
      },
      "growth_segment_version",
    );
    res.status(201).json(result);
  }),
);
router.post(
  "/segments/preview",
  grant("manage_marketing"),
  wrap(async (req, res) => {
    const boundary = await access.scope(req.user, "manage_marketing");
    const { rows, overlap } = await withTransaction(
      db,
      async (conn) => {
        await conn.query("SET TRANSACTION READ ONLY");
        await conn.query("SET LOCAL statement_timeout='30s'");
        const evaluated = await segments.evaluate(
          conn,
          req.body.definition,
          boundary,
          req.body.partner === true ? "partner_offers" : "activity_offers",
        );
        // Overlap with other active campaigns: how many of these members
        // are already frozen into a live campaign's audience. Counts
        // below k are suppressed like every other growth count.
        let overlapRows = [];
        if (evaluated.length) {
          const { rows: ov } = await conn.query(
            `SELECT r.campaign_id,c.name,COUNT(DISTINCT r.user_id)::int AS shared
             FROM offer_campaign_recipients r JOIN offer_campaigns c ON c.id=r.campaign_id
             WHERE r.user_id=ANY($1::uuid[])
               AND c.status IN ('approved','scheduled','queued','sending')
             GROUP BY r.campaign_id,c.name ORDER BY shared DESC LIMIT 20`,
            [evaluated.map((r) => r.id)],
          );
          overlapRows = ov.map((o) => ({
            campaign_id: o.campaign_id,
            name: o.name,
            shared: o.shared >= 5 ? o.shared : null,
            below_k: o.shared < 5,
          }));
        }
        return { rows: evaluated, overlap: overlapRows };
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
      overlap,
    });
  }),
);
router.post(
  "/segments/members",
  grant("view_growth_insights"),
  wrap(async (req, res) => {
    // Member access is fail-closed (spec 11.2): the reasoned audit row is
    // written in its own transaction BEFORE any member data is read. If
    // the audit write fails, the request fails and no data moves.
    const reason = String(req.body.reason || "").trim();
    if (!reason || reason.length > 500)
      return res.status(400).json({ error: "member_access_reason_required" });
    const versionId = id(req.body.segment_version_id);
    const limit = Math.min(
      25,
      Math.max(1, parseInt(req.body.limit, 10) || 10),
    );
    await withTransaction(
      db,
      async (conn) => {
        await logAdminAction({
          adminId: req.user.id,
          action: "growth_segment_members_viewed",
          targetType: "growth_segment_version",
          targetKey: versionId,
          after: { reason, limit },
          client: conn,
        });
      },
      "growth_member_audit",
    );
    const boundary = await access.scope(req.user, "view_growth_insights");
    const members = await withTransaction(
      db,
      async (conn) => {
        await conn.query("SET TRANSACTION READ ONLY");
        await conn.query("SET LOCAL statement_timeout='30s'");
        const {
          rows: [v],
        } = await conn.query(
          "SELECT definition FROM growth_segment_versions WHERE id=$1",
          [versionId],
        );
        if (!v)
          throw Object.assign(new Error("segment_version_not_found"), {
            status: 404,
          });
        const all = await segments.evaluate(
          conn,
          v.definition,
          boundary,
          req.body.partner === true ? "partner_offers" : "activity_offers",
        );
        // Sample only, and only the fields an admin needs to sanity-check
        // a segment: no names, emails or contact data.
        return all
          .slice(0, limit)
          .map((r) => ({
            id: r.id,
            role: r.role,
            country: r.country,
            preferred_language: r.preferred_language,
          }));
      },
      "growth_members",
    );
    res.json({ members, audited: true });
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
            : "id,offer_id,segment_version_id,predicted_reach,score,rationale,model,status,rejection_reason,created_at";
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
           ORDER BY c.id DESC LIMIT 10001`,
          params,
        );
        // Fail explicitly past the export cap, the same standard as the
        // privacy exports: a silently truncated finance file is worse
        // than no file.
        if (data.length > 10000) {
          const error = new Error("export_result_limit_exceeded");
          error.code = "EXPORT_RESULT_LIMIT_EXCEEDED";
          throw error;
        }
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
    if (
      b.is_personalized !== undefined &&
      typeof b.is_personalized !== "boolean"
    )
      return res.status(400).json({ error: "invalid_campaign" });
    if (
      b.amazon_tracking_tag !== undefined &&
      b.amazon_tracking_tag !== null &&
      !/^[A-Za-z0-9-]{1,64}$/.test(b.amazon_tracking_tag)
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
          `INSERT INTO offer_campaigns(name,offer_id,segment_version_id,channels,copy,holdout_pct,is_personalized,amazon_tracking_tag,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            b.name,
            id(b.offer_id),
            id(b.segment_version_id),
            b.channels,
            b.copy,
            b.holdout_pct ?? 10,
            b.is_personalized !== false,
            b.amazon_tracking_tag || null,
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
router.patch(
  "/campaigns/:id",
  grant("manage_marketing"),
  wrap(async (req, res) => {
    const result = await withTransaction(
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
        const boundary = await access.scope(req.user, "manage_marketing");
        if (!boundary.global && c.created_by !== req.user.id)
          throw Object.assign(new Error("campaign_access_denied"), {
            status: 403,
          });
        const offerId = req.body?.offer_id || c.offer_id;
        const {
          rows: [offer],
        } = await conn.query("SELECT type FROM offers WHERE id=$1", [
          offerId,
        ]);
        if (!offer) throw new Error("offer_not_found");
        return campaigns.editCampaign(conn, c, req.user, req.body, {
          affiliate: offer.type === "affiliate_product",
        });
      },
      "growth_campaign_edit",
    );
    res.json(result);
  }),
);
router.get(
  "/campaigns/:id/results",
  grant("manage_marketing"),
  wrap(async (req, res) => {
    const {
      rows: [c],
    } = await db.query("SELECT * FROM offer_campaigns WHERE id=$1", [
      id(req.params.id),
    ]);
    if (!c) return res.status(404).json({ error: "campaign_not_found" });
    const boundary = await access.scope(req.user, "manage_marketing");
    if (!boundary.global && c.created_by !== req.user.id)
      return res.status(403).json({ error: "campaign_access_denied" });
    const finance = await financeVisible(req.user);
    const results = await campaigns.campaignResults(db, c, { finance });
    res.json({ campaign: { id: c.id, name: c.name, status: c.status }, ...results });
  }),
);
router.get(
  "/campaigns/:id/review-preview",
  grant("manage_marketing"),
  wrap(async (req, res) => {
    const {
      rows: [c],
    } = await db.query("SELECT * FROM offer_campaigns WHERE id=$1", [
      id(req.params.id),
    ]);
    if (!c) return res.status(404).json({ error: "campaign_not_found" });
    const boundary = await access.scope(req.user, "manage_marketing");
    if (!boundary.global && c.created_by !== req.user.id)
      return res.status(403).json({ error: "campaign_access_denied" });
    const preview = await withTransaction(
      db,
      async (conn) => {
        await conn.query("SET TRANSACTION READ ONLY");
        return campaigns.reviewPreview(conn, c, req.user);
      },
      "growth_campaign_preview",
    );
    res.json(preview);
  }),
);
router.post(
  "/campaigns/:id/:action",
  wrap(async (req, res, next) => {
    const action = req.params.action;
    if (
      !["review", "approve", "queue", "cancel", "pause", "schedule", "changes"].includes(
        action,
      )
    )
      return res.sendStatus(404);
    const permission = ["approve", "queue", "schedule"].includes(action)
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
            if (action === "schedule") {
              if (c.status !== "approved")
                throw new Error("invalid_campaign_transition");
              const when = Date.parse(req.body?.scheduled_at || "");
              if (!Number.isFinite(when) || when <= Date.now())
                throw new Error("invalid_campaign_schedule");
              await conn.query(
                "UPDATE offer_campaigns SET status='scheduled',scheduled_at=$2,updated_at=NOW() WHERE id=$1",
                [c.id, new Date(when).toISOString()],
              );
              await logAdminAction({
                adminId: req.user.id,
                action: "growth_campaign_scheduled",
                targetType: "offer_campaign",
                targetKey: c.id,
                after: { scheduled_at: new Date(when).toISOString() },
                client: conn,
              });
              return { status: "scheduled" };
            }
            if (action === "review") {
              if (!["draft", "changes_requested"].includes(c.status))
                throw new Error("invalid_campaign_transition");
              campaigns.validateCopy(c.copy, c.channels);
            } else if (action === "changes") {
              if (c.status !== "in_review")
                throw new Error("invalid_campaign_transition");
            } else if (["sent", "cancelled"].includes(c.status))
              throw new Error("invalid_campaign_transition");
            const status = {
              review: "in_review",
              changes: "changes_requested",
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
router.post(
  "/propensity/run",
  requirePermission("manage_marketing"),
  wrap(async (req, res) => {
    // On-demand recompute of the transparent v1 scorecards plus a fresh
    // calibration report per model (the nightly rollup also runs this).
    const summary = await require("../growth/propensity").computeAll(db);
    await withTransaction(
      db,
      async (conn) => {
        await logAdminAction({
          adminId: req.user.id,
          action: "growth_propensity_computed",
          targetType: "propensity",
          after: summary,
          client: conn,
        });
      },
      "growth_propensity_audit",
    );
    res.json({ summary });
  }),
);
router.get(
  "/propensity/calibration",
  grant("view_growth_insights"),
  wrap(async (req, res) => {
    const propensity = require("../growth/propensity");
    const model = String(req.query.model || "");
    if (!Object.hasOwn(propensity.MODELS, model))
      return res.status(400).json({ error: "unknown_propensity_model" });
    const {
      rows: [latest],
    } = await db.query(
      "SELECT report,computed_at FROM propensity_calibration_reports WHERE model=$1 ORDER BY id DESC LIMIT 1",
      [model],
    );
    res.json({
      report: latest?.report || (await propensity.calibration(db, model)),
      computed_at: latest?.computed_at || null,
      models: Object.keys(propensity.MODELS),
    });
  }),
);
router.post(
  "/suggestions/produce",
  requirePermission("manage_marketing"),
  wrap(async (req, res) => {
    // On-demand run of the nightly producer (spec 12). Not wrapped in one
    // transaction: the producer evaluates segments and may call the
    // self-hosted Ollama re-ranker, which must not hold a transaction open.
    const summary = await require("../growth/recommend/produce").produce(db, {
      authorId: req.user.id,
    });
    res.json(summary);
  }),
);
router.post(
  "/suggestions/:suggestionId/reject",
  requirePermission("manage_marketing"),
  wrap(async (req, res) => {
    // Rejection feedback (spec 12.3): a reasoned rejection lowers the
    // offer x intent pair for 30 days via offer_pair_penalties.
    const reason = String(req.body.reason || "").trim();
    if (!reason || reason.length > 500)
      return res.status(400).json({ error: "rejection_reason_required" });
    await withTransaction(
      db,
      async (conn) => {
        const {
          rows: [s],
        } = await conn.query(
          "SELECT * FROM offer_suggestions WHERE id=$1 FOR UPDATE",
          [id(req.params.suggestionId)],
        );
        if (!s)
          throw Object.assign(new Error("suggestion_not_found"), {
            status: 404,
          });
        if (s.status !== "pending_review")
          throw new Error("suggestion_not_pending");
        await conn.query(
          "UPDATE offer_suggestions SET status='rejected',rejection_reason=$2 WHERE id=$1",
          [s.id, reason],
        );
        const {
          rows: [v],
        } = await conn.query(
          "SELECT definition FROM growth_segment_versions WHERE id=$1",
          [s.segment_version_id],
        );
        const code = v?.definition?.intents?.[0]?.code;
        let nodeId = null;
        if (code) {
          const {
            rows: [n],
          } = await conn.query(
            "SELECT id FROM demand_taxonomy_nodes WHERE code=$1",
            [code],
          );
          nodeId = n?.id || null;
        }
        await conn.query(
          `INSERT INTO offer_pair_penalties(offer_id,node_id,segment_version_id,reason,penalty_until,created_by)
           VALUES($1,$2,$3,$4,NOW()+interval '30 days',$5)`,
          [s.offer_id, nodeId, s.segment_version_id, reason, req.user.id],
        );
        await logAdminAction({
          adminId: req.user.id,
          action: "growth_suggestion_rejected",
          targetType: "offer_suggestion",
          targetKey: s.id,
          after: { reason },
          client: conn,
        });
      },
      "growth_suggestion_reject",
    );
    res.sendStatus(204);
  }),
);
router.post(
  "/suggestions/:suggestionId/accept",
  requirePermission("manage_marketing"),
  wrap(async (req, res) => {
    // Accepting a suggestion creates a draft campaign pinned to the
    // suggestion's segment version and the offer's reviewed copy.
    const result = await withTransaction(
      db,
      async (conn) => {
        const {
          rows: [s],
        } = await conn.query(
          "SELECT * FROM offer_suggestions WHERE id=$1 FOR UPDATE",
          [id(req.params.suggestionId)],
        );
        if (!s)
          throw Object.assign(new Error("suggestion_not_found"), {
            status: 404,
          });
        if (s.status !== "pending_review")
          throw new Error("suggestion_not_pending");
        const {
          rows: [o],
        } = await conn.query("SELECT * FROM offers WHERE id=$1", [s.offer_id]);
        if (!o || o.status !== "active")
          throw new Error("suggestion_offer_not_active");
        campaigns.validateCopy(o.copy, o.channels, {
          affiliate: o.type === "affiliate_product",
        });
        const {
          rows: [c],
        } = await conn.query(
          `INSERT INTO offer_campaigns(name,offer_id,segment_version_id,channels,copy,holdout_pct,created_by)
           VALUES($1,$2,$3,$4,$5,10,$6) RETURNING *`,
          [
            `Suggestion ${s.id}: ${o.title}`.slice(0, 120),
            o.id,
            s.segment_version_id,
            o.channels,
            o.copy,
            req.user.id,
          ],
        );
        await conn.query(
          "UPDATE offer_suggestions SET status='accepted' WHERE id=$1",
          [s.id],
        );
        await logAdminAction({
          adminId: req.user.id,
          action: "growth_suggestion_accepted",
          targetType: "offer_suggestion",
          targetKey: s.id,
          after: { campaign_id: c.id },
          client: conn,
        });
        return c;
      },
      "growth_suggestion_accept",
    );
    res.status(201).json(result);
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
