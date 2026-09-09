# OxSteed Safety and Security Hardening Report

**Audit date:** 2026-09-09  
**Scope:** OxSteed web application, support and guest-chat paths, uploads, HTTP security controls, dependencies, and the local Coolify host.

## Executive Assessment

The security posture is materially improved, but it is not 10/10 yet. Application-level issues that could be fixed safely in code were addressed and verified. The macOS application firewall and stealth mode are active; the custom PF experiment was rolled back because it interfered with Colima forwarding and is not loaded. Remote Login/ARDAgent state, production secret rotation, browser token architecture, external-provider behavior, and backup/recovery controls still need verification.

## Safe Changes Applied

- Upgraded `multer` to `2.3.0`, `nodemailer` to `9.1.1`, and the vulnerable `js-yaml` lockfile path. Both production and full dependency audits now report zero vulnerabilities.
- Added strict multipart limits and type filtering to logistics document uploads, including a 20 MB size limit, field/part limits, and an allowlist for PDF and image types.
- Added equivalent request limits to profile image and cover-image uploads, preserving the existing 5 MB image policy.
- Sanitized uploaded filenames before storage-key and `Content-Disposition` use to prevent path ambiguity and header injection.
- Hardened correlation IDs to accept only bounded safe characters, preventing log/header injection through a client-supplied ID.
- Added `Cache-Control: no-store` and `Pragma: no-cache` to API and admin responses while retaining public asset caching.
- Tightened Helmet cross-origin policies with same-origin COOP/CORP and Origin-Agent-Cluster headers.
- Bound legacy guest-chat reads and guest messages to signed, session-specific, expiring guest tokens. Guest message identity now comes from the stored session rather than request input.
- Restricted legacy guest-chat claim and helper-message actions to platform admins or active support-agent records tied to active user accounts.
- Added authorization checks to legacy support conversation reads, status changes, and assignment actions, including an atomic capacity check for manual assignment.
- Made automatic live-support assignment capacity-aware inside its transaction; if another chat fills the agent first, the customer safely enters the existing queue.
- Added rate limiting to logout and token-protected guest-session reads to reduce endpoint and session-abuse traffic.
- Added regression tests covering guest-token binding, staff authorization, and unrelated support-conversation access.

## Verification Results

- `npm audit --audit-level=high`: **0 vulnerabilities**.
- `npm audit --omit=dev --audit-level=high`: **0 vulnerabilities**.
- Focused server security/support suites: **3 suites passed, 41 tests passed**.
- Client `verify:i18n`: **passed**.
- Client typecheck: **passed**.
- Client production build: **passed**. Existing warnings remain about one mixed dynamic/static import and large chunks.
- Full server suite: **91 suites passed, 577 tests passed**. The job detail fixtures now authenticate requests as required, and discover coverage uses the current canonical `/helpers/public/:id` URL.
- Live `https://oxsteed.com/` returned `200` with CSP, HSTS, COOP, CORP, Permissions-Policy, Referrer-Policy, X-Content-Type-Options, X-Frame-Options, and Origin-Agent-Cluster headers.
- Live `/ready` returned `200` with healthy application, database, and dependency checks.
- The local host audit found the app container healthy and not directly host-published; Coolify and reverse-proxy management ports are present on the host. FileVault is enabled. The macOS application firewall is enabled with stealth mode on. A custom PF policy was tested, then rolled back and left unloaded because it interfered with Colima forwarding; the pre-change `/etc/pf.conf` was backed up.
- Post-hardening smoke checks after rollback: public `/` returned `200`, `/ready` returned `200`, and localhost Coolify returned `302`. A same-host request to the LAN IP is not a valid inbound-filter test because local traffic can bypass the interface filter.

## Remaining Production Gaps

These items were intentionally not changed blindly because they can interrupt access, expose management interfaces, or invalidate existing clients.

1. **Confirm network exposure.** Establish whether the Mac/Coolify host is LAN-only, publicly reachable, or unknown. Confirm router port forwards, Cloudflare tunnel/reverse-proxy paths, and which ports are intentionally exposed.
2. **Lock down management access.** The custom PF filter is not loaded, so Coolify ports `8000` and `8080`, realtime ports, development ports, DNS, and ARDAgent still require exposure verification and a safe network-level control. Confirm from a separate LAN device and from an external network. `oxsteed.com:8080` currently returns the public homepage through Cloudflare, not the Coolify UI; verify the Cloudflare/origin port mapping and keep Coolify management off public DNS. Remote Login remains on and ARDAgent remains present; the attempted service disable did not take effect, so disable unused SSH/Screen Sharing/Remote Management services through an administrator-approved maintenance action.
3. **Confirm host protections.** Verify the macOS firewall, automatic security updates, least-privilege administrator accounts, and restore-tested offline or immutable backups. FileVault is already enabled.
4. **Rotate and scope production secrets.** In Coolify, verify least-privilege credentials and rotation plans for JWT, encryption, database, Redis, object storage, Stripe, Resend, Twilio, and AI providers. No secret values were copied into this report or chat.
5. **Decide public storage policy.** Known public assets currently use `/api/storage/public`; sensitive documents should use signed `/api/storage/files`. A blanket change could break existing profile, job, or media URLs, so the public/private inventory should be confirmed first.
6. **Decide browser token architecture.** `client/src/api/auth.js` currently stores access and refresh tokens in local storage. HttpOnly, Secure, SameSite refresh cookies would provide stronger XSS resistance, but this requires coordinated web and mobile authentication changes.
7. **Exercise external providers.** Run production-like tests for Resend delivery, Stripe webhooks and replay handling, Twilio failures, object-storage permissions, and AI-provider failure/rate-limit behavior.
8. **Review deployment controls.** These code changes are local and were not deployed during this audit. Push/review through the existing GitHub Desktop and Coolify workflow before release, then re-run `/ready`, smoke tests, and the external-provider checks.

## Required Input Before Claiming 10/10

Please confirm the host exposure model and the intended administrator access path before firewall, SSH, remote-management, or Coolify-port changes are made. A complete security score cannot be honestly assigned until those infrastructure controls, secret rotation, backup restore, and provider integration tests are verified.
