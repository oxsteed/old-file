# Persona foundation: implementation slice 1

Base reviewed: old-files-claude at c61a61dd99f121017d9c30e033f20f566181c5b1.

## Scope

Adds an immutable, descriptive catalog for the 18 primary persona families, safe lookup and translated-text search, plus ten dependency-free unit tests. This is not a complete inventory of child personas. Classification means source support, not deployment readiness. Scope strings are descriptions, not database subject types. Evidence paths are navigation aids; tests validate their format, not their existence or downstream behavior.

The catalog must never grant access, derive account roles, change modes, create memberships, advertise current-user approval or enable financial actions. The investor product intent is investing in eligible entities on OxSteed with OxSteed Credit only, not in OxSteed itself. There is no platform-investor persona. Investment entries remain needs-verification pending review of the recently merged investment implementation.

## Verification

The new module and tests were executed in an isolated workspace using Node v20.20.1 and a temporary type=module package, matching the client module convention. Command: node --test <temporary-workspace>/client/src/features/personas/personaCatalog.test.mjs. Result: 10 passed, 0 failed. No dependencies were installed. The full repository, client build, Node 22 runtime, browser behavior, database and CI were not tested. These are metadata tests, not proof of effective authorization enforcement.

Repository command:

```sh
cd client
node --test src/features/personas/personaCatalog.test.mjs
```

## Remaining explorer integration

Reuse client/src/pages/ExperienceGuidePage.jsx and client/src/utils/experienceGuideModel.js instead of creating a competing account-mode switcher. No route or component is mounted in this slice. Translation keys are reserved, not yet added to locale catalogs; do not render them until en/es/fr/ht/ar legacy and namespaced catalogs have matching reviewed translations. The search accepts the host translator and does not access private user data.

The future read-only explorer needs labeled search/filter controls, result announcements, keyboard support, theme and RTL coverage. Unverified/planned features must not gain actionable links. Current-user badges, if later introduced, require authoritative existing access APIs. Nonhuman actor identities, lifecycle states and subscription tiers stay separate from personas.

No changes to server authorization, existing investor routes/permissions, Credit ledgers, migrations, activation flags, production configuration or deployment are included. Unit tests are not wired into build:ci yet; run the explicit command above until the next integration slice.
