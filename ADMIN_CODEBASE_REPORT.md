# Comprehensive Admin Codebase Exploration Report

---

## 1. `JobsList.jsx` — What It Shows

**Location:** `client/src/admin/pages/JobsList.jsx`

**Display Columns:**
- TITLE (with location city/state)
- CLIENT (client name)
- HELPER (helper name or "Unassigned")
- BUDGET (budget range in dollars or "Open")
- STATUS (colored badge: published, in_progress, completed, cancelled, disputed, accepted)
- CREATED (creation date)
- ACTIONS (View → link for all admins; Delete button for super_admin only)

**Features:**
- Search by title/ID
- Filter by status (published, accepted, in_progress, completed, cancelled, disputed)
- Pagination (25 items per page)
- Export CSV functionality
- Delete modal with reason requirement (super_admin only)
- Job title links to `/admin/jobs/:id` detail page
- Responsive dark-themed table

---

## 2. Routes in `server/routes/admin.js`

### Regular Admin (admin + super_admin access)

| Method | Path | Handler |
|--------|------|---------|
| GET | `/admin/dashboard` | `adminCtrl.getDashboardStats` |
| GET | `/admin/reports` | `adminCtrl.getReports` |
| PUT | `/admin/reports/:reportId` | `adminCtrl.reviewReport` |
| GET | `/admin/moderation-queue` | `adminCtrl.getModerationQueue` |
| GET | `/admin/jobs` | `superCtrl.getJobs` |
| GET | `/admin/jobs/:jobId` | `superCtrl.getJobDetail` |
| POST | `/admin/jobs/:jobId/action` | `superCtrl.forceJobAction` |
| GET | `/admin/content` | `adminCtrl.getContent` |
| POST | `/admin/bids/:bidId/remove` | `adminCtrl.removeBid` |
| POST | `/admin/reviews/:reviewId/remove` | `adminCtrl.removeReview` |
| POST | `/admin/reviews/:reviewId/restore` | `adminCtrl.restoreReview` |
| GET | `/admin/users` | `superCtrl.getUsers` |
| GET | `/admin/users/:userId` | `superCtrl.getUserDetail` |
| PUT | `/admin/users/:userId/name` | `superCtrl.updateUserName` |
| POST | `/admin/users/:userId/ban` | `superCtrl.toggleUserBan` |
| GET | `/admin/markets` | `adminCtrl.getMarkets` |
| POST | `/admin/markets/:marketId/zip-codes` | `adminCtrl.addZipCodes` |
| DELETE | `/admin/markets/:marketId/zip-codes` | `adminCtrl.removeZipCodes` |
| GET | `/admin/search` | `searchCtrl.search` |
| GET | `/admin/permission-grants` | `permCtrl.listGrants` |
| GET | `/admin/permission-scopes` | `permCtrl.getScopes` |

### Super Admin Only

| Method | Path | Handler / Notes |
|--------|------|-----------------|
| DELETE | `/admin/jobs/:jobId` | `superCtrl.deleteJob` |
| GET | `/admin/super/dashboard` | `superCtrl.getDashboardStats` |
| GET | `/admin/super/revenue-chart` | `superCtrl.getRevenueChart` |
| POST | `/admin/users/:userId/verify` | `superCtrl.verifyUser` |
| PUT | `/admin/users/:userId/role` | `superCtrl.updateUserRole` |
| DELETE | `/admin/users/:userId` | `superCtrl.deleteUser` |
| POST | `/admin/super/force-logout/:userId` | `superCtrl.forceLogout` |
| POST | `/admin/super/users` | `superCtrl.createUser` — `requirePermission('create_users')` |
| GET | `/admin/super/admin-accounts` | `superCtrl.getAdminAccounts` |
| POST | `/admin/super/admin-accounts` | `superCtrl.createAdminAccount` |
| PUT | `/admin/super/admin-accounts/:id/status` | `superCtrl.toggleAdminAccountStatus` |
| GET | `/admin/super/admin-activity/:adminId` | `superCtrl.getAdminActivity` |
| GET | `/admin/financials` | `superCtrl.getFinancials` |
| GET | `/admin/payouts` | `superCtrl.getPayouts` |
| GET | `/admin/super/revenue` | `superCtrl.getRevenueSummary` |
| GET | `/admin/super/revenue/export` | `superCtrl.getRevenueExport` |
| POST | `/admin/jobs/:jobId/refund` | `superCtrl.issueManualRefund` |
| GET | `/admin/settings` | `superCtrl.getSettings` |
| PUT | `/admin/settings/:key` | `superCtrl.updateSetting` |
| PUT | `/admin/feature-flags/:key` | `superCtrl.updateFeatureFlag` |
| GET | `/admin/audit-log` | `superCtrl.getAuditLog` |
| GET | `/admin/export/:type` | `superCtrl.exportData` |
| POST | `/admin/super/permission-grants` | `permCtrl.createGrant` |
| DELETE | `/admin/super/permission-grants/:id` | `permCtrl.revokeGrant` |
| POST | `/admin/super/users/:userId/message` | `superCtrl.sendAdminMessage` |

