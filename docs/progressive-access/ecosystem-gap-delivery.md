# Ecosystem gap delivery

Integration baseline `3931b56a4dab6ce050628a2ed3debfc93c5e54f1` on
`old-files-claude`. The [PR #804 CI baseline](https://github.com/oxsteed/old-file/actions/runs/44482075531)
passed at `1f06e552891ca7848dd345f540befab4ef286cd9`.

| Audit gap | Delivery state | Evidence and next acceptance check |
| --- | --- | --- |
| Restaurant workspace uses the wrong ID | Verified in CI | `8a06153f47e6da480b60997a2fd5362e14ce79cd`. Projection tests cover retained businesses and unaffected shortcuts after location revocation. Navbar browser test opens the parent workspace when a location ID overlaps another business ID. [CI passed](https://github.com/oxsteed/old-file/actions/runs/44484642312). |
| Delivery driver admission stops at legacy helper checks | In progress | `logistics.ship` enables organizer access in `requireLogisticsAccess.js`. Implement a separate driver intake backed by the operations-approved driver profile. Prove that a newly verified customer can submit setup, a pending or inactive profile cannot see or claim open marketplace jobs, and operations approval cannot be bypassed by signup intent or legacy modes. |
| Property work is authorized at business scope | Not started | Introduce a canonical property assignment, scope reads and mutations server-side, and test two properties under one business and revocation during an active workspace. |
| Finance read access depends on manager standing | Implemented and verified locally | Owners can assign the expirable `statements.view` override to an active team member. It allows authenticated access to issued records in that business. Location-restricted members cannot read restaurant-wide settlements. Tests cover owner grant, self-grant denial, another business, statement download and HTML, expiry, removal, blocked issuance, and blocked payout approval. |
| Requester, payer, recipient and site contact cannot be delegated independently | Not started | Add per-booking, time-bounded access. Test contact-only coordination, billing privacy, identity binding and revocation. |
| Investor reporting uses platform datasets for every audience | Not started | Separate platform and entity/position report scopes within the Investor workspace and test cross-entity denials. |
| Investment contributions require separate activation | Gated | Keep live commitment writes disabled. Verify eligible Credit-only transaction and statement journeys with isolated data before release approval. |
| Credit participant signup does not reach the existing application | Implemented | Verified signup hands off to `/credit/apply` and can resume in Applications. Existing domain eligibility, review and activation still apply. |
| Team signup does not reach existing invitation redemption | Implemented | Verified business and restaurant team signup hands off to `/vortex` and can resume in Applications. Vortex still owns preview, redemption and approval. |
| Partner or affiliate admission misrepresents helper-only capability | Needs verification | Reconcile partner enrollment with the existing helper-gated affiliate program. Expose only verified enrollment and capability. |
| Workforce enrollment lacks its own authority | Needs verification | Verify actual admission and enrollment before exposing workflow tools. Public learning content is a separate destination. |
| Persona catalog and live policy disagree | In progress | Keep [signup coverage](persona-signup-coverage.md) aligned with verified domain paths and expand it with blocked or planned status and acceptance evidence for all 18 families. |

Local handoff checks passed with Chromium browser fixtures and a freshly
migrated, disposable PostgreSQL/PostGIS database. The signup database suite
passed 16 tests, including the three new handoffs, intent persistence, and
zero grants, memberships, or generic applications from those choices. The
browser fixtures exercised the three post-verification links, the Settings
resume link, and rejection of an unsupported resume destination. The client
production build passed with `npm run build:ci`.

The read-only finance package passed 60 statement and archive tests in four
suites on a freshly migrated disposable PostgreSQL/PostGIS database. The
client build and growth instrumentation coverage also passed locally. The
permission does not grant live balance access, statement investigations,
new issuance, anonymous download links, or payout mutations.

Production rollout and operational acceptance are separate from code and CI
verification. Record exact commits and the environment for each acceptance run.
