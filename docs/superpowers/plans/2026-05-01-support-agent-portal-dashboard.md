# Support Agent Portal — Implementation Plan

> **For agentic workers:** Implement task-by-task; steps use checkbox syntax.

**Goal:** Give employed support agents (`support_agents` rows for their `user_id`) a first-class **main-app** home at `/support/agent` with employer context, “go online” availability, and links to chat/inbox—without using the admin shell.

**Architecture:** Backend exposes `GET /api/support/agent/me` (aggregates employments via `support_employers` + `support_agents`, scoped to the authenticated user). Frontend uses existing `api` axios + `ProtectedRoute`, a thin `SupportAgentPortalPage`, and i18n keys. OxSteed model: **employer** = who employs you; **business_id** on agent row = service context for conversations/shifts when set.

**Tech Stack:** Express, React 18, react-i18next, existing `authenticate` middleware.

---

## Task 1: Plan document

**Files:** This file.

- [x] Write plan (industry pattern: agent portal = self-service status + queue entry, not admin team overview).

## Task 2: API — `GET /api/support/agent/me`

**Files:**
- Create: `server/controllers/supportAgentPortalController.js` ✅
- Modify: `server/routes/support.js` (register route **before** `/:businessId/*` — use `/agent/me`) ✅

**Behavior:**
- `requireAuth`
- Query `support_agents sa JOIN support_employers e ON sa.employer_id = e.id LEFT JOIN businesses b ON e.business_id = b.id OR sa.business_id = b.id` — actually simplify: for each row where `sa.user_id = req.user.id`, return `agent_id`, `employer_id`, `employer_kind`, `employer_display_name`, `business_id` (context), `business_name` (from businesses if we have id), `status`, `is_available`, `role`, `hire_date`
- For business employers: `display_name` from `b.business_name` or fallback
- For helper: `support_employers.display_name` or "Personal support"
- For platform: `support_employers.display_name`

## Task 3: API — `PATCH /api/support/agent/me/availability` ✅

**Files:** Same controller + route `PATCH /agent/me/availability` body `{ is_available: boolean }`

- Updates **all** active employments for this user (or document: updates each — industry standard is often per-employment; OxSteed multi-employer → apply to all active rows for simplicity v1).

Actually industry standard for multi-org is **per employment**. Body: `{ is_available, agent_id? }` — if `agent_id` provided, verify `user_id` and patch one row; else patch all.

I'll implement: **optional `agent_id`** in body; if missing, set all user's support_agents rows (consistent "global online" for v1).

## Task 4: Frontend — page + routes ✅

**Files:**
- Create: `client/src/pages/SupportAgentPortalPage.jsx`
- Modify: `client/src/App.jsx` — `<ProtectedRoute><SupportAgentPortalPage /></ProtectedRoute>` at `/support/agent`
- Modify: `client/src/components/ProtectedRoute.jsx` — add `/support/agent` to a small allowlist if agents hit onboarding gate (agents may have role `agent` — not helper; check if onboarding applies). `agent` role users: `requireOnboarded` might still run — check. ProtectedRoute only special-cases helper/broker. **Agents** with role `agent` pass through unless `requiredRole`. Good.

## Task 5: Navbar + i18n ✅

**Files:**
- Modify: `client/src/components/Navbar.jsx` — show link when user has support agent employments OR role agent (we could fetch once in AuthContext — avoid for v1: show link if `user.role === 'agent'` OR add `user.is_support_agent` from login — **not** in login payload today). **Option A:** Always show "Support workspace" for logged-in users and let page show empty state. **Option B:** Fetch lightweight flag. **Option C:** show if `user.role === 'agent'`.

Best: Portal page calls `/api/support/agent/me`; if empty, show "no employments". Navbar: show link for **any authenticated user** — too noisy. Show if `['agent','admin','super_admin'].includes(user.role)` — admins aren't agents. Show only **`user.role === 'agent'`** OR we add a client-side check after optional profile fetch.

Simplest industry approach: **Show "Support" nav item when `user?.role === 'agent'`** OR when `/api/support/agent/me` returns length > 0. That needs async in Navbar — heavy.

**Pragmatic:** Add link for `user && (user.role === 'agent' || user.role === 'admin' || user.role === 'super_admin')` — admins can peek (might have no rows — empty state). Actually admin shouldn't use agent portal. **Only `user.role === 'agent'`** for nav link.

But: helpers can be support agents without role `agent` (employed under business). So we need **either** extend login payload **or** use a tiny `GET /api/support/agent/me/exists` returning `{ hasEmployment: boolean }` — extra request.

**v1:** Navbar shows "Support workspace" for authenticated users where we **cannot** know — use **`user.role === 'agent'`** only. Document that multi-role users (helper + agent) need `agent` role or we enhance later.

Actually re-read employer model: user can be helper and have `support_agents` row — their `users.role` might still be `helper`. So nav must not rely on role === agent only.

**v1 fix:** In `AuthContext` after login/refresh, optionally call `GET /api/support/agent/me` and set `supportAgentEmployments` in context — too invasive.

**Lighter:** Navbar uses `useState` + `useEffect` once: `api.get('/support/agent/me')` and if `data.length > 0` show link. One small request per mount — acceptable.

## Task 6: i18n ✅

**Files:** `client/src/locales/en.json` (+ es, fr, ht parity — user rules say parity; I'll add keys to all four).

## Task 7: CLAUDE.md

Update latest work. ✅

---

## Testing

- Log in as user with `support_agents` row → `/support/agent` shows employments.
- PATCH availability → DB updates.
- User with no rows → empty state message.
