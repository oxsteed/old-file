# Business public profile: re-check of the Oct 6 findings (round 3, latest commit)

**Type:** Findings only. I changed no code, pushed nothing, opened no PRs, and sent no email.
**Tip checked:** `8af1cd662defd563f9bdbcce3f741a9f552cca9e` (2026-10-07 19:03 EDT, oxsteed, "Fix 5 deferred audit items: token storage, launch gate, secret fallback, tip cap"). Fetched at 19:43 EDT. This is the only commit after `be813b0e`. It was pushed directly, with no PR.
**CI:**
- `8af1cd66`: "Server and Client Verification" was still **in progress** at 19:43 EDT (started 19:34 EDT, run 37703069312).
- `be813b0e`: did report, **green**. Verification passed at 18:59 EDT and the PostgreSQL migration rehearsal passed at 19:00 EDT.
- Note: CI has **no server-boot step**, and no Jest test requires `server/index.js`. A green run will therefore NOT catch N1 below.

## Changed since be813b0e

### Totals (18 findings): unchanged at **9 Fixed / 6 Partial / 3 Open**
`8af1cd66` touches no profile files (21 files: auth/socket/launch-gate/guest-chat-secret/food tip). Every profile status from round 2 carries over unchanged. I re-confirmed that the touched-file list has no overlap.
| # | Status @ 8af1cd66 | Evidence (unchanged) |
|---|---|---|
| PS-1 booking_buffer_minutes | **Partial (save outage)** | `server/routes/helperProfile.js:142` passes `$17` = NULL into the NOT NULL DEFAULT 0 column (migration 301). No client sends it (`EditProfileTab.jsx:176`, `AIKnowledgeTab.jsx:75`). The fix is `COALESCE($17,0)`. |
| PS-2 / R3 owner 404 | Fixed (public) + **regression R3 open** | `server/routes/businesses.js:167,173,179,185` (gallery/policies/FAQs/hours) still lack `optionalAuth`. Only `:161` (services) has it. |
| GV-5 / R2 owner_id fallout | Fixed + **regression R2 open** | `BusinessPublicProfilePage.tsx:106-117` (Pay fetch skipped). `BusinessProfilePage.jsx:73,976,1027,1136,1241` (owner undefined). |
| PS-5 URL validation | Partial | `server/utils/mediaUrlValidation.js` is still a denylist. It lets through `[::ffff:127.0.0.1]`, `[::ffff:10.0.0.1]`, `localhost.`, and http. |
| GV-4 hide flags | Partial | Migration 730 adds the columns, but nothing writes them and the hidden data is still in the payload. |
| PS-7 is_listed | Partial | `PATCH /listing` exists at `helperProfile.js:261-287`. `GET /me` (`:54-68`) still omits `is_listed`, so the badge always says "Published". |
| GV-1 / GV-2 parity + messenger | Partial | The pages still diverge and the Pay CTA is dead. `ChatPanel.tsx:310` polls `/helpers/null/status` (404). The messenger mounts only if `allowGuestContact` (`BusinessPublicProfilePage.tsx:423`). |
| Tests | Partial | No new profile tests. Still none for `/core`, the helper gates, `/listing`, or the URL validator. |
| PS-11 / PS-12 / GV-7 | Open (intentional skips) | Untouched. |

