# OxSteed Media — implementation status

**Audited against:** `docs/archive/oxsteed-media-spec.md` (uploaded product spec, SHA baseline `bd92ad2b`)  
**Code baseline:** tip of `pr/oxsteed-media-stabilization` (includes PR #489 stabilization + CI fixes)  
**Audit date:** 2026-10-09  
**Branch for completion work:** `cursor/oxsteed-media-complete-3a48`

Legend: **Done** | **Partial** | **Missing**

---

## Emile locked decisions (1–17)

| # | Decision | Status | Evidence |
|---|----------|--------|----------|
| 1 | Option C marketplace deferred to v3; MVP = discovery shell | **Partial** | Marketplace + Credit flows shipped early: `server/controllers/mediaCreatorController.js`, `740_oxsteed_media_creator_marketplace.sql`, `client/src/pages/media/MediaCreatorPage.jsx` — product-complete but ahead of written phasing |
| 2 | MVP posters: verified helpers, businesses, restaurants | **Done** | `mediaPublisherPolicy.js`, `mediaController.js` `createPost` |
| 3 | Public entity links, ~5 cap | **Done** | `MAX_LINKS_PER_POST`, `media_post_links`, compose/detail UI |
| 4 | Keep restaurant Media tab; dual-write later (v2) | **Done** | `restaurantMediaController.js` `dualWriteToMedia`, `739_oxsteed_media_restaurant_federation.sql` |
| 5 | Photo/video uploads + scan/transcode/CSAM | **Done** | `mediaAssetController.js`, `mediaTranscodeWorker.js`, `videoTranscodeWorker.js` |
| 6 | Strong ranking boost for valid local links | **Done** | `mediaController.js` `getFeed`, `mediaFeedContext.js` |
| 7 | Real city/category Spaces | **Done** | `731_oxsteed_media_spaces.sql`, `734_oxsteed_media_default_spaces.sql`, `MediaCommunitiesPage.jsx` |
| 8 | Messages tab reuses messenger | **Partial** | `MediaMessagesPage.jsx` embeds `MessagingWorkspace` (same UX as `/messages`, route `/media/messages`) |
| 9 | Focused Network branch when ready | **Partial** | `networkBranches.js` adds Media when `LAUNCH_VISIBILITY.oxsteedMedia`; default flag **false** (`launchScope.js`) |
| 10 | Handles = `profile_slug` only | **Partial** | Business/restaurant actors use slugs; reply `user` actors use generated handles (`mediaController.js`) |
| 11 | Badges: Didit / business verified / restaurant verified | **Done** | `verified_kind` on `media_actors`, `MediaPostCard.jsx` |
| 12 | Didit for video upload; block **public** video until CSAM vendor certified | **Partial** | Didit gate in `mediaAssetController.js`; public video gated via `mediaSafetyPolicy.js` + `MEDIA_PUBLIC_VIDEO_INTERIM` (default off); certified path `MEDIA_CSAM_CERTIFIED=true` |
| 13 | Latest at MVP; Relevant later | **Done** | `getReplies` supports both; UI defaults to Latest with Relevant option (v2 criterion met) |
| 14 | Paid boosts after marketplace (v3+) | **Partial** | Boosts + Credit settlement live (`media_post_boosts`, `MediaPostCard.jsx`) — implemented, phasing note only |
| 15 | Local economy discovery; nearby linked entities | **Done** | Feed locality + link ranking |
| 16 | Launch moderation: auto flags + DMCA | **Partial** | Flags/DMCA: `mediaAdminController.js`, `MediaFlags.jsx`; auto-hide on N open flags added in completion branch |
| 17 | Dual-write restaurant items → `media_post_links` | **Done** | `dualWriteToMedia` |

---

## Section 0 — UI contract

| Item | Status | Files |
|------|--------|-------|
| 0.1 Post detail chrome (avatar, badge, handle, body, media+mute, time, views, 5 actions, reply sort, quotes, composer, linked row) | **Partial** | `MediaPostDetailPage.jsx`, `MediaPostCard.jsx`, `MediaReplyComposer.jsx` — absolute timestamp + reply truncation added in completion branch |
| 0.2 Quote embed | **Done** | `MediaPostCard.jsx` `quoted` |
| 0.3 Reply thread + per-reply actions | **Partial** | Replies use `MediaPostCard`; truncation added in completion branch |
| 0.4 Bottom nav (5 tabs, badges) | **Partial** | `MediaShell.jsx` — notifications/messages badges; Spaces community badge **not** wired (no unread signal in API) |
| 0.5 Linked on OxSteed cards (~5, snapshot, login-gated CTAs) | **Partial** | Hydration `mediaController.js`; transactional CTA login gate added in completion branch |

---

## Section 3 — Architecture (selected)

| Area | Status | Files |
|------|--------|-------|
| Schema `media_*` + `media_post_links` | **Done** | `709_oxsteed_media.sql` + follow-on migrations |
| `/api/media` + `/api/admin/media` | **Done** | `server/routes/media.js`, `mediaAdmin.js`, `server/index.js` |
| Client `/media/*` routes | **Partial** | `App.jsx` — route order fix (notifications/messages before `:handle`) in completion branch |
| Launch flag + API gate | **Partial** | `LAUNCH_VISIBILITY.oxsteedMedia` false; `launchGate.js` + `OXSTEED_MEDIA_LAUNCHED` env |
| Rate limits / blocks | **Done** | Controllers + `user_blocks` filters in feed |
| Prerender / OG | **Done** | `prerenderHelperProfile.js` Media paths |
| i18n `media.*` | **Done** | `client/src/locales/{en,es,fr,ht,ar}.json` |
| How-it-works `/how-it-works/media` | **Partial** | `experienceGuideModel.js` media area + locale objects in completion branch |
| Business Hub Media tab | **Partial** | `BusinessMediaTab.jsx`; tab enabled via `LAUNCH_BUSINESS_HUB_TABS` in completion branch |
| Profile Studio Media | **Done** | `ProfileMediaSection.jsx` |
| Public profile embed | **Done** | `MediaProfilePreview.jsx` |
| Creator marketplace + Credit | **Done** | Creator controllers, migrations `740`–`752`, tests |
| View dedupe 24h | **Partial** | `recordView` — 24h window logic in completion branch |

---

## Section 4 — MVP acceptance (1–11)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Post detail §0.1 | **Partial** → polish in completion branch |
| 2 | Quote-post §0.2 | **Done** |
| 3 | Reply rows §0.3 | **Partial** → truncation |
| 4 | Bottom nav §0.4 | **Partial** (Spaces badge gap) |
| 5 | Quarantine / CSAM / Didit gates | **Partial** (strict public video default off; interim via env for CI) |
| 6 | Launch flag off → redirect; on → Network | **Partial** → false default + Network entry when on |
| 7 | Feed local economy ranking | **Done** |
| 8 | Verified compose + links hydration | **Done** |
| 9 | Guest view / auth transactional CTAs | **Partial** → link gate |
| 10 | Snapshot-only unavailable chips | **Done** |
| 11 | Auto-flag + DMCA | **Partial** → auto-hide threshold |

## Section 4 — v2 acceptance

| Item | Status |
|------|--------|
| Following tab + follow graph | **Done** |
| Business Hub Media + Profile Studio + public embed | **Partial** (Hub tab launch) |
| Restaurant dual-write | **Done** |
| v2 link types (tool, Direct, logistics) | **Done** |
| Relevant sort | **Done** |
| Socket live counts | **Done** |
| No paid boosts in v2 | **Partial** (boosts exist; Credit-backed, spec phasing) |

## Section 4 — v3 acceptance

| Item | Status |
|------|--------|
| Creator marketplace + Credit tipping/gigs/sponsorships | **Done** |
| Paid boosts after marketplace | **Done** (code) |
| Certified CSAM → public video | **Blocked** until `MEDIA_CSAM_CERTIFIED=true` + vendor integration (owner/ops) |
| Stories / advanced ML analytics | **Missing** (out of spec minimum; optional future) |

---

## Section 6 checklist (spec)

| Checklist item | Status |
|----------------|--------|
| Migration family | **Done** (`709`+) |
| Routes + controllers | **Done** |
| Client pages | **Done** |
| Launch + Network | **Partial** (completion branch) |
| Locales + prerender | **Partial** (how-it-works media) |
| Hub + Studio | **Partial** |
| Tests | **Done** (broad coverage under `server/__tests__/media*`) |

---

## Owner / ops actions

| Item | Action |
|------|--------|
| Go-live | Set `LAUNCH_VISIBILITY.oxsteedMedia` / deploy `OXSTEED_MEDIA_LAUNCHED=true` and flip client flag for production bundle |
| Public video | Do **not** enable until CSAM vendor certified; then `MEDIA_CSAM_CERTIFIED=true`, `MEDIA_CSAM_MODE=vendor` |
| CI / isolated media tests | Set `MEDIA_PUBLIC_VIDEO_INTERIM=true` for disposable harness only |
| CSAM vendor contract | Human licensing per `docs/oxsteed-media-safety-policy.md` |

---

## Completion branch commits (map)

See PR description on `cursor/oxsteed-media-complete-3a48` for commit ↔ spec mapping.
