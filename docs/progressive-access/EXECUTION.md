# Progressive access execution contract

This document records the verified Package 0 inventory and the bounded
follow-up navigation package after PR #797. It is evidence for implementation,
not a permission boundary and not proof of production deployment.

## Baseline and local safety

- PR #797 (`WP-104: cut over progressive access experience`) is merged as
  `2d8a4f19b6851fa53cc18580085d381fa897c400`.
- The implementation branch is created from the current `old-files-claude`
  integration base at execution time. The base must be re-read before a new
  branch is created.
- The existing dirty `codex/progressive-access-cutover` worktree and all other
  unrelated worktrees are preserved. No reset, clean, stash, move, prune, or
  overwrite is part of this package.

## Architecture map

| Area | Current source of truth | Admission or authority | Client surface | Verification |
| --- | --- | --- | --- | --- |
| Identity and session | `users`, auth session epoch, `AuthContext` | Authenticated account state and account restrictions | Join, Login, ProtectedRoute | Auth/session suites and browser recovery checks |
| Progressive projection | `GET /api/me/access`, `accessService.getProjection`, `resolver.project` | Effective grants plus canonical organization facts | `useAccessProjection`, Home, Navbar | `progressiveAccess.db.test.js`, `accessProjection.browser-check.cjs` |
| Signup intent | `signupIntent`, Join and OTP flow | Intent only; never authority | Join and SignupApplication | Signup validation and DB signup suites |
| Applications | `access_requests`, policy registry, request editor | Platform-reviewed application where policy allows | Settings → Applications and in-context editor | Access lifecycle, concurrency, and settings browser suites |
| Review | `reviewService`, decisions and review permissions | Capability-scoped platform or organization authority | Staff review queue | Decision, permission, and locking suites |
| Organizations | Businesses, memberships, scope resolver | Ownership, invitation, membership, and live permissions | BusinessSwitcher and workspaces | Workspace, invitation, and organization isolation suites |
| Activation | Existing identity, terms, payout, restaurant, and territory flows | Domain-specific prerequisites per operation | Setup checklists and gated actions | Domain guard and activation suites |
| Staff | Existing staff role, grants, and internal routes | Provisioned staff authority | Separate staff shell | Admin/staff authorization suites |
| Nonhuman actors | Existing connector, device, kiosk, and service-account controls | Credential provisioning and scoped server checks | Domain-specific clients | Connector/device and replay suites |

## Admission matrix

| Relationship | Inventory status | Admission mechanism | Navigation/work area | Delivery status |
| --- | --- | --- | --- | --- |
| Customer | Existing | Baseline account access | Personal Home, Explore, My activity | Verified |
| Helper/provider | Existing | Platform-reviewed application | Helper work surfaces after effective access | Implemented; exact-head evidence required |
| Business owner | Existing | Platform-reviewed application plus ownership flow | Scoped Business Workspace | Implemented; scope acceptance required |
| Business/restaurant team | Existing | Organization invitation and membership approval | Organization/location workspace | Implemented; broader acceptance open |
| Consultant | Existing policy; product availability varies | Platform-reviewed application | Consultant work area | Needs verification per route |
| Equipment owner | Existing policy; enforcement varies | Platform-reviewed application | Equipment-owner tools | Needs verification |
| Logistics | Existing policy and role machinery | Domain/platform admission as configured | Assignment/buyer/organizer surfaces | Needs verification |
| Franchise operator | Existing pipeline | Franchise intake and territory assignment | Territory operations | Needs verification |
| Investor reporting | Existing policy | Platform-reviewed reporting request | Reporting only | Needs verification |
| Investment participation | Planned boundary | Separate eligible-entity enrollment | No live transaction UI | Planned |
| Credit participant | Existing Credit domain | Credit-domain eligibility/enrollment | Credit surfaces | Needs verification per operation |
| Internal staff | Existing | Authorized staff provisioning | Staff shell | Needs verification per grant |
| Device/service account | Existing | Nonhuman credential provisioning | Domain-specific client | Needs verification per actor |

Inventory status and delivery status are intentionally separate. Existing code
does not by itself establish production readiness.

## Projection contract

The existing response is authoritative for client rendering but never replaces
server authorization:

