# OxSteed Media — implementation status

**Audited against:** `docs/archive/oxsteed-media-spec.md` (uploaded product spec, SHA baseline `bd92ad2b`)  
**Code baseline:** `old-files-claude` + PR #490 (`cursor/oxsteed-media-complete-3a48`; includes stabilization from #489 until that merges)  
**Audit date:** 2026-10-09 (updated after PR #490 completion pass)

Legend: **Done** | **Partial** | **Missing** | **Blocked (external)**

---

## Emile locked decisions (1–17)

| # | Decision | Status | Evidence |
|---|----------|--------|----------|
| 1 | Option C marketplace deferred to v3; MVP = discovery shell | **Partial** | Marketplace + Credit flows shipped early: creator controllers, migrations `740`+, `MediaCreatorPage.jsx` — product-complete but ahead of written phasing |
| 2 | MVP posters: verified helpers, businesses, restaurants | **Done** | `mediaPublisherPolicy.js`, `createPost` |
| 3 | Public entity links, ~5 cap | **Done** | `MAX_LINKS_PER_POST`, compose/detail UI |
| 4 | Keep restaurant Media tab; dual-write later (v2) | **Done** | `restaurantMediaController.js` `dualWriteToMedia` |
| 5 | Photo/video uploads + scan/transcode/CSAM | **Done** | Asset pipeline + workers |
| 6 | Strong ranking boost for valid local links | **Done** | Feed locality + link ranking |
| 7 | Real city/category Spaces | **Done** | Spaces schema + UI |
| 8 | Messages tab reuses messenger | **Partial** | `MediaMessagesPage.jsx` embeds `MessagingWorkspace` |
| 9 | Focused Network branch when ready | **Done** | `networkBranches.js`; hidden until `LAUNCH_VISIBILITY.oxsteedMedia` |
| 10 | Handles = `profile_slug` only | **Partial** | Business/restaurant slugs; reply `user` actors use generated handles |
| 11 | Badges: Didit / business verified / restaurant verified | **Done** | `verified_kind`, `MediaPostCard.jsx` |
| 12 | Didit for video upload; block **public** video until CSAM vendor certified | **Partial** | Didit gate; public video blocked unless certified; `MEDIA_PUBLIC_VIDEO_INTERIM` only non-production (or production + certified) |
| 13 | Latest at MVP; Relevant later | **Done** | Reply sort UI + API |
| 14 | Paid boosts after marketplace (v3+) | **Partial** | Boosts live — phasing note only |
| 15 | Local economy discovery; nearby linked entities | **Done** | Feed ranking |
| 16 | Launch moderation: auto flags + DMCA | **Done** | Flags/DMCA + auto-hide threshold |
| 17 | Dual-write restaurant items → `media_post_links` | **Done** | `dualWriteToMedia` |

---

## Section 0 — UI contract

| Item | Status | Files |
|------|--------|-------|
| 0.1 Post detail chrome | **Done** | `MediaPostDetailPage.jsx`, `MediaPostCard.jsx`, `MediaReplyComposer.jsx` |
| 0.2 Quote embed | **Done** | `MediaPostCard.jsx` |
| 0.3 Reply thread + per-reply actions | **Done** | Truncation + `MediaPostCard` for replies |
| 0.4 Bottom nav (5 tabs, badges) | **Done** | `GET /media/badges` (`spaces_unread`), migration `753`, `MediaShell.jsx` |
| 0.5 Linked on OxSteed cards + guest CTAs | **Done** | `mediaLinkGuestGate.js`, `MediaGuestGate.jsx`, wired on cards + creator/actor/community actions |

---

## Section 3 — Architecture (selected)

| Area | Status | Files |
|------|--------|-------|
| Schema `media_*` | **Done** | `709_oxsteed_media.sql` + follow-ons including `753` |
| `/api/media` + `/api/admin/media` | **Done** | Routes + `launchGate.js` when not launched |
| Client `/media/*` routes | **Done** | `App.jsx`, `MediaLaunchGate.jsx`, `getLaunchRedirect` |
| Launch flag + API gate | **Done** | `oxsteedMedia: false`; hub tab + Network + routes/API 404 when off |
| i18n `media.*` | **Done** | Five locales incl. `media.guestSignIn.*` |
| How-it-works `/how-it-works/media` | **Done** | `experienceGuideModel.js` |
| Business Hub Media tab | **Done** | `isBusinessHubTabLaunched('media')` — hidden until launch |
| Profile Studio / public embed | **Done** | Hidden when `!oxsteedMedia` |

---

## Section 4 — MVP acceptance (1–11)

| # | Criterion | Status |
|---|-----------|--------|
| 1–4 | Post detail, quote, replies, bottom nav | **Done** |
| 5 | Quarantine / CSAM / Didit gates | **Partial** (vendor certification **Blocked (external)**) |
| 6 | Launch flag off → hidden; on → Network | **Done** |
| 7–8 | Feed ranking + verified compose | **Done** |
| 9 | Guest view / auth transactional CTAs | **Done** |
| 10 | Snapshot-only unavailable chips | **Done** |
| 11 | Auto-flag + DMCA | **Done** |

## Section 4 — v2 / v3

| Item | Status |
|------|--------|
| Following, dual-write, v2 links, Relevant sort, sockets | **Done** |
| Business Hub Media + Studio + embed | **Done** (gated until launch) |
| Creator marketplace + Credit | **Done** |
| Certified CSAM → public video | **Blocked (external)** until vendor + `MEDIA_CSAM_CERTIFIED=true` |
| Stories / advanced ML analytics | **Missing** (out of MVP minimum) |

---

## Tests added in PR #490 completion

| Area | Test |
|------|------|
| Launch gating (client) | `client/src/utils/launchScope.test.mjs` |
| Guest link CTAs | `client/src/utils/mediaLinkGuestGate.test.mjs` |
| Spaces badges API | `server/__tests__/mediaShellBadges.test.js` |
| Production interim env | `server/__tests__/mediaSafetyPolicy.test.js` |
| Media API launch gate | `server/__tests__/launchGate.test.js` (existing) |

---

## Owner / ops actions

| Item | Action |
|------|--------|
| Go-live | Set `LAUNCH_VISIBILITY.oxsteedMedia` in client build + `OXSTEED_MEDIA_LAUNCHED=true` on server |
| Public video | Do **not** enable until CSAM vendor certified; then `MEDIA_CSAM_CERTIFIED=true`, `MEDIA_CSAM_MODE=vendor` |
| CI / disposable harness | `MEDIA_PUBLIC_VIDEO_INTERIM=true` (refused in `NODE_ENV=production` unless certified) |
| CSAM vendor contract | Human licensing per `docs/oxsteed-media-safety-policy.md` |

---

## Local test notes (2026-10-09)

| Symptom | Verdict |
|---------|---------|
| `creditMediaVerifier` `credit_total_issuance_limit` on shared DB | **Not a product regression** — disposable DB near default 5M cap; test file raises `OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS` when DB URL is set |
| `prerenderMarketing` / `adminLocaleNamespaces` on Node without full client build | **Environment/setup**, not introduced by #490 — CI runs with production client build |
| `registerHooks` in bare Node | **Tooling/env** — use `npm run build:ci` in `client/` per AGENTS.md |