### New findings in `8af1cd66` (outside the 18; ranked)
| ID | Sev | Finding | Evidence |
|---|---|---|---|
| N1 | **Critical** | **The server cannot start.** `launchGate.js` requires a logger module that does not exist. `index.js` loads it at the top level, so boot fails with MODULE_NOT_FOUND. The real logger is `server/utils/logger.js`, so the fix is `require('../utils/logger')`. | `server/middleware/launchGate.js:17` `require('./logger')`. `server/index.js:36`. `node -e "require('./server/middleware/launchGate')"` returns `Cannot find module './logger'`. |
| N2 | **High** | **Pre-auth crash of the whole process through the socket cookie fallback.** `decodeURIComponent` of the cookie runs outside any try, inside async Socket.IO middleware. A handshake with `Cookie: oxsteed_access=%E0` throws a URIError, which becomes an unhandled rejection. `index.js:903` then calls `terminate('unhandledRejection', 1)`. I reproduced this with socket.io 4.8.3. | `server/realtime/chatNamespace.js` `cookieAccessToken()` (`~:105-110`), called at `~:152` before the `try`. `server/bootstrap/realtime.js:127-132` (IIFE outside the `try`). Compare `server/middleware/auth.js:63-70`, which wraps it in try/catch. |
| N3 | **High** | **Admin passkey login no longer produces a web session.** `issueAdminSession` returns the tokens only in JSON and sets no cookie. The client used to keep the access token in localStorage, but `persistSessionPayload` now discards it. | `server/controllers/passkeyController.js:209-215` (no `res.cookie`). `client/src/admin/pages/Login.jsx:274-282`. `client/src/api/auth.js:9-14` (`setStoredAccessToken` is a no-op). |
| N4 | **High** | **Internal/logistics access login has the same problem.** `issueSessionForUser` sets no cookies, and the response tokens are now dropped. | `server/controllers/logisticsInternalAccessController.js:204-227, 646-654`. |
| N5 | **Medium** | **Mode/role switch leaves a stale access cookie.** The server rotates only the refresh cookie and invalidates the old sessions. The client no longer stores the fresh access token, so requests keep using the old-role JWT until the cookie expires or refreshes (up to 15 min). | `server/controllers/authController.js:~2140-2152` (only `setRefreshTokenCookie`). `client/src/context/AuthContext.jsx:~182` (storage removed). |
| N6 | Medium | **The launch gate is a no-op even after N1 is fixed.** It is mounted with `app.use('/api/templates', launchGate(), …)`. Under a mount, `req.path` is relative (`/`, `/active`), so it never matches the full `/api/templates` prefix. Use `req.baseUrl + req.path` or `originalUrl`. Caution: once it works, it also 404s admin `/templates/admin/*` (`TemplateManagement.jsx:473,487`) and `TemplatePicker` linked from `BusinessHubPage.jsx:1557`. | `server/middleware/launchGate.js:42-44`. `server/index.js:662,728`. |
| N7 | Medium | **The tip cap is wrong on the order-create path.** `createOrder` `subtotal` is already in cents (`price_cents*qty`, compared against `minimumOrderCents`), but it is multiplied by 100 again. The real cap there is therefore $500 regardless of subtotal, while `quoteOrder` enforces 100% of subtotal (quote and create disagree). The **POS** path named in the commit message was not changed. It still uses `Math.max(subtotal, 50000)` ("whichever is higher"). | `server/controllers/foodController.js:2955` vs `:2435`, `:2804`, `:2855-2860`. `server/controllers/restaurantAppFlowController.js:3575-3580`. |
| N8 | Low-Med | Leftover `accessToken` readers break now that the token is never stored. `JobPublicPage` "Bid" always sends signed-in users to /login. Native push registration after a fresh login never fires, because the watcher keys on `localStorage.setItem('accessToken')`. | `client/src/pages/JobPublicPage.tsx:125-131`. `client/src/utils/mobileBridge.js:111-122`. `client/src/api/tokenValidator.js:33` is harmless because it falls back to `user`. |
| N9 | Low | Socket cookie auth has no Origin check. `cors.origin` (`realtime.js:87`) does not apply to the WS transport. The risk is mitigated by `SameSite=Lax` on `oxsteed_access` (`authController.js:492-498`), so cross-site handshakes carry no cookie. Adding an `allowRequest` Origin allowlist would be worthwhile. | as cited |
| N10 | Low | No tests were added for any of the 5 changes (launch gate, cookie socket auth, tip cap, guest secret, client token removal). There is a cosmetic mangled line in `chatNamespace.js:120` (`=> {    const guestToken`). | `git show --stat 8af1cd66` |
| OK | — | Guest-chat secret: the hardcoded fallback is gone and it fails closed at module load (`guestChatController.js:11-19`). The test setup sets both secrets (`server/__tests__/setup.js:19-20`). | |

