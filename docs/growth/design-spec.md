# OxSteed Demand & Sales Engine: Design Spec

**Status:** implementation specification and acceptance boundary. The engine remains default-off until the rollout, legal, infrastructure, and external acceptance gates are complete.
**Written against:** `codex/demand-sales-engine`; the original design baseline is `old-files-claude` @ `82711d2a` (October 20, 2026).
**Owner decisions locked by Emile:** track every click, target every role, affiliate partners first and an OxSteed catalog later, admins approve every send, self-hosted Ollama only. Follow-up decisions from October 20 are recorded below and are applied throughout.
**Internal working name:** "Growth Insights" (admin section). It's an internal tool. Users never see the engine. They only see the offers admins approve.

### Emile's decisions (October 20, 2026)

| # | Topic | Decision | Where it's applied |
|---|---|---|---|
| D1 | Cookie toggle outside the EU/UK | **Relabel only**: the analytics toggle covers Google Analytics and persistent device storage. First-party activity tracking covers everyone after the notice. **No separate personalized-offers opt-out.** The only exception: in California and other US states whose law requires it, users get a **"Do not sell or share"** opt-out, and **GPC is honoured for users in those states only**. | §0, §4.1, §4.5, §4.6, §11, §16.2, §17.1, §17.3, §18, §23, §25 |
| D2 | Policy acceptance | **No forced re-acceptance.** A dismissible notice banner, not the blocking re-accept gate (`requireTermsAcceptance`). | §3 (R12), §4.2, §4.4, §24, §25 (K4) |
| D3 | Policy languages | Translate the privacy policy into **all 20** languages. | §3 (R11), §4.1, §23, §25 (K17) |
| D4 | Campaign approval | **The creator can approve and send alone.** No second approver. Audit logging stays. | §0, §15.2, §22, §24 |
| D5 | Event storage | **Self-hosted ClickHouse from day one** (no Postgres-first stage). | §0, §6, §7, §18.1, §19, §20.3, §20.4, §24, §25, appendices |
| D6 | Effective date | **Exactly 14 days after the last notice email is sent.** | §4.3, §4.5, §24 |
| D7 | Channels | **In-app and push now; offer email in Phase 8**, with the postal-address work. The one email now is the legal policy notice, which isn't an offer. | §0, §15.2, §16, §17, §21, §24 |

### Forward decisions D8–D24

These requirements were added to the review baseline and are part of this
specification. A row marked **external** needs evidence outside the source tree;
it remains a release gate even when the supporting code is present.

| # | Requirement | Current implementation boundary |
|---|---|---|
| D8 | Run self-hosted ClickHouse with two replicas and three Keeper nodes in one provider and region. | Schema and role grants are in `server/migrations-clickhouse`; provisioning, replica drills, and provider/region evidence are external. |
| D9 | Switzerland, Canada, and Québec use notice treatment; applicable US opt-out states expose the sale/share control. | Migration `956_growth_jurisdiction_optout_rules.sql` seeds the state rows and leaves them unreviewed until Legal supplies the review reference. |
| D10 | GPC and sale/share opt-out apply only in an applicable US opt-out jurisdiction and block personalized targeting while preserving broad offers. | The gate blocks personalized activity and partner offer purposes; broad partner-link handling remains an explicit acceptance item. |
| D11 | Encrypted same-region ClickHouse backups are retained for seven days and restore-checked. | `server/jobs/growthClickhouseOps.js`, migration `960_growth_clickhouse_ops_runs.sql`, and `docs/growth/clickhouse-runbook.md` provide default-off automation; configured storage, encryption, restore evidence, and retention remain external release gates. |
| D12 | ClickHouse upgrades and health alerts are repeatable and auditable. | The default-off ops worker records health/backup/restore/upgrade outcomes and durable incident alerts; the CI fixture and topology file provide rehearsal scaffolding, while production provisioning and alert delivery remain external. |
| D13 | Users can hide an offer and report “Not relevant”; the display preference is independent from tracking consent. | `offer_preferences` and intent-dismissal flows implement this boundary. |
| D14 | Activity-event retention is 90 days for every jurisdiction and basis. | ClickHouse migration `C005_activity_events_retention.sql` changes the table TTL to one 90-day policy. |
| D15 | Re-engagement and Discover digest sends remain unchanged and stay outside growth-offer frequency caps. | Legacy contacts remain in the audit log; offer cap queries count `source='growth_offer'` only. |
| D16 | GeoNames postal centroids feed `regionScope.js` through a switch with a diff, rollback setting, and admin note. | Migration `958_region_geo_source.sql`, `scripts/regionGeoDiff.js`, `regionScope.js`, and `docs/growth/region-geo-source-runbook.md` implement the compatibility default, switch, diff, rollback, and operator note; evidence is still required before switching. |
| D17 | Policy notices go to account holders only, never business-client audiences. | Notice audience queries are account-user scoped. |
| D18 | Existing `site_visits` analytics stays separate from growth activity events and retention. | No growth writer or rollup reads or writes `site_visits`. |
| D19 | No minors, staff, internal subjects, or impersonated sessions enter growth collection, profiling, or delivery. | `growth_subject_eligibility.adult_confirmed` and gate checks fail closed; adult-status backfill is an external launch dependency. |
| D20 | Offer push is a separate opt-in with a 90-day prompt rule. | `offer_preferences`, `offer_push` consent, and prompt cooldown enforce the channel boundary. |
| D21 | Amazon Associates is the first catalog partner; tracking IDs, report import, and disclosure are required. | Migration `961_growth_amazon_associates.sql` and `server/growth/partners/amazonProducts.js` provide a default-off signed client, campaign tags, report hash evidence, and disclosure; provider terms and credentials remain external. |
| D22 | Helper-assisted attribution never shares or pays helper commission from growth partner revenue. | Assisted fields are audit-only and excluded from affiliate conversion payouts. |
| D23 | Licensed business listings require provenance, license scope, suppression, and per-country outreach controls. | Migration `962_growth_prospects.sql` and `server/growth/prospects/import.js` provide default-off validated import, license/provenance fields, suppression, and outreach controls; licensed source approval remains external. |
| D24 | Privacy policy, notice, and banner content maintain parity across all 20 locales. | All locale files exist; professional translation and browser/RTL/accessibility review remain external acceptance gates. |

---

## 0. One-page summary

The engine has five layers:

1. **Collect.** Record what people do on OxSteed: every click and page view, plus the business events the server already knows about (job posted, bid placed, order paid, and so on). Collection starts only after the privacy policy (all 20 languages) is updated and users get email notice. It turns on exactly 14 days after the last notice email is sent, with no forced re-acceptance, just a dismissible banner. EU/UK users (plus a few other consent jurisdictions) are tracked only if they opt in. Everywhere else, the cookie toggle is relabelled to cover only Google Analytics and device storage. California and similar states also get a "Do not sell or share" opt-out that honours GPC. Raw events go into a **self-hosted ClickHouse** cluster.
2. **Understand.** Tag each job, service, booking, order and search with a demand **intent**, like `plumbing › drain clog`. Rules run first. When the rules aren't confident, Ollama picks from a fixed list. Each person and record is placed by **postal-code centre** (ZIP centroid). Personal coordinates are never stored or used.
3. **Find patterns.** Map demand and supply by area. Find clusters, like "5 plumbers within 35 miles doing drain-clog jobs" or "12 restaurants in this metro whose delivery orders grew 40%". Find the areas where demand exceeds supply, which are OxSteed's potential customers.
4. **Suggest.** Match clusters and segments to offers: affiliate partner products now, OxSteed promo codes and plans, and later OxSteed's own catalog. Rules and statistics pick and score the candidates. Ollama re-ranks the top few and writes the explanation an admin reads.
5. **Send only what an admin approves.** Admins review each suggestion, edit the copy in 5 languages, and approve it. The campaign then goes out through a generalized version of the existing broadcast outbox, **in-app and push only for now**, with push opt-in/opt-out, frequency caps, quiet hours, copy in 5 languages and full audit logging. The admin who creates a campaign can approve and send it; every step is audited. Offer email (via Resend) is a later phase (Phase 8). Nothing is ever sent automatically.

All AI runs on an OxSteed-controlled Ollama server, with no fallback to OpenRouter, Meta or any other outside provider.

---

## 1. Goals and non-goals

### Goals

| # | Goal | Measured by |
|---|------|-------------|
| G1 | Know what each role does on OxSteed, at click level, within the law in each region | Event coverage ≥ 95% of interactive elements; 0 events from users who aren't permitted to be tracked (automated check) |
| G2 | Map demand and supply by area and intent, over time | Daily demand/supply rollups per postal centroid × intent, fresh by 06:00 UTC |
| G3 | Find groups of similar providers near each other (the plumber example) and similar restaurants or businesses | Cluster finder answers "role × intent × X miles × min N" in < 10 s for any country |
| G4 | Turn patterns into ranked, explained offer suggestions for admins | ≥ 30% of suggestions approved (possibly edited) after the first 2 months |
| G5 | Earn affiliate revenue now, and catalog revenue later | Commission per 1,000 recipients, net of reversals, per currency |
| G6 | Find potential customers for OxSteed: areas with unmet demand, and users likely to upgrade or adopt a feature | Gap index per area × intent; propensity lists approved into campaigns |
| G7 | Respect every opt-out and data right, and prove it | Consent, "Do not sell or share" and channel opt-outs honoured at send time (100%); DSARs answered within the legal deadline; full audit trail |

### Non-goals

- **No automatic sends.** Not even "small" ones. Every campaign needs a human approval.
- **No offer emails in the current phases.** Email campaigns, their unsubscribe flow, Resend deliverability work and the CAN-SPAM postal address come in Phase 8 (§24). The design for them is kept in this spec so nothing has to be redone.
- **No sale or sharing of personal data with partners.** Partners only receive an anonymous click id. The engine never exports user lists to partners, ad networks or data brokers.
- **No third-party AI.** No OpenRouter, Meta or OpenAI calls from this engine. No prompts leave OxSteed-controlled servers.
- **No scraping of off-platform people or businesses.** "Potential customers" means areas with unmet demand, plus users already on OxSteed. Licensed business-listing data is an open question (§26).
- **No individual coordinates.** Users are placed by postal-code centre only. Job and helper coordinates that already exist (`jobs.location_lat/lng`, `helper_profiles.service_location`) are not read by the engine.
- **No sensitive inferences.** No health, religion, ethnicity, sexuality, political views, financial distress, or Credit status (§8.6).
- **No money movement.** Affiliate commissions come in from partners. The engine pays nobody, so the existing two-distinct-admin money rules (`server/services/dualApprovalService.js`, ADM-016) are not involved and are unchanged. **P3-1009 is not touched.** OxSteed Credit data is excluded from the engine entirely, and Credit checkout keeps refusing promo codes.
- **No change to the Promote 7-day account linking** Emile chose to keep (`docs/analytics-platform/privacy-consent-notes.md`). The policy update in §4 is a chance to finally describe it.
- **No change to the analytics NL model decision.** `ANALYTICS_NL_MODEL_ENABLED` stays `false` (§20.4).

---

## 2. What already exists (inventory)

Everything below was read on `old-files-claude` @ `82711d2a`.

### 2.1 Analytics events and tracking

| What | Where | Notes for this engine |
|---|---|---|
| First-party pageview beacon | `client/src/components/PageviewBeacon.jsx` → `POST /api/analytics/pageview` (`server/routes/siteVisits.js`) → `server/services/siteVisitService.js` → `site_visits` | Fires only with analytics-cookie consent. Skips `DNT: 1`. Stores a salted IP hash, country/region/city from Cloudflare headers, and the full user agent. Pruned after 90 days (`server/jobs/siteVisitRetention.js`). Admin view needs `view_visitor_analytics`. |
| GA4 wrapper | `client/src/utils/analytics.js` (`trackEvent`, `analytics.jobPosted`, `bidPlaced`, `learnBuyClicked` …) | Sends to Google only. Gives us a starting list of event names. |
| Consent banner and state | `client/src/hooks/useCookieConsent.ts` (`CONSENT_VERSION = '2026-10-13'`, categories essential/analytics/marketing/functional, GPC disables marketing), `client/src/context/CookieConsentContext.tsx`, `client/src/components/CookieConsent.tsx`, `client/src/utils/consentScripts.ts` | **Stored in browser `localStorage` only.** The server has no record of cookie consent (see risk R1). |
| Policy acceptance ledger | `user_consents` (migration `001`), `server/routes/consent.js`, `server/middleware/requireTermsAcceptance.js`, `server/constants/termsConfig.js` (privacy `2026-10-13`) | Clickwrap acceptance per version. Bumping a version makes every API call return 403 `terms_acceptance_required` until the user re-accepts. |
| Campaign events (featured placements) | `server/analytics/campaignAnalytics.js`, migrations `889`, `895` (`campaign_analytics_events`) | impression/click/conversion. |
| Tool rental events | migration `076` (`tool_rentals_analytics`), `client/src/api/toolRentals.js` | view/favorite/inquire/book/review. |
| Discover search log | migration `087` (`discover_search_log`), `server/controllers/discoverController.js:46-60` | Logs normalized query, result count, radius, **raw lat/lng**, IP hash and user id for every search (see risk R2). |
| Saved searches / planned needs | migrations `288` (`saved_searches`), `041` (`planned_needs`) | Strong future-demand signals. |

### 2.2 Promote link analytics

