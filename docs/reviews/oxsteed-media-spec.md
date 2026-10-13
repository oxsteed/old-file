# OxSteed Media — Design Spec (design-only)

| Field | Value |
|---|---|
| **Repo** | `/workspace/old-file` (`oxsteed/old-file`) |
| **Branch** | `old-files-claude` |
| **SHA** | `bd92ad2b2ca89f929f34a92f4f57e91ec7e34569` |
| **Date** | 2026-10-06 19:50 EDT |
| **Author ask** | Define OxSteed Media as a new branch similar to OxSteed Logistics / OxSteed Direct |
| **Constraint** | Design-only. NO code changes, NO commits, NO push. |
| **UI constraint** | Product structure must mirror the attached X/Twitter post layout (content shape only — no political positions). |

**Legend:** Claims about current code cite files. Sections marked **[PROPOSAL]** are new design, not existing code.

Screenshots are treated only as the **content shape**: short video/photo posts, quote-posts, engagement counters, reply threads, bottom nav. No political content is adopted.

---

## Emile locked decisions (2026-10-06)

All 17 items below are **DECIDED** as of 2026-10-06. They override any earlier Option A / open-question language in this spec.

1. **Product positioning:** Option C (full creator marketplace — paid gigs, sponsorships, tipping via Credit) is **deferred to v3**. MVP still ships the X-shaped local Media branch for discovery/promo (Home prefers nearby linked entities). **Do not** treat Option A as the chosen long-term monetization path — Option A describes the MVP shell and feed philosophy only.
2. **MVP posters:** Verified helpers, businesses, and restaurants only.
3. **Attach links:** Any public restaurant / helper / job / etc.; cap ~5 links per post.
4. **Restaurant Media:** Keep the restaurant Media tab; dual-write into OxSteed Media later.
5. **MVP media types:** Full video file uploads with scan / transcode / CSAM pipeline (subject to decision #12).
6. **Deep-link ranking:** Strong boost for posts with valid local entity links.
7. **Spaces MVP:** Real local city/category channels (not a placeholder icon).
8. **Messages tab:** Reuse existing `/messages` messenger.
9. **Launch:** Focused Network branch when ready.
10. **Handles:** Reuse helper/business `profile_slug` only.
11. **Verified badge:** Didit identity for helpers; business verified; restaurant verified flags.
12. **Age / CSAM:** Didit identity required to upload video; **and** block public video uploads until a production CSAM vendor is certified. Photos and non-public video pipeline work may still progress (see MVP acceptance).
13. **Relevant sort:** Latest only at MVP; Relevant later.
14. **Monetization:** Paid post boosts only after creator marketplace in **v3+** (not v2).
15. **Feed philosophy:** Discovery/promo for the local economy; prefer nearby linked entities.
16. **Moderation at launch:** Auto flags / DMCA only until staffed.
17. **Federation:** Dual-write `restaurant_media_items` into `media_post_links`.

---

## 0. UI → product contract (must match screenshots)

OxSteed Media is an **X/Twitter-shaped local content branch**. Every screenshot surface maps 1:1 to a route, component, and data field.

### 0.1 Post detail page → contract

| UI element (screenshot) | Product field / behavior | **[PROPOSAL]** API / table |
|---|---|---|
| Author avatar | Actor avatar URL | `media_actors.avatar_url` (from helper/business/restaurant profile) |
| Display name | Actor display name | `media_actors.display_name` |
| Verified badge | Didit (helpers) / business verified / restaurant verified flags (Emile locked #11) | Derived from Didit / `businesses.is_business_verified` / restaurant verified flags — see §3.2 |
| `@handle` | Public handle | **DECIDED** reuse `profile_slug` only (`575_profile_slugs.sql`); `media_actors.handle` aliases slug (Emile locked #10) |
| Post text | Caption / body | `media_posts.body` |
| Embedded video/image + mute toggle | Primary media + client mute | `media_posts` + `media_post_assets`; player mute is client-only (mirror restaurant media muted preview in `RestaurantMediaUploadModal.jsx`) |
| Timestamp | Created time (relative + absolute on detail) | `media_posts.created_at` |
| View count | Views | `media_posts.view_count` (+ optional `media_post_views` for dedupe) |
| Action row: replies / reposts / likes / bookmarks / share | Five actions + counts | Counters on `media_posts`; edges in `media_replies` (parent_id), `media_reposts`, `media_likes`, `media_bookmarks`; share = copy/OG link (no table required for MVP) |
| Count next to each action | Denormalized counters | `reply_count`, `repost_count`, `like_count`, `bookmark_count`, `view_count` |
| “Relevant” reply sort dropdown | Ranking mode | MVP: **Latest only** (Emile locked #13); `GET .../replies?sort=latest` — Relevant (`sort=relevant`) deferred post-MVP |
| “View quotes” link | Quote-of this post list | `GET /api/media/posts/:id/quotes` (`quoted_post_id = :id`) |
| Sticky “Post your reply” composer | Create reply | `POST /api/media/posts` with `parent_id` |
| **“Linked on OxSteed” / product card row** | One or more tagged OxSteed entity deep-links (restaurant, dish, helper, business, job, …) | `media_post_links` hydrated on GET; UI chips/cards under media (or light overlay) — **must not** displace reply/repost/like/bookmark/share chrome (§0.5) |

### 0.2 Quote-post → contract

A quote-post is a normal post that **embeds another post card** (author, handle, age, text, media).

| UI | **[PROPOSAL]** data |
|---|---|
| Outer post (quoter) | `media_posts` row with `quoted_post_id` set, `parent_id` null |
| Inner card | Joined `quoted` post + its actor + primary asset |
| Not a reply | `parent_id IS NULL` AND `quoted_post_id IS NOT NULL` |

### 0.3 Reply thread list → contract

| UI element | **[PROPOSAL]** |
|---|---|
| Each reply row | `media_posts` where `parent_id = root_post_id` (replies are posts) |
| Avatar / name / verified / handle / relative age | Same actor projection as post detail |
| Text + “Show more” truncation | `body` + client truncate (e.g. 280 chars expanded) |
| Per-reply action row (reply, repost, like, views, bookmark, share) | Same action model as root posts |

### 0.4 Bottom nav → contract

| Tab | Badge | **[PROPOSAL]** route |
|---|---|---|
| Home feed | — | `/media` |
| Search | — | `/media/search` |
| Community / spaces | unread/community badge | `/media/communities` (**DECIDED** MVP: real local city/category channels — Emile locked #7) |
| Notifications | unread count | `/media/notifications` (backed by existing `/api/notifications`) |
| Messages | unread count | `/media/messages` → **DECIDED** reuse existing `/messages` messenger (Emile locked #8) |

### 0.5 Commerce / entity deep-links (“Linked on OxSteed”) **[PROPOSAL]**

User rule: a video about good food at a restaurant can link the **restaurant profile** and/or the **food items** themselves; same for tools, jobs, helpers, businesses, Direct catalog, logistics campaigns — everything on OxSteed.

| UI | Behavior |
|---|---|
| Placement | Horizontal **product card / chip row** labeled e.g. “Linked on OxSteed”, **under** the media (preferred) or as a non-blocking overlay strip on the media — same family as restaurant Media `DishBar` in `RestaurantMediaFeed.jsx` |
| Chrome rule | X-shaped post structure stays intact: avatar/name/handle/body/media/action row untouched. Linked cards are an **additive** commerce strip, not a sixth engagement action |
| Card content | Entity thumbnail (optional), `label` (or live name), optional **price snapshot**, entity-type badge, primary CTA (“View”, “Order”, “Book”, “Rent”, “Apply”) |
| Tap — view | Navigate to canonical public URL (always allowed where the target profile/page is public) |
| Tap — book / order / pay / rent / apply | Same **login gate** pattern as public profiles / restaurant Media: guests may view; transactional CTAs call `onRequireLogin` / navigate `/login` with `state.from` return (see `HelperBusinessProfilePage.tsx` guest sign-in modal; `RestaurantMediaFeed.jsx` `onRequireLogin`; food checkout `signInToCheckout`) |
| Unavailable target | If live join says gone/unpublished: show **snapshot-only** chip (not tappable) — mirror `dishLinkState` in `client/src/utils/restaurantMedia.js` (`available=true` → tappable; else snapshot) |
| Multi-link | 1–N links per post (**cap ~5 MVP**, Emile locked #3); any public entity; `sort_order` controls chip order; compose UI to pick entities |

**Ranking / product rule:** deep-links are how Media serves the **local economy loop** (post → order / book / rent / apply), not engagement-max. Feed ranking applies a **strong boost** for posts with valid local entity links (Emile locked #6 / #15; `oxsteed-product-definition.md`).

**Reuse naming from existing attach-product patterns (cite, do not invent):**

| Existing pattern | Cite | What Media reuses |
|---|---|---|
| Tag dishes on restaurant Media | `restaurant_media_items` (`664_restaurant_media.sql`): `menu_item_id`, `item_name_snapshot`, `item_price_snapshot_cents`, `currency_code`; hydrate + `available` in `restaurantMediaController.js` | Snapshot + availability; generalized as `media_post_links` |
| Dish chip bar UI | `DishBar` in `RestaurantMediaFeed.jsx`; tap → `jumpToMenuItem` / `?dish=` on `FoodRestaurantPage.jsx` (`id=menu-item-{id}`) | Chip/card UX + deep-link into restaurant page |
| Login gate on Media actions | `onRequireLogin` / signed-out watch-only in `RestaurantMediaFeed.jsx` | Guest view vs auth for transactional CTAs |
| Featured placement (promo, not content attach) | `routes/businessMarketing.js` `featured-placement-requests`; `adminFeaturedPlacement.js`; `FeaturedPlacementReview.jsx` | **Not** the attach model — keep separate from post links; paid Media boosts only in **v3+** after creator marketplace (Emile locked #14) |
| Profile Studio / public CTAs | `CTASection`, Book/Message CTAs on `HelperBusinessProfilePage.tsx`; Profile Studio slots for CTA/QR/share (`docs/superpowers/specs/2026-09-21-profile-studio-design.md`) | CTA labels + guest contact gate (`allowGuestContact` / guest sign-in modal) |
| QR → profile | `docs/COVER_IMAGE_QR_CODE_*.md`; `/api/qr-codes`; static `/qr-codes` in `server/index.js` | Optional share/QR of Media post or linked entity later; not MVP attach |

**Canonical URL builders / public routes to hydrate (cite):**

| `link_type` (proposed enum) | Canonical path (existing) | Builder / notes |
|---|---|---|
| `helper` | `/helpers/:idOrSlug` | `helperProfilePath` in `client/src/utils/profileUrls.js` |
| `business` | `/b/:slug` or `/businesses/public/:businessId` | `businessProfilePath` in `profileUrls.js`; routes in `App.jsx` |
| `restaurant` | `/restaurants/r/:restaurantId` (canonical); `/food/restaurants/:restaurantId` back-compat | `App.jsx` food dual routes comment |
| `food_item` | `/restaurants/r/:restaurantId?dish=:menuItemId` (and/or hash `menu-item-:id`) | `FoodRestaurantPage.jsx` `?dish=` + `jumpToMenuItem` / `getElementById('menu-item-'+id)` |
| `job` | `/jobs/public/:jobId` (public); `/jobs/:id` guarded | `App.jsx` |
| `tool_rental` (v2) | `/tool-rentals/:toolId` | `App.jsx` |
| `direct_catalog` / Direct service (v2) | `/direct/skills`, `/direct/services`, `/direct/tools` directories; book/quote flows `/direct/book/:id`, `/direct/request-quote` | `App.jsx` Direct block — no single public “item detail” vanity path found; hydrate to catalog/book entry with query/id as API returns |
| `logistics_campaign` (v2) | `/logistics/campaigns/:id` | `App.jsx` |
| Book CTAs (helper/business) | `/book/:id`, `/book/business/:id` | `App.jsx` — use for transactional CTA after view |

MVP entity set: **restaurant + food_item + helper + business + job**. v2: **tool_rental + Direct catalog/service + logistics_campaign**.

---

## 1. How existing branded branches are built (evidence)

OxSteed is a **multi-branch platform** under one OxSteed ID. Governing strategy: `docs/oxsteed-restaurants-strategy.md` — “one account, many branches”; Network switcher routes only; each destination enforces its own gates.

### 1.1 Branch catalog pattern

| Branch | Public path prefix | API mount | Network entry |
|---|---|---|---|
| Marketplace | `/jobs`, helpers, etc. | various | `client/src/utils/networkBranches.js` (`marketplace`) |
| Restaurants / Food | `/restaurants`, `/food` | `/api/food`, `/api/restaurants` (`server/index.js`) | `networkBranches.js` (`restaurants`) — currently focused |
| Logistics | `/logistics/*` | `/api/logistics`, `/api/admin/logistics` | Listed in `hiddenLegacyBranches` in `networkBranches.js`; still routed in `App.jsx` |
| Direct | `/direct/*` | `/api/direct` | Footer + command palette; not in focused Network list |
| Credit | `/food` credit pages + admin super | `/api/oxsteed-credit` | Admin via `adminRouteManifest.js` |
| Business Launch / Consulting / Vortex | various | various | Hidden by `LAUNCH_VISIBILITY` / redirects in `launchScope.js` |

**Naming rule (existing):** `OxSteed <Branch>` — `docs/oxsteed-restaurants-strategy.md`.

### 1.2 OxSteed Logistics — structure

| Layer | Files / pattern |
|---|---|
| Schema | `server/migrations/247_oxsteed_logistics.sql` (+ `269`, `274`, `276`, `277`, `278`) — enums, lanes, sourcing, POs, shipments, pooled campaigns, warehouse, claims |
| Public API | `server/routes/logistics.js` → controllers `logisticsLanesController`, `logisticsSourcingController`, `logisticsPooledOrdersController`, `logisticsPurchaseOrdersController`, `logisticsShipmentsController`, `logisticsWarehouseController`, `logisticsRecurringProcurementController`, `logisticsComplianceController`, `logisticsFinanceController` |
| Admin API | `server/routes/logisticsAdmin.js` → `logisticsAdminController` + same domain controllers; workspaces via `requireInternalLogisticsWorkspace` |
| Access | `server/middleware/requireLogisticsAccess.js`, `logisticsAccessService.js`, logistics roles in migration 247 |
| Uploads | `server/middleware/logisticsUpload.js` + `validateFileUpload` |
| Client pages | `client/src/pages/logistics/*` (Home, Campaigns, Buyer, Organizer, Ops/Compliance workspaces, Finance, …) |
| Client routes | `client/src/App.jsx` `/logistics…` block (~589+) |
| Admin UI | `client/src/admin/pages/logistics/*`; manifest keys `logistics*` in `client/src/admin/adminRouteManifest.js` |
| Business Hub hook | `client/src/components/businessHub/BusinessProcurementTab.jsx` → logistics API |
| SEO | `server/middleware/prerenderHelperProfile.js` Logistics titles/descriptions |
| i18n | `client/src/locales/{en,es,fr,ht,ar}.json` keys `logistics.*`, `network.logistics.*`, how-it-works |
| Styles | `client/src/styles/logistics/LogisticsHomePage.css` |
| API client | `client/src/api/logistics.js` |

**Pattern:** dedicated migration family → `/api/<branch>` + `/api/admin/<branch>` → role middleware → lazy pages under `pages/<branch>/` → adminRouteManifest entries → prerender + locales.

### 1.3 OxSteed Direct — structure

| Layer | Files / pattern |
|---|---|
| Schema | `375_direct_portal.sql`, `376_direct_public_quote_lookup.sql`, `377_direct_service_areas.sql`, `390_direct_catalog.sql`, `414_direct_catalog_lifecycle.sql`, `415_business_launch_direct_catalog.sql`, `416_direct_calendar_blocks.sql`, `417_direct_request_assignment.sql`, `356_direct_job_payment_launch_defaults.sql` — extends `quote_requests` rather than a wholly separate commerce core |
| API | `server/routes/direct.js` → `directController.js` + `quoteRequestsController`; rate limiters for upload/hold/book |
| Services | `directCatalogService.js`, `directServiceAreas.js`, `directSlotEngine.js`, `directCapability.js`, `directCatalogAI.js`, `directCalendarAudit.js` |
| Client | `DirectPortalPage.jsx`, `DirectCatalogDirectoryPage.jsx`, `DirectBookSlotPage.jsx`, `DirectAdminPortalPage.jsx`, admin `DirectCatalog` |
| Routes | `App.jsx` `/direct…` + `/direct/admin…` with `DirectAdminRouteGate` |
| Admin manifest | `directOps`, `directServiceAreas`, `directCatalog` in `adminRouteManifest.js` |
| Permissions | Direct admin uses `manage_operations` (`directController.js` grant check; manifest grants) |
| Public static SEO page | `server/routes/directServiceAreaPage.js` + `server/public/direct-service-area/` |
| Jobs | `server/jobs/directCalendarReminders.js` |
| Specs | `docs/superpowers/specs/2026-09-29-direct-catalog-availability-long-term.md`, `docs/direct/` |

**Pattern:** company-operated service portal; catalog + quote lifecycle; guest lookup; dedicated admin portal under `/direct/admin` **and** shared admin app entries.

### 1.4 OxSteed Restaurants / Food — structure (third branded branch)

| Layer | Citation |
|---|---|
| Strategy | `docs/oxsteed-restaurants-strategy.md` |
| Schema | `305_oxsteed_food.sql` + large `restaurant_*` / `food_*` migration series |
| API | `/api/food`, `/api/restaurants` in `server/index.js` |
| Client | `client/src/pages/food/*`; dual routes `/food` and `/restaurants` in `App.jsx` |
| Media tab (already) | Migrations `664`–`666`, `restaurantMediaController.js`, `RestaurantMediaFeed.jsx` — **per-restaurant TikTok-style feed**, not a network-wide social branch |

### 1.5 OxSteed Credit — structure (payments branch)

Mounted at `/api/oxsteed-credit` (`server/index.js`); controllers/services `oxsteedCredit*`; admin super routes in `adminRouteManifest.js` (`oxsteedCredit*`, `superOnly: true`). Docs under `docs/oxsteed-credit-*.md`.

### 1.6 Cross-cutting conventions every branch uses

| Concern | Existing mechanism | Cite |
|---|---|---|
| Launch / feature flags | `LAUNCH_VISIBILITY`, `LAUNCH_BUSINESS_HUB_TABS`, `getLaunchRedirect` | `client/src/utils/launchScope.js`; docs `ui-simplification-hidden-entry-points.md` |
| Network switcher | `getNetworkBranches` (focused vs hidden legacy) | `client/src/utils/networkBranches.js`, `OxSteedNetworkSwitcher.jsx` |
| Admin surfaces | `adminRouteManifest.js` + grant / `superOnly` | `client/src/admin/adminRouteManifest.js` |
| Admin permissions | `PERMISSION_SCOPES` incl. `moderate_content`, `manage_operations`, `manage_marketing`, `verify_users` | `server/controllers/adminPermissionController.js`; grants table `049_admin_search_and_permissions.sql` |
| Business Hub | Tabs gated by `LAUNCH_BUSINESS_HUB_TABS`; profile/gallery in hub | `BusinessHubPage.jsx`, `launchScope.js` |
| Profile Studio | Shared edit shell; helper sections include **gallery** | `docs/superpowers/specs/2026-09-21-profile-studio-design.md`, `EditProfileTab.jsx`, `profileStudio/*` |
| i18n | `en/es/fr/ht/ar` locale JSON | `client/src/locales/` |
| SEO / prerender | `prerenderHelperProfile.js`, `PageMeta.jsx` allowlist | those files |
| How-it-works | `/how-it-works`, `/how-it-works/:area` | `FeatureGuidePage.jsx`, `ExperienceGuidePage.jsx`; locale keys for direct/logistics |
| Command palette | Branch pages registered | `commandPaletteItems.js` |
| Navbar / footer | Direct, Logistics, Restaurants links (partially launch-gated) | `Navbar.jsx`, `Footer.jsx` |

---

## 2. Media-like pieces that ALREADY exist (evidence)

Do **not** invent a second upload/transcode stack. OxSteed Media should **reuse** these primitives and generalize where restaurant Media is too restaurant-scoped.

### 2.1 Uploads / storage / signed URLs

| Piece | Cite |
|---|---|
| Generic authenticated upload | `server/routes/upload.js` → `utils/storage` `uploadFile` / `getPublicUrl` |
| Local/signed storage serve | `server/routes/storage.js` — private prefixes include `chat/`, `direct/`, `logistics/`, `user-uploads/` |
| Upload middleware + validation | `server/middleware/upload.js`, `validateFileUpload.js` |
| Client helper | `client/src/api/uploads.js` |
| Business logo/cover DB fallback | `369_business_media_assets.sql` (BYTEA fallback when object store down) |
| Message attachments | `298_message_attachments.sql` (`messages.attachments` JSONB) |
| Direct asset uploads | `POST /api/direct/uploads` in `routes/direct.js` (auth + rate limit) |
| Helper / business galleries | Helper: Profile Studio gallery via `/helper-profile/gallery` (`EditProfileTab.jsx`); Business: `routes/businesses.js` gallery CRUD → `businessContentController.js` |

### 2.2 Malware scan / video / CSAM / quarantine

| Piece | Cite |
|---|---|
| ClamAV scan | `server/services/fileScanService.js` |
| Restaurant Media uploads + quarantine | `665_restaurant_media_uploads.sql` — `processing_status`, `csam_status`, `renditions`, `restaurant_media_processing_jobs` |
| Transcode worker | `server/services/videoTranscodeWorker.js` — CSAM gate **before** ffmpeg; 720p/480p + poster |
| CSAM service | `server/services/csamCheckService.js` |
| Deployment notes / known limits | `docs/video-processing-production-2026-10-04.md` — ffmpeg/worker wiring; **CSAM adapters are not certified vendor integrations** (SHA-256 vs CSAI Match / PhotoDNA caveats) |
| Link-only video precedent | Learn: `630_learn_guide_video_submissions.sql`; Restaurant link posts: `664_restaurant_media.sql` |

### 2.3 Restaurant Media feed (closest existing UX)

| Piece | Cite |
|---|---|
| Tables | `restaurant_media`, `_items`, `_likes`, `_flags`, processing jobs (`664`–`666`) |
| Controller | `restaurantMediaController.js` — list/post/like/delete/flag; **10 posts/day/user**; Redis rate-limit stores |
| Video upload controller | `restaurantMediaVideoController.js` (DMCA path from admin) |
| Admin | `routes/adminRestaurantMedia.js` — `moderate_content` grant; DMCA takedown action |
| Client | `api/restaurantMedia.js`, `RestaurantMediaFeed.jsx`, `RestaurantMediaUploadModal.jsx` |
| Scope limit | **Per-restaurant**, not global social graph; likes only (no replies/reposts/quotes/bookmarks/views as first-class X-style actions) |
| **Dish attach (closest “product on content”)** | `restaurant_media_items` + `DishBar` + `dish_ids` on compose (`664_restaurant_media.sql`, `RestaurantMediaFeed.jsx`, `restaurantMediaController.js`) — **generalize this into Media `media_post_links`**, do not fork a second dish-only model |

### 2.4 Engagement / verification / profiles

| Piece | Cite |
|---|---|
| Like pattern | `restaurant_media_likes` PK `(media_id, user_id)`; `like_count` via `COUNT(*)` |
| View counters elsewhere | e.g. `tool_rentals.views_count` (`078b`), `marketplace_products.view_count` (`125`) — pattern for denormalized counters |
| Didit / identity | `035_fix_didit.sql`, `users.is_verified` (`026`), identity columns |
| Business verified badge | `212_business_is_verified.sql` (`businesses.is_business_verified`) |
| Handles / slugs | `575_profile_slugs.sql` (`profile_slug` on helpers + businesses); legacy `users.username` (`001_initial_schema.sql`) |
| Saved helpers (not social follow) | `saved_helpers` in `031_life_dashboard_tables.sql` |

### 2.5 Messaging / sockets / notifications

| Piece | Cite |
|---|---|
| Messages API | `server/routes/messages.js`, `chat.js` |
| Realtime | `server/realtime/chatNamespace.js`; `socketService.js`, `websocketService.js` |
| Notifications | `server/routes/notifications.js`; `notificationService.js` (`sendNotification` + promo cap); mounts in `server/index.js` |
| Push | `webPushService.js`, `mobilePushService.js` |

### 2.6 Moderation / reports / trust

| Piece | Cite |
|---|---|
| Moderation queue | `016_phase5_create_moderation_queue.sql`, `routes/moderation.js`, `moderationController.js` |
| Business moderation | `161_business_moderation_enhancements.sql`, `businessModerationController.js` |
| Reviews moderation | `174_review_moderation_system.sql`, `reviewModeration.js` |
| User blocks/reports | `285_user_blocks_and_reports.sql`, `169_reputation_and_reports.sql`, `userReportController.js` |
| Restaurant media flags | reasons `unrelated|spam|broken|inappropriate`; admin review + DMCA in `adminRestaurantMedia.js` |
| Grant | `moderate_content` in `adminPermissionController.js` |

### 2.7 SEO / share / QR

| Piece | Cite |
|---|---|
| Prerender + JSON-LD | `prerenderHelperProfile.js` (Direct/Logistics pages; campaign JSON-LD) |
| PageMeta allowlist | `PageMeta.jsx` includes `/direct`, `/restaurants`, … |
| QR | Cover/QR docs `docs/COVER_IMAGE_QR_CODE_*.md`; `/qr-codes` static in `server/index.js`; `LAUNCH_VISIBILITY.genericQrGenerator` |
| Featured placement (promo, not feed boost) | `routes/businessMarketing.js`, `adminFeaturedPlacement.js`; `/promote` launch-redirects to Business Hub |

### 2.8 Relevant known issues (prior reviews only)

From `docs/video-processing-production-2026-10-04.md`:

- Video worker requires `VIDEO_WORKER_ENABLED` + ffmpeg in image; otherwise uploads stay quarantined.
- CSAM vendor adapters are **not** certified; whole-file SHA-256 ≠ Google CSAI Match fingerprinting; PhotoDNA cloud is image-oriented.
- ClamAV path exists and was verified with EICAR in that doc’s repair notes.

From Direct routes comments (`routes/direct.js`): upload/hold/book rate limits were tightened after audit findings (auth on uploads/holds, attachment array bounds).

**Implication for Media:** ship behind launch flag; reuse restaurant quarantine/transcode/CSAM gates; **DECIDED (#12):** Didit required for video upload; **block public video uploads** until production CSAM vendor is certified (photos/non-public may progress). Do not claim certified CSAM until vendor contract is done.

---

## 3. **[PROPOSAL]** OxSteed Media — definition & architecture

### 3.1 Positioning options (2–3) + recommendation

| Option | One-liner | Fits marketplace? | Risk / timing |
|---|---|---|---|
| **A. Local creator / promo layer (MVP shell)** | Short video/photo posts for verified helpers, businesses, restaurants to promote work, dishes, before/afters; local Home feed prefers nearby linked entities; quote/repost/like; soft CTA into Marketplace / Direct / Restaurants | High — demand + supply discovery adjacent to jobs/food | Feed distraction vs “not engagement-max” — mitigate with strong deep-link + nearby ranking (locked #6 / #15). **Not** the long-term monetization path |
| **B. Restaurant Media generalized only** | Lift `restaurant_media` to all entities but keep TikTok vertical feed, no X-style quotes/threads | Medium — reuses most code | Does **not** match screenshot structure (no quote cards, reply threads, bookmarks, bottom nav) — rejected for product shell |
| **C. Full creator marketplace (v3)** | Paid creator gigs, sponsorship auctions, tipping via Credit; paid post boosts only after this lands | High monetization later | Heavy; overlaps MarketingTools / featured placement — **Emile locked #1 / #14: deferred to v3+**; do not ship paid boosts in v2 |

**MVP recommendation (Emile locked 2026-10-06):** Ship the **Option A product shell** (X-shaped local Media per §0) for discovery/promo — **not** as the chosen long-term monetization path. **Option C is deferred to v3** (paid gigs, sponsorships, tipping via Credit; paid post boosts only after that marketplace). Reuse restaurant Media **pipeline** (storage, scan, CSAM, transcode, flags/DMCA) as the media engine; do **not** reuse restaurant Media as the product shell (keep restaurant tab; dual-write later — locked #4 / #17). Reuse **`restaurant_media_items` / `DishBar`** as the naming and UX precedent for cross-entity **`media_post_links`** (§0.5).

Grounding: product definition says OxSteed is not an engagement-max feed — Media must **serve the local economy loop** (Life → Home → Learn → Growth), e.g. post → **linked entity** → book / order / rent / apply. Screenshots define chrome; OxSteed purpose defines ranking and CTAs; deep-links get a **strong ranking boost** (locked #6 / #15).

### 3.2 Data model **[PROPOSAL]**

Mirror screenshot nouns. Prefer **replies-as-posts** (`parent_id`) and **quotes** (`quoted_post_id`).

```text
media_actors              -- projection / cache of who can post
  id, actor_type (user|helper|business|restaurant),
  owner_user_id, business_id NULL, restaurant_id NULL,
  handle CITEXT UNIQUE, display_name, avatar_url,
  verified_kind (none|identity|business|restaurant),  -- derived snapshot
  created_at, updated_at

media_posts
  id UUID PK,
  actor_id → media_actors,
  body TEXT (len cap),
  parent_id UUID NULL → media_posts,     -- reply
  quoted_post_id UUID NULL → media_posts, -- quote-post
  root_id UUID NULL,                     -- denorm for thread queries
  visibility (public|followers|unlisted|removed),
  processing_status / csam_status        -- same enums as restaurant_media (665)
  storage mirrors: OR link to media_post_assets
  reply_count, repost_count, like_count, bookmark_count, view_count, quote_count INT
  created_at, edited_at NULL, deleted_at NULL

media_post_assets
  id, post_id, asset_type (image|video|video_link),
  provider (upload|youtube|vimeo),
  storage_key, thumbnail_key, renditions JSONB,
  external_url, external_video_id,
  sort_order, width, height, duration_ms

media_post_links                     -- commerce / entity deep-links (generalize restaurant_media_items)
  id UUID PK,
  post_id UUID NOT NULL → media_posts ON DELETE CASCADE,
  link_type TEXT NOT NULL
    CHECK (link_type IN (
      'restaurant','food_item','helper','business','job',   -- MVP
      'tool_rental','direct_catalog','logistics_campaign'   -- v2
    )),
  target_id TEXT NOT NULL,            -- opaque id matching target table (bigint/uuid as string)
  label TEXT NULL,                   -- optional author override; else hydrate live name
  -- snapshots (link-rot safe; mirror 664 restaurant_media_items)
  name_snapshot TEXT NOT NULL,
  price_snapshot_cents INTEGER NULL
    CHECK (price_snapshot_cents IS NULL OR price_snapshot_cents >= 0),
  currency_code CHAR(3) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, link_type, target_id)

media_reposts
  post_id, actor_id, created_at
  PK (post_id, actor_id)                 -- pure repost (no quote body)

media_likes
  post_id, user_id, created_at
  PK (post_id, user_id)                  -- mirror restaurant_media_likes

media_bookmarks
  post_id, user_id, created_at
  PK (post_id, user_id)

media_post_views                         -- optional MVP+; else increment with IP/user dedupe window
  post_id, viewer_user_id NULL, viewer_hash, created_at
  unique partial for dedupe window

media_follows                            -- Home feed graph (MVP can use geo + followed actors)
  follower_user_id, actor_id, created_at
  PK (follower_user_id, actor_id)

media_communities / media_community_members  -- bottom-nav “spaces”
  id, slug, title, geo_scope / category, badge rules

media_post_flags                         -- mirror restaurant_media_flags + DMCA reason
  id, post_id, user_id, reason, note, status, decided_by, decided_at

media_processing_jobs                    -- generalize restaurant_media_processing_jobs
  id, post_id / asset_id, job_type (transcode|csam_check), status, attempts, last_error
```

**Constraints**

- Reply: `parent_id IS NOT NULL` → cannot also be a pure repost row.
- Quote: `quoted_post_id IS NOT NULL`, `parent_id IS NULL`.
- Soft-delete / `visibility='removed'` for moderation (like restaurant `status='hidden'`).
- Video uploads start `quarantine` until CSAM pass + transcode ready (copy iron rule from `videoTranscodeWorker.js`). **DECIDED (#12):** Didit identity required to upload video; **public** video uploads blocked until production CSAM vendor is certified (photos / non-public pipeline may still progress).
- Links: **DECIDED** — any public restaurant/helper/job/etc. (not own-entity-only); cap **~5 per post** (Emile locked #3); on write, snapshot name/price like `restaurant_media_items` insert in `restaurantMediaController.js`.
- Hydration: GET joins live row when possible; expose `available` (or `dishLinkState`-equivalent) so UI can degrade to snapshot-only.

**Verified badge mapping (existing → Media)**

| Badge show when | Source (existing) — **DECIDED** Emile locked #11 |
|---|---|
| Identity checkmark on helper actor | Didit identity (`035_fix_didit.sql` / helper identity-verified patterns) |
| Business checkmark | `businesses.is_business_verified` (`212_business_is_verified.sql`) |
| Restaurant checkmark | Restaurant verified flags (separate restaurant verification flag — not “inherit business only”) |

**Handle mapping — DECIDED** Emile locked #10

- Reuse helper/business `profile_slug` only (`575_profile_slugs.sql`) as `@handle`.
- `media_actors.handle` aliases the slug; no Media-only handles and no `users.username` as primary handle. Conflict resolution: admin tool if slug collisions arise across actor types.

### 3.3 API surface **[PROPOSAL]**

Mount like other branches: `app.use('/api/media', mediaRoutes)` and `app.use('/api/admin/media', …)` in `server/index.js` (pattern from logistics/direct).

| Method | Path | Maps to UI |
|---|---|---|
| GET | `/api/media/feed?tab=home\|following\|local` | Home bottom-nav — each card may include hydrated `links[]` |
| GET | `/api/media/search?q=` | Search tab |
| GET | `/api/media/communities` | Spaces tab |
| GET | `/api/media/posts/:id` | Post detail — **hydrate `links[]`** with live name/`available`, `canonical_url`, optional live price, CTA kind |
| GET | `/api/media/posts/:id/replies?sort=latest` (MVP); `relevant` later | Reply list — **Latest only at MVP** (Emile locked #13); Relevant deferred |
| GET | `/api/media/posts/:id/quotes` | “View quotes” |
| POST | `/api/media/posts` | Compose root / reply (`parent_id`) / quote (`quoted_post_id`); optional `links[]` body (`link_type`, `target_id`, `label?`, `sort_order?`) — snapshots taken server-side |
| PATCH | `/api/media/posts/:id` | Edit body / replace or merge `links[]` (author only) |
| POST | `/api/media/posts/:id/links` | Attach one link (compose/edit) |
| DELETE | `/api/media/posts/:id/links/:linkId` | Detach one link |
| POST | `/api/media/posts/:id/repost` | Repost action |
| DELETE | `/api/media/posts/:id/repost` | Undo repost |
| POST | `/api/media/posts/:id/like` | Like toggle (mirror restaurant) |
| POST | `/api/media/posts/:id/bookmark` | Bookmark toggle |
| POST | `/api/media/posts/:id/view` | View count (deduped) |
| POST | `/api/media/posts/:id/flags` | Report |
| POST | `/api/media/assets/photo-uploads` | Photo (sync ready) |
| POST | `/api/media/assets/video-uploads` | Video (202 quarantine) |
| POST | `/api/media/assets/link` | YouTube/Vimeo link |
| GET | `/api/media/actors/:handle` | Profile-in-Media |
| POST | `/api/media/actors/:id/follow` | Follow |
| GET | `/api/admin/media/flags` | Admin queue |
| POST | `/api/admin/media/flags/:id/review` | dismiss / remove / DMCA |

Rate limits: copy restaurant Media (10 posts/day/user, flag bucket) + Direct-style upload limiter; Redis store pattern from `restaurantMediaController.js`.

**Link hydration (GET feed + GET post + quotes embeds):** each post includes `links: [{ id, link_type, target_id, label, name, name_snapshot, price_cents, price_snapshot_cents, currency_code, available, canonical_url, cta }]`. Build `canonical_url` with existing helpers — `helperProfilePath` / `businessProfilePath` (`client/src/utils/profileUrls.js`); restaurant `/restaurants/r/:id`; food item `/restaurants/r/:id?dish=:menuItemId`; job `/jobs/public/:jobId`; v2 tool `/tool-rentals/:toolId`; Direct catalog/book paths; logistics `/logistics/campaigns/:id` (§0.5). Do not invent new vanity URL schemes.

Client API module: **[PROPOSAL]** `client/src/api/media.js` (mirror `restaurantMedia.js` / `logistics.js`).

### 3.4 Client routes & UI chrome **[PROPOSAL]**

| Route | Screen |
|---|---|
| `/media` | Shell with **bottom nav** + Home feed |
| `/media/search` | Search |
| `/media/communities` | Spaces |
| `/media/communities/:slug` | Space feed |
| `/media/notifications` | Media-filtered notifications (or deep-link into existing notifications UI) |
| `/media/messages` | Redirect/embed existing messenger |
| `/media/compose` | New post (photo/video/link) |
| `/media/post/:id` | **Post detail** (screenshot layout) |
| `/media/post/:id/quotes` | Quotes list |
| `/media/@:handle` | Actor profile + posts grid |
| `/media/bookmarks` | Bookmarks |
| `/media/admin` | Ops portal (optional; else admin app only) |

**Components (proposed):** `MediaShell` (bottom nav + badges), `MediaPostCard`, `MediaQuotedEmbed`, `MediaActionRow`, `MediaReplyList`, `MediaReplyComposer` (sticky), `MediaVideoPlayer` (mute toggle), `MediaRelevantSort`, **`MediaLinkedEntities`** (“Linked on OxSteed” chip/card row — generalize `DishBar` from `RestaurantMediaFeed.jsx`), **`MediaLinkPicker`** on compose/edit (search/attach restaurant, dish, helper, business, job; v2 tools/Direct/logistics).

**Linked-row layout rule:** render `MediaLinkedEntities` between media and the action row (or as a thin overlay on video that does not cover the mute control). Never replace or reorder the five engagement actions. Quote embeds that carry links show the linked strip inside the inner card as well.

**Compose:** `/media/compose` includes link picker; `POST /api/media/posts` accepts `links[]`. Edit post can attach/detach without rewriting media assets.

Register lazy routes in `App.jsx` like Direct/Logistics; wrap with `LaunchScopeRouteGate` / new visibility flag.

### 3.5 Admin / moderation **[PROPOSAL]**

| Item | Convention to follow |
|---|---|
| Manifest keys | `mediaFlags`, `mediaPosts`, `mediaActors` in `adminRouteManifest.js` with `grant: 'moderate_content'` (same as `adminRestaurantMedia.js`) |
| Super pages | Optional `/admin/super/media-*` only if financial boosts need `manage_financials` |
| DMCA | Same body shape as restaurant: `{ action:'remove', takedownReason:'dmca' }` |
| Audit | `logAdminAction` pattern used elsewhere |
| CSAM flagged | Stay quarantined; never public (worker iron rule) |

### 3.6 Permissions / launch flag **[PROPOSAL]**

| Mechanism | Proposal |
|---|---|
| `LAUNCH_VISIBILITY.oxsteedMedia` | `false` until go-live (add to `launchScope.js`) |
| Network branch | **DECIDED** Emile locked #9: add to **focused** Network list when ready (`networkBranches.js`) |
| Business Hub | New tab `media` **not** in `LAUNCH_BUSINESS_HUB_TABS` until ready; when enabled, composer + recent posts for the business |
| Team permissions | Optional `media.manage_posts` in business permission catalog (`245_team_roles_permissions_access_codes.sql` pattern) for staff posting as business actor |
| Admin | Reuse `moderate_content`; marketing/Media boosts → `manage_marketing` (**v3+ only**, Emile locked #14) |

### 3.7 Profile Studio / public profile integration **[PROPOSAL]**

| Surface | Proposal |
|---|---|
| Helper Profile Studio | New section **Media** beside gallery (`EditProfileTab.jsx` section list) — “Pin posts” / link to `/media/@handle`; gallery remains still photos |
| Business Profile Editor | Same via Profile Studio shell (`2026-09-21-profile-studio-design.md`) |
| Public profiles | Embed recent Media posts or CTA “View on OxSteed Media”; prerender OG for `/media/post/:id` |
| Restaurant | **DECIDED** Emile locked #4 / #17: keep existing restaurant Media tab; dual-write into OxSteed Media later (`restaurant_media_items` → `media_post_links`; `actor_type=restaurant`) |

### 3.8 Credit / payments **[PROPOSAL]**

MVP: **no** payments required. Paid post boosts are **not** in v2.

| Phase | Hook | Existing spine |
|---|---|---|
| v2 | No paid boosts (Emile locked #14) | Featured-placement spine may stay for non-Media promo elsewhere; do not wire Media feed boosts yet |
| v3+ | Creator marketplace (Option C) first, then paid post boosts / sponsorships / tipping via Credit | `manage_marketing`, featured-placement patterns (`businessMarketing.js`, `adminFeaturedPlacement.js`); Credit via `/api/oxsteed-credit`; payouts via Stripe Connect / `restaurantPayoutService.js` + Credit ledger |

Do not invent a new wallet; use OxSteed Credit + existing promo notification cap (`notificationService.js` promotional ≤2 / 7 days).

### 3.9 Notifications & realtime **[PROPOSAL]**

| Event | Channel |
|---|---|
| Reply / quote / like / repost / follow / mention | `sendNotification` types e.g. `media_reply`, `media_like`, … → in-app + push |
| Unread badges on bottom nav | Existing notifications unread count + messages unread from chat |
| Live like/reply counts (optional) | `broadcastToUser` / post room via `socketService.js` — not required for MVP |

### 3.10 Abuse / rate limits **[PROPOSAL]**

- Post: 10/day/user (restaurant Media).
- Upload: Direct-style 20 / 15 min IP + auth required.
- Flags: 30/hour (restaurant Media).
- Views: server-side dedupe (user or hashed IP + UA, e.g. 1 view / 24h / post).
- Blocks: reuse `285_user_blocks_and_reports.sql` — blocked authors hidden in feed/replies.
- Autohide on N open flags (Emile sets threshold).

### 3.11 Storage / transcoding pipeline **[PROPOSAL]**

Reuse restaurant Media pipeline generalized:

1. Auth upload → ClamAV (`fileScanService.js`) → object store under `media/` prefix (add to private prefixes in `storage.js` if not public).
2. Photos: sharp/stripExif path like restaurant photo uploads → `ready`.
3. Videos: insert quarantine + queue `csam_check` then `transcode` (`videoTranscodeWorker.js` iron rule).
4. Serve via **signed URLs** (`getSignedDownloadUrl`), never raw public keys for uploads.
5. Links: YouTube/Vimeo validation as in `restaurantMediaController.js` / `videoEmbed` util.

### 3.12 Trust & safety (CSAM / copyright / DMCA) **[PROPOSAL]**

- CSAM: same gate as restaurant Media; document vendor certification gap (`video-processing-production-2026-10-04.md`). **DECIDED (#12):** block **public** video uploads until production CSAM vendor is certified.
- DMCA: admin review action + audit trail (existing restaurant path). At launch, moderation = **auto flags / DMCA only until staffed** (Emile locked #16).
- Copyright: report reason + takedown workflow; repeat offender → `manage_users` suspension.
- Age / video upload: **DECIDED (#12)** — Didit identity required to upload video.
- Political/news clip virality in screenshots is **not** a product goal; local economy discovery/promo is (Emile locked #15).

### 3.13 Analytics (views / likes / shares) **[PROPOSAL]**

- Denormalized counters on `media_posts` for action row.
- Share: client share-sheet / copy link; optional `share_count` later (screenshot shows share affordance; count optional).
- Admin: basic post metrics; Business Hub Media tab: impressions for own posts.
- SEO: prerender title/description/OG image = poster frame; JSON-LD `VideoObject` / `SocialMediaPosting` **[PROPOSAL]** in `prerenderHelperProfile.js` style.

### 3.14 i18n **[PROPOSAL]**

Add `media.*` and `network.media.*` keys to **all** of `en.json`, `es.json`, `fr.json`, `ht.json`, `ar.json` (same discipline as Direct/Logistics). How-it-works area `/how-it-works/media`. Machine error codes from API; client maps to locale (restaurant Media pattern).

### 3.15 Branding / marketing pages **[PROPOSAL]**

- Wordmark: `OxSteed Media` (naming rule).
- Landing: `/media` signed-out explainer.
- Footer + command palette entries when launch flag on.
- Prerender entries for `/media`, `/media/post/:id`.

---

## 4. Phased build plan **[PROPOSAL]** (aligned to Emile locked 2026-10-06)

### MVP (match screenshots + local discovery/promo)

**Scope** (locked decisions applied)

- Schema + `/api/media` CRUD for posts/replies/quotes/reposts/likes/bookmarks/views + **`media_post_links`**.
- **Who can post:** verified helpers, businesses, and restaurants only (locked #2).
- **Handles:** `profile_slug` only (locked #10). **Badges:** Didit (helpers) / business verified / restaurant verified flags (locked #11).
- Client: MediaShell bottom nav; Home feed (discovery/promo; prefer nearby linked entities — locked #15); Post detail (full chrome); quote embed; reply list with **Latest-only** sort (locked #13 — no Relevant at MVP); sticky reply composer; mute-capable player; **`MediaLinkedEntities` + compose link picker**.
- **MVP deep-link types:** `restaurant`, `food_item`, `helper`, `business`, `job` — any public entity; **cap ~5 per post** (locked #3); hydrate canonical URLs per §0.5 / `profileUrls.js` / `App.jsx` routes. **Strong ranking boost** for posts with valid local entity links (locked #6).
- **Spaces:** real local city/category channels (locked #7) — `/media/communities` + `:slug` feeds.
- **Messages tab:** reuse existing `/messages` messenger (locked #8).
- **Media types:** photo + video **file** uploads with scan/transcode/CSAM pipeline (locked #5), subject to #12 gates below; video link (YouTube/Vimeo) still supported.
- **Age/CSAM gates (locked #12):** Didit identity required to upload video; **block public video uploads** until production CSAM vendor is certified. Photos may ship publicly; non-public video pipeline (quarantine/worker wiring) may progress without going public.
- **Moderation at launch:** auto flags + DMCA path only until staffed (locked #16); `moderate_content` admin still wired.
- **Restaurant Media:** keep restaurant tab; dual-write federation is **v2** (locked #4 / #17) — not required for MVP go-live.
- `LAUNCH_VISIBILITY.oxsteedMedia = false` default; when ready, enable as **focused Network branch** (locked #9).
- i18n keys all 5 locales for MVP strings (incl. “Linked on OxSteed”, snapshot/unavailable, CTA labels).
- Notifications: reply + like.
- **No paid boosts** in MVP (locked #14).

**Acceptance criteria**

1. Post detail matches §0.1 element checklist (avatar, name, badge, handle, text, media+mute, time, views, five actions+counts, **Latest** reply sort, View quotes, sticky composer, **Linked on OxSteed row when links present**). Relevant dropdown UI may be hidden or stubbed until post-MVP.
2. Quote-post renders inner card per §0.2.
3. Reply rows match §0.3 action row.
4. Bottom nav five tabs per §0.4; Spaces = real city/category channels; Messages → existing `/messages`; Notifications/Messages badges reflect unread.
5. Quarantined / uncertified-CSAM video **never** appears in public feed/detail. Public video upload endpoints reject (or hard-gate) until vendor certified; Didit required for any video upload attempt. Photos can be public when ready.
6. Launch flag off → `/media` redirects (via `getLaunchRedirect` or gate); when on → focused Network entry.
7. Feed philosophy: discovery/promo for local economy; **strong boost** for valid local entity deep-links + prefer nearby linked entities (not engagement-max / politics virality).
8. Compose/edit: only verified helper/business/restaurant actors; attach/detach any public MVP link types (≤~5); GET post/feed returns hydrated `links[]` with `canonical_url` + `available`.
9. Guest: View profile/entity public where already public; Order/Book/Pay/Rent/Apply hits login gate (same pattern as `RestaurantMediaFeed` / helper guest sign-in).
10. Unavailable/unpublished targets render snapshot-only chips (mirror `dishLinkState`).
11. Moderation: auto-flag + DMCA admin actions work; no assumption of full human staffing at launch.

### v2

- Follow graph + Following tab; Space membership badges / polish.
- Business Hub Media tab; Profile Studio Media section; public profile embed.
- **Federation (locked #4 / #17):** keep restaurant Media tab; **dual-write** `restaurant_media_items` into `media_post_links` (and restaurant posts into Media with `actor_type=restaurant`).
- Share cards polish; view dedupe table.
- **Deep-link types v2:** `tool_rental` (`/tool-rentals/:toolId`), `direct_catalog` / Direct service (`/direct/skills|services|tools`, book/quote flows), `logistics_campaign` (`/logistics/campaigns/:id`).
- Socket live count updates; search quality.
- **Relevant** reply/feed sort (locked #13 — deferred from MVP).
- Still **no paid post boosts** (locked #14 → v3+).

**Acceptance:** Hub can publish as business actor; restaurant tab still works and dual-writes into `/media`; tool/Direct/logistics links hydrate and CTA correctly with login gate; Relevant sort available; no Sponsored/boost SKUs yet.

### v3

- **Option C — full creator marketplace:** paid creator gigs, sponsorships, tipping via Credit (locked #1).
- **Paid post boosts** only after that marketplace lands (locked #14).
- Certified CSAM vendor integration → unlock public video uploads (completes locked #12).
- Advanced Relevant ML; Stories (24h) if still desired; analytics dashboards; creator payouts.

**Acceptance:** Marketplace + boosts reconcile on Credit/Stripe paths; CSAM vendor contract verified in runbook; public video uploads enabled under Didit + certified CSAM.

---

## 5. Risks & decisions — Emile locked (2026-10-06)

> Full list also at top: **Emile locked decisions (2026-10-06)**. Open questions below are closed; residual risks noted.

1. **Feed vs product philosophy** — **DECIDED (#15):** discovery/promo for the local economy; prefer nearby linked entities (not engagement-max / politics virality).
2. **Restaurant Media relationship** — **DECIDED (#4):** keep restaurant Media tab; dual-write into OxSteed Media later.
3. **Who can post at MVP?** — **DECIDED (#2):** verified helpers, businesses, and restaurants only.
4. **Handle namespace** — **DECIDED (#10):** reuse helper/business `profile_slug` only.
5. **Verified badge rules** — **DECIDED (#11):** Didit identity for helpers; business verified; restaurant verified flags.
6. **Video file uploads at MVP** — **DECIDED (#5 + #12):** full video file uploads with scan/transcode/CSAM, but public video blocked until CSAM vendor certified; Didit required to upload video; photos/non-public may progress.
7. **CSAM vendor certification** — **DECIDED (#12):** block public video uploads until production CSAM vendor is certified (`video-processing-production-2026-10-04.md` gap remains until then).
8. **Age / CSAM policy** — **DECIDED (#12):** Didit identity required to upload video (with public-video gate above).
9. **Communities/spaces MVP** — **DECIDED (#7):** real local city/category channels.
10. **Messages tab** — **DECIDED (#8):** reuse existing `/messages` messenger.
11. **Launch placement** — **DECIDED (#9):** focused Network branch when ready.
12. **Monetization timing** — **DECIDED (#1 / #14):** Option C creator marketplace deferred to v3; paid post boosts only after that in **v3+** (not v2). Do **not** treat Option A as the long-term monetization path.
13. **Moderation staffing** — **DECIDED (#16):** auto flags / DMCA only until staffed.
14. **Relevant algorithm** — **DECIDED (#13):** Latest only at MVP; Relevant later.
15. **Who may attach entity links?** — **DECIDED (#3):** any public restaurant/helper/job/etc.; cap ~5 per post.
16. **Deep-link ranking weight** — **DECIDED (#6):** strong boost for posts with valid local entity links.
17. **Restaurant Media items migration** — **DECIDED (#17):** dual-write `restaurant_media_items` into `media_post_links`.

**Residual risks (not reopened as product forks):** CSAM vendor contract timing vs public-video launch; moderation volume before staffing; dual-write consistency between restaurant tab and Media; focused Network go-live quality bar.

---

## 6. Implementation checklist (when build is approved; not done in this task)

- [ ] Migration `XXX_oxsteed_media.sql` (tables above, incl. `media_post_links`)
- [ ] Link hydrate helpers reusing `profileUrls.js` + food/job/tool/direct/logistics routes; compose `MediaLinkPicker`
- [ ] `server/routes/media.js` + `mediaAdmin.js`; mount in `server/index.js`
- [ ] Controllers/services; generalize or wrap `videoTranscodeWorker` / CSAM for `media_*`
- [ ] Client pages under `client/src/pages/media/`; routes in `App.jsx`
- [ ] `LAUNCH_VISIBILITY.oxsteedMedia`; `networkBranches.js`; `adminRouteManifest.js`
- [ ] Locales en/es/fr/ht/ar; prerender; how-it-works
- [ ] Business Hub tab + Profile Studio section (v2)
- [ ] Tests mirroring restaurant Media + Direct rate-limit tests

---

## 7. Summary

OxSteed Media should be a **first-class Network branch** (focused Network when ready — locked #9) built like Logistics/Direct (own `/media` + `/api/media`, launch flag, admin manifest, locales, prerender), powered by the **existing restaurant Media trust pipeline** (scan, quarantine, CSAM gate, transcode, flags/DMCA), with a **product shell that matches the X/Twitter screenshots 1:1** (post detail, quote embeds, reply threads, bottom nav). MVP posters = **verified helpers, businesses, and restaurants** only; handles = `profile_slug`; badges = Didit / business verified / restaurant verified.

First-class **`media_post_links`** (“Linked on OxSteed”) generalize `restaurant_media_items` / `DishBar`: any public restaurant/helper/job/etc., **~5 cap**, with a **strong ranking boost** for valid local links — discovery/promo for the local economy (prefer nearby linked entities), not engagement-max. Spaces = real city/category channels; Messages reuses `/messages`; reply sort = **Latest only** at MVP.

**Positioning (locked #1):** MVP ships the Option A **shell** (X-shaped local Media). **Option C** (full creator marketplace — paid gigs, sponsorships, tipping via Credit) is **v3**; paid post boosts only **after** that (**v3+**). Do **not** treat Option A as the long-term monetization path. Restaurant Media tab stays; **dual-write** into Media later. Public video uploads require Didit **and** certified CSAM vendor; photos/non-public may progress. Launch moderation = auto flags/DMCA until staffed.

**SHA reviewed:** `bd92ad2b2ca89f929f34a92f4f57e91ec7e34569` on `old-files-claude`.