### Support Tickets (admin + super_admin)

| Method | Path | Handler |
|--------|------|---------|
| GET | `/admin/support/stats` | `supportCtrl.getStats` |
| GET | `/admin/support/tickets` | `supportCtrl.listTickets` |
| GET | `/admin/support/tickets/:ticketId` | `supportCtrl.getTicketAdmin` |
| POST | `/admin/support/tickets/:ticketId/claim` | `supportCtrl.claimTicket` |
| POST | `/admin/support/tickets/:ticketId/unclaim` | `supportCtrl.unclaimTicket` |
| PUT | `/admin/support/tickets/:ticketId/status` | `supportCtrl.updateStatus` |
| PUT | `/admin/support/tickets/:ticketId/priority` | `supportCtrl.updatePriority` |
| POST | `/admin/support/tickets/:ticketId/reply` | `supportCtrl.adminReply` |

### Search Logs (requirePermission — super bypasses)

| Method | Path | Handler |
|--------|------|---------|
| GET | `/admin/super/search-logs` | `searchCtrl.getSearchLogs` |
| GET | `/admin/super/search-stats` | `searchCtrl.getSearchStats` |

### Skills Lookup (admin + super_admin)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/admin/skills-lookup` | Search/filter with `q`, `category`, `limit`, `offset` |
| GET | `/admin/skills-lookup/categories` | Distinct category list |
| POST | `/admin/skills-lookup` | Create or upsert skill |
| PUT | `/admin/skills-lookup/:id` | Update skill |
| DELETE | `/admin/skills-lookup/:id` | Soft delete (or hard with `?hard=true`) |

---

## 3. `adminController.js` — Job-Related Functions

**No job functions in `adminController.js`.** Job-related functions (`getJobs`, `getJobDetail`, `forceJobAction`, `deleteJob`) are all in `superAdminController.js`.

`adminController.js` contains:
- `getDashboardStats` — Regular admin dashboard
- `getReports` — Content reports list
- `reviewReport` — Process report action
- `getModerationQueue` — Jobs/content needing moderation (uses `metadata->>'admin_flagged'`)
- `getMarkets` — Markets for zip code management
- `addZipCodes` / `removeZipCodes` — Market zip code management
- `getContent` — List bids/reviews for removal
- `removeBid` / `removeReview` / `restoreReview` — Content moderation

---

## 4. `JobDetail.jsx` — Existence and Contents

**Location:** `client/src/admin/pages/JobDetail.jsx` *(created this session)*

**Route:** `/admin/jobs/:jobId` — accessible to all admins

**Sections:**
- **Header:** Job title, status badge, flagged/disputed indicators, admin action buttons
- **Description panel**
- **Bids list** — helper name/email (linked to user detail), bid amount, status badge, message preview, date
- **Payment breakdown** — status, total amount, helper payout, platform fee, Stripe PI, date
- **Sidebar — Details:** location, budget, category, job value, created/updated dates
- **Sidebar — Client card:** name + email, links to `/admin/users/:id`
- **Sidebar — Helper card:** name + email (if assigned), links to `/admin/users/:id`

**Admin actions (all admins):**
- Cancel Job (with optional reason modal)
- Flag / Unflag (reads `job.admin_flagged` from `metadata->>'admin_flagged'`)

**Super-admin only actions:**
- Refund (shown when `payment.status === 'captured'`)
- Delete (hard delete with required reason, navigates back to list)

**Flag state storage:** `jobs.metadata->>'admin_flagged'` (JSONB). The backend `forceJobAction` uses `jsonb_set` to persist it; `getJobDetail` exposes it as `admin_flagged boolean`.

---

## 5. `UserDetail.jsx` — Sections Summary

**Location:** `client/src/admin/pages/super/UserDetail.jsx`

| Section | Contents |
|---------|----------|
| **Header** | Avatar, name, email, edit-name button, role badge, plan badge, active/banned status, ID-verified badge, background-check badge |
| **Actions (super_admin)** | Ban/Unban, Verify ID, Send Message, Change Role dropdown |
| **Stats grid** | Rating, Jobs Completed, Total Earnings, Completion Rate |
| **Recent Jobs** | Title, date, final price, status — up to 10 |
| **Billing History** | Invoice event type, period start, amount, status, external link |
| **Recent Payouts** | Job title, completion date, net payout — only if payouts exist |
| **Stripe Account (super_admin)** | Account ID, onboarding status, charges/payouts enabled, subscription ID/status |
| **Direct Message modal (super_admin)** | Textarea, character counter; disabled for admin targets |