| What | Where |
|---|---|
| Tracked shares, visits and conversions | `server/analytics/promotionLinkAnalytics.js` (730-day retention, 7-day attribution), migrations `900`, `909`, `910` (`promotion_link_events`) |
| Client beacon and device id | `client/src/hooks/usePromotionVisitBeacon.js`, `client/src/utils/promotionVisitor` (localStorage with consent, sessionStorage without) |
| Attribution and net conversions | `server/analytics/promotionAttribution.js`, migration `910` reversal triggers on `booking_requests`, `business_appointments`, `food_orders`, `jobs` |
| Non-consent 7-day account link | `account_key` column, cleared after 7 days. Kept as is (Emile's decision). |

### 2.3 Broadcasts, outbox and delivery tracking

| What | Where |
|---|---|
| Delivery worker (leases, SKIP LOCKED, backoff, idempotent Resend keys) | `server/services/broadcastDeliveryService.js`, `server/jobs/broadcastDelivery.js`, started in `server/bootstrap/backgroundWorkers.js`. On unless `BROADCAST_DELIVERY_ENABLED=false`. |
| Tables | migration `906` (`business_broadcast_recipients`, `business_broadcast_deliveries`, `business_broadcast_suppressions`, `notification_preferences.email_notifications/marketing_emails`) |
| Resend webhooks (delivered, bounced, complained) | `POST /api/webhooks/resend`, `server/services/resendWebhookService.js`, migration `907` |
| Push open contract | `docs/analytics-platform/push-open-contract.md` |
| Email sending | `server/utils/email.js` (Resend REST, single send, idempotency keys) |
| Global email preferences and unsubscribe tokens | `server/controllers/emailPreferencesController.js` (`unsubscribe_all`, `unsubscribed_from_bulk_emails`, category tokens) |
| Other outboxes to copy patterns from | `server/services/jobEventOutbox.js` (transactional, coalescing), `server/services/supportEmailOutbox.js`, `server/jobs/messageNotificationOutbox.js` |
| **Existing automatic marketing-type sends** | `server/jobs/customerReengagementJob.js` (daily nudge email and notification), `server/jobs/discoverDigest.js` (saved-search digest) |

**Important:** the broadcast system is **business-scoped**. `business_broadcasts.business_id` is required, the audience is a business's own clients, and the email footer says "you are a customer of {{business}}". So the platform needs a generalized delivery core (§16), not a copy of the business broadcast.

### 2.4 Regions, scoping and geo

| What | Where |
|---|---|
| Region definitions (`zip_range`, `city_state`, `geo_radius`, `country_region`, `country_only`) | migrations `115`/`119` (`admin_regions`, `admin_permission_grants.region_id`), `server/controllers/adminRegionController.js`, `client/src/admin/pages/super/RegionsManager.jsx` |
| Region-filtered SQL (shadow CTEs, fail closed) | `server/analytics/regionScope.js` (ANCHORS for jobs, food, payments, support …), `server/utils/scopeFilter.js`, `server/middleware/regionAuth.js` |
| Grant resolution (global vs regional, `globalOnly`) | `server/middleware/adminAuth.js` (`requirePermission`), `server/analytics/metricAccess.js`, `server/services/scopeModel.js` |
| Confirmed country | migration `908` (`users.country_confirmed`). `users.country` defaults to `US`. |
| ZIP centroid for users | `regionScope.js` `USER_GEO` joins `direct_geocode_cache` (migration `377`, filled by `server/services/directServiceAreas.js` `cacheGeocode`), US 5-digit ZIPs only (see risk R3) |
| PostGIS | enabled in migration `001` (`jobs.location_point`, GiST index) |
| GDPR country list | `server/validation/countries.js` (31 EU/EEA/UK codes), used by `server/services/privacyRetentionService.js` (`GDPR_COUNTRIES`) |
| Markets admin | `client/src/admin/pages/MarketZipCodes.jsx` (`/admin/markets`) |

### 2.5 Snapshots and governed metrics

| What | Where |
|---|---|
| Registry of 18 governed metrics | `server/analytics/metricsRegistry.js`, `operationalMetrics.js`, `financialMetrics.js` |
| Builder, evidence, access, alerts | `server/analytics/queryBuilder.js` (fixed templates, read-only, fail-closed ledger), `metricEvidence.js`, `metricAccess.js`, `metricAlerts.js` |
| Nightly snapshots | `server/analytics/metricSnapshots.js`, `server/jobs/metricSnapshots.js`, migration `904` (`metric_daily_snapshots`, `metric_snapshot_runs`) |
| Governed KPI cards | `server/analytics/governedKpis.js` |

### 2.6 Ollama and AI providers

| What | Where |
|---|---|
| Ollama URL allowlist (SSRF guard) | `server/services/supportChatProviders.js` (`OLLAMA_ALLOWED_HOSTS`: localhost, `ollama-api`, `ollama-api-p116fo3uwyxytib7ph3yleei`; `resolveOllamaUrl`) |
| Ollama call | `server/controllers/chatController.js:132-190` (`fetchOllamaChat`, `OLLAMA_MODEL` default `qwen2.5:3b`; `callWithFallback` tries **OpenRouter first**, then Ollama) |
| Provider health | `server/services/providerHealthRegistry.js:211-224` |
| Meta provider | `server/services/aiChatProvider.js` |
| Analytics NL fallback (off) | `server/analytics/nlModelTranslator.js`. Despite the docs saying "existing provider", it actually requires `provider.isMetaConfigured()`, so it would call **Meta**. `ANALYTICS_NL_MODEL_ENABLED=false` (`server/.env.example:388`). |
| AI tagging precedent (external) | `server/services/learnTagging.js` (OpenRouter) → `learn_guide_ai_suggestions`, admin review in `client/src/admin/pages/LearnAiSuggestionsAdmin.jsx` |

### 2.7 Affiliate, promo and products

| What | Where |
|---|---|
| Helper-affiliate program (helpers earn commission on shared carts), gated by `AFFILIATE_ENABLED` | `server/routes/affiliatePayouts.js` (`requireFeatureEnabled('Affiliate','AFFILIATE_ENABLED')`), `server/middleware/launchGate.js:107`, `server/controllers/affiliatePayoutsController.js`, `AffiliateAnalyticsController.js`, `server/jobs/affiliateCommissionBatch.js`, `server/services/affiliateAntiFraudService.js`; migrations `131`, `297`, `771` |
| Product catalog with skill mapping | migration `125` (`marketplace_products` with `source` 'homedepot'/'internal', `affiliate_url`; `marketplace_product_skills` product↔`skills_lookup` with relevance; `affiliate_links_log`) |
| Marketplace orders and clicks | migration `129` (`marketplace_orders`, `affiliate_clicks` with raw `ip_address`/`user_agent` columns), `server/controllers/cartCheckoutController.js:420-450` |
| Job kits (job type → SKUs) | migration `662` (`job_kit_definitions`), `server/services/jobKitService.js` ("prices always come from the live catalog") |
| Learn product links (Amazon, partner, own inventory, rental) | migration `290` (`learn_product_links`), `client/src/admin/pages/LearnProductLinksAdmin.jsx`, `client/src/pages/LearnModePage.jsx:59` (hard-coded Amazon tag `oxsteed-20`, `rel="noopener sponsored"`) |
| Promo codes and checkout redemption | `server/services/discountService.js`, `server/services/promoRedemptionService.js`, migration `905` (`promo_redemptions`, `discount_codes.per_user_limit/currency_code/applicable_surfaces`). Food promos are restaurant-funded by a DB check. Credit checkout refuses codes. |
| Marketing permission | `manage_marketing` (`server/controllers/adminPermissionController.js:29`): discount codes, featured placements |

### 2.8 Taxonomies

| Taxonomy | Where |
|---|---|
| Job categories (hierarchical, `parent_id`) | `categories` (migration `019`); `jobs.category_id`, `jobs.category_name`, `jobs.job_type` enum (migration `001`) |
| Helper skills (250) and licenses (250) | `skills_lookup`, `licenses_lookup` (migration `037`); `helper_skills.category_id` |
| Business categories and subtypes | `server/services/businessCategories.js` (food, services, retail, beauty …) |
| Business services | `business_services.category` (migrations `075`, `220`) |
| OxSteed Direct catalog | `direct_catalog_categories`, `direct_catalog_services` (migration `611`), `server/services/directCatalogService.js` |
| Food | `food_restaurants.cuisine_tags` (GIN), `food_menu_categories`, `food_menu_items.tags/allergens` (migration `305`) |
| Learn guide categories | `server/services/learnTagging.js` `LEARN_CATEGORIES` |
| Planned needs | `planned_needs.category` (`car_care`, `personal_care`, `other`) |
| Job kits | `job_kit_definitions.job_type` |

### 2.9 Privacy, rights and audit

| What | Where |
|---|---|
| Privacy policy text | `client/src/locales/privacy/<locale>.content.json`, **20 locales** (ar, bn, de, en, es, fr, hi, ht, id, it, ja, ko, pt, ru, sw, th, tr, ur, vi, zh). "Last updated" lives in each main catalog (`privacyPage.lastUpdated`, e.g. `client/src/locales/en.json:3222`). Page: `client/src/pages/privacy.tsx`. |
| Cookie policy | `client/src/pages/cookiepolicy.tsx` (`cookiePolicyPage.*` keys) |
| Do-not-sell | `client/src/pages/donotsell.tsx` → `POST /legal/ccpa-requests` (`server/routes/legalDocuments.js`) |
| Export and deletion | `server/routes/privacy.js` (`/export`, `/delete-account`, `/data-categories`), `server/services/privacyRetentionService.js` (behind `FEATURE_PRIVACY_RETENTION`), `server/jobs/scheduledDeletionJob.js`, `server/services/accountDeletionGuard.js` |
| Admin audit (hash chain, daily verification) | `server/services/auditService.js` (`logAdminAction`), migration `406`, `server/jobs/adminAuditChainVerification.js` |
| Separation of duties for settings | `server/controllers/settingsChangeController.js:718` (a proposer can't schedule their own change), `server/jobs/settingsChangeApplier.js` |
| Step-up auth | `server/services/stepupChallengeService.js` |

---

## 3. Risks found in the existing code

These affect the design. The first six should be fixed or decided before tracking starts.

| # | Risk | Evidence | What the engine does about it |
|---|------|----------|-------------------------------|
| R1 | **Cookie consent has no server record.** The server can't prove an EU user opted in. | `useCookieConsent.ts` writes `localStorage` only | Add a server-side consent ledger (§4.6) before any EU/UK tracking. |
| R2 | **Discover searches store raw coordinates and user id** for every visitor, regardless of consent. No retention job, and not in the privacy export. That conflicts with today's policy and with "no stored coordinates". | migration `087`; `discoverController.js:46-60` | Separate pre-work: snap to a postal centroid (or drop) lat/lng, add retention (90 days) and add it to the export. The engine reads only the fixed version. |
| R3 | **ZIP centroids are incomplete.** `direct_geocode_cache` is a geocoding cache keyed by query text and filled only when something gets geocoded. It covers US 5-digit ZIPs only, so `geo_radius` regions silently drop users whose ZIP was never geocoded. | `regionScope.js:115-125`; migration `377` | New reference table `geo_postal_centroids` (§9). Switching `regionScope.js` to it changes existing regional numbers, so it's a separate decision (Q10). |
| R4 | **Marketing email defaults to on.** `marketing_emails DEFAULT TRUE` is fine under US opt-out rules but isn't valid consent for EU/UK marketing email. | migration `906` | Matters once offer email arrives (Phase 8). Consent jurisdictions then need a separate explicit opt-in (§17). |
| R5 | **The broadcast outbox is business-only.** | `business_broadcasts.business_id`, footer copy in `broadcastDeliveryService.js` | Extract a shared delivery core; platform campaigns get their own tables (§16). |
| R6 | **Automatic marketing-type sends already exist** without admin review. | `customerReengagementJob.js`, `discoverDigest.js` | The engine's frequency caps count them. Whether they stay automatic is Q9. |
| R7 | **The NL "model fallback" would call Meta**, an outside provider. | `nlModelTranslator.js:6` | The engine never uses `aiChatProvider` or `callWithFallback` (§20). |
| R8 | **Raw IPs and user agents are stored for affiliate clicks and marketplace orders.** | migration `129` `affiliate_clicks.ip_address`; `affiliateAntiFraudService.js:22-60` | Partner click tracking stores no IP or UA. Existing tables are out of scope but flagged for the privacy review. |
| R9 | **Unsalted or default-salted hashes.** Promote's `visitorHash` and `accountHash` are plain SHA-256 that anyone holding user ids can recompute. `IP_HASH_SALT` falls back to a hard-coded value. | `promotionLinkAnalytics.js:84-95`; `siteVisitService.js:15` | The engine uses keyed HMAC with a secret pepper (§7). |
| R10 | **The privacy export misses analytics data** (`site_visits`, `promotion_link_events`, `discover_search_log`). | `server/routes/privacy.js` | The engine adds its own data and closes these gaps in the same work (§18). |
| R11 | **The policy exists in 20 languages**, not 5. Updating only 5 leaves 15 languages showing the old text. | `client/src/locales/privacy/` | All 20 are translated (D3, §4.1). |
| R12 | **Bumping the privacy version forces re-acceptance**, with a 403 on every API call, for ~6M users including mobile clients. | `requireTermsAcceptance.js` | Avoided: the gate version isn't bumped; a dismissible banner instead (D2, §4.4). |
| R13 | **Redis is optional today**, with in-process fallback. The event queue needs it to be required, persistent (AOF) and highly available. | `docs/resource-cost-optimization.md` §1 | Dedicated or hardened Redis for ingestion (§6). |
| R14 | **Amazon links are hard-coded**, and partner programs restrict where links can appear (Amazon's policy restricts links in email; verify current terms). | `LearnModePage.jsx:59` | Per-partner `allowed_channels` (§13). Less pressing while offers are in-app and push only. |
| R15 | **Platform-funded food promos are impossible.** A DB check makes food codes restaurant-funded. | migration `905` | The engine's OxSteed promos use only job/booking/plan surfaces (§13.5). |
| R16 | **Coordinates already exist** for jobs (`location_lat/lng`, `location_point`) and helpers (`service_location`). | migration `001` | Engine readers are column-allowlisted and never select them (§9). |

---

## 4. Legal gating: policy update, 14-day notice, effective date, switch

### 4.1 Privacy policy text changes

Files: `client/src/locales/privacy/<locale>.content.json`, **all 20 locales** (D3). Each one gets a professional translation of the final English text. en/es/fr/ht/ar also get a native-speaker legal review. The existing disclaimer stays ("This translation is provided for convenience only. The English version is the legally binding document"). "Last updated" lives in `privacyPage.lastUpdated` in each main catalog, so it's updated in all 20 catalogs too. A CI check fails if any of the 20 privacy content files is missing section 14 or has a different section count from English.

Section numbers stay the same, so existing anchors (`privacy-section-N`) and references to "section 12" keep working. The new topic is added as **section 14**.

Draft English text (legal to finalize):

| Section | Change |
|---|---|
| **2. Information We Collect** | Replace "and consented usage events" with: "and activity on OxSteed, such as pages and screens viewed, buttons and links selected, searches, and the jobs, bookings, orders and services you create or respond to. Where the law requires your consent for this, we collect it only after you agree." |
| **3. How We Use Your Information** | Replace "Optional analytics helps us understand usage." with: "We use activity and account records to understand demand for services and food in different areas, improve OxSteed, and choose offers we think are relevant to you, including products from partner retailers and OxSteed's own offers. Our staff review and approve every offer before it is sent. Offers never affect your access to OxSteed, your prices, or how you appear in search." Add: "AI features used for this analysis run on servers OxSteed controls. Your activity is not sent to outside AI providers for it." |
| **4. How We Share Your Information** | Add: "When you open a partner offer, the partner receives a random link code so it can tell us whether a purchase happened. We do not give partners your name, email, account details or activity. Purchases you make on a partner's site are governed by that partner's privacy policy." |
| **6. Data Retention** | Add: "Detailed activity records are kept for up to 90 days. Summaries tied to your account are kept for up to 13 months. Area-level statistics that cannot identify you may be kept longer." |
| **7. Your Rights** | Add: "In the European Economic Area and the United Kingdom, we use your activity for offers only with your consent, and you can withdraw it at any time. If you live in Switzerland or Canada, activity and offers follow the notice treatment described below. If you live in California or another US state that gives you the right, you can opt out of the sale or sharing of your personal information at /do-not-sell or in Settings › Privacy, and we honour the Global Privacy Control signal from your browser. You can turn off offer notifications at any time." (Outside US opt-out states there is no separate opt-out of personalized offers, per D1.) |
| **8. Cookies and Tracking Technologies** | Add: "OxSteed stores a random device code in your browser or app to connect activity on that device. The Analytics setting in Manage Cookies controls this device code and Google Analytics. In the European Economic Area and the United Kingdom, we track activity only with your consent. Switzerland and Canada use notice treatment; elsewhere, we record activity on OxSteed while you use it, as described in section 14." |
| **14. Activity Tracking, Offers and Partner Links (new)** | Plain-language summary: what's tracked, why, the consent regions, the US-state "Do not sell or share" opt-out and GPC, retention, the partner link code, staff review of every offer, the self-hosted AI, no sale of personal data, how to turn off offer notifications. **Also describes the Promote 7-day account link** for signed-in visitors (closes the gap in `privacy-consent-notes.md`). |
| **12. Changes** | Unchanged. This change is treated as material, so the 14-day email rule applies. |

The Cookie Policy (`cookiePolicyPage.*` keys, in all languages the app ships) also changes. It:
- adds the `oxsteed_device_id` storage item
- describes the "Activity & analytics" consent category for consent regions
- says that, outside consent regions, the **relabelled** Analytics toggle controls only Google Analytics and persistent device storage (D1, §4.6)

**Upcoming version during the notice period:** the new text ships as `client/src/locales/privacy/next/<locale>.content.json` (all 20) and shows at `/privacy/upcoming` with "Takes effect on {date}". `/privacy` keeps showing the current text until the effective date. On that date, the "next" files replace the current ones (§4.4).

### 4.2 The 14-day notice email (Resend)

| Item | Design |
|---|---|
| Type | **Legal/service notice**, not marketing. It goes to users who unsubscribed from marketing, and contains **no offers**. |
| Audience | Every account with a deliverable email that isn't deleted or banned. Skips hard-bounced and complaint-suppressed addresses (they can't receive mail anyway). Business clients without an OxSteed account are excluded, because they're a business's contacts, not OxSteed users (Q11). |
| Language | `users.preferred_language` in all 20 policy languages. The email body is translated into en/es/fr/ht/ar. Users of the other 15 languages get the English body with a first line in their language linking to their translated upcoming policy. Arabic and Urdu use `dir="rtl"`. |
| Content | Subject: "We're updating our Privacy Policy on {date}". Body: 4 plain bullets (what we'll collect, why, the consent regions and the US-state opt-out, how to turn off offer notifications), link to `/privacy/upcoming`, link to Settings › Privacy, contact privacy@oxsteed.com. |
| Sending | New `policy_notice_campaigns` and `policy_notice_deliveries` tables, one row per user, using the same lease/SKIP LOCKED/idempotency pattern as `broadcastDeliveryService.js`. Uses the **Resend Batch API** (100 emails per request) through a new `sendEmailBatch` in `server/utils/email.js`. Resend's default limit is 10 requests per second per team, which allows 1,000 emails/s in theory. Throttle to a daily cap (default 750,000/day) for deliverability, so ~6M users go out over ~8 days. Ask Resend for a rate and quota increase beforehand. |
| Tracking | Delivered, bounced and complained via the existing Resend webhook (extended to map notice deliveries). No open pixel on a legal notice. |
| In-app notice (D2) | A **dismissible banner**, not the blocking re-accept gate. It runs from the first send until 30 days after the effective date. 5 languages with RTL; the other 15 languages show English with the link to their translated policy. It links to `/privacy/upcoming` before the date and to `/privacy` after it. Dismissal is stored per account (`policy_notice_acknowledgements`: user, policy version, dismissed_at) and per device for signed-out visitors. It reaches users whose email bounced. |
| Evidence | Each delivery row keeps `sent_at`, the Resend id, the language and the policy version. Together with banner dismissals, that proves when each user was told. |

### 4.3 Effective date (D6: exactly 14 days after the last notice email)

```
effective_at = (sent_at of the LAST successfully sent notice email) + 14 days
```

- **No admin-chosen date.** The server computes `effective_at` when the notice campaign completes (`notice_complete`), and it can't be set any other way.
- **The date in the email.** Notices go out before the last one is sent, so they quote a planned date: the planned last send day (from the daily cap) + 14 days. The send plan is fixed before the first email, and the worker keeps to it.
  - If sending runs late, `effective_at` moves later automatically: the computed date wins. The policy page, banner and upcoming-policy page then show the later date. Nobody gets less than 14 days, because every email quoted an earlier date than the real one.
  - If sending finishes early, the effective date still isn't moved earlier than the date quoted in the emails. That's the one case where `effective_at` = the quoted date, which is more than 14 days after the last email.
- **Stuck deliveries.** Deliveries still retrying at the end of the send plan get at most 24 hours more. After that they're marked `failed` (audited); those users rely on the in-app banner. This keeps one person's mailbox from delaying the date for everyone.
- **New signups.** People who sign up during the notice period see the upcoming policy at signup, and their signup acceptance records both versions.

### 4.4 At the effective date: no forced re-acceptance (D2)

On `effective_at`:
- The "next" content files replace the current ones in all 20 locales.
- `privacyPage.lastUpdated` is updated in all catalogs.
- The banner switches to "Our Privacy Policy changed on {date}".

**`TERMS_CONFIG.privacy_policy.version` (the gate version) is not bumped**, so `requireTermsAcceptance` doesn't return 403 and nobody is blocked (this resolves R12).
- To still record which text people accepted at signup, add a separate `contentVersion` field to `TERMS_CONFIG.privacy_policy`. `User.recordConsent` stores it for new signups, while the re-accept gate keeps comparing only `version`.
- A unit test asserts that changing `contentVersion` never triggers `terms_acceptance_required`.

### 4.5 The tracking switch (keeps everything off until the date)

One rollout record plus a kill switch:

| Piece | Design |
|---|---|
| `activity_tracking_rollout` (singleton row) | `state` ∈ `draft → notice_scheduled → notice_sending → notice_complete → effective`, plus `paused`. Also `policy_version`, `notice_campaign_id`, `first_notice_sent_at`, `last_notice_sent_at`, `planned_effective_at` (quoted in emails), `effective_at` (computed, §4.3). The move to `effective` happens automatically when `now() >= effective_at`. Every transition is audited (`logAdminAction`). |
| Platform setting `growth.activity_tracking_enabled` | Kill switch, default `false`. Changes go through the existing **settings change request** flow (`settingsChangeController.js`), so one admin proposes and a different admin schedules it. This is the existing settings rule, reused and not changed. It's separate from campaign approval, which needs no second admin (D4). |
| Env guard `GROWTH_TRACKING_HARD_OFF=true` | Ops emergency stop that wins over everything. It fails closed: tracking can only run when the value is exactly the lowercase string `false`. Unset, empty, `False`, `FALSE`, `0`, `no`, `off`, padded values or typos all keep tracking off (D-ENG-10). |

**Tracking is allowed for a person only when all of these are true:**

```
hard_off is not set
AND setting activity_tracking_enabled = true
AND rollout.state = 'effective' AND now() >= rollout.effective_at
AND jurisdiction rule for this person allows it (notice basis), OR the person has a current consent record (consent basis)
AND the person isn't a minor, staff/admin, or an impersonation session
AND (for personalized-offer profiling) the person hasn't used "Do not sell or share" / sent GPC in an opt-out state
```

There's no general personalized-offers opt-out outside consent regions (D1).

Enforced in four places, with the server authoritative:
1. `GET /api/activity/config` tells clients whether to collect at all, so nothing is collected when off.
2. `POST /api/activity/batch` re-checks every batch and drops events it isn't allowed to keep (it counts them, but never stores them).
3. The server domain-event emitter (§5.3) checks before writing.
4. Profile builders, segment builders and campaign senders check before reading or sending.

A CI test fails if any code path writes to ClickHouse without calling `trackingGate.allow()`.

**Before the effective date**, the engine can still build **area-level, k-anonymous** demand statistics from records OxSteed already keeps (jobs, orders), with no per-person profiles. That's only if legal agrees it falls under the current "operate and improve the marketplace" purpose (Q5). Otherwise everything waits.

### 4.6 Region-by-region legal gating

Rules live in a data table (`jurisdiction_rules`), so legal can change them without a deploy, through the settings approval flow.

| Jurisdiction | Click/activity tracking | Interest profile and offers | Offer email (Phase 8, later) | Offer push / in-app (current) |
|---|---|---|---|---|
| EU + EEA (30 countries) | **Opt-in consent** ("Activity & analytics") | **Separate opt-in** ("Offers based on my activity") | Opt-in marketing consent (soft opt-in doesn't cover third-party partner products) | Push: OS permission + offer-push opt-in. In-app: offers consent |
| UK | Same as EU (UK GDPR + PECR) | Same | Same | Same |
| Switzerland (D9) | Notice | Notice | Opt-in | Push: offer-push opt-in. In-app: shown |
| Canada, Québec (D9) | Notice | Notice | CASL consent | Push: offer-push opt-in. In-app: shown |
| Canada, rest (D9) | Notice | Notice | CASL: express or implied consent (implied for 2 years after a transaction) | Push: offer-push opt-in. In-app: shown |
| **US "opt-out" states** (California plus the states whose law gives a sale/sharing opt-out; list kept by legal in `jurisdiction_rules`, Q3) | Notice | Notice, plus **"Do not sell or share"** opt-out; **GPC honoured** as that opt-out | CAN-SPAM opt-out (existing prefs) | Push: offer-push opt-in. In-app: shown |
| Other US states | Notice | Notice, no opt-out (D1); GPC not applied | CAN-SPAM opt-out | Push: offer-push opt-in. In-app: shown |
| Brazil (LGPD) | Notice, legitimate interest (documented LIA) | Notice | Opt-out | Push: offer-push opt-in. In-app: shown |
| All others (incl. Haiti) | Notice | Notice, no opt-out (D1) | Opt-out | Push: offer-push opt-in. In-app: shown |
| **Unknown** | **Treated as opt-in (fail closed)** | Opt-in | Opt-in | Opt-in |

**"Do not sell or share" (US opt-out states only, D1).** The engine never sells or shares personal data in the CCPA sense, so legal confirms what the opt-out must switch off (Q3). The design treats it conservatively:
- The person's activity is **not used to pick personalized activity, promo, plan, or partner offers** for them. They're left out of interest profiles and segments used for personalized offers.
- OxSteed's own offers and generic, non-targeted partner offers can still be shown.
- It also switches off marketing cookies (Meta Pixel), as GPC already does today in `useCookieConsent.ts`.

How it's set and stored:
- **Where users set it:** the existing `/do-not-sell` page (`client/src/pages/donotsell.tsx` → `POST /legal/ccpa-requests`), and a new switch in Settings › Privacy that's shown only to users in those states.
- **Storage:** `tracking_consents` with purpose `sale_share_optout`.
- **GPC:** a `Sec-GPC: 1` header or `navigator.globalPrivacyControl` sets the same opt-out, **only when the person's jurisdiction is an opt-out state**. That's the strictest-signal rule below, so a confirmed California profile or a California IP region is enough. GPC from anywhere else doesn't change engine behaviour. The existing browser-wide "GPC disables marketing cookies" behaviour in `useCookieConsent.ts` is outside this engine and unchanged.

**Offer push is opt-in everywhere.** Apple's App Store rule 4.5.4 only allows promotional push after the user explicitly opts in through consent text in the app, with a way to opt out in the app. Google Play expects the same. Using one rule on every platform (iOS, Android and web) keeps it simple.
- **The prompt:** a one-tap "Get offers as notifications?" prompt in 5 languages with RTL. It appears at most once every 90 days, on the in-app offers card or in Settings, and never on first launch.
- **Storage:** each answer is stored in `tracking_consents` (purpose `offer_push`).
- **Not a profiling opt-out:** this is a delivery-channel control required by the app stores.

**Working out someone's jurisdiction (strictest signal wins):**
- Signed in: `users.country` (and province or state), trusted when `country_confirmed` (migration `908`), **plus** the request's `CF-IPCountry` and Cloudflare region header. If either one points to a consent jurisdiction, consent applies. If either one points to a US opt-out state, the "Do not sell or share" controls and GPC apply.
- Signed out: Cloudflare country and region headers. A Canadian visitor with no region header is treated as Québec, and a US visitor with no region header is treated as an opt-out state (both fail closed).
- The result is stored on each event as `jurisdiction` and `basis` (`notice` or `consent`).

**Server-side consent ledger (fixes R1):**
- `tracking_consents` is append-only: `subject_key` or `device_key`, `jurisdiction`, `purpose` (`activity`, `activity_offers`, `offer_email`, `offer_push`, `sale_share_optout`), `granted`, `source` (`banner`, `settings`, `signup`, `gpc`, `do_not_sell_page`, `unsubscribe_link`), `consent_text_version`, `recorded_at`, `ip_hash` (HMAC).
- `tracking_consent_current` holds the latest row per subject and purpose.
- The banner posts to `POST /api/consent/tracking`. Signing in merges a device's choices into the account. Withdrawal or opt-out applies immediately and starts the matching deletion (§18).
- `CONSENT_VERSION` in `useCookieConsent.ts` is bumped, so everyone sees the banner again with the new category text (5 languages, RTL).

**Banner meaning outside consent regions (D1, relabel only):** outside consent regions, first-party activity tracking is covered by the policy and the notice.
- The existing **Analytics toggle is relabelled** to "Google Analytics and device storage" in every app language. It controls only Google Analytics and the persistent `oxsteed_device_id`.
- Declining it means no persistent device id: signed-out activity is kept only for the tab session, and signed-in activity is still recorded.
- No new toggle or opt-out is added there. The relabel ships in the same release as the effective date, so the toggle never promises more than it does.

---


## 5. Event taxonomy and instrumentation

### 5.1 Event families

There are two kinds of events.

- **Client events** are what people tap and see. They're high volume and lower trust.
- **Domain events** are what the server knows happened. They're lower volume, authoritative, and written in the same transaction as the business change.

| Family | Events (name = `family.action`) | Key properties (allowlisted) |
|---|---|---|
| Navigation | `page.view`, `screen.view`, `page.leave` (dwell in seconds, rounded) | `route` (React Router **template**, e.g. `/jobs/:id`), `referrer_kind` (internal/search/social/email/push/direct), `utm_*` |
| Interaction | `ui.click`, `ui.submit`, `ui.toggle`, `ui.tab`, `ui.share`, `ui.copy` | `element_key` (`data-track` id), `route`, `component`, `position` |
| Search | `search.performed`, `search.result_click`, `search.zero_results` | `surface` (discover/helpers/restaurants/learn/jobs), `query_norm` (lower-case, ≤ 100 chars, PII-scrubbed), `filters` (allowlisted keys), `result_count`, `radius_bucket` |
| Content | `learn.guide_view`, `learn.buy_click`, `media.view`, `profile.view` | entity type and id (public objects only) |
| Offers (engine) | `offer.impression`, `offer.click`, `offer.dismiss`, `offer.feedback` (`not_relevant`, `too_many`) | `campaign_id`, `offer_id`, `delivery_id` |
| Account (domain) | `account.signed_up`, `account.role_added`, `account.tier_changed`, `account.verified` | role, tier, country |
| Jobs (domain) | `job.posted`, `job.published`, `job.bid_placed`, `job.assigned`, `job.completed`, `job.cancelled`, `job.unfilled_expired` | `job_id`, `category_id`, `job_type`, budget bucket, currency, postal centroid id |
| Services and bookings (domain) | `booking.requested`, `booking.confirmed`, `booking.cancelled`, `appointment.booked`, `direct.quote_requested` | service id, category |
| Food (domain) | `food.order_placed`, `food.order_paid`, `food.order_cancelled`, `food.order_refunded`, `food.menu_item_added`, `food.delivery_enabled` | restaurant id, cuisine tags, item count, fulfilment, amount bucket |
| Commerce (domain) | `promo.redeemed`, `marketplace.cart_shared`, `marketplace.order_paid`, `tool_rental.booked`, `subscription.started`, `subscription.cancelled` | ids, amounts in minor units + currency |
| Demand planning (domain) | `planned_need.created`, `saved_search.created` | category, due month |

**Never captured:** input values, typed text other than normalized search queries, message or support chat content, payment instrument data, identity documents, dispute narratives, **any OxSteed Credit data**, precise location, raw IP, full URLs (query strings are dropped except `utm_*` and `ref`), clipboard contents, and screen recordings.

Each event has a versioned JSON schema in `server/growth/events/schemas/<name>.v<N>.json`. Unknown events or properties are rejected at ingest and counted per client version.

### 5.2 Client instrumentation (web and apps)

- **`ActivityTracker` provider** (`client/src/growth/ActivityTracker.jsx`), mounted next to `CookieConsentProvider`. It reads `/api/activity/config`, which returns enabled/basis/schema version/sample rate/flush interval and is cached for 10 minutes and on consent change. When not enabled it collects nothing.
- **Autocapture:** one delegated listener for `click`/`submit` on `a, button, [role=button], [role=tab], input[type=checkbox|radio|submit], [data-track]`.
  - The element's `data-track` key is required for a "named" event. Elements without one are recorded as `unlabeled` with only the tag, route and component, never text or aria-label (those can contain names).
  - A lint rule (`eslint-plugin-oxsteed/require-data-track`) plus a coverage report in CI aim for ≥ 95% named coverage. Keys are stable ids like `job.post.submit`, not copy, so they're the same in every language and in RTL.
- **Page views** come from the router (route template, not the path with ids). The existing `PageviewBeacon`/`site_visits` stays as is for the visitor-analytics admin page (Q12 asks whether to merge them later).
- **Batching:** in-memory queue, flushed every 5 s, or at 20 events, or on `visibilitychange` → `hidden`, via `fetch(..., {keepalive:true})`. Capped at 64 KB per batch and 200 queued events, with the oldest `ui.*` dropped first. Each event carries a client UUIDv7 `event_id` for dedupe.
- **Identity:** a random `oxsteed_device_id` in `localStorage`, created only when the gate allows a persistent id (consent regions need consent). Otherwise there's no device id and only signed-in events are kept. A session id lives in `sessionStorage` (30-minute idle rotation).
- **Native apps:** the same `/api/activity/*` contract, documented in `docs/growth/activity-contract.md` next to `push-open-contract.md`. The app sends `surface=ios|android` and `app_version`. Apple's App Tracking Transparency doesn't apply as long as no data goes to other companies for ads (it doesn't), but the App Store privacy labels must be updated.

### 5.3 Server instrumentation

- `server/growth/emit.js` exposes `emitDomainEvent(client, name, props)`. It writes to **`activity_outbox`** in the main database **using the same transaction** as the business change (the `jobEventOutbox.js` pattern), so events are never lost or invented on rollback.
- Hooks go in the existing service layer (job create/publish/assign/complete, booking lifecycle, food order state changes, promo redemption, marketplace order paid). Each hook is one line, and a guard test lists required hooks per domain.
- A relay worker (`server/jobs/activityOutboxRelay.js`, fenced lock) moves outbox rows to the ingest queue and deletes them after acknowledgement.
- Staff/admin accounts and impersonation sessions are tagged `is_internal` and excluded from every rollup, just as Promote excludes owners and team members.

---

## 6. Ingestion at scale (self-hosted ClickHouse, D5)

### 6.1 Sizing assumptions (about 6 million users)

| Assumption | Value | Basis |
|---|---|---|
| Registered users | 6,000,000 | target |
| Daily active | 10% = 600,000 | planning assumption |
| Events per active user per day | 150 (clicks + views + domain) | typical for marketplace apps |
| Events per day | ~90 million (avg ~1,050/s, peak ~5,000/s) | |
| Stored size per event in ClickHouse | ~40 bytes compressed (columnar, LZ4/ZSTD) | typical for this shape of event |
| Raw data per day | ~3.6 GB compressed per replica | |
| Raw retention | 90 days everywhere → ~330 GB per replica | |
| Rollups in ClickHouse | `activity_hourly` + `subject_activity_daily` (13 months) → ~60–90 GB per replica | |
| Headroom | 3× growth before more disk or a second shard is needed | |

### 6.2 Pipeline

```
web / app ──► POST /api/activity/batch ──► gate + validate ──► Redis Stream "activity:ingest"
server    ──► activity_outbox (same txn, Postgres) ──► relay worker ─┘
                                                                     │ XREADGROUP (consumer group "writers")
                                                                     ▼
                                              writer workers (batch 20,000 rows or 2 s)
                                                                     ▼  HTTPS insert, JSONEachRow, dedup token
                                      ClickHouse: growth.activity_events (ReplicatedReplacingMergeTree, daily parts)
                                                                     ▼  materialized views (real time)
                                      ClickHouse: activity_hourly, subject_activity_daily
                                                                     ▼  nightly job
                                      Postgres main DB: demand_daily, supply_daily, user_interest_profiles (§6.4)
```

| Stage | Design |
|---|---|
| Endpoint | `POST /api/activity/batch` (`server/routes/activity.js`), `optionalAuth`, and a dedicated rate limiter (`rate-limit-redis`, per device and per IP hash, e.g. 120 batches/min). Limits: body ≤ 64 KB, ≤ 50 events. It always answers `204` quickly, so a failure never breaks the page. Per batch it runs the gate, validates the schema, strips non-allowlisted properties, scrubs PII from `query_norm` (emails, phone numbers, street-address patterns), stamps `received_at`, `jurisdiction`, `basis`, `subject_key` and `device_key`, then does `XADD`. |
| Queue | **Redis Streams** on a dedicated Redis with AOF persistence and a replica (R13), `MAXLEN ~ 20,000,000` (~4 hours at peak, enough to ride out ClickHouse maintenance). Dead-letter stream `activity:dlq` for rows ClickHouse rejects. |
| Back-pressure | If the stream is over 80% full, the endpoint drops sampled `ui.*` events first and keeps `offer.*`, `search.*` and every domain event. Dropped counts are exported as metrics. The domain outbox never drops; it just waits. |
| Writers | Node workers in `server/workerMain.js` (scaled separately from the web dynos), using the official `@clickhouse/client` over HTTPS. Each takes a batch of up to 20,000 rows or 2 s and inserts it as one block, with `insert_deduplication_token` = hash of the batch's first and last stream ids. A retried batch is dropped by ClickHouse's replicated block dedupe, and only then does the worker `XACK`. Big blocks keep part counts low (no `async_insert` needed). |
| Duplicates | Effectively exactly once: block dedupe on retries, plus `ReplacingMergeTree` keyed on `event_id` for anything that slips through. Rollups count `uniqExact(event_id)` where exact numbers matter. |
| Bot filter | User-agent list plus Cloudflare bot score header (if enabled) plus behaviour (more than 30 clicks/s). Stored as `is_bot` and excluded from rollups. |

### 6.3 Storage: ClickHouse cluster

**Topology:**
- **One shard, two replicas** (`ReplicatedReplacingMergeTree`) on two dedicated servers.
- **ClickHouse Keeper** on three nodes: the two ClickHouse servers plus one small VM, so the cluster survives one server loss without split-brain.
- Pinned to a current ClickHouse **LTS** release and upgraded twice a year after a staging rehearsal.
- Ports are reachable only on the private network (WireGuard or the provider's private network) with TLS (HTTPS 8443, native 9440). No public listener.

Raw table (migration `C002`):

```sql
CREATE TABLE growth.activity_events ON CLUSTER growth
(
  day           Date,                                  -- UTC day
  event_id      UUID,                                  -- client/server UUIDv7
  occurred_at   DateTime64(3, 'UTC'),
  received_at   DateTime64(3, 'UTC'),
  event_name    LowCardinality(String),
  schema_ver    UInt16,
  subject_key   FixedString(32),                       -- HMAC(user id); all-zero if signed out
  device_key    FixedString(32),                       -- HMAC(device id); all-zero if none
  session_key   FixedString(32),
  role          LowCardinality(String),                -- customer/helper/business/restaurant
  surface       LowCardinality(String),
  app_version   LowCardinality(String),
  locale        LowCardinality(String),
  country       LowCardinality(FixedString(2)),
  subdivision   LowCardinality(String),
  postal_ref    UInt32,                                -- geo_postal_centroids.id (never coordinates)
  jurisdiction  LowCardinality(String),
  basis         Enum8('notice' = 1, 'consent' = 2),
  route         LowCardinality(String),
  element_key   LowCardinality(String),
  entity_type   LowCardinality(String),
  entity_id     String,                                -- public platform objects only
  props         String CODEC(ZSTD(3)),                 -- allowlisted JSON
  is_bot        Bool,
  is_internal   Bool,
  INDEX idx_subject subject_key TYPE bloom_filter(0.01) GRANULARITY 4,
  INDEX idx_device  device_key  TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ReplicatedReplacingMergeTree('/clickhouse/{shard}/growth/activity_events', '{replica}')
PARTITION BY day
ORDER BY (event_name, day, subject_key, event_id)
TTL day + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;
```

- **Partitions:** one per UTC day (about 90 live). They're created automatically on insert, so no partition maintenance job is needed (unlike migration `760`'s Postgres pattern).
- **Retention:** enforced by **TTL**: 90 days for every jurisdiction and legal basis. A daily check confirms no row older than the TTL survives, by querying `min(day)` per basis.
- **Access roles (ClickHouse users and roles):**

| Role | Can do |
|---|---|
| `growth_writer` | `INSERT` on `activity_events` only |
| `growth_reader` | `SELECT` on rollup tables; raw `SELECT` only for the nightly job user. Settings profile: `readonly=1`, `max_execution_time=30`, `max_result_rows=1,000,000`, memory quota. |
| `growth_rights` | `SELECT` and lightweight `DELETE` by key, for data-rights jobs only |
| `growth_admin` | DDL and migrations; used by CI/deploy only, never by the app at runtime |

- **Backups:** daily native `BACKUP … TO S3(…)` (incremental from the last full, full weekly) to an **OxSteed-owned, S3-compatible bucket** with server-side encryption, separate write-only credentials and object lock off.
  - Backups are kept **7 days**, so data-rights deletions reach backups within a week. The policy's section 6 already mentions backup lifecycles.
  - A restore to staging is rehearsed every quarter.
  - Where the bucket lives is Q6 below.
- **Replication** covers one server failing. Backups cover operator error and corruption. Target RPO for raw events is 24 hours (last backup). Domain events can be rebuilt from Postgres source records and the outbox; lost click and view events are accepted as a gap, because rollups and profiles already exported to Postgres survive.

### 6.4 Rollups

| Rollup | Where | Grain | Retention | Used by |
|---|---|---|---|---|
| `activity_hourly` | ClickHouse, materialized view → `ReplicatedAggregatingMergeTree` | hour × event_name × role × country × postal_ref × route/element, with `uniqState(subject_key)` | 13 months (TTL) | product analytics, capacity |
| `subject_activity_daily` | ClickHouse, materialized view → `ReplicatedAggregatingMergeTree` | day × subject_key × event name × exact event state | 13 months (TTL) | interest profiles, propensity |
| `demand_daily` | Postgres main DB | day × postal_ref × intent × signal_type → distinct subjects, events, value per currency | 5 years (k-anonymous) | heatmaps, gap index, governed metrics, region scoping |
| `supply_daily` | Postgres main DB | day × postal_ref × intent × role → active providers, capacity proxy (open bids, bookable slots), mostly from domain tables | 5 years | heatmaps, gap index |
| `user_interest_profiles` | Postgres main DB | subject × intent → score, last_seen | rolling; deleted after 12 months inactive, on consent withdrawal (EU/UK), or for personalized-offer use on a "Do not sell or share" opt-out | segments, recommendations |

- **Nightly job:** `server/jobs/growthNightlyRollups.js` (fenced lock, its own `growth_rollup_runs` row, one running run at a time like `metric_snapshot_runs`). It runs **after** the existing `metricSnapshots` job. It reads yesterday's aggregates from ClickHouse as `growth_reader` and upserts the three Postgres tables in one transaction per day.
- **Why the split:** segments, governed metrics, region scoping (`regionScope.js`) and the admin UI keep working on Postgres tables the existing code already understands. ClickHouse holds only raw events and their two direct rollups.
- **Admin product-analytics charts** (funnels, click maps) read `activity_hourly` through the fixed, bounded, parameterized queries in `server/growth/clickhouseQueries.js`. These are audited like the query builder and never run ad hoc SQL.

---

## 7. Identity and pseudonymization

| Key | How it's made | Why |
|---|---|---|
| `subject_key` | `HMAC-SHA256(GROWTH_SUBJECT_PEPPER, 'subject:' + user_id)` | Raw user ids never sit in ClickHouse. With the pepper (kept in the secrets manager, never in any database), the server can still find a user's rows for access or deletion. Unlike Promote's plain SHA-256 (R9), nobody who only holds user ids can recompute it. |
| `device_key` | `HMAC(pepper, 'device:' + device_id)` | Same, for signed-out activity |
| Identity stitching | On sign-in, a `device_link` event records `(device_key → subject_key)` for **notice-basis users or consenting users only**. Earlier anonymous events on that device can be attributed for 30 days. | Join the before- and after-login journey |
| `ip_hash` (consent ledger only) | `HMAC(pepper, ip)` | Evidence without the raw IP |
| Pepper rotation | Yearly. Old keys are re-derived during a migration window, and raw rows older than the rotation are left to expire by TTL (90 days). | |

These keys are pseudonymous, not anonymous. Under GDPR they're still personal data, and every rights process in §18 treats them that way.

---

## 8. Category and intent taxonomy

### 8.1 Structure

One shared tree for all verticals, `demand_taxonomy_nodes`:

```
vertical          category            intent (leaf)
services ─────── plumbing ─────────── drain_clog, leak_repair, water_heater, toilet_install …
         ├────── electrical ───────── outlet_repair, panel_upgrade, ev_charger …
         ├────── cleaning ─────────── deep_clean, move_out, carpet …
food ─────────── restaurant_ops ───── delivery_growth, takeout_packaging, receipt_printing, kitchen_display …
         └────── cuisine ──────────── haitian, mexican, halal_menu (restaurant-level only) …
business ─────── setup ───────────── online_booking, invoicing, card_payments …
customer ─────── home_project ────── bathroom_refresh, lawn_season, moving …
```

| Column | Meaning |
|---|---|
| `code` | stable id, e.g. `services.plumbing.drain_clog` |
| `parent_id`, `level` | tree |
| `labels` | JSONB `{en, es, fr, ht, ar}`, shown in admin UI |
| `sensitive` | if true, never used for person-level segments (§8.6) |
| `status`, `version` | draft/active/retired; changes are audited |

**Seed sources:** `categories` (job categories), `skills_lookup` (250 skills), `businessCategories.js` subtypes, `direct_catalog_categories`, `LEARN_CATEGORIES`, `job_kit_definitions.job_type`, `food_restaurants.cuisine_tags` and common `food_menu_items.tags`. An admin page (§15) manages the tree.

### 8.2 What gets classified

| Entity | Text and fields used | When |
|---|---|---|
| Job | title, description (PII-scrubbed), `category_id`, `job_type` | on `job.posted`, on material edit |
| Booking request / appointment / Direct quote | service name, category, notes are **not** used | on create |
| Business service | name, description, category | on create/update |
| Restaurant | cuisine tags, top menu categories, fulfilment mix | nightly |
| Search query | `query_norm` | on first sight of each distinct normalized query (cached by hash) |
| Helper | skills, licenses, completed-job intents | nightly |
| Planned need, saved search | title, category | on create |

### 8.3 Rules first

`demand_taxonomy_rules` holds `(node_id, locale, kind, pattern, weight)`. The kinds are `category_id`, `skill_id`, `job_type`, `cuisine_tag`, `menu_tag`, `keyword` and `regex`.

Example for `services.plumbing.drain_clog`:

| Locale | Keywords |
|---|---|
| en | clog, clogged, blocked drain, slow drain, backed up, drain snake, auger, hydro jet |
| es | atascado, tapado, destapar, desagüe, drenaje lento |
| fr | bouché, déboucher, canalisation, évacuation lente |
| ht | bouche, tiyo bouche, debouche, drenaj |
| ar | انسداد, مسدود, تسليك, تصريف بطيء |

Scoring: matching category plus keyword gives 0.9, keyword only 0.7, category only gives the parent node at 0.8. If the best score is ≥ 0.75, the rules win and no AI is called. We expect rules to settle 60–80% of items.

### 8.4 Ollama second

- **Input:** only the scrubbed text and the **closed list of child intents** under the best-guess category (≤ 40 codes with English labels), so the prompt stays small. Every text is treated as data, never as instructions.
- **Output:** Ollama structured output (JSON schema via the `format` parameter) of the form `{"intent": "<one of the codes>|none", "confidence": 0-1}`, with `temperature: 0`. Anything that isn't a listed code becomes `none`.
- **Stored in `entity_intents`:** entity, node, confidence, `source` (`rules`/`ollama`/`admin`), model name and digest, `prompt_version`, `created_at`, `superseded_at`. History is kept, so re-classifying never overwrites.
- **Low confidence** (< 0.6) or rules and model disagreeing goes to `classification_review_queue`. Admins confirm or fix it, and each fix can suggest a new keyword rule. The `LearnAiSuggestionsAdmin.jsx` review pattern is reused.

### 8.5 Quality bar

- A labelled evaluation set: 300 items per vertical per language (en/es/fr/ht/ar), stored in `server/growth/eval/`.
- A model or prompt change ships only if top-1 precision is ≥ 90% overall and ≥ 85% in every language, with no drop over 2 points in any intent with ≥ 30 examples. CI runs the eval against a pinned model digest on the GPU box (nightly job, not every PR).

### 8.6 Sensitive and excluded inferences

Never inferred or used for person-level segments: health conditions (even from "personal care" or wellness bookings), religion (from halal/kosher tags, which are allowed **only at restaurant level**), ethnicity or nationality, sexual orientation, political views, pregnancy, financial distress, Credit balance, disputes, identity-verification failures, and anything about minors. Nodes flagged `sensitive` can appear in area-level demand maps (k-anonymous) but never in a segment that targets people.

---

## 9. Geo model: ZIP centres, no stored coordinates

### 9.1 Reference table

`geo_postal_centroids` (main DB): `id`, `country`, `postal_code`, `place_name`, `admin1`, `admin2`, `lat`, `lng`, `geog GEOGRAPHY(POINT)`, `h3_r5`, `h3_r7`, `source`, `source_version`.

- **Source:** GeoNames postal-code dataset (CC BY 4.0, so the admin map shows an attribution line), ~100 countries. Plus the GeoNames cities file as a fallback "place centroid" where postal codes are missing or unreliable (for example Haiti).
- Loaded by an admin-run import (`server/scripts/importPostalCentroids.js`), versioned and diffable. No outside API is called at runtime.
- GiST index on `geog`. H3 cells are computed at import with `h3-js`, so heatmaps don't need a new Postgres extension.

### 9.2 Placing people and records

| Thing | Location used |
|---|---|
| User (any role) | `users.country` + `users.zip_code` → `geo_postal_centroids.id`. With no postal code, `city`/`state` → place centroid. Otherwise country only. |
| Job | the job's postal code (`location_zip`, `location_country_code`) → centroid. **Never** `location_lat/lng/point`. |
| Restaurant / business | address postal code → centroid. The restaurant's own coordinates aren't used either, to keep one method. |
| Search | the searcher's profile postal code, or Cloudflare city → place centroid. Never the browser's coordinates. |

Only `postal_ref` (an integer id) is stored on events and rollups. Engine reader modules use a column allowlist, and a unit test fails if any of them selects a coordinate column from `jobs`, `helper_profiles`, `discover_search_log` or `food_restaurants`.

### 9.3 Finding "N providers within X miles of each other"

The question: "Which groups of at least N people in role R, each with intent I in the last D days, all lie within X miles of each other?"

1. **Candidates:** the subjects with `user_interest_profiles.score ≥ s` for intent I and role R (and permitted for profiling), grouped by `postal_ref` with a count per centroid.
2. **Neighbourhoods:** for each active centroid c, `ST_DWithin(c.geog, other.geog, (X/2) × 1609.344)` over the GiST index gives everyone within X/2 miles of c. Two people both within X/2 of the same centre are at most X apart, so the group's diameter is ≤ X.
3. **Pick groups:** greedily take the centroid with the largest neighbourhood count ≥ N, mark its members as used, and repeat. That gives non-overlapping groups, ranked by size and intent strength.
4. **Output:** group id, anchor place name, member count, intent strength, and supply/demand context. **No member list** unless the viewer holds `view_growth_insights` and the group is turned into a segment (§11).

Work is proportional to active centroids (tens of thousands), not users (millions). It runs per country and finishes in seconds.

People in the same postal code share a centroid, so distances inside a ZIP are 0. Results are approximate by design, and the UI says "about X miles, using postal-code centres".

---

## 10. Demand heatmaps and the potential-customer model

### 10.1 Signals

| Demand signal (people who want something) | Supply signal (people who provide it) |
|---|---|
| job posted (weight 1.0), job unfilled/expired (1.5), search (0.3), zero-result search (0.8), planned need (0.7), saved search (0.5), booking requested (1.0), food order placed (1.0, by cuisine) | helper with matching skill and active in 30 days, open bids, business service active, restaurant with cuisine and open hours, delivery capacity |

Counts are **distinct subjects**, not events, so one person clicking 100 times counts once.

### 10.2 Heatmap

- **Cells:** H3 r5 (country/metro view) and r7 (city view) built from `demand_daily`/`supply_daily` via centroid → cell.
- **Layers:** demand, supply, gap (§10.3), trend (28-day vs prior 28-day), plus a filter by intent, role, country and region.
- **Privacy:** any cell with fewer than **k = 5** distinct subjects is hidden. A hard floor of 3 can't be lowered, matching the investor-evidence suppression in `server/analytics/investorEvidence.js`. Regional admins see their territory only (§22).
- **Rendering:** MapLibre GL in the admin app, using the map style the app already uses through AWS Location (`docs/aws-location-service.md`). The map provider gets tile requests only, never data. A table view is offered for accessibility and as a fallback.

### 10.3 Gap index (where OxSteed is missing supply)

```
gap(area, intent) = smoothed_demand / (smoothed_supply + 1)
smoothed_x        = (x + prior_x × m) / (1 + m)     # empirical-Bayes shrink toward the country mean
```

High gap with a rising trend marks a **recruitment opportunity**. Example: "Drain-clog jobs near Springfield, OH: 46 requesters in 28 days, 3 active plumbers, gap 11.5, up 30%." That's where OxSteed should recruit helpers. It isn't a list of people, and it doesn't send anything.

### 10.4 Potential-customer model (people already on OxSteed)

| Prospect type | Example signal | Model v1 (transparent scorecard) | Model v2 |
|---|---|---|---|
| Helper likely to upgrade tier | many bids, high win rate, hits free-tier limits | weighted points, calibrated on past upgrades | logistic regression trained nightly |
| Customer likely to become a helper | skills on profile, Learn guide views, searches for "jobs near me" | scorecard | same |
| Business likely to adopt invoicing/booking | services added, many manual appointments | scorecard | same |
| Restaurant likely to adopt delivery/POS/displays | rising pickup orders, no delivery, printer set up (migration `912`) | scorecard | same |
| Customer likely to return | category seasonality, planned needs | scorecard | same |

- **v1** is a points table admins can read and tune. Every score shows its top 3 reasons, and calibration is reported as predicted vs actual by decile.
- **v2** is a small Python worker container inside OxSteed's network (`growth-model-worker`, scikit-learn). It trains on `subject_activity_daily` + domain facts, writes scores to `propensity_scores`, and keeps a model card (features, AUC, calibration, date).
- No score is ever used to decide price, visibility, ranking in search, eligibility, or anything else with a legal or similar effect. Scores are only for choosing who an admin may offer something to.

**Off-platform prospects** (businesses not on OxSteed) are a non-goal for now. The gap index points to areas to recruit in, and any outreach list would need licensed data (Q18).

---

## 11. Segment builder

A **segment** is a saved, versioned rule for "who". It's never a hand-uploaded list.

### 11.1 Definition (JSON, validated like `queryBuilder.validateBuilderQuery`)

```json
{
  "roles": ["helper"],
  "area": { "type": "cluster", "cluster_id": "c_2026-10-20_US_45501_drain_clog" },
  "intents": [{ "code": "services.plumbing.drain_clog", "min_score": 0.5, "window_days": 60 }],
  "facts": [{ "fact": "jobs_completed", "op": ">=", "value": 3, "window_days": 90 }],
  "lifecycle": { "last_active_within_days": 30, "account_age_min_days": 14 },
  "languages": ["en", "es", "fr", "ht", "ar"],
  "exclude": ["contacted_in_days:7", "dismissed_intent_in_days:30"]
}
```

| Block | Allowed values |
|---|---|
| `roles` | customer, helper, business (owner/manager), restaurant (owner/manager) |
| `area` | `admin_region` (id), `postal_list`, `radius` (centroid id + miles), `cluster` (from §9.3), `country` |
| `intents` | active, non-sensitive taxonomy codes, score threshold, window |
| `facts` | a fixed list computed from domain tables: jobs posted/completed, bids, bookings, orders paid, menu size, tier, subscription, has delivery, and so on. Each fact is a reviewed SQL template, the same idea as the governed metrics. |
| `propensity` | model + minimum decile |
| `lifecycle` | signup age, last active, verified |
| `languages`, `countries` | filters |
| `exclude` | recently contacted, dismissed, opted-out (always added automatically), minors, staff, banned/suspended, deleted |

### 11.2 How it runs

- Compiled to **parameterized SQL over rollup tables and fact templates only**, never ad-hoc SQL and never raw events, inside a READ ONLY transaction with a 30 s timeout. This reuses the safety pattern in `server/analytics/queryBuilder.js`.
- **Always ANDed in, and they can't be removed:** the tracking gate (permitted subjects only), the jurisdiction profiling basis (offers consent in EU/UK consent regions), no "Do not sell or share" opt-out for personalized offer segments (US opt-out states), and the admin's region territory (§22).
- **Preview** shows a count (shown as "fewer than 5" below k), a breakdown by country, language and role, and overlap with other active campaigns. **No names in preview.** Viewing a sample of members needs `view_growth_insights` plus a reason, and is audited fail-closed.
- **Versions:** editing creates version N+1. Campaigns point to the exact version they used.
- **Freezing:** when a campaign is approved, the segment is evaluated once and frozen into `offer_campaign_recipients`, the same idea as `business_broadcast_recipients`. Opt-outs are still re-checked at send time (§17).

---

## 12. Recommendation engine

The goal is a short list of **suggestions** each night. A suggestion is a segment plus an offer, with an expected outcome and a plain-language reason.

### 12.1 Steps

| Step | What happens | Who does it |
|---|---|---|
| 1. Opportunity scan | Find clusters (§9.3), rising intents per area, propensity deciles, and gap areas | SQL over rollups |
| 2. Candidate offers | Map each opportunity's intent to offers through `offer_intent_map`, seeded from `marketplace_product_skills` (skill → product with relevance), `job_kit_definitions` (job type → SKUs), `learn_product_links` (tool → link) and partner feed categories (§13.3). Only offers that are active, available in the segment's countries and currencies, allowed on the planned channels, and with the needed disclosure text in all 5 languages. | rules |
| 3. Score | `expected_value = reach × P(click) × P(convert | click) × commission_or_margin` with Beta-Binomial smoothed rates (priors from the same intent × role × channel, then the global prior), minus a fatigue penalty (recent contacts), minus overlap with scheduled campaigns, plus a small exploration bonus for offers with little data | statistics (Node) |
| 4. Re-rank and explain | The top 20 candidates per opportunity go to Ollama with **aggregate facts only**: counts, rates, intent labels, offer titles and prices from the feed. Never names, ids or text written by users. Ollama returns JSON `{ranking:[offer_ids], rationale, risks, draft_copy:{en,es,fr,ht,ar}}`. Validation: ids must be from the input; length caps; no price or claim not present in the input; banned phrases ("guaranteed", "free" unless the offer is free); if validation fails, the statistical ranking is kept and the rationale is template text. | Ollama (self-hosted) |
| 5. Store | `offer_suggestions` row: segment draft, offer(s), predicted reach, CTR, conversions and revenue with ranges, rationale (marked "AI-written, check before use"), `model`, `prompt_version`, `status = pending_review` | |

### 12.2 Example (Emile's case)

> **Suggestion #8812.** 5 plumbers within about 35 miles of Springfield, OH completed 23 drain-clog jobs in the last 60 days. 4 of them don't own a powered drain auger, based on Learn guide "buy" clicks for drain tools (no purchases recorded). Offer: Partner X 50-ft drum auger, $189, 4% commission. Predicted: 5 reached, about 1.4 clicks, about 0.3 purchases, about $2.30 commission. Small group, so this is low revenue but cheap to test. Alternatives: a hydro-jet rental (OxSteed tool rentals), or a job kit "drain clog" cart.

Small groups are fine to show. The ranking makes clear when the value is small, and admins can merge clusters into a wider segment.

### 12.3 Learning loop and honest measurement

- Every campaign holds back a random **control group** (default 10%, minimum 50 people, otherwise it's skipped and the campaign is labelled "no holdout").
- Reported lift = conversion in the treated group − conversion in the control group, with a 90% interval.
- Results feed back into the smoothed rates in step 3. Suggestions an admin rejects, with a reason code, lower that offer × segment pair for 30 days.

---

## 13. Affiliate partners and revenue attribution

### 13.1 How it fits the existing affiliate code

| Existing | Purpose | The engine's relationship |
|---|---|---|
| `AFFILIATE_ENABLED` + `/api/affiliate` (`affiliatePayouts.js`) | **Helpers** earn commission when customers buy from carts they share | Unchanged. The engine can suggest "join the affiliate program" to helpers **only if** `AFFILIATE_ENABLED` is on. A sale made through a helper's shared cart belongs to the helper program, so the engine records it only as "assisted" and never double-counts it. |
| `marketplace_products` (`source`, `affiliate_url`) | Product catalog | Reused as the single product table: partner feed items become rows with `source = '<partner code>'` and new columns (§13.3). |
| `marketplace_product_skills`, `job_kit_definitions`, `learn_product_links` | Product ↔ skill/job/tool | Seeds `offer_intent_map` |
| `affiliateAntiFraudService.js` | Fraud checks on orders | Reused for postback sanity checks (velocity, self-purchase patterns) |

The engine's partner offers sit behind their own flag, **`GROWTH_PARTNER_OFFERS_ENABLED`** (default off, in `launchGate.js` next to `affiliate`), so the two programs can be switched independently.

### 13.2 Partners

`affiliate_partners`: `code`, `name`, `network` (direct, Impact, CJ, Awin, Rakuten, Amazon Associates …), `status`, `countries_allowed`, `currencies`, `allowed_channels` (for example Amazon: in-app/web only, never email, per its operating agreement; verify the current terms), `link_domains_allowlist`, `commission_terms` (JSON: rate by category, cookie window, reversal window), `disclosure_key` (i18n key for the required "We may earn a commission" text), `postback_secret_ref` (secrets manager name, never the secret), `created_by`, `approved_by`.

Changing a partner needs the new grant `manage_affiliate_partners` and is audited.

### 13.3 Catalog feeds

- `partner_feeds`: partner, URL (HTTPS or SFTP), format (CSV/XML/JSON/Google Merchant), schedule, field mapping, last run, row counts and errors.
- `server/jobs/partnerFeedImport.js` (fenced, nightly) downloads the feed, validates it, and upserts into `marketplace_products`. New columns: `partner_id`, `feed_item_id`, `country_codes[]`, `last_seen_at`, `brand`, `gtin`, `category_path`. Items missing for 2 runs become `is_available = false`. **Prices always come from the feed and are never written by AI** (the `jobKitService.js` iron rule).
- Feed categories map to intents through `partner_category_map` (rules first, then Ollama-proposed mappings that an admin approves).
- Images are not hot-linked in email. They're fetched once, scanned (`fileScanService.js`) and served from OxSteed storage.

### 13.4 Tracked links and click ids

```
Offer in-app card / push → offer detail / (email, Phase 8) ─► https://oxsteed.com/api/o/<signed token>
                              │ token = HMAC-signed {delivery_id, offer_id, product_id, exp}
                              ▼
                      record offer_clicks(click_id = random 128-bit, delivery_id, offer_id, product_id, at)
                              ▼
                      302 to partner URL + subid=<click_id>   (domain must be in partner allowlist)
```

- **No user id, email or segment goes to the partner.** Only the random `click_id`.
- No IP or user agent is stored (unlike `affiliate_clicks`, R8).
- Links are `rel="sponsored noopener"` on web.
- An expired token, or a domain not on the allowlist, gets a plain "This offer has ended" page in 5 languages with RTL, so there's no open redirect.

### 13.5 Revenue attribution

| Source | How it arrives | Stored in `affiliate_conversions` |
|---|---|---|
| Server-to-server postback | `POST /api/partners/:code/postback`, HMAC signature + timestamp (5-minute tolerance) + replay dedupe (the Svix pattern from `resendWebhookService.js`) | `click_id`, partner order ref (hashed), sale amount and commission in **minor units + currency**, status `pending` |
| Network report API (daily) | Import job per network | Same, and updates status `approved` / `reversed` / `paid` |
| Partner monthly statement | CSV upload by admin (`view_financials` + `manage_affiliate_partners`) | Reconciliation marks |

- **Attribution:** last click within the partner's cookie window, via `click_id → delivery → campaign → suggestion → segment`. Gross and net (after reversals) are shown side by side, the same rule as Promote's net conversions.
- **OxSteed promo offers** use `discount_codes` + `promo_redemptions` (migration `905`). Each campaign gets its own code (new column `discount_codes.offer_campaign_id`), with `per_user_limit = 1`, a currency and allowed surfaces. Redemption is attributed to the campaign directly. Food codes stay restaurant-funded (R15), so platform food promos aren't offered. Credit-paid checkout still refuses codes (P3-1009 untouched).
- **Promote attribution** (`promotion_link_events`) is not mixed in. It belongs to businesses. The engine may read aggregate Promote visit counts as a supply-side signal, but **never** the `account_key` rows.
- **Governed metrics** (§21) carry the money numbers, so finance sees one definition everywhere.

---

## 14. Later: the OxSteed catalog and checkout

This builds on what already exists: `marketplace_products` (`source = 'internal'`), `shopping_carts`, `marketplace_orders`, `marketplace_order_items`, `marketplace_transactions` and `cartCheckoutController.js` (Stripe).

| Need | Plan |
|---|---|
| Products | `source = 'oxsteed'` rows with cost, margin, stock (`inventory_levels`), supplier (`supplierService.js` exists) and country availability |
| Checkout | Extend the marketplace checkout: Stripe PaymentIntent, tax via the existing `taxService.js`, shipping quotes via `shippingService.js`. Promo codes work through `promoRedemptionService` with a new `catalog` surface. **OxSteed Credit isn't offered** at catalog checkout in v1, so P3-1009 is untouched. |
| Fulfilment | Drop-ship partner or a 3PL first (`warehouseService.js`, `shipmentService.js` exist). Order states, tracking emails in 5 languages. |
| Returns and refunds | Through `marketplaceRefundService.js`. Refunds at or above the threshold go through the **existing** dual approval (`dualApprovalService.js`) unchanged. |
| Engine changes | Offers of type `catalog_product`. Margin replaces commission in scoring. Attribution is direct (order has the campaign id). |
| Legal | Terms of sale, returns policy, consumer law per country, prohibited items list, product safety recalls. |

Entry criteria: affiliate data shows at least 3 intents where OxSteed could beat the partner on price or margin, with ≥ 1,000 monthly buyers.

---

## 15. Admin UI and campaign workflow

### 15.1 Pages (admin app, new section "Growth Insights")

All routes are added to `client/src/admin/adminRouteManifest.js` and `server/utils/adminSpaRoutes.js`, with `grant` set.

| Route | Page | Grant |
|---|---|---|
| `/admin/growth` | Overview: tracking status, today's suggestions, campaigns in flight, revenue (finance cards only with `view_financials`) | `view_growth_insights` |
| `/admin/growth/demand` | Heatmap + table: demand, supply, gap, trend; filters for intent, role, area | `view_growth_insights` |
| `/admin/growth/clusters` | Cluster finder (role × intent × miles × min N) | `view_growth_insights` |
| `/admin/growth/segments` | Segment builder, preview, versions | `manage_marketing` (edit), `view_growth_insights` (read) |
| `/admin/growth/suggestions` | Suggestion inbox: approve into a draft campaign, edit, or reject with a reason | `manage_marketing` |
| `/admin/growth/campaigns` | Campaign list, detail, review, schedule, live progress, results with holdout lift | `manage_marketing` (draft), `approve_growth_campaigns` (approve/send) |
| `/admin/growth/partners` | Partners, feeds, imports, category mapping, conversions, reconciliation | `manage_affiliate_partners`; money columns need `view_financials` |
| `/admin/growth/taxonomy` | Intent tree, keyword rules, classification review queue, eval scores | `manage_marketing` |
| `/admin/growth/settings` | Tracking rollout state, notice campaign progress, jurisdiction rules (read), caps, kill switch (via settings change requests) | `manage_settings` / `approve_settings` |

- **New grants** are added to `PERMISSION_SCOPES` in `server/controllers/adminPermissionController.js`:
  - `view_growth_insights`: "View demand maps, clusters, segments and growth suggestions"
  - `approve_growth_campaigns`: "Approve and send growth campaigns"
  - `manage_affiliate_partners`: "Manage affiliate partners, feeds and partner revenue records"
- `manage_marketing`, `view_financials`, `export_data`, `manage_settings` and `approve_settings` are reused.
- Super admins hold everything, as today.

### 15.2 Campaign states

```
draft ─► in_review ─► approved ─► scheduled ─► queued ─► sending ─► sent
   ▲          │            │           │          │          │
   └─ changes_requested ◄──┘           └────── cancelled ◄───┘  (cancel any time before 'sent'; pause in 'sending')
```

| Step | Rule |
|---|---|
| Draft | From a suggestion or from scratch. Choose segment version, offer(s), channels (**in-app and/or push** in the current phases; the email option is hidden until Phase 8), schedule, copy in **all 5 languages** (in-app card title/body/button, and a push title ≤ 50 characters and body ≤ 120 characters per language; missing languages block review), and holdout %. |
| Review | A checklist the approver (who may be the creator, D4) must tick: audience size and breakdown, cap and quiet-hours impact (how many pushes will be held until morning), how many recipients have no push device, partner channel rules, disclosure present, preview in every language: in-app card including Arabic RTL, light/dark, 320 px, plus a mock iOS/Android/web push banner showing truncation. |
| Approve | Needs `approve_growth_campaigns` and step-up auth (`stepupChallengeService.js`). **The creator may approve and send their own campaign; no second approver is needed (D4).** Approval is still an explicit step with step-up auth, and the approve and send actions are audited with the admin's id. Existing two-distinct-admin rules elsewhere are not changed. |
| Region | A regional admin can only target their territory, and can only approve campaigns whose audience lies inside their territory. Cross-region campaigns need a global grant. |
| Queue | The audience is frozen into recipients at queue time. Re-approval is required if the segment version or copy changes after approval. |
| Send | The delivery worker (§16) re-checks consent, opt-outs, caps, account status and jurisdiction **for every message at send time**. |
| Results | Per channel: sent, delivered (push: at least one device accepted), opened (in-app: read; push: tapped, which for native apps is counted only after the app update, see §16), clicked, converted (gross/net), revenue per currency, push and offer opt-outs, holdout lift. Native push opens are labelled "partial until the app update ships". |

Every state change, preview of members, export and approval writes `admin_audit_log` through `logAdminAction` (hash-chained, verified daily). Member previews and exports are **fail-closed**: no audit row means no data, the same as the query builder ledger (migration `892`).

### 15.3 UI copy and accessibility

All strings live in the legacy catalogs (`client/src/locales/{en,es,fr,ht,ar}.json`) **and** the namespaced catalogs (`client/src/i18n/locales/<lng>/common.json`), keeping the parity checks (`verify:i18n`, i18n debt gates, duplicate-key checks) green.

- Arabic uses RTL with logical CSS properties. Maps and number formats are locale-aware. Money uses `moneyExact`/`analyticsFormat`.
- AI-written text is labelled "Written by AI, check before sending" in each language.
- Browser checks at 320/390/1360 px, en/fr/ar, light/dark, keyboard-only and screen reader, extending the existing `*.browser-check.cjs` pattern.

---

## 16. Delivery: reusing the broadcast outbox

**Current phases: in-app and push only.** Offer email is Phase 8 (§16.4).

Today's code is business-scoped (R5), so the plan is **extract, then reuse**:

1. **Extract** a channel-agnostic core from `broadcastDeliveryService.js` into `server/services/delivery/core.js`. The core covers:
   - claims with SKIP LOCKED plus a lease token
   - conditional completion
   - retry backoff (5 attempts)
   - `sendInApp`
   - push via `webPushService`/`mobilePushService` with a `track_url`
   - email with Resend idempotency keys, the open pixel, whitelisted click redirects and RFC 8058 one-click unsubscribe. The email path stays in the core for business broadcasts; platform offers simply don't use it yet.

   Business broadcasts keep working through a thin adapter, and their tests must pass unchanged.
2. **Add a platform campaign adapter** with its own tables: `offer_campaigns`, `offer_campaign_recipients` and `offer_campaign_deliveries`. They have the same columns and checks as migration `906`, plus `offer_id`, `holdout` and `language`. The `channel` check allows `in_app` and `push` now; `email` is added by the Phase 8 migration.
3. **Worker:** `server/jobs/offerCampaignDelivery.js`. It runs only when `GROWTH_CAMPAIGN_DELIVERY_ENABLED=true` (default false).

### 16.1 In-app offers

- **Format:** a `notifications` row per delivery (idempotent, as in `sendInApp`), type `growth_offer`. Read status comes from `notifications.read_at`.
- **Offer card:** an "Offers for you" card on the role's home or dashboard, at most 1 per screen view. It has a "Not relevant" / "Too many offers" menu and a "Hide offer cards" link if the display toggle ships (Q7) (all 5 languages, RTL).
- **Tracking:** an impression is logged when the card is visible for at least 1 second. Clicks go through the signed `/api/o/<token>` redirect (§13.4).
- **Expiry:** cards disappear when the offer ends or the partner product becomes unavailable.

### 16.2 Push offers

- **Payload:** same shape as business broadcasts.
  - `title` and `body` in the recipient's language: en/es/fr/ht/ar, otherwise English. `dir` hint `rtl` for Arabic on web push.
  - `data.type = "growth_offer"`, plus `data.campaign_id`, `data.offer_id` and `data.track_url`.
  - `data.deep_link` points to the in-app offer detail, so a tap opens OxSteed first, never the partner site directly. The partner link is one more tap, through the signed redirect.
- **Track URL:** use the **same path prefix as today**, `/api/broadcast-tracking/p/<token>`, with a token namespace (`g_` prefix) that routes to the offer adapter.
  - Apps that implement `docs/analytics-platform/push-open-contract.md` accept only URLs starting with `/api/broadcast-tracking/p/`. Reusing the prefix means no new allowlist work in the apps.
  - The response stays `204` for every token, as the contract requires.
- **Opt-outs and permissions checked at send time:**
  - OS/browser permission and enabled devices
  - `push_notifications` and `web_push_enabled`
  - the new `offer_push` preference (explicit opt-in)
  - in consent regions, an explicit offers consent
  - for partner offers in US opt-out states, no "Do not sell or share" opt-out (§4.6)
  - no device means `skipped: no_push_device`. In-app still goes out if that channel was chosen.
- **Quiet hours:** never deliver between 21:00 and 08:00 in the recipient's local time.
  - Time zone comes from the profile time zone if set, otherwise the profile city or postal centroid via `city-timezones`, otherwise the country's main zone.
  - Unknown time zone means a 12:00–18:00 UTC window only.
  - Held pushes get `next_attempt_at` set to 08:00 local plus a random 0–30 minutes, so the push providers aren't hit all at once.
  - A held push is dropped if the offer expires first.
- **Send rate:** a Redis token bucket shared with business broadcasts protects the push providers. APNs/FCM and web push errors for dead tokens disable the device, as `mobilePushService`/`webPushService` do today.

**Native push opens need the app update.** The iOS and Android apps live outside this repo. Until they call `track_url` on tap, as described in `push-open-contract.md`, push opens from native devices are **not counted**. Delivered counts are unaffected. The apps also need to:
- handle `type = "growth_offer"` and open `deep_link`
- show the offer detail screen with "Not relevant" and "Turn off offer notifications"
- add an **"Offers" notification category/channel**, so users can mute offers in the OS settings without muting job and order alerts (Android notification channel; iOS a `UNNotificationCategory` plus in-app setting)

Web push opens already work through `client/public/sw.js`. Until the app release is adopted, reports label native push open rates as partial, and campaign scoring (§12) uses in-app and web push opens plus click-throughs, not native push open rate.

### 16.3 Shared rules for both channels

- **Copy:** every campaign has copy in en/es/fr/ht/ar, with a length check per channel. Arabic previews are RTL.
- **Disclosure:** the partner disclosure line ("We may earn a commission") shows on the in-app card and the offer detail screen. Push text never claims prices or discounts that the offer detail doesn't show.
- **Audit:** every send is audited per campaign (counts), not per message. Per-message rows live in `offer_campaign_deliveries`.

### 16.4 Later (Phase 8): offer email

These parts are designed now so nothing has to be redone:
- **Webhook:** extend the Resend webhook (`resendWebhookService.js`) to map provider ids to campaign deliveries. Hard bounces and complaints add a suppression to the global `marketing_suppressions` table.
- **Sender and footer:** from `offers@<sending domain>` with SPF/DKIM/DMARC aligned. The full **postal address** goes in the footer, as CAN-SPAM requires. The policy only says "Springfield, Ohio" today (Q19).
- **Content and unsubscribe:** the email is clearly labelled as an offer and has RFC 8058 one-click unsubscribe.
- **Rate and spam limits:** a shared Resend rate budget with business broadcasts. Stay under Gmail/Yahoo bulk-sender rules (spam rate under 0.3%), with auto-pause above 0.1%.
- **Consent:** EU/UK need an explicit marketing-email opt-in (R4).
- **Partner rules:** `allowed_channels` checks per partner (Amazon links aren't allowed in email).

---

## 17. Frequency caps and opt-outs

### 17.1 Opt-outs and preferences

| Control | Where | Effect |
|---|---|---|
| **Offers consent** (EU/EEA and UK only) | Consent banner and Settings › Privacy (5 languages, RTL) | Off by default (opt-in). Withdrawal means no interest profile, removal from all segments, profile and raw events deleted within 24 hours (§18). |
| **"Do not sell or share"** (US opt-out states only, `tracking_consents` purpose `sale_share_optout`) | Existing `/do-not-sell` page, Settings › Privacy (shown only in those states), and GPC (§4.6) | Activity isn't used to pick personalized offers; the person is left out of interest profiles and segments for personalized offers within 24 hours. OxSteed's own broad and generic offers stay allowed. |
| No general personalized-offers opt-out elsewhere (D1) | — | Outside consent regions and US opt-out states, activity is used for offers under the notice. The relabelled Analytics toggle controls only Google Analytics and device storage. |
| **Offer push** (new, `offer_preferences.offer_push`, **default off: explicit opt-in everywhere**, §4.6) | Opt-in prompt on the offers card or in Settings. Opt-out in Settings › Notifications › "Offers" (5 languages, RTL), "Turn off offer notifications" on the offer detail screen a push opens, and the OS "Offers" channel/category once the apps update (§16.2) | Off means no offer pushes. Job, order and message pushes are unaffected. Takes effect for the next send, including pushes already queued or held for quiet hours. |
| **Offer in-app** (proposed, `offer_preferences.offer_in_app`; Q7) | Settings › Notifications › "Offers", and the card menu | A display control, not a profiling opt-out: off hides offer cards and offer notifications. Every card also has "Not relevant". Whether to ship this toggle is Q7. |
| Existing push permission | `push_notifications`, `web_push_enabled`, OS/browser permission | Respected as today. If any is off, there's no offer push. |
| Offer email (Phase 8) | `offer_email` + existing `marketing_emails`, `unsubscribe_all`, `unsubscribed_from_bulk_emails`, one-click unsubscribe | Built with offer email later. The preference column is created now, defaulting to off, so the later phase doesn't need a backfill. |
| GPC browser signal | `Sec-GPC: 1` / `navigator.globalPrivacyControl` | **US opt-out states only (D1):** treated as "Do not sell or share" for that device and, once signed in, for the account. Elsewhere it doesn't change engine behaviour (existing marketing-cookie behaviour unchanged). |
| Consent withdrawal (consent regions) | Banner settings or account settings | Stops collection, deletes raw events and profile (§18) |
| Global suppression | `marketing_suppressions` (legal request now; hard bounce and complaint in Phase 8) | No offers on any channel |

### 17.2 Caps (defaults; admin-tunable in settings with approval)

| Cap | Default |
|---|---|
| Offer push per person | 1 per 7 days, 3 per 30 days |
| Push quiet hours | none delivered 21:00–08:00 local time. Held until 08:00 plus jitter, and dropped if the offer expires (§16.2). |
| In-app offer cards | 3 per 7 days, 1 per screen view |
| Both channels for one campaign | count as one contact for the 7-day cap; push is skipped if the person saw the in-app card in the last 24 hours |
| Offer email (Phase 8) | 1 per 7 days, 3 per 30 days |
| Same offer category after "not relevant" | 0 for 30 days |
| Same campaign | once per person |
| All platform marketing combined | Counts offer campaigns **plus** `customerReengagementJob` and other platform marketing sends (R6). Transactional, legal and business broadcasts don't count. |
| New users | no offers in the first 14 days after signup |

Caps are checked **twice**: as a preview at review time ("1,240 people will be skipped by caps"), and enforced at send time through `marketing_contact_log`, under a per-user advisory lock so two campaigns can't both squeeze into one slot.

### 17.3 Law checklist

| Law | How it's met |
|---|---|
| Push and in-app (current) | No email law applies. Platform rules do: Apple App Store guideline 4.5.4 requires explicit opt-in for promotional push and an in-app way to opt out; Google Play notification policies. Hence the separate `offer_push` preference, the in-app opt-out and the OS "Offers" channel. Consent regions need an offers opt-in before any offer push. |
| CAN-SPAM (US, Phase 8 email) | Identified as an ad; real From; non-deceptive subject; postal address; unsubscribe works for ≥ 30 days after send and is processed immediately (well inside 10 business days); no sale of opt-out lists |
| GDPR / UK GDPR / PECR / ePrivacy | Opt-in for tracking, profiling and marketing email/push in consent regions; withdrawal as easy as giving consent; Art. 21(2) objection to direct-marketing profiling is absolute and honoured via withdrawing offers consent; DPIA before launch (§20.4) |
| CASL (Canada) | Express or implied consent tracked per user; sender identification + unsubscribe |
| CCPA/CPRA and other US states | Designed not to be a sale or share (no personal data to partners, no cross-context ads). Even so, California and the other opt-out states get a "Do not sell or share" opt-out with GPC honoured there (D1, §4.6; state list Q3). Policy discloses categories and purposes; right to know and delete covered (§18). Other states: notice only. |
| LGPD (Brazil) | Legitimate interest assessment on file; opt-out |
| App stores | Privacy labels updated; no tracking across other companies' apps |

---

## 18. User data rights

| Right | What changes |
|---|---|
| **Access / portability** | `server/routes/privacy.js` `/export` adds: `activity_events.csv` (last 90 days, decoded event names, routes, times, no internal keys), `interests.csv` (intent labels + scores in plain language), `offers.csv` (offers sent, opened, clicked, dismissed), `consents.csv` additions (tracking purposes), `segments.csv` (current segment names, not definitions). It also closes R10 by adding `site_visits`, `promotion_link_events` (own rows by hashed key) and `discover_search_log`. `/data-categories` lists the new categories. |
| **Deletion / erasure** | `privacyRetentionService.requestErasure` and `/delete-account` add a `growth` step: delete `user_interest_profiles`, `propensity_scores`, `tracking_consent_current`, recipient rows not yet sent; queue ClickHouse deletion by `subject_key` and linked `device_key`s (§18.1); keep `marketing_suppressions` (hashed email only, so an unsubscribe still holds) and `affiliate_conversions` (no user id; financial record). The erasure audit row records counts per store. |
| **Objection to profiling / withdraw consent** | In EU/UK consent regions, withdrawing consent means: within 24 hours, collection stops, the profile is deleted, the person leaves all segments, and raw events are queued for deletion (§18.1). In US opt-out states, "Do not sell or share" (or GPC) removes the person from personalized-offer profiling and segments within 24 hours. Elsewhere, an objection sent to privacy@ is handled manually the same way. All recorded in `tracking_consents`. |
| **Correction** | Interest shown in the export can be marked "not me", which drops that intent for 180 days |
| **Limit sensitive use** | Not applicable by design (§8.6) |
| **Deadlines** | GDPR 1 month, CCPA 45 days. Tracked in the existing admin CCPA requests page (`AdminCCPARequestsPage.jsx`), with a new "growth data" checklist item. |
| **No discrimination** | Opting out never changes prices, ranking, access or service quality. A test asserts search ranking code never reads growth tables. |

### 18.1 ClickHouse deletion and export (D5)

| Step | Design |
|---|---|
| Queue | Erasure, consent withdrawal and account deletion add rows to `growth_erasure_queue` (Postgres main DB: `subject_key`, linked `device_key`s, reason, requested_at, status). |
| Nightly delete | `server/jobs/growthErasure.js` runs as `growth_rights`. It issues one lightweight `DELETE FROM growth.activity_events ON CLUSTER growth WHERE subject_key IN (…) OR device_key IN (…)` per batch (≤ 10,000 keys), and the same for `subject_activity_daily`. Rows disappear from queries at once. The bloom-filter skip indexes keep the scan small. |
| Physical removal | Lightweight deletes only mask rows until parts merge. A weekly job runs `ALTER TABLE … APPLY DELETED MASK` (or an `ALTER TABLE … DELETE` mutation on older versions) on partitions with masked rows, so data is physically gone **within 7 days**. It verifies with a count query per key sample and records counts in the erasure audit row. |
| Backups | Kept 7 days (§6.3), so deleted rows leave backups within a further 7 days. The privacy policy wording ("backup lifecycles") already covers this. |
| Aggregates | `activity_hourly` holds only `uniqState` sketches (no recoverable keys) and k-anonymous counts. It isn't rewritten. |
| Export | `/export` queries ClickHouse as `growth_rights` by `subject_key` and linked `device_key`s for the last 90 days (`max_execution_time` 60 s, streamed to CSV), then decodes event names and routes. The export job's audit row records the row count. |

---

## 19. Security

| Area | Control |
|---|---|
| Separation | ClickHouse cluster on its own servers, private network only, TLS. Roles `growth_writer` (INSERT only), `growth_reader` (read-only profile, rollups; raw only for the nightly job user), `growth_rights` (deletes and exports), `growth_admin` (DDL from CI only). No web-tier credential can read raw events. Main-DB growth tables have their own Postgres role for the nightly jobs. |
| Secrets | `GROWTH_SUBJECT_PEPPER`, partner postback secrets and token-signing keys live in the secrets manager (`docs/deployment-origin-lock.md` mentions AWS Secrets Manager), are never in the DB or logs, and are rotated yearly. |
| Encryption | Disk encryption (LUKS) on the ClickHouse, Keeper and Ollama boxes; encrypted backups in the OxSteed-owned bucket; TLS or WireGuard for every hop between hosts |
| Ingest abuse | Rate limits, size limits, schema validation, bot filtering. Demand uses **distinct** subjects with lower weight for signed-out ones, so spam can't easily paint a fake hotspot. A daily anomaly check flags any cell whose demand jumps over 5× week over week. |
| Prompt injection | User text sent to Ollama is data inside a fixed JSON field. The output is constrained to an enum or validated JSON. The model has no tools, network or DB access. |
| Open redirect | Signed tokens, partner domain allowlist, expiry |
| Postbacks | HMAC signatures, timestamp tolerance, replay dedupe, per-partner IP allowlist if offered |
| Admin access | Grants, regional territory, step-up for approve/export, fail-closed audit on member previews and exports, export needs `export_data` and goes through `ExportService.js` with formula-safe CSV (as in the query builder) |
| Supply chain | Ollama binary and model pinned by digest. Model files are pulled once to an internal registry, not from the internet at runtime. |
| Logging | No raw payloads in app logs. Sentry scrubbing rules extended for `query_norm` and `props`. |
| Pen test | External test of the ingest endpoint, redirect, postback, and admin growth routes before the first campaign |

---

## 20. Ollama: hosting, sizing, cost, and the analytics AI review

### 20.1 A separate, self-hosted path

- **New client** `server/growth/ollamaClient.js`. It reuses `resolveOllamaUrl()` for the SSRF guard but reads its own `GROWTH_OLLAMA_URL` / `GROWTH_OLLAMA_MODEL`.
  - The allowed host list is extended with one fixed private hostname, `growth-ollama`, reached over a private network or WireGuard. This is a one-line change to `OLLAMA_ALLOWED_HOSTS` in `supportChatProviders.js`.
- **No fallback, ever.** It doesn't import `aiChatProvider.js` or `callWithFallback`. A unit test fails if any `server/growth/**` file imports them, or calls `openrouter.ai`, `api.meta.ai` or `api.openai.com`.
- **If Ollama is down:**
  - Classification falls back to rules only, and low-confidence items wait in the queue.
  - Suggestions use the statistical ranking and template rationale.
  - Nothing goes to an outside provider.
- **Box isolation:** the Ollama server has **no outbound internet** (firewall) once models are loaded. Prompt logging is off (no `OLLAMA_DEBUG`). Inputs aren't stored; outputs are stored with a SHA-256 of the prompt for audit.

### 20.2 Model and sizing

| Job | Volume (6M users, steady state) | Model | Notes |
|---|---|---|---|
| Intent classification | ~20,000 items/day reach Ollama (after rules) | Qwen2.5-7B-Instruct, Q4_K_M (~5 GB), or a newer equivalent that passes the eval | ~0.3–0.8 s each with `OLLAMA_NUM_PARALLEL=4` → **2–5 GPU-hours/day** |
| Search query classification | ~50,000 new distinct queries/day at first, falling as the cache fills | same | ~0.2 s each (short) |
| Re-rank + rationale + 5-language draft copy | ~300 opportunities/night | Qwen2.5-14B-Instruct Q4 (~9 GB) for better ht/ar copy | ~20–40 s each → ~2–3 hours/night |
| One-time backfill | ~2M historical jobs, services and orders; rules settle 60–80% | 7B | ~1–3 days on one GPU |

Both models fit together in 20 GB of VRAM. The 3B model the support chat uses today (`qwen2.5:3b`) is too weak for Haitian Creole and Arabic copy. The eval set decides the final pick. Model licences (Apache-2.0 for Qwen2.5; check any alternative's licence) are part of the review in §20.4.

### 20.3 Hosting and cost (estimates; confirm before ordering)

| Item | Option | Approx. cost |
|---|---|---|
| GPU server for Ollama | Hetzner GEX44 (RTX 4000 SFF Ada 20 GB, 64 GB RAM) | ~€185–€235/month excl. VAT plus one-time setup (Hetzner changed GEX prices in 2026; current list shows both figures) |
| Second GPU for failover (optional) | Same | Same again. Without it, an outage just means rules-only for a while. |
| ClickHouse servers (D5) | 2 dedicated servers (one shard, two replicas), each ~16-core, 128 GB RAM, 2 × 1.92 TB NVMe RAID 1 (e.g. Hetzner AX102 class) | ~€110–€160/month each → **~€220–€320/month** |
| ClickHouse Keeper third node | Small cloud VM (2 vCPU, 4 GB); the other two Keeper members run on the ClickHouse servers | ~€5–€15/month |
| Backup storage | OxSteed-owned S3-compatible bucket, ~1–1.5 TB (weekly full + daily incrementals, 7-day retention) | ~€10–€30/month |
| Redis for the queue | Dedicated small instance with AOF + replica | ~€20–€50/month |
| Resend | 6M-email policy notice now; offer email only from Phase 8 | Custom volume plan; request a quota and rate increase before the notice |
| GeoNames data | Free, CC BY 4.0 attribution | €0 |

**Total (estimate):** about **€440–€650/month** excl. VAT (one GPU, two ClickHouse nodes, Keeper VM, backups, Redis), plus about €185–€235 for an optional second GPU, plus the Resend custom plan and one-time setup fees. The old Postgres events-DB line (~€150–€250) is replaced by the ClickHouse lines.

**Region:** put the GPU and ClickHouse in the same region as the production app, or in the EU for EU data residency. The production host's location isn't stated in the repo (Q1). Either way, everything stays on servers OxSteed rents and controls, which is what "no data leaves OxSteed" means here. The hosting provider is an infrastructure processor, not an AI provider.

### 20.4 How this relates to the analytics AI-model fallback, and what the review needs

- The **analytics NL fallback** (`nlModelTranslator.js`, `ANALYTICS_NL_MODEL_ENABLED=false`) stays off. It sends admins' free-text questions to the **Meta** API (R7), an outside provider. That's why it's waiting on a provider and privacy review (`COMPLETION.md`, decision 5).
- This engine **doesn't use that path** and doesn't change it. It's a separate, self-hosted Ollama path.
- Once the Ollama box exists, the NL fallback *could* be pointed at it, which would make its review simpler. That's a separate decision and isn't part of this spec.

**The review this engine needs before tracking starts:**

1. **DPIA** (GDPR Art. 35): large-scale tracking and profiling for marketing needs one. Cover purposes, necessity, risks and mitigations from this spec, and get DPO/legal sign-off.
2. **Legitimate interest assessment** for notice-basis regions (US, Brazil, others).
3. **Hosting check:** Ollama, ClickHouse and its backups are on OxSteed-controlled servers and storage, with no outbound internet, disk encryption, and a named owner.
4. **Data minimization check of prompts:** only scrubbed job/service text for classification, and only aggregates for ranking. Spot-check 200 random prompts for leftover personal data.
5. **Model licence check** and pinned digests.
6. **Acceptance:** eval results (§8.5), red-team prompts (injection in job text), and a bias check (similar offers across languages and countries for the same intent).
7. **Records:** add "Growth Insights" to the record of processing activities, and update the App Store/Play privacy labels.

---

## 21. Metrics and success criteria

### 21.1 Governed metrics (added to `server/analytics/metricsRegistry.js`)

These get the builder, evidence, alerts, region filtering and nightly snapshots automatically (add to `VALUE_COLUMNS` in `metricSnapshots.js`; add anchors in `regionScope.js`).

| Metric | Definition | Permission | Region anchor |
|---|---|---|---|
| `growth_campaign_recipients` | recipients with ≥ 1 sent delivery, per campaign send day | `view_growth_insights` | recipient user's address |
| `growth_offer_ctr_pct` | distinct clickers / distinct delivered | `view_growth_insights` | recipient user |
| `growth_offer_optout_rate_pct` | people who turned off offer push or in-app offers within 48 h of a delivery / delivered, per channel (email unsubscribes added in Phase 8) | `view_growth_insights` | recipient user |
| `growth_push_open_rate_pct` | push taps / push delivered; **web and updated native apps only**, labelled partial until the app update is adopted | `view_growth_insights` | recipient user |
| `growth_affiliate_commission_cents` | approved commission minus reversals, **per currency** | `view_financials` | recipient user |
| `growth_promo_redeemed_cents` | `promo_discount_cents` filtered to campaign codes | `view_financials` | existing promo anchors |
| `demand_unfilled_rate_pct` | jobs expired unfilled / jobs published | `view_growth_insights` | job location (postal) |
| `demand_gap_index` | median gap across active cells | `view_growth_insights` | postal centroid (new anchor type) |

### 21.2 Operations targets

| Area | Target |
|---|---|
| Event loss (accepted by API but not stored) | < 0.1% per day |
| Ingest latency, API → stored | p95 < 60 s |
| Consent correctness | **0** stored events from people the gate disallows. A nightly audit query re-checks yesterday's events against the consent ledger and pages on any hit. |
| Rollup freshness | ready by 06:00 UTC daily |
| Classification quality | ≥ 90% top-1 precision overall, ≥ 85% per language |
| Ollama availability | ≥ 99% monthly. Outages degrade to rules-only. |
| DSAR | 100% within deadline; deletion propagated to raw events within 7 days |

### 21.3 Business targets (review after 90 days of sending)

| Metric | Target |
|---|---|
| Suggestions approved (with or without edits) | ≥ 30% |
| In-app offer card click-through | ≥ 2% of impressions |
| Push click-through (taps that open the offer, web + updated apps) | ≥ 4% of delivered |
| Offer-push opt-in rate (of people shown the prompt) | ≥ 20% |
| Offer opt-outs per campaign (push or in-app turned off) | < 0.5%; auto-pause a campaign above 1% (owner-ratified 2026-10-20: the rule fires only once a campaign has at least 100 delivered, so a single opt-out in a tiny send cannot pause it) |
| Push device loss (users disabling OS notifications for OxSteed entirely after an offer push) | no measurable rise vs. 30-day baseline; any rise pauses push campaigns for review |
| Offer email CTR, unsubscribes, complaints (Phase 8) | ≥ 3%; < 0.5%; < 0.1% (auto-pause at 0.1%, provider ceiling 0.3%) |
| Holdout lift on conversions | positive and significant on ≥ 50% of campaigns with holdout |
| Net affiliate revenue per 1,000 recipients | tracked per currency; target set after the first 10 campaigns |
| Recruitment: gap cells that got ≥ 1 new provider within 60 days of a recruitment campaign | ≥ 25% |

---

## 22. Permissions, region scoping and audit

| Rule | How |
|---|---|
| Grants | New grants (§15.1) plus the reused ones. Checked per request **and** at execution, like `metricAccess.js`. Revoked or expired grants stop background views and exports immediately. |
| Regional admins | See only rows inside their territory. New anchors in `regionScope.js`: `demand_daily`/`supply_daily` (postal centroid → zip, country, lat/lng from `geo_postal_centroids`), `user_interest_profiles` and `offer_campaign_*` (user address), `affiliate_conversions` (via recipient). Any table without an anchor fails closed (`region_scope_unsupported`), the existing rule. |
| Global grant | Sees everything, as today |
| Targeting | A regional admin's segments get their territory ANDed in, and they can't remove it. Campaign approval checks that 100% of frozen recipients are inside the approver's territory. |
| Audit | `logAdminAction` for every create, edit, approve, send, cancel, export, member preview, setting change, partner change and classification override. Fail-closed for member previews and exports. The hash chain is verified daily by the existing job. |
| Two-admin rules | Existing ones are unchanged (money dual approval, settings separation, refunds, credit adjustments). Offer campaigns add **no** new two-admin rule: the creator may approve and send (D4), with every step audited. The kill switch and cap settings go through the existing settings change-request flow, unchanged. **P3-1009 is not touched.** |

---

## 23. Languages and RTL

- **Copy in 5 languages (en/es/fr/ht/ar)** for: admin UI, user settings (offer channels, the US-state "Do not sell or share" switch, consent-region offers consent), the relabelled Analytics toggle, consent banner and settings, `/privacy/upcoming`, the notice email, the in-app notice banner, offer in-app cards and offer detail screen, offer push titles and bodies (with length checks per language), the offer-push opt-in prompt, offer email templates and email unsubscribe pages (Phase 8), "offer ended" page, partner disclosure lines.
- Campaign copy is required in all 5 before review.
- Other app languages fall back to English for offer copy. The privacy policy (and its upcoming version) is professionally translated into all 20 languages (D3, §4.1); the notice email body is 5 languages for now (Q20).
- **Arabic:** `dir="rtl"`, logical properties, mirrored icons where meaningful. Prices and links are isolated with bidi controls (as PR #617 did for chat links). Email templates are tested in RTL.
- **Haitian Creole and Arabic AI drafts** use the 14B model and always need human review. That's already true for all AI copy, but these two are labelled "check carefully".

---

## 24. Phased rollout and migrations

Migration numbers start at **916** (the latest is `915_support_chat_replies_feedback.sql`). Check `docs/migration-number-collisions.md` at build time. ClickHouse migrations live in a new `server/migrations-clickhouse/` folder (`C001…`), applied by a small runner `server/scripts/clickhouseMigrate.js` that records applied files in `growth.schema_migrations` (ClickHouse) and runs `ON CLUSTER`. CI starts a ClickHouse container and applies them on every PR touching the folder. Everything is additive.

| Phase | Weeks (indicative) | Builds | Migrations | Exit criteria |
|---|---|---|---|---|
| **0. Legal and switch** | 0–2 | Policy text (professional translation into all 20 locales, legal review of 5), Cookie Policy, `/privacy/upcoming`, banner relabel (Analytics → "Google Analytics and device storage") + `CONSENT_VERSION` bump, "Do not sell or share" switch + GPC for US opt-out states, consent ledger, jurisdiction rules, tracking rollout + kill switch, notice email pipeline (Resend batch), dismissible in-app notice banner (no re-accept gate), DPIA/LIA. Pre-work for R2 (Discover coordinates) and R10 (export gaps). | `916_tracking_consents_and_jurisdictions.sql` (`tracking_consents`, `tracking_consent_current`, `jurisdiction_rules`), `917_activity_tracking_rollout.sql` (`activity_tracking_rollout`, setting keys), `918_policy_notice_delivery.sql` (`policy_notice_campaigns`, `policy_notice_deliveries`, `policy_notice_acknowledgements`), `919_discover_search_log_minimize.sql` (postal ref column, drop lat/lng after backfill, retention) | Legal sign-off; send plan fixed; notice sending starts; emails quote planned last send + 14 days; server computes `effective_at` = actual last send + 14 days (§4.3) |
| **1. Pipes (during the notice period, tracking off)** | 2–5 | ClickHouse cluster (2 replicas + Keeper), backups to the OxSteed bucket with a restore drill, roles, Redis stream, `/api/activity/*`, client tracker + autocapture + lint, server `emitDomainEvent` + outbox + relay, ClickHouse writers, materialized-view rollups, nightly export skeleton to Postgres. Tested on staging with synthetic users only. | `920_activity_outbox.sql`; ClickHouse `C001_database_roles_profiles.sql` (database, users, roles, settings profiles, quotas), `C002_activity_events.sql` (table, TTL, skip indexes), `C003_rollup_views.sql` (`activity_hourly`, `subject_activity_daily` + materialized views) | Load test at 5,000 events/s for 1 hour with < 0.1% loss; the gate test proves 0 stored events while the switch is off; a replica kill and a backup restore both rehearsed |
| **2. Understanding** | 3–6 | Taxonomy tree + rules (5 languages), Ollama box + growth client, classification + review queue + eval, GeoNames import, cluster finder | `921_demand_taxonomy.sql` (`demand_taxonomy_nodes`, `demand_taxonomy_rules`), `922_entity_intents.sql` (`entity_intents`, `classification_review_queue`), `923_geo_postal_centroids.sql` | Eval passes; centroid coverage ≥ 98% of users with a postal code in the top 10 countries |
| **3. Turn on tracking** | at effective date | Content swap (no `TERMS_CONFIG` version bump, D2) + banner switches to "changed on {date}"; switch on through settings approval; ramp 1% → 10% → 100% of eligible people over 7 days (capacity ramp only); data-rights additions live **before** the first event | `924_growth_rollups.sql` (`demand_daily`, `supply_daily`, `user_interest_profiles`, `growth_rollup_runs`), `925_growth_privacy_rights.sql` (`growth_erasure_queue`, export/erasure bookkeeping) | Consent audit shows 0 violations for 7 days; DSAR export includes ClickHouse rows; a test erasure is physically gone within 7 days |
| **4. Insights and suggestions** | +2–4 after on | Heatmap, gap index, propensity v1, segment builder, recommendation engine, admin pages, new grants, governed metrics | `926_growth_segments.sql` (`growth_segments`, `growth_segment_versions`), `927_offer_suggestions.sql` (`offers`, `offer_intent_map`, `offer_suggestions`), `928_growth_permissions_and_metrics.sql` (grant scopes, audit event types) | Admins use it weekly; suggestions look sensible in review |
| **5. Partners and campaigns** | +3–6 | Partners, feeds, tracked links, postbacks, conversions; delivery core extraction; offer campaign tables + worker for **in-app and push**; in-app offers card and offer detail screen; push payload with `growth_offer` type and shared `/api/broadcast-tracking/p/` track URL; offer-push opt-in prompt; caps and quiet hours; preferences (push, in-app, and an email column defaulting off); global suppressions; per-locale copy checks | `929_affiliate_partners.sql` (`affiliate_partners`, `partner_feeds`, `partner_category_map`, `marketplace_products` new columns), `930_offer_clicks_and_conversions.sql` (`offer_clicks`, `affiliate_conversions`), `931_offer_campaigns.sql` (`offer_campaigns`, `offer_campaign_recipients`, `offer_campaign_deliveries`, `discount_codes.offer_campaign_id`), `932_offer_preferences_caps_suppressions.sql` (`offer_preferences`, `marketing_contact_log`, `marketing_suppressions`) | First in-app + push campaign approved (creator may approve, D4) with a complete audit trail; quiet hours proven in a test across 3 time zones; business broadcast tests pass unchanged; pen test passed. **App dependency:** native push open counts need the iOS/Android update per `push-open-contract.md` (plus `growth_offer` deep link and an "Offers" notification channel). Campaigns can start without it; native opens just show as partial. |
| **6. Propensity v2 and scale review** | +3 months | Python model worker; ClickHouse capacity review (disk, merges, query latency) and decide on a second shard if needed | `933_propensity_scores.sql` | Model card approved |
| **7. OxSteed catalog** | later | Own SKUs, inventory, checkout, fulfilment, returns | `934_catalog_inventory.sql`, `935_catalog_orders_surface.sql`, `936_catalog_fulfilment.sql` | Terms of sale approved; entry criteria in §14 met |
| **8. Offer email (deferred)** | later; can come before or after Phase 7 | Email channel for offer campaigns (§16.4): `offers@` sending subdomain with SPF/DKIM/DMARC and warm-up, Resend webhook mapping to campaign deliveries, one-click unsubscribe, CAN-SPAM footer with **full postal address**, EU/UK/CASL email consent, partner email rules, email caps | next free numbers (≈ `937_offer_email_channel.sql`: allow `email` in the `offer_campaign_deliveries` channel check, provider-event columns, suppression sources `hard_bounce`/`complaint`) | Postal address confirmed (Q19); deliverability review; first email campaign approved (creator may approve, D4) and audited |

**Flags and settings (all default off):** `growth.activity_tracking_enabled` (setting), `GROWTH_TRACKING_HARD_OFF`, `GROWTH_PARTNER_OFFERS_ENABLED`, `GROWTH_CAMPAIGN_DELIVERY_ENABLED`, `GROWTH_OLLAMA_URL`, `GROWTH_OLLAMA_MODEL`, `GROWTH_OLLAMA_RANK_MODEL`, `GROWTH_SUBJECT_PEPPER` (secret), `GROWTH_AGE_VERIFICATION_PROVIDER` (default `none`), `GROWTH_AGE_SELF_ATTESTATION` (default `off`; only `on` enables), `GROWTH_AGE_ATTESTATION_VERSION`, `GROWTH_CLICKHOUSE_URL`, `GROWTH_CLICKHOUSE_WRITER_*` / `_READER_*` / `_RIGHTS_*` (secrets), `GROWTH_CLICKHOUSE_BACKUP_*` (secrets), `GROWTH_REDIS_URL`. All are documented in `server/.env.example` and checked in `server/utils/validateEnv.js`, plus provider health in `providerHealthRegistry.js`.

**Ops steps (for Emile or ops, not code):** order the GPU server, the two ClickHouse servers and the Keeper VM, and create the OxSteed-owned backup bucket; request the Resend quota and rate increase for the policy notice; ship the iOS/Android app update for push opens, the `growth_offer` deep link and the "Offers" notification channel; set the secrets; register partner accounts and postback URLs; run migrations through the deployment workflow; confirm the computed effective date (last send + 14 days) after the notice completes; name the ClickHouse on-call owner.

---

## 25. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| K1 | Tracking a US user who declined the analytics toggle looks deceptive (FTC / state law) | Medium / High | Relabel the toggle to "Google Analytics and device storage" and disclose clearly in policy section 8/14 (D1, §4.6); "Do not sell or share" + GPC in opt-out states (Q3); no general opt-out elsewhere (accepted by Emile, D1) |
| K2 | EU/UK consent can't be proven (today's banner is client-only) | High until fixed / High | Server consent ledger before EU tracking (R1) |
| K3 | Notice timing mistake (tracking before 14 days) | Low / High | Server refuses an early effective date; switch requires `effective` state; audit |
| K4 | Users miss the change because there's no forced re-accept (D2) | Medium / Low | 14-day email to everyone, dismissible banner from first send to +30 days, dismissals recorded as evidence; the re-accept gate is not used, so no mobile breakage risk |
| K5 | ClickHouse is new to the team: misconfiguration, too many parts, Keeper loss, failed upgrades | Medium / Medium | Big insert blocks, 2 replicas + 3 Keeper nodes, pinned LTS, staging rehearsals, restore drills, named on-call owner (Q4), monitoring of parts, merges, replication lag and disk |
| K5b | Lightweight deletes don't physically remove data in time | Low / High | Weekly `APPLY DELETED MASK`/mutation, verification counts in the erasure audit, 7-day backup retention (§18.1) |
| K6 | Redis loss drops events | Medium / Low | AOF + replica; domain events go through the DB outbox and never drop |
| K7 | Bad classifications produce silly offers | Medium / Medium | Rules first, eval gates, review queue, human approval of every campaign |
| K8 | Small clusters re-identify people (e.g. "the only plumber in a ZIP") | Medium / Medium | k = 5 suppression in maps and previews, member lists only inside approved segments with audit |
| K9 | Offer pushes annoy people, who then turn off **all** OxSteed notifications, including job and order alerts | Medium / High | Explicit opt-in, separate OS "Offers" channel, 1 push per 7 days, quiet hours, auto-pause above 1% opt-outs, watch device loss (§21.3) |
| K9b | Native push opens undercounted until the app update ships | High / Low | Label as partial; score on clicks and web/in-app opens (§16.2) |
| K9c | Spam complaints hurt the sending domain (Phase 8 email only) | Medium / High | Separate offers subdomain, caps, auto-pause at 0.1%, warm-up |
| K10 | Partner terms break (e.g. Amazon links in email, Phase 8) | Medium / Medium | Per-partner `allowed_channels`, legal review per partner |
| K11 | AI copy makes claims that aren't true | Medium / Medium | Validation rules, prices only from feeds, human review, "AI-written" label |
| K12 | Sensitive inference by accident (e.g. halal → religion) | Low / High | `sensitive` flag, restaurant-level only, review of new intents |
| K13 | GPU outage | Medium / Low | Rules-only degrade; optional second box |
| K14 | Costs climb (Resend volume, servers) | Medium / Low | Caps, daily send budget, measurement-first like `resource-cost-optimization.md` |
| K15 | Existing automatic sends (re-engagement, digest) conflict with "no automatic sends" | Medium / Low | Count them in caps; Q9 |
| K16 | Region filters miss users whose ZIP was never geocoded (R3) | High today / Medium | Reference table; Q10 |
| K17 | Translating all 20 policy languages delays the notice (D3) | Medium / Medium | Order translations as soon as the English text is final; the CI check blocks a partial release; the notice can't start until all 20 are in |
| K18 | Scope creep into Credit data | Low / High | Excluded by design and by a guard test on `server/growth/**` imports |

---

## 26. Open questions for Emile

Questions answered on October 20 (storage, effective date, re-acceptance, cookie toggle and GPC, translations, campaign approval, channels) are removed. They're recorded as D1–D7 at the top. The rest are renumbered, ordered by how much they block, and new questions raised by those decisions are marked *(new)*.

| # | Question | Recommendation |
|---|---|---|
| **Q1** | *(new, merges old Q10)* Where do the ClickHouse servers (and the GPU) run? Which provider and region, and is two replicas plus a small third Keeper VM the right size, or one node to start? Where production runs isn't stated in the repo. | Same provider and region as production (EU if EU residency is wanted); 2 replicas + 3 Keeper members from day one, because raw events are the source for data-rights work and one node is a single point of failure |
| **Q2** | *(new)* Treat Switzerland and Québec as consent (opt-in) regions like the EU/UK? | No. Switzerland and all of Canada, including Québec, use notice treatment (D9); legal maintains the reviewed state data. |
| **Q3** | *(new)* For "Do not sell or share": which US states get it (list in `jurisdiction_rules`), and what must it switch off? | Every state with a comprehensive privacy law in force that grants a sale/sharing opt-out, kept by legal; switch off personalized offer profiling and marketing cookies; broad offers stay allowed. |
| **Q4** | *(new)* Who operates ClickHouse (on-call, upgrades, restore drills)? The team doesn't run it today. | Name one owner plus a backup before Phase 1; budget 1–2 days a month; consider a paid support contract only if incidents occur |
| **Q5** | *(was Q8)* Before the effective date, may we build area-level, k-anonymous demand maps from records we already keep (no per-person data)? | Yes, if legal confirms it fits the current policy |
| **Q6** | *(new)* Backup approach for ClickHouse: which bucket (same provider as the servers, or a second provider for off-site), 7-day retention, and should backups be client-side encrypted? | OxSteed-owned S3-compatible bucket at a **different** provider or region from the servers; daily incremental + weekly full; 7-day retention (fits the 7-day deletion promise); encrypted; quarterly restore drill |
| **Q7** | *(new)* D1 removes the personalized-offers opt-out. Keep a separate "Show offer cards in the app" display toggle (not a profiling opt-out), or only per-card "Not relevant"? | Keep the in-app display toggle; it costs little and reduces annoyance, and doesn't change profiling |
| **Q8** | *(was Q12)* Raw event retention: 90 days everywhere, or 30 days in consent regions? | 90 days everywhere (migration `C005_activity_events_retention.sql`). |
| **Q9** | *(was Q7)* Keep `customerReengagementJob` and the Discover digest automatic, or move them under admin approval? | Keep them but count them in the caps; review their copy |
| **Q10** | *(was Q9)* Load GeoNames postal centres (CC BY 4.0) and also switch the existing region filters (`regionScope.js`) to them? That changes some regional numbers. | Load them now; switch region filters in a separate, announced change |
| **Q11** | *(was Q14)* Send the notice to businesses' clients who don't have OxSteed accounts? | No; they aren't OxSteed users |
| **Q12** | *(was Q11)* Merge the existing `site_visits` pageview tracking into the new pipeline later? | Yes, after 90 days of parallel running |
| **Q13** | *(was Q18, updated)* Budget OK for ~€440–€650/month (one GPU, two ClickHouse servers, Keeper VM, backups, Redis; §20.3), plus the Resend custom plan? A second GPU (~€185–€235/month) for failover? | Yes; one GPU now, second later if needed |
| **Q14** | *(was Q19)* Offer push is designed as **explicit opt-in on every platform**, because Apple rule 4.5.4 requires it for promotional push on iOS, and one rule everywhere is simpler. That means push reaches only people who say yes. OK, or opt-out on Android and web outside consent regions? | Opt-in everywhere |
| **Q15** | *(was Q20)* Who ships the iOS/Android update (push-open call per `push-open-contract.md`, `growth_offer` deep link, "Offers" notification channel), and when? Campaigns can start before it; native push opens just show as partial. | Ship it alongside Phase 5 |
| **Q16** | Which affiliate networks first? | Home Depot (fits existing `marketplace_products` source) and one general network (Impact or Awin); Amazon in-app and push are fine; never email |
| **Q17** | Should helpers who drive partner sales share in the commission later? | Not in v1. If yes later, payouts go through the existing affiliate payout and dual-approval path unchanged. |
| **Q18** | *(was Q13)* Buy licensed business-listing data to reach businesses not on OxSteed? | Not now; revisit after the gap index proves useful |
| **Q19** | *(was Q15)* Offer email (Phase 8) needs OxSteed LLC's full postal address in the footer (CAN-SPAM). What is it? | Not blocking now; needed before Phase 8 |
| **Q20** | *(new)* D3 translates the policy into all 20 languages. Translate the notice email body and in-app banner into all 20 as well (today: 5, with a native-language first line linking to the translated policy)? | Yes; it's short text and makes the notice clearer for the 15 other languages |

---

## Appendix A. New tables at a glance

| Store | Table | Purpose |
|---|---|---|
| main | `tracking_consents`, `tracking_consent_current` | Server consent ledger |
| main | `jurisdiction_rules` | Per-region legal basis |
| main | `activity_tracking_rollout` | Notice → effective state machine |
| main | `policy_notice_campaigns`, `policy_notice_deliveries`, `policy_notice_acknowledgements` | 14-day notice email and dismissible banner evidence |
| main | `activity_outbox` | Transactional domain events |
| ClickHouse (`growth` database) | `activity_events` (ReplicatedReplacingMergeTree, daily partitions, TTL 90 days), `activity_hourly` (AggregatingMergeTree), `subject_activity_daily` (AggregatingMergeTree), materialized views, `schema_migrations` | Raw and hourly data |
| main | `demand_taxonomy_nodes`, `demand_taxonomy_rules` | Intent tree and rules |
| main | `entity_intents`, `classification_review_queue` | Classifications |
| main | `geo_postal_centroids` | Postal centres (no personal coordinates) |
| main | `demand_daily`, `supply_daily`, `user_interest_profiles`, `growth_rollup_runs` | Rollups |
| main | `propensity_scores` | Potential-customer scores |
| main | `growth_segments`, `growth_segment_versions` | Segments |
| main | `offers`, `offer_intent_map`, `offer_suggestions` | Offers and suggestions |
| main | `affiliate_partners`, `partner_feeds`, `partner_category_map` (+ `marketplace_products` columns) | Partners |
| main | `offer_clicks`, `affiliate_conversions` | Clicks and revenue |
| main | `offer_campaigns`, `offer_campaign_recipients`, `offer_campaign_deliveries` | Campaign delivery |
| main | `offer_preferences`, `marketing_contact_log`, `marketing_suppressions` | Opt-outs and caps |
| main | `growth_erasure_queue` | ClickHouse deletion queue (§18.1) |

## Appendix B. New server and client modules

| Path | Role |
|---|---|
| `server/growth/gate.js` | `trackingGate.allow(subject, purpose)`: switch, jurisdiction, consent, exclusions |
| `server/growth/emit.js`, `server/jobs/activityOutboxRelay.js` | Domain events |
| `server/routes/activity.js` | `/api/activity/config`, `/api/activity/batch`, `/api/consent/tracking` |
| `server/growth/ingest/writer.js` (worker) | Stream → ClickHouse (`@clickhouse/client`, batched inserts with dedup tokens) |
| `server/growth/events/schemas/*` | Event schemas |
| `server/growth/taxonomy/*`, `server/growth/classify.js` | Rules + Ollama classification |
| `server/growth/ollamaClient.js` | Self-hosted only, no fallback |
| `server/growth/geo/*`, `server/scripts/importPostalCentroids.js` | Centroids, clusters |
| `server/growth/segments/*`, `server/growth/recommend/*` | Segments and suggestions |
| `server/growth/partners/*`, `server/jobs/partnerFeedImport.js`, `server/routes/partners.js` | Partners, feeds, postbacks, redirect |
| `server/services/delivery/core.js` + adapters, `server/jobs/offerCampaignDelivery.js` | Shared delivery |
| `server/jobs/growthNightlyRollups.js`, `server/jobs/growthConsentAudit.js` | ClickHouse → Postgres rollups and consent audit |
| `server/growth/clickhouse.js`, `server/growth/clickhouseQueries.js` | ClickHouse clients per role and the fixed, audited admin queries |
| `server/scripts/clickhouseMigrate.js`, `server/migrations-clickhouse/C*.sql` | ClickHouse migrations |
| `server/jobs/growthErasure.js` | Nightly lightweight deletes, weekly physical purge, export helper (§18.1) |
| `client/src/growth/ActivityTracker.jsx`, `client/src/growth/useTrack.js` | Client tracker |
| `client/src/admin/pages/growth/*` | Admin pages |
| `client/src/pages/privacyUpcoming.tsx`, `client/src/locales/privacy/next/*` | Upcoming policy |
