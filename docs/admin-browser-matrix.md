# Admin authenticated browser matrix

The static half of the matrix is automated: `node scripts/admin-route-matrix.cjs`
derives every admin route's required credential from the canonical manifest
(`client/src/admin/adminRouteManifest.js`) and cross-checks it against the
server's `requirePermission` usage. It fails CI on any violation (phantom
anonymous route, unenforced grant, superOnly outside its convention).

The current manifest contains **115 routes: 114 protected and one public login**.
The protected routes comprise 80 plain admin routes, 20 super-admin-only routes,
13 grant-protected admin routes, and the separate `/direct/admin` surface.
Run the matrix command to derive current counts after manifest changes; the
tests derive totals from the manifest and pin security-sensitive role/grant mappings.

This document is the live half: real logins, per role, across browsers. It
needs a running backend with seeded role accounts and cannot run in CI here.

## Roles

| Role | How to seed | Expected scope |
|---|---|---|
| `super_admin` | admin account with role super_admin | all 114 protected routes; login is public |
| `admin` (no grants) | admin account, no permission grants | 80 plain admin routes |
| `admin` + `view_financials` | grant via /admin/super/permissions | + 6 financial routes |
| `admin` + `manage_operations` | grant via /admin/super/permissions | + incident-management route |
| `admin` + `message_users` | grant via /admin/super/permissions | + messaging route |
| `admin` + `manage_settings` | grant via /admin/super/permissions | + settings route |
| `admin` + `view_audit_log` | grant via /admin/super/permissions | + 2 audit routes |
| `admin` + `manage_admin_accounts` | grant via /admin/super/permissions | + 2 account routes |
| `direct-staff` | direct operations account | /direct/admin only |
| anonymous | no session | /admin/login only |

## Matrix procedure

For each role, in Chromium, Firefox, and WebKit (Playwright):

1. Log in as the role at `/admin/login`. A wrong password must show the
   localized error and never navigate.
2. Visit every route the role may access (from
   `node scripts/admin-route-matrix.cjs --json`). Each must render without
   raw i18n keys and without console errors.
3. Visit one route per higher credential the role must NOT access:
   - anonymous -> /admin/dashboard: expect redirect to /admin/login.
   - admin (no grants) -> /admin/super/money: expect 403 + denial audit row.
   - admin (no grants) -> /admin/super/dashboard: expect 403.
   - direct-staff -> /admin/dashboard: expect 403.
4. Switch locale to es, fr, ht, ar on /admin/operations and confirm no raw
   keys and no layout breakage (RTL for ar).
5. Confirm the release gate (`/api/monitoring/release-gate`) returns 401
   without a token and 200/503 with an admin token.

## Evidence to record

- Date, backend commit SHA, browser versions.
- For each role: pass/fail per step, screenshots of any 403/redirect.
- Any denial missing from `admin_audit_log` is a bug: the matrix requires
  every denied access to be audited.

## Relation to automated checks

- `node --test client/scripts/adminRouteContracts.test.mjs`: route registration.
- `node scripts/admin-route-matrix.cjs`: credential mapping, CI-gated.
- `node --test client/scripts/adminOperations.browser-check.cjs`: read-only
  command-center render check with mocked grants.