---

## 6. Permission Scopes (`adminPermissionController.js`)

12 scopes total after this session:

| Scope | Description |
|-------|-------------|
| `view_financials` | View revenue, payouts, and financial data |
| `export_data` | Export platform data (users, jobs, revenue) |
| `manage_settings` | Update platform settings and feature flags |
| `view_audit_log` | View the full admin audit log |
| `issue_refunds` | Issue manual job refunds |
| `verify_users` | Mark users as identity-verified |
| `delete_users` | Hard-delete user accounts |
| `delete_jobs` | Hard-delete job posts |
| `view_search_logs` | View admin search audit log |
| `manage_admin_accounts` | Create and enable/disable admin accounts |
| `message_users` | Send direct admin-to-user messages |
| `create_users` | Create new regular user accounts (customer/helper/broker) |

Super-admins bypass all permission checks automatically. Regular admins must hold an active, non-expired, non-revoked grant from a super-admin via `POST /admin/super/permission-grants`.

---

## 7. `superAdminController.js` — User Creation Functions

### `createAdminAccount` (admin accounts only)

| Field | Notes |
|-------|-------|
| `email` | Required |
| `first_name` | Required |
| `last_name` | Required |
| `role` | Optional, defaults to `'admin'`; accepts `'admin'` or `'super_admin'` |
| `temporary_password` | Required, min 12 chars, bcrypt-hashed |

- Sets `email_verified = true` by default
- Logs to `admin_audit_log`
- **Does not** create regular user accounts

### `createUser` *(new — this session)*

| Field | Notes |
|-------|-------|
| `first_name` | Required |
| `last_name` | Required |
| `email` | Required, normalized to lowercase, must be unique |
| `password` | Required, min 8 chars, bcrypt-hashed (cost 12) |
| `role` | Optional, defaults to `'customer'`; accepts `'customer'`, `'helper'`, `'broker'` |

- Sets `is_active = true`, `email_verified = true`
- Logs `user_created` action to `admin_audit_log`
- Route: `POST /admin/super/users` — guarded by `requirePermission('create_users')`

---

## 8. `AdminAccounts.jsx` — Purpose

**Location:** `client/src/admin/pages/super/AdminAccounts.jsx`

**Scope:** Admin accounts **only** — not regular users.

**Features:**
- Lists only `admin` and `super_admin` role accounts
- Create new admin modal (email, name, role, temporary password — min 12 chars)
- Enable / Disable admin accounts (with optional reason prompt for disabling)
- Force logout all sessions for an admin
- Admin activity drawer showing audit log per admin
- Actions-logged count and last-action timestamp per row

---

## 9. `adminAuth.js` Middleware

**Location:** `server/middleware/adminAuth.js`

### `requireAdmin`
- Verifies JWT, checks `is_active`, requires `role IN ('admin', 'super_admin')`
- Sets `req.user` and `req.isSuper`

### `requireSuperAdmin`
- Verifies JWT, checks `is_active`, requires `role = 'super_admin'`
- Sets `req.user`, `req.isSuper = true`

### `requirePermission(scope)` — factory
- Must be chained after `requireAdmin` (relies on `req.user` and `req.isSuper`)
- Super-admins pass unconditionally
- Regular admins: queries `admin_permission_grants` for an active non-expired non-revoked grant with `permissions ? $scope` (JSONB containment)
- Sets `req.grantedPermission` for downstream use
- Returns `403` with a "contact a super-admin" message on failure

**Usage pattern:**
```js
router.get('/route', requireAdmin, requirePermission('view_financials'), ctrl.handler);
// or for super-admin-only routes:
router.post('/route', requireSuperAdmin, ctrl.handler);
// or with delegable permission:
router.post('/route', requireAdmin, requirePermission('create_users'), ctrl.handler);
```

---

## Key Architecture Notes

- **Job flag state** is stored in `jobs.metadata->>'admin_flagged'` (JSONB), not a dedicated column. Use `jsonb_set` to write and cast to boolean when reading.
- **Job functions** live in `superAdminController.js` even for regular-admin routes — the route file uses `requireAdmin` for read access and `requireSuperAdmin` only for destructive writes.
- **Regular user creation** is accessible to super-admins and any admin granted `create_users`. Admin account creation (`createAdminAccount`) remains super-admin only with no delegation path.
- **`AdminAccounts.jsx`** is scoped exclusively to admin/super_admin accounts. Regular user management is in `UsersList.jsx` + `UserDetail.jsx`.
