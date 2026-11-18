# Persona signup coverage

Signup is customer-first. A selected persona records a descriptive intent and
routes the verified account to the owning admission mechanism; it never grants
capability, membership, staff authority, workspace access, or investment
participation.

| Catalog family | Signup intent | Admission mechanism | Verified next step | Protected access |
| --- | --- | --- | --- | --- |
| Customer | `find_help` | Baseline customer access | Personal Home | Customer actions only |
| Helper | `offer_services` | Platform-reviewed application | Helper application | Only after approval and activation |
| Business owner | `run_business` | Platform-reviewed application | Business application | Only after approval and payout/setup requirements |
| Business team | `join_business_team` | Organization invitation or membership approval | Invitation/status | Only for the validated organization scope |
| Restaurant owner | `run_restaurant` | Platform-reviewed application | Restaurant application | Only after approval and restaurant activation |
| Restaurant team | `join_restaurant_team` | Location invitation or membership approval | Invitation/status | Assigned-location tools only |
| Logistics and delivery | `ship_goods` | Platform-reviewed application | Logistics application | Only after effective logistics access |
| Consultant | `consult` | Platform-reviewed application | Consultant application | Only after approval and activation |
| Equipment owner | `list_equipment` | Platform-reviewed application | Equipment application | Only after approval and payout/setup requirements |
| Franchise | `franchise` | Domain-owned territory enrollment | Program/status handoff | No tools until territory assignment |
| Investor reporting | `request_reporting` | Platform-reviewed reporting request | Reporting application | Reporting only; never investment participation |
| Credit participant | `join_credit` | Domain-owned Credit enrollment | Program/status handoff | No Credit capability until eligibility and activation |
| Partner or affiliate | `join_partner` | Domain-owned partner enrollment | Program/status handoff | No attribution tools until approval |
| Workforce and learning | `join_workforce` | Domain-owned program enrollment | Learn/program handoff | No professional tools until enrollment |
| Reviewer | `request_reviewer` | Internal staff provisioning | Staff support handoff | No staff shell from signup |
| Support agent | `request_support` | Internal staff provisioning | Staff support handoff | No staff shell from signup |
| Operations staff | `request_operations` | Internal staff provisioning | Staff support handoff | No staff shell from signup |
| Device or service account | `request_device` | Nonhuman credential provisioning | Administrator handoff | No human navbar or human authority |

The client coverage list is derived from `PERSONA_NAVIGATION_CATALOG`, and the
signup test asserts that every one of its 18 families has exactly one intent.
Unknown or forged privileged values still normalize to `find_help` on the
server.