i18n: no UI copy changed, so not applicable.

### Priority (round 3)
1. **N1** launchGate logger path (boot blocker; CI won't catch it).
2. **N2** wrap the cookie decode in try/catch in both socket authenticators (pre-auth DoS).
3. **N3/N4/N5** set `oxsteed_access` on admin passkey, internal-access login, and switch-mode (or revert the client change until they do).
4. **PS-1** `COALESCE($17,0)` (Studio/AI Knowledge saves still fail).
5. **R3** `optionalAuth` on `businesses.js:167-185`.
6. **R2** owner_id fallout (Pay CTA, BusinessProfilePage owner).
7. **N7** tip cap units + POS path; **N6** launch-gate mount-relative path.
8. PS-5 allowlist → GV-4 write path + payload suppression → PS-7 `/me` `is_listed` → GV-1/GV-2 → tests (incl. N10) → **N8** → PS-12 / GV-7 / PS-11.

---

# Round 2 (be813b0e), kept for history

**Type:** Findings only. I changed no code, pushed nothing, opened no PRs, and sent no email.
**Repo:** `oxsteed/old-file` @ `origin/old-files-claude`
**Tip checked:** `be813b0e1f0268bc76a1295879f1f61b66013af6` (2026-10-07 18:47 EDT, "PS-5 (missing piece): validate business logo/cover/gallery URLs"). CI status on GitHub: pending (no checks reported yet).
**Previous check:** `f3dd74c0` (17:00 EDT): 0 fixed / 5 partial / 13 open
**Date:** 2026-10-07 (ET)

## Changed since f3dd74c0
**New commits on `old-files-claude`:** pushed directly to the branch. No new PRs, and no open PRs or other remote branches (latest PRs are #487 and #486, both merged earlier).
| Commit | Time (ET) | Profile-related? |
|---|---|---|
| `dbaa9e5b` Fix helper-profile save regression: COALESCE NOT NULL booleans in upsert VALUES | 17:50 | Yes (PS-1) |
| `9dcecff9` Fix 13 business public profile findings (Grok re-check scorecard) | 18:11 | Yes (30 files: PS-2..PS-10, GV-1..GV-5, new #2/#3, tests, migration 730) |
| `be813b0e` PS-5 (missing piece): validate business logo/cover/gallery URLs | 18:47 | Yes (PS-5) |
| `5f0691c0`, `0c82d2c3`, `6645b13d` | 17:42–18:24 | No (statements/navbar/credit fixture) |

**Status changes:**
| # | Was | Now | Commit |
|---|---|---|---|
| PS-1 | Partial (boolean NOT NULL regression) | **Partial: still a save outage, different column** | `dbaa9e5b` |
| PS-2 | Partial | **Fixed** (public), but see regression R3 | `9dcecff9` |
| PS-3 | Partial | **Fixed** | `9dcecff9` |
| PS-4 | Partial | **Fixed** | `9dcecff9` |
| PS-5 | Partial | **Partial** (business side now validated; still a denylist with bypasses) | `9dcecff9`, `be813b0e` |
| PS-6 | Open | **Fixed** | `9dcecff9` |
| PS-7 | Open | **Partial** | `9dcecff9` |
| PS-8 | Open | **Fixed** | `9dcecff9` |
| PS-9 | Open | **Fixed** | `9dcecff9` |
| PS-10 | Open | **Fixed** | `9dcecff9` |
| GV-1 | Open | **Partial** | `9dcecff9` |
| GV-2 | Open | **Partial** | `9dcecff9` |
| GV-3 | Open | **Fixed** | `9dcecff9` |
| GV-4 | Open | **Partial** | `9dcecff9` |
| GV-5 | Open | **Fixed**, but see regression R2 | `9dcecff9` |
| New #2 (ungated `/api/business-profile/:id/public`) | Open | **Fixed** | `9dcecff9` |
| New #3 (narrow gallery gate) | Open | **Fixed** | `9dcecff9` |
| New #4 (no regression tests) | Open | **Partial** | `9dcecff9` |
| PS-11, PS-12, GV-7 | Open | Open (the commit says these were skipped on purpose) | — |

**New regressions / issues introduced or uncovered:** R1–R6 below.

## Where the original findings came from
| Review | When / SHA | Source |
|---|---|---|
| A. Profile Studio deep dive | 2026-10-06 ~14:52 EDT @ `e902930c` | Chat text from the conversation index. A condensed version is in the Gmail digest "OxSteed codebase reviews — digest (old-files-claude)" (2026-10-06 14:53 EDT, §7). |
| B. Guest helper vs business profile views | 2026-10-06 ~18:25 EDT @ `c6d613ca` | Chat text from the conversation index. Never emailed. |

## Totals (18 unique findings; GV-6 duplicates PS-2 and is not counted twice)
| Scope | Fixed | Partial | Still open |
|---|---:|---:|---:|
| Business public profile (11) | 4 | 4 | 3 |
| Helper / shared Studio (7) | 5 | 2 | 0 |
| **Total (18)** | **9** | **6** | **3** |
| *Previous (f3dd74c0)* | *0* | *5* | *13* |

## Scorecard @ be813b0e

### A. Profile Studio (Oct 6 @ e902930c)
| # | Finding (original) | Sev | Scope | Status | Evidence @ be813b0e | Fix commit |
|---|---|---|---|---|---|---|
| PS-1 | `PUT /helper-profile/core` partial update wipes booleans | Critical | Shared Studio (helper) | **Partial: saves still fail** | Booleans are now fine: VALUES uses `COALESCE($8,FALSE)`, `COALESCE($9,FALSE)`, `COALESCE($14,FALSE)` (`server/routes/helperProfile.js:142`) and UPDATE keeps `COALESCE($n, existing)`. **But `$17` (booking_buffer_minutes) is still raw in VALUES** (`:142`), and the column is `INTEGER NOT NULL DEFAULT 0` (`migrations/301_helper_booking_buffer_minutes.sql:2`). No client sends `booking_buffer_minutes`: not `EditProfileTab.jsx:176` (core state `:70-74`), not `AIKnowledgeTab.jsx:75`. So `$17` is NULL and Postgres rejects the insert row before ON CONFLICT. **Repro with the exact SQL from the file in Postgres (PGlite):** Studio save on an existing row, AI Knowledge save on an existing row, and Studio save on a new row all fail with `null value in column "booking_buffer_minutes" … violates not-null constraint`. Only a request that includes `booking_buffer_minutes` succeeds (booleans preserved). This `$17` problem predates `5417464b`. I missed it in the previous pass, which blamed only the booleans. Caveat: this assumes the production column matches the migrations; Sentry had no matching issues or logs. One-line fix: `COALESCE($17, 0)` in VALUES. Minor: `is_available_now_updated_at` (`:157-161`) gets bumped to NOW() on saves that omit `is_available_now` when the stored value is false. | `5417464b`, `dbaa9e5b` |
| PS-2 | Unlisted business content APIs open (gallery/faqs/policies/hours/services) | High | Business | **Fixed** (public) — see R3 | Shared gate `isBusinessPubliclyVisible` (`businessContentController.js:69-82`) uses the aggregate predicate (deleted/active/listed/hidden/setup/service). Applied to services `:108`, gallery `:290`, policies `:418`, FAQs `:537`, hours `:656`. Owners/managers bypass via `passesContentVisibilityGate` (`:88-92`). Test: `server/__tests__/businessContentVisibility.test.js`. | `9dcecff9` |
| PS-3 | Unlisted helper side-channels (status/availability/pricing/slots) | High | Helper | **Fixed** | `COALESCE(hp.is_listed, TRUE) = TRUE` added to `getHelperStatus` (`helpersController.js:1075`, now 404 instead of `false`), `getHelperAvailability :1108`, `getHelperAvailabilitySummary :1180`, `getHelperPricing :1217`, `getHelperSlots :1266`. Calendar blocks were gated earlier (`3d47c364`). No dedicated tests. | `9dcecff9` |
| PS-4 | N8: ungated `getPublicProfile` landmine / dual users profile routes | High | Shared | **Fixed** | The `app.get('/api/users/:id/profile', getPublicProfile)` line and its import are removed from `server/index.js`, so only the gated `routes/users.js` handler remains. Residual (UX only): `/profile/:id` still renders the lean `PublicProfile.jsx` instead of the rich helper profile. | `9dcecff9` |
| PS-5 | Arbitrary media URLs on photo/gallery/logo/cover JSON writes | High | Business + helper | **Partial** | New shared `server/utils/mediaUrlValidation.js`, used for business logo/cover (`businessController.js:398-399`) and gallery (`businessContentController.js:326`). Helper `/photo` has its own copy (`helperProfile.js` PUT /photo). It is still a **denylist, not an allowlist** (the commit message for 9dcecff9 says "allowlist"): any public host is accepted and `http:` is allowed. Probed bypasses: `http://[::ffff:127.0.0.1]/…`, `http://[::ffff:10.0.0.1]/…` and `http://localhost./…` pass. No DNS-resolution check. | `9dcecff9`, `be813b0e` |
| PS-6 | Hours sticky Save vs real save path | Medium | Helper Studio | **Fixed** (code) | The sticky Save bar calls `handleStickySave` (`EditProfileTab.jsx:198-207,955`). In the hours section that is the availability editor's own save via `saveRef` (`:103,624`; `HelperAvailabilityEditor.jsx` registers `handleSave`). Not tested in a browser. | `9dcecff9` |
| PS-7 | Helper Studio has no `is_listed` / draft publish | Medium | Helper | **Partial** | New `PATCH /api/helper-profile/listing` (`helperProfile.js:261-287`) and a toggle in the Visibility section (`EditProfileTab.jsx:421-435,874-900`), i18n in all 5 locales. **Bug:** `GET /helper-profile/me` doesn't select `is_listed` (`helperProfile.js:54-68`), so `setIsListed(d.is_listed !== false)` (`EditProfileTab.jsx:129`) always shows "Published". An unlisted helper's first click sends `is_listed:false` (no change). No tests. | `9dcecff9` |
| PS-8 | Visibility PUT defaults omitted toggles to `true` | Medium | Helper | **Fixed** | Params now `null` when omitted; VALUES `COALESCE($n, TRUE)` for insert, UPDATE `COALESCE($n, existing)` (`helperProfile.js` PUT /visibility ~`:225-246`). | `9dcecff9` |
| PS-9 | Dual Business edit UIs (retire `/business/edit-profile`) | Medium | Business | **Fixed** | `App.jsx:551` redirects to `/business-hub?tab=profile` (valid tab, `BusinessHubPage.jsx:1311`). The lazy import is removed. `BusinessProfileEditPage.tsx` is still on disk as dead code. | `9dcecff9` |
| PS-10 | Cover base64 fallback | Medium | Helper cover | **Fixed** | Storage failure now returns 503 and writes nothing (`helperProfileImageController.js:~262-268`). Test: `helperProfileCoverUploadFailure.test.js`. | `9dcecff9` |
| PS-11 | `COALESCE(is_listed, TRUE)` | Medium | Business + helper | **Still open (cosmetic)** | Still widespread (e.g. `helpersController.js:219,530,766`, now also in the new gates `:1075…:1266`). Columns are `NOT NULL DEFAULT TRUE`, so there's no leak. The commit skipped it on purpose. | — |
| PS-12 | No whole-profile draft API | Info | Business + helper | **Still open** | Skipped on purpose (commit message). | — |

### B. Guest (logged-out) helper vs business views (Oct 6 @ c6d613ca)
| # | Finding (original) | Sev* | Scope | Status | Evidence @ be813b0e | Fix commit |
|---|---|---|---|---|---|---|
| GV-1 | Canonical business URL is a thin page; full parity only on unlinked `/business/:id` | Gap #1 | Business | **Partial** | The canonical `BusinessPublicProfilePage.tsx` now has a messenger, FAQs, policies, JSON-LD and section flags. Slug-aware links via `businessProfilePath` in Discover/Directory/Promote/BookBusiness/BusinessProfilePage/admin snapshot, and server-side in `discoverController.js`, `profileVisibilityController.js`, `prerenderHelperProfile.js`. Remaining: two business profile pages still diverge (`/business/:id` still has templates, BusinessHeader, Book/Post-job, reputation card), and the **Pay CTA is now dead on the canonical page** (R2). | `9dcecff9` |
| GV-2 | Guest chat / messenger dock missing on canonical business URL | Gap #5 | Business | **Partial** | `PublicProfileMessenger` is mounted when `allowGuestContact !== false` (`BusinessPublicProfilePage.tsx:423-440`). Guest OTP and messages resolve the owner via `businessId` (`guestProfileChatVerification.resolveHelperTargets`; `chatController.js:763`), so they work. **Live presence is broken:** `helperId={business.owner_id \|\| null}` is now always null (R2), so `ChatPanel.tsx:310` polls `/helpers/null/status`, which now returns 404. Logged-in users of a business with guest contact off get no messenger at all (the mount is gated on `allowGuestContact`). | `9dcecff9` |
| GV-3 | No FAQ/policies and no `ProfileJsonLd` on canonical page | Table | Business | **Fixed** | FAQs `BusinessPublicProfilePage.tsx:347-360`, policies `:363-379`, `ProfileJsonLd` `:196-220`; i18n keys in en/es/fr/ht/ar. | `9dcecff9` |
| GV-4 | Business sections always shown (no visibility flags) | Table | Business | **Partial** | Migration `730_business_section_visibility_flags.sql` adds `show_*` NOT NULL DEFAULT true. The aggregate reads them defensively (`businessController.js:1357-1375`) and returns them (`:~1488-1492`); the page hides cards (`BusinessPublicProfilePage.tsx:77-81,291,311,347,363,385`). Gaps: **no write path**, so businesses can't change the flags (`updateBusiness` and the Hub UI don't accept `show_*`). Hidden sections' data is still returned in the public payload and by the sub-routes. | `9dcecff9` |
| GV-5 | Public API exposes phone/website/owner_id/team names | Gap #3 | Business | **Fixed** — see R2 | `website`/`phone`/`owner_id` are now `adminPreview ? … : undefined` (`businessController.js:1444-1445,1464`). Team is roles only (`:1504`). Test: `businessPublicProfilePrivacy.test.js`. Residual: reviewer last names still public (not an original finding). | `9dcecff9` |
| GV-6 | Content sub-routes weaker listing gates | Gap #4 | Business | Same as PS-2 (**Fixed**); not double-counted | — | `9dcecff9` |
| GV-7 | Booking/post-job require login | Gap #2 | Business + helper | **Still open** (skipped on purpose) | `App.jsx:463-464` still `ProtectedRoute`. | — |

\*Review B had no severity labels. "Gap #n" is the position in its "Biggest gaps" list; "Table" means it came from the side-by-side table.

### Observations added in round 1
| # | Observation | Status | Evidence |
|---|---|---|---|
| New #1 | PS-1 boolean NOT NULL regression | Superseded: booleans fixed (`dbaa9e5b`), `$17` still fails (see PS-1) | — |
| New #2 | `GET /api/business-profile/:businessId/public` ungated | **Fixed** | Full predicate in WHERE (`businessProfileImageController.js:335-341`); tested |
| New #3 | Gallery gate narrower than aggregate | **Fixed** | Uses the shared gate (`businessContentController.js:290`) |
| New #4 | No regression tests | **Partial** | Added: `businessContentVisibility.test.js`, `businessPublicProfilePrivacy.test.js`, `helperProfileCoverUploadFailure.test.js`. Still none for `/core` (and mocked tests can't catch NOT NULL), helper side-channel gates, `PATCH /listing`, visibility PUT, or the media URL validator. The content test injects `req.user` directly, which hides R3. |

## New regressions / issues (since f3dd74c0)
- **R1 (pre-existing, missed in round 1):** `/helper-profile/core` VALUES passes NULL `booking_buffer_minutes` into a NOT NULL column, so every Profile Studio Basics save and every AI Knowledge save 500s. Verified in Postgres with the exact SQL. Fix: `COALESCE($17, 0)`.
- **R2 (introduced by 9dcecff9, GV-5):** removing `owner_id` from the public payload breaks its consumers:
  - The Pay button never renders on the canonical page: the pay-code fetch exits early on `!business?.owner_id` (`BusinessPublicProfilePage.tsx:106-117`).
  - Messenger presence polls `/helpers/null/status`, which now returns 404 (see GV-2).
  - `/business/:id` (`BusinessProfilePage.jsx:73`) maps `helper.id = business.owner_id`, now undefined. That feeds `PublicProfileMessenger helperId` `:976`, report target `:1027`, `BusinessHeader helperId` `:1136` and `UserReputationCard userId` `:1241`.
  - Not verified: logged-in messenger booking (`createMessengerGuestBooking` requires `helperId`, `chatController.js:1918-1923`) may now 400 from business pages.
  - Fix: a public-safe owner handle or business-keyed pay-code/status endpoints.
- **R3 (introduced by 9dcecff9, PS-2):** the owner/manager bypass reads `req.user`, but gallery/policies/FAQs/hours GET routes have no `optionalAuth` (`businesses.js:167,173,179,185`; only services `:161` has it), and nothing sets `req.user` globally.
  - Effect: owners of draft, unlisted, paused or setup-incomplete businesses get 404, so the Business Hub editor loads empty gallery/policies/FAQs/hours (`BusinessHubPage.jsx:661-685`) and the readiness check shows "hours not set" (`BusinessProfileEditor.jsx:245`). That hits exactly the businesses still in onboarding, with a risk of duplicate re-entry.
  - Hub team roles other than owner/manager also get 404 on draft businesses.
  - The test misses this because it sets `req.user` directly.
- **R4 (GV-4 gap):** business `show_*` flags have no write API or UI, and hidden-section data is still served.
- **R5 (PS-7 bug):** `GET /me` lacks `is_listed`, so the listing toggle starts in the wrong state for unlisted helpers.
- **R6 (PS-5 gap):** the media URL denylist misses IPv4-mapped IPv6 and `localhost.`, still accepts any external host, and allows `http:`.

## Still open / partial — priority order
1. PS-1/R1: `/core` save outage (`COALESCE($17,0)` in VALUES)
2. R3: add `optionalAuth` to gallery/policies/FAQs/hours GETs (owners currently 404 in the Hub for non-public businesses)
3. R2: restore what `owner_id` fed (Pay CTA, live presence, `/business/:id` reputation/report/messenger) without exposing the raw owner id
4. PS-5/R6: real allowlist (own storage/CDN hosts) or at least cover IPv4-mapped IPv6 and trailing-dot hosts; https only
5. GV-4/R4: business `show_*` write path (Hub toggles) and server-side suppression of hidden sections
6. PS-7/R5: return `is_listed` from `GET /helper-profile/me`
7. GV-1/GV-2 residual: converge the two business profile pages; presence for business chats
8. New #4: tests for `/core` (needs a real-Postgres or SQL-shape test), helper gates, listing PATCH, URL validator, route-level auth for the content gates
9. PS-12 draft API · GV-7 login-gated booking · PS-11 COALESCE (cosmetic) — all skipped on purpose
