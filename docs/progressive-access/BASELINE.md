# Progressive access authority baseline

This inventory is the authority map for the migration from legacy mode switching
to customer-first, capability-backed access. It records the current sources of
truth and the seams that must remain compatible while the rollout flags are
enabled. It is deliberately concrete: a new implementation should use this
file to decide where to add a gate instead of introducing another role or mode
lookup.

## Current authority layers

| Layer | Source of truth | What it controls today | Progressive-access rule |
| --- | --- | --- | --- |
| Identity | `users.id`, email, active/suspended/deleted state | Authentication, session ownership, account lifecycle | Never infer a capability from an email, request body, or stale JWT alone. |
| Legacy RBAC | `users.role` | Existing middleware and controller checks (`customer`, `helper`, staff, admin) | Keep for compatibility, but a customer-class role must not be promoted by a mode write. |
| Legacy view preference | `users.default_mode` | Dashboard selection, navbar labels, route selection, old ModeSwitcher | Treat as a view preference only when projection is enabled; it is not proof of approval. |
| Capability grant | `access_grants` plus resolver facts | Approved helper, consultant, tool, logistics and other authority | A grant is usable only when status, effective dates, account state and subject scope pass the canonical resolver. |
| Organization authority | `businesses` ownership and active `business_memberships` | Workspace access, delegated business permissions and support scope | Resolve the selected business and live membership on every server request; never trust a client-selected role. |
| Application lifecycle | `access_requests`, policy revisions, `access_request_decisions` | Pending, needs-information, resubmission, approve/reject/revoke and audit history | Applicant reads are account-scoped; reviewer authority is reloaded inside the locked transaction. |
| Feature rollout | `ACCESS_CUSTOMER_FIRST_SIGNUP`, `ACCESS_LEGACY_SWITCH_RETIRED`, projection/request flags | Shadow/enforce compatibility behavior and client surfaces | Keep gates default-off until evidence is complete; a flag must not grant authority by itself. |

## Legacy write and read paths

The following paths still exist and must be treated as compatibility surfaces:

- `POST /api/auth/login` accepts `operatingMode`, `defaultMode`, and
  `default_mode`. Under progressive access, a requested mode is ignored unless
  `modeGate.checkModeChange` proves the account already holds the authority.
- `POST /api/auth/switch-role`, `PUT /api/auth/profile`, and
  `PATCH /api/auth/me` route mode changes through `services/access/modeGate.js`.
  A rejected authority lift returns `access_required` (or records
  `mode_change_ignored` for profile writes) and does not create a grant.
- `server/utils/modeRole.js` remains the only legacy mode-to-`users.role`
  mapping. Do not add a second mapping in a controller or route.
- `client/src/utils/modeRouter.js`, `modeAccess.js`, and old dashboard routing
  still read `default_mode`. With projection enabled, those reads select a
  surface only after `accessProjection` confirms the capability; they do not
  authorize an API action.
- `client/src/components/ModeSwitcher.jsx` is compatibility-only when the
  projection flag is active. The progressive branch links to Applications;
  Settings no longer offers self-selected mode promotion.

## Capability families and current server gates

| Capability family | Representative key | Existing enforcement |
| --- | --- | --- |
| Helper work | `helper.offer_services` | `requireHelperCapability` / `requireHelperWorkEligible` on bid, reconfirm and hire flows; onboarding remains a separate completion gate. |
| Business ownership | `business.own` | Business creation and workspace ownership checks; owner facts are reloaded server-side. |
| Business membership | `business.manage_team`, live membership role | `requireBusinessAccess` and workspace permission resolver with selected-business scoping. |
| Consultant | `consultant.accept_paying_clients` | Mode/access projection and consultant route/API gates. |
| Tool owner | `tool_owner.list_equipment` | Mode/access projection plus tool rental route checks. |
| Logistics | `logistics.ship` and logistics role facts | Logistics route gates and buyer/organizer capability checks. |

## Known migration hazards

1. A stale `users.role` or `default_mode` in a JWT can outlive a grant
   revocation. Protected APIs must use live facts or a short-lived projection,
   and revocation tests must cover an already-issued token.
2. `business_manager`, representative, employee, and support-agent modes are
   membership views, not self-selectable account promotions. Their authority is
   the active membership plus permission resolver, scoped to one business.
3. Legacy helper-class roles are broader than the new capability set. The
   Credit role trigger can intentionally leave an approved account at role
   `customer`; helper APIs therefore use `isHelperActor`/capability evidence,
   not a role-only check.
4. Public application policy schemas must expose applicant questions only.
   Reviewer notes, evidence requirements intended for staff, and arbitrary
   policy metadata are private.
5. The old switch endpoint cannot be deleted while legacy clients exist. It
   must remain a compatibility endpoint whose authority-lifting branch is
   denied under `ACCESS_LEGACY_SWITCH_RETIRED`.

## Required evidence before retiring the compatibility layer

- A populated login-path test proves a customer logging in with a privileged
  legacy mode remains a customer and keeps `default_mode=customer` when the
  progressive gate is enabled.
- Populated two-business approval, revoked-approver and cross-business tests
  prove membership scope is live and cannot be selected from the client.
- Exact-head CI is green for the pushed commit, followed by a staged shadow and
  enforce rollout with mismatch metrics reviewed.
- Browser acceptance confirms that Applications is reachable from the customer
  surface and that removing a grant removes provider/workspace entry points
  without removing customer navigation.
