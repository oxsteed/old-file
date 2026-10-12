# Mode-aware navbar verification

Verified locally on October 12, 2026.

## Behavior

| Mode | Primary navigation | Emphasized action |
| --- | --- | --- |
| Customer | Find Help, My Jobs, Order Food, Messages, Post a Job | Post a Job |
| Helper | Browse Jobs, My Work, Messages | Browse Jobs |
| Business owner and applicable granted business roles | Dashboard, Workspace, Messages | Workspace |

Desktop and mobile share the same navigation model. Account groups settings,
statements, sign-out, and applicable personal/workspace/support destinations.
Language and theme stay visible. Business selection appears only in business
mode; helpers retain a gated workspace link inside Account.

Workspace links and selection prefer the current workspace URL over the saved
business. Owners with no business retain the existing Business Hub setup flow.
The homepage, API interfaces, and authorization rules are unchanged.

## Local verification

- `node --test client/scripts/navbarNavigation.test.mjs client/scripts/messengerShell.test.mjs`: 29 passed, zero failed.
- `npm run test:navbar-navigation-browser` in `client/`: passed with no browser page errors.
- Browser coverage: customer/helper/business; English/French/Arabic; light/dark;
  320/390/768/1360/1600px. All 90 combinations kept the expected ordered links,
  one emphasized action, unread badges, unique IDs, and no page overflow.
- Business dropdown bounds also stayed within every tested viewport in both
  LTR and RTL. Visual review covered the three desktop and mobile modes.
- Interaction checks exercised Tab/Enter/Escape, focus return, outside-click
  dismissal, route-change dismissal, nested disclosure dismissal, unread-event
  updates, mode switching with navigation/reload, workspace URL precedence,
  zero/one/multiple businesses, accessible full business names, and sign-out.
- `npm run build:ci` in `client/`: passed, including the new navigation unit
  suite, type checking, localization checks, and production asset checks.
- After the final mobile dropdown CSS refinement, `npm run build` and
  `npm run verify:dist-assets` passed; 771 emitted assets verified.
- `git diff --check`: passed.

The browser harness mounts the real navigation components with synthetic
account, API, workspace, and socket fixtures. This validates browser behavior;
it is not a production account/API test or a human screen-reader listening pass.

## Delivery boundary

The repository's verified default branch is `old-files-claude`. This change is
prepared for commit/push there. No manual production deployment was performed;
local builds and a Git push do not establish that Coolify deployed the change.
