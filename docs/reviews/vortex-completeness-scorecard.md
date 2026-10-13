# Vortex completeness scorecard

**Repo:** `oxsteed/old-file` @ `origin/old-files-claude`  
**Tip:** `0d83dc6afb9c2e09c82d0a1c7cd5d6b9f512e896` (2026-10-07 08:02 EDT) — *Register adminOperationsController columnsCache in process-state inventory*  
**Prior digest tips:** security `cbd6a5ef` · product-gap `3d47c364`  
**Fix commit since digest:** `cf3c89dc` — *Vortex security + product-gap fixes*  
**Reopen date:** 2026-10-07 08:22 EDT  
**Mode:** findings only — no code changes / PRs / pushes

---

## 1. One-sentence answer

**No — Vortex is not complete.** High-severity security items from the digest are largely fixed in `cf3c89dc`, but launch alignment, Hub show-once Copy, soft-revoke reissue, deny-as-kick, dual redeem paths, and several product/ops gaps remain open or partial.

---

## 2. Counts

| Status | Count |
|--------|------:|
| **Done** | 19 |
| **Partial** | 8 |
| **Open** | 8 |
| **Total discrete items** | **35** |

(Includes digest Part A #1–15, Part B C/H/M/L, three Gaps, plus pre-digest L-H2 gate already fixed at email time.)

---

## 3. Scorecard

### Part A — Security / correctness

| Finding | Prior severity | Status | Evidence | Residual if any |
|---------|----------------|--------|----------|-----------------|
| **L-H2** `server/routes/vortex.js` fail-closed gate | High (pre-fixed) | **Done** | `server/routes/vortex.js:26–31` — `requireFeatureEnabled('Vortex','VORTEX_ENABLED',false)` on preview/redeem + `rejectImpersonated` + `vortexRedeemLimiter` | — |
| **S1** Launch-hide bypass — leftover APIs ungated | High | **Done** | `businesses.js:74,150–152` and `businessTeam.js` access-code + approve/deny all use `requireVortexEnabled` + `rejectImpersonated` (`cf3c89dc`) | `/api/me/businesses` intentionally ungated (`meWorkspace.js:17–18`) |
| **S2** Manager can mint peer-manager codes | High | **Done** | `businessAccessCodesController.js:84–89` — non-owner `role:'manager'` capped to `representative`; vortex tokens same pattern (`vortexController.js` manager→representative) | Hub role `<select>` still offers Manager to all (`BusinessHubPage.jsx:3266–3270`) — silent cap, confusing UX |
| **S3** Single-use token redeem burns without membership | High | **Done** | `vortexController.js` redeem: `FOR UPDATE`, burn, `INSERT … ON CONFLICT DO NOTHING`, rollback if `rowCount===0` | — |
| **S4** No `rejectImpersonated` on membership mutations | High | **Done** | Applied on vortex preview/redeem, businesses vortex redeem/tokens, access-code CRUD, approve/deny | Role PATCH + overrides PUT still lack `rejectImpersonated` (`businessTeam.js:48–59`) — outside original list |
| **S5** Code redeem skips business liveness | Medium | **Done** | `businessAccessCodesController.js:394–399` — `is_active = TRUE AND deleted_at IS NULL`; else 410 `business_inactive` | — |
| **S6** Active member re-redeem burns `max_uses` | Medium | **Done** | `businessAccessCodesController.js:423–431` — existing non-revoked membership skips uses increment | — |
| **S7** Preview/redeem status oracle; no rate limit | Medium | **Partial** | Codes: unified `CODE_UNAVAILABLE` 404 (`:308–333`); `vortexRedeemLimiter` 10/15min (`rateLimiter.js:544+`, test file present) | Legacy token path still distinct 400 messages (invalid vs expired vs own); code path still 410 for inactive business |
| **S8** Secrets plaintext + returned in lists | Medium | **Partial** | List masking: active tokens/codes → `NULL` (`vortexController.js:100–102`, `businessAccessCodesController.js:54`); email masked | **At-rest still plaintext**; Hub discards create/rotate response then reloads list → active `code` is `NULL` → **Copy broken** (`BusinessHubPage.jsx:1000–1020`, `:3317–3335`) |
| **S9** Footer still advertises Vortex | Medium | **Partial** | `/vortex` no longer dead-redirects; redeem surface always shown (`VortexPage.jsx:246–305`); Footer modal has code+token tabs | `footerUtilityPills: true` + Vortex pill (`Footer.jsx:120–126`); `vortexWorkspaceEntry`/`businessHubVortexAccess` still `false`; APIs 503 when `VORTEX_ENABLED` default false |
| **S10** `listTokens` returns `used_by_email` | Medium | **Done** | Masked `LEFT(email,1)||'@'||domain` (`vortexController.js:114–116`) | — |
| **S11** Soft-revoked codes keep UNIQUE(code) | Low | **Open** | Migration `245`: column `code VARCHAR(32) NOT NULL UNIQUE` **and** partial `idx_bac_code_active … WHERE is_active` — revoked rows still occupy global unique | Cannot reissue same string after soft-revoke |
| **S12** `generateCode` modulo bias | Low | **Done** | `crypto.randomInt(CODE_ALPHABET.length)` (`businessAccessCodesController.js:31–33`) | — |
| **S13** GET `/:id/vortex-tokens` no `bizIdAccess` | Low | **Done** | `businesses.js:150` — `bizIdAccess('manager')` + gate + `rejectImpersonated` | — |
| **S14** Help teaches Vortex while launch-hidden | Low | **Open** | Inventory help still documents Vortex join codes (`InventoryHelpCenterPage.jsx:70–82,208–228`); Hub mint UI gated off (`businessHubVortexAccess: false`) | Launch-hide vs docs mismatch |
| **S15** `denyMembership` revokes pending **and** active | Low | **Open** | `businessAccessCodesController.js:608–609` — `status IN ('pending','active')` | “Deny” doubles as kick; Hub button labeled Deny |

### Part B — Product gaps

| Finding | Prior severity | Status | Evidence | Residual if any |
|---------|----------------|--------|----------|-----------------|
| **C1** Approval lifecycle not operable | Critical | **Done** | Owner notify on redeem (`:514–521`); joiner notify on approve/deny (`:580–597+`); Hub Approve/Deny (`BusinessHubPage.jsx:3516–3526`); pending labeled distinctly (`:3507–3508`) | — |
| **C2** Pending redeem navigates into workspace | Critical | **Done** | `VortexPage.jsx:127–129` — pending → toast + waiting panel, no navigate | — |
| **H1** Advertised Vortex entry dead end | High | **Done** | No launch redirect away from redeem; workspace list gated by `vortexWorkspaceEntry` (`:183`, `:246`) | See S9 — advertise vs `VORTEX_ENABLED` still inconsistent |
| **H2** Help promises codes managers cannot mint in Hub | High | **Partial** | `en.json` `managerCreateCodesBody` → owners create in Hub; ask owner | Hardcoded `defaultValue` still “Owners and managers…” (`InventoryHelpCenterPage.jsx:316`); Hub Vortex section still launch-hidden |
| **H3** Two redeem products, split surfaces | High | **Partial** | Footer: Recommended code tab + Legacy token tab (`Footer.jsx:360–363`); Hub Recommended/Legacy labels | Dual backend paths remain; both still live when flag on |
| **H4** Dashboard “Workspaces” → `/vortex` dead | High | **Done** | Same as H1 — `/vortex` usable for redeem; deep links (`DashboardQuickLinks`, role dashboards) land on redeem surface | Workspace list hidden until `vortexWorkspaceEntry` true |
| **M1** Access-code UI create/revoke/copy only | Medium | **Partial** | Form has `max_uses` + `expires_in_days`; rotate button wired (`:3293–3305`, `:1033`) | **Show-once incomplete:** create/rotate ignore returned `code`; list returns NULL for active → Copy copies null |
| **M2** Role change + permission overrides API-only | Medium | **Partial** | Owner role editor on active members (`:3489–3498`, `handleChangeMemberRole`) | No overrides UI (`setMembershipOverrides` unused); Hub team load still `listMembers` not `listMemberships` |
| **M3** “Manage access codes” shortcut missing | Medium | **Done** | Rendered when `workspaceEntryVisible` → `/business-hub?tab=team` (`VortexPage.jsx:349–358`) | Hidden while workspace entry launch-gated (intentional) |
| **M4** Launch CTA → `/business-launch-status` redirect loop | Medium | **Done** | CTA now `navigate('/business-hub')` (`VortexPage.jsx:349–354`) | — |
| **M5** No joiner notification on approve/deny | Medium | **Done** | `sendNotification` after approve/deny in controller | — |
| **M6** Pending code-join mislabeled as email invite | Medium | **Done** | `member_id` → “Awaiting approval” + Approve/Deny; else “Invite sent” | — |
| **M7** No share/email tooling for VRTX codes | Medium | **Open** | Clipboard only (`copyToken`); no mailto/share sheet | Blocked further by show-once Copy bug |
| **L1** No admin/ops Vortex tooling | Low | **Open** | No admin controllers/pages referencing vortex/access-codes | — |
| **L2** Hub Team still on `listMembers` | Low | **Open** | `BusinessHubPage.jsx:530` — `listMembers(bizId)`; `listMemberships` exported in `api/vortex.js` unused here | — |
| **L3** Network Vortex card correctly hidden | Low | **Done** | No Vortex references in `NetworkAppsPage.jsx` | OK |

### Gaps (from digest footer)

| Finding | Prior severity | Status | Evidence | Residual if any |
|---------|----------------|--------|----------|-----------------|
| **G1** No Vortex/access-code tests | Gap | **Partial** | `server/__tests__/vortexRedeemLimiter.test.js` only | No redeem atomicity / manager-cap / approve-deny integration tests |
| **G2** No challenge sweeper / TTL for unused invite tokens | Gap | **Open** | No vortex/invite-token sweeper under `server/jobs` / `workers` | Expired tokens remain until manual revoke |
| **G3** No step-up / dedicated mint limiter when enabled | Gap | **Open** | Redeem limiter only; mint routes have no step-up / mint-specific limiter | — |

---

## 4. Still-todo prioritized (What / Where / Do)

### P0 — launch safety / broken core UX

| # | What | Where | Do |
|---|------|-------|-----|
| P0-1 | Launch surface alignment | `launchScope.js`, `Footer.jsx`, help centers, `VORTEX_ENABLED` | Either **hide** Footer Vortex pill + help Vortex copy until Hub mint + flag are on together, **or** turn on `VORTEX_ENABLED` + `businessHubVortexAccess` (+ decide `vortexWorkspaceEntry`) as one package. Today: advertise redeem → APIs 503 / Hub mint hidden. |
| P0-2 | Hub show-once Copy broken | `BusinessHubPage.jsx` create/rotate handlers + list row | Keep `data.code` from create/rotate response in client state (or one-shot banner); Copy that value. Do not rely on list for live secrets (list correctly returns NULL). |
| P0-3 | Soft-revoke blocks reissue | `245` schema / migrate | Drop or relax table-level `UNIQUE(code)` so only active codes are unique (partial index already exists); or free code on revoke. |

### P1 — correctness / product honesty

| # | What | Where | Do |
|---|------|-------|-----|
| P1-1 | Deny ≠ kick | `denyMembership` + Hub button | Restrict deny to `pending` only; keep separate revoke/remove for active (already exists). |
| P1-2 | Token redeem oracle | `vortexController.redeemToken` | Unify invalid/expired/revoked to one generic 4xx message (match code path). |
| P1-3 | Dual redeem paths | Footer + Hub + APIs | Pick VRTX codes as sole recommended path; deprecate or admin-only legacy 64-char tokens. |
| P1-4 | Manager option UX | Hub access-code `<select>` | Hide Manager option unless `isOwner` (server already caps). |
| P1-5 | Help defaultValues / Hub flag | `InventoryHelpCenterPage.jsx`, locales | Align hardcoded defaults with owner-only mint; don’t teach Vortex while launch-hidden. |
| P1-6 | `listMemberships` + overrides | Hub Team | Switch load to `listMemberships`; either ship overrides UI or remove/hide API from product surface. |
| P1-7 | Tests beyond limiter | `server/__tests__` | Redeem atomicity (no burn without membership), manager role cap, liveness, approve/deny notify paths. |
| P1-8 | Invite-token TTL sweeper | new job/worker | Expire/revoke unused `business_invite_tokens` past `expires_at`. |

### P2 — hardening / polish

| # | What | Where | Do |
|---|------|-------|-----|
| P2-1 | Hash secrets at rest | invite tokens + access codes | Store hash; show plaintext only at create/rotate. |
| P2-2 | Share/email for codes | Hub | mailto / share after show-once capture. |
| P2-3 | Admin/ops Vortex | Admin | List codes/memberships, force-revoke, audit view. |
| P2-4 | Step-up on mint | access-code + token POST | `rejectImpersonated` already on; add recent-auth / step-up if policy requires. |
| P2-5 | Role/overrides + impersonation | `businessTeam.js` | Add `rejectImpersonated` on role PATCH / overrides PUT. |

---

## 5. Bottom line for Emile

**Vortex work is not complete**, but the digest’s **High security backlog (S1–S4) and Critical product gaps (C1–C2) were addressed** in `cf3c89dc` (tip now `0d83dc6a`).

**For MVP / launch safety:** do **not** treat Vortex as shippable end-to-end yet. Safest short path: keep `VORTEX_ENABLED=false` **and** stop advertising it (Footer pill + help) until P0-1/P0-2 are fixed. If you want Vortex live at launch, flip flag + Hub mint together, fix show-once Copy, then clear P1 deny/oracle/tests.

**Biggest surprise on reopen:** the list-masking security fix left Hub **unable to Copy live access codes** (create/rotate response discarded; list returns `NULL` for active codes).

---

*Source digest: Gmail “OxSteed Vortex review — security + product gaps (old-files-claude)” · tip re-check against `0d83dc6a`.*