```json
{
  "accountId": "user-id",
  "flags": {
    "accessProjection": true,
    "accessRequests": true,
    "customerFirstSignup": true,
    "legacySwitchRetired": false
  },
  "access": {
    "version": 0,
    "personal": ["customer"],
    "organizations": [],
    "openRequestCount": 0,
    "signupResume": null
  }
}
```

The implementation preserves this shape. Any future additions must be
additive and documented before client consumption. `personal` contains only
effective projection capabilities; `organizations` identifies currently
accessible organization scopes; `openRequestCount` is a status indicator, not
authority.

Projection handling distinguishes initial loading, refresh, temporary failure,
unauthenticated state, account-wide restriction, and explicit feature rollback.
Generic failure never falls back to roles, modes, intent, local storage, or a
previous account. Authentication epochs and late-response rejection remain
mandatory.

## Navigation contract

The navigation selector remains a display model. Server guards own authority.
The shared model supplies stable IDs and routes to desktop, mobile, installed
app, and bottom navigation.

Package 1 adds the projection-backed Applications entry and open-request badge
to Account, and filters BusinessSwitcher results against the current projected
organization IDs. It does not introduce new capability programs or protected
operations.

Pending applications do not create workspaces. A workspace selector is shown
only when the projection contains an active organization scope. Changing the
selected workspace changes context only and is revalidated by the server.

## Compatibility register

| Mechanism | Purpose | Owner | Permitted behavior | Retirement condition |
| --- | --- | --- | --- | --- |
| Legacy mode writes and switch endpoint | Support older clients | Access/runtime maintainers | View preference only when progressive gates deny authority lifts | Minimum client version pinned and compatibility clients retired |
| `users.default_mode` reads | Historical routing compatibility | Client/runtime maintainers | Never proof of grant, membership, or staff authority | All progressive routes projection-driven |
| Access rollout flags | Controlled rollback | Release owner | May select compatibility behavior; never grants access | Staged rollout and live acceptance complete |
| Legacy business list fallback | Older deployment compatibility | Business workspace maintainers | Results filtered by projected organization IDs when projection is active | `/me/businesses` supported by all deployed clients |

Every retained mechanism must remain server-authorized and have a removal
package. Rollback cannot turn historic mode strings into grants or bypass
account-wide restrictions.

## Acceptance matrix

| State or scenario | Expected behavior | Evidence |
| --- | --- | --- |
| Customer | Customer baseline navigation and Personal Home | Navbar unit/browser checks |
| Pending application | Same primary navigation; Applications badge/status only | Navigation unit and Settings browser checks |
| Approved helper | Customer navigation plus helper entry points | Projection, helper enforcement, browser checks |
| Approved business/team member | Named, projected workspace only | Workspace and membership isolation checks |
| Combined grants | Additive links; no identity or mode switch | Navigation matrix |
| Suspended/revoked grant | Affected links disappear after refresh; customer actions remain | Revocation and open-session checks |
| Projection failure | No specialist fallback; preserve valid account restrictions | Access projection browser checks |
| Account/session change | Old responses, caches, and scoped data are discarded | Session epoch and cross-account checks |
| Reviewer race | One valid decision; immutable history; durable outbox intent | DB concurrency and review suites |
| Investor reporting | Reporting only; no investment participation | Investment route and projection suites |
| Localization/accessibility | Five locales, RTL, keyboard, focus, responsive behavior | i18n and browser acceptance |

## Cross-cutting requirements

Security, lifecycle integrity, localization, and accessibility apply to every
package from its first implementation. Activation prerequisites are mapped to
specific operations such as browsing, setup, bidding, accepting work,
performing work, viewing earnings, and receiving payouts.

Review decisions and authoritative access changes commit consistently. Async
projection and notification work uses the existing durable outbox or equivalent
recovery path. Delivery failure must not lose decisions, duplicate grants, or
leave unrecoverable access state.

Account and scope changes invalidate or partition projections, application
data, workspace preferences, and scoped caches. Authenticated browser,
service-worker, and offline caching must never create authority or expose a
previous account's data.

Verification records the exact commit, runtime, commands, result type, and
unrun checks. Non-production browser and revocation acceptance precede any
separately authorized production verification, merge, deployment, or flag
activation.
