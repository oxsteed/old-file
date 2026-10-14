# Public policy refresh, 2026-10-13

## Scope and evidence

The public `/terms` route renders `client/src/pages/terms.tsx` and the versioned language content in `client/src/locales/terms/`; it does not render the separate database-backed `TermsOfServicePage.jsx`. `/privacy` uses the corresponding privacy content files. Security, cookies, opt-out, accessibility, and the cookie dialog use legacy catalogs, with matching namespaced common catalogs in all five supported languages.

Changes describe implemented features without asserting that every optional integration is enabled in production:

- Modes and feature availability: `client/src/utils/launchScope.js`, `client/src/App.jsx`, shared navbar and business workspaces.
- Payment records versus transfers: job payment layers, restaurant order flows, Stripe integrations, and Credit ledgers. Removed fixed tier/price/release-time claims from general terms. The selected transaction and payment method supply their applicable conditions.
- Hosting: `AGENTS.md`, `Dockerfile`, `docker-compose.coolify.yml`; replaced the retired Render claim with Coolify/container and Cloudflare wording.
- Retention: `server/services/privacyRetentionService.js`, `accountDeletionGuard.js`, `server/jobs/scheduledDeletionJob.js`, and conversation retention jobs. Financial/audit retention and active-obligation blockers mean there is no universal account/message erasure deadline.
- AI processing: configured AI integrations including support triage and catalog assistance; disclosed prompt/context processing and output limitations without claiming a particular production provider is active.
- Cookies: `client/src/utils/consentScripts.ts`, `PageviewBeacon.jsx`, `useCookieConsent.ts`, and `server/utils/authCookies.js`. GA and Meta are optional configured integrations; the functional loader currently adds no script. Browser settings and drafts are not all governed by the optional-functional toggle.
- Privacy requests: the existing public `/legal/ccpa-requests` endpoint records pending requests. The page now describes review rather than instant account-wide completion. It no longer promises a 45-day wait for every type of request.
- Accessibility: selected automated/browser regression coverage is evidence of tested flows, not complete WCAG conformance or a human assistive-technology audit.

## Behavior changes

- GPC prevents marketing initialization and overrides saved marketing consent and Accept All in that browser. DNT alone is not represented as an automatic opt-out.
- GA advertising signals and personalization are disabled independently of analytics consent. Withdrawal disables GA measurement and revokes Meta consent, in addition to cookie cleanup. This does not erase data previously sent to providers.
- The opt-out form disables marketing in the current browser before submitting, including when the request service fails. Request success means recorded for review.
- Manage Cookies is directly available from Cookie Policy and Do Not Sell. The dialog has Escape dismissal, focus containment and return, reset-to-saved choices, Reject All, logical spacing, and theme tokens. Blocked localStorage does not prevent applying choices for the current visit.
- The new cookie preference version requests a fresh choice. Required legal versions are updated; the existing acceptance gate requests renewed Terms/Privacy acceptance. The legacy user creation path now records central configured versions rather than a stale date.

## Publication requirements

This branch is prepared for review, not production publication. Existing Terms section 20 and Privacy section 12 promise email notice at least 14 days before material changes take effect. Preserve that obligation. Before merging/releasing, the owner must arrange the notice, select an effective date consistent with it, and align page dates, catalog dates, `TERMS_CONFIG`, and the cookie consent version with the approved release. No email notices were sent by this task and no existing acceptance records were rewritten.

Code establishes implementation, not a certification of all business practices. Provider activation, contractual retention duties, mailbox operation, and legal enforceability are not established by these tests. The opt-out request queue still needs operational handling within applicable deadlines; browser GPC handling is not a claim of account-wide third-party erasure. Existing contractual protections and notice provisions were retained; new operational wording needs owner/legal review before publication.

Guidance consulted: [California Attorney General CCPA guidance](https://oag.ca.gov/privacy/ccpa) on sale/sharing choices and GPC, and [FTC guidance on protecting personal information](https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business). These are reference sources, not a determination of which laws apply to OxSteed.

## Validation

- `cd client && npm run build:ci`: passed; 778 emitted assets verified, including TypeScript, locale and source-reference gates.
- `cd client && node --test scripts/legalPolicies.browser-check.cjs scripts/footerNavigation.browser-check.cjs`: both passed. Synthetic APIs only; no live privacy requests or third-party tracking sent. Covers all six pages/five languages, catalog parity, preference withdrawal/regrant, GPC with saved preferences, request success/failure, blocked storage, Escape/Tab focus handling, and cookie dialog widths 320/390/768/1360/1600 in light/dark English/French/Arabic. Existing footer suite verified 120 layout combinations and shared cookie settings.
- `cd server && npx jest --runInBand __tests__/legalPolicyVersion.test.js __tests__/helperRegistration.test.js`: two suites, four tests passed.
- `git diff --check`: passed.

Remote CI is reported separately on the PR. Production deployment was not started or awaited.
