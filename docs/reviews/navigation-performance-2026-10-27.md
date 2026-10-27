# Navigation performance - 2026-10-27

The reported slowdown was moving between pages. Inspection found that
`SmartDashboard` statically imported all ten mode dashboards, and the shared
navigation prefetch registry did not recognize Dashboard, Business Workspace,
or either messages inbox.

Dashboard now imports only the selected mode through the existing resilient
lazy loader. The main navigation destinations share their loaders with the
existing pointer, keyboard, and touch prefetch links. Prefetching still respects
offline, data-saving, and slow connections. Conversation-detail URLs do not
prefetch an unrelated inbox.

## Local evidence

Compared production manifests built immediately before and after the change.
For a homepage-to-dashboard transition, collect transitive static JavaScript
imports, include the selected dashboard in the new build, and exclude files
already required by HomePage. Sum file bytes and gzip bytes for each remaining
file. These figures exclude API responses, CSS, network headers, and timing.

| Dashboard mode | Before JavaScript | After JavaScript | Before gzip | After gzip |
| --- | ---: | ---: | ---: | ---: |
| Business Owner | 680,002 | 75,194 | 176,454 | 28,518 |
| Customer | 680,002 | 453,086 | 176,454 | 131,843 |
| Helper | 680,002 | 382,400 | 176,454 | 106,497 |
| Business Manager | 680,002 | 42,667 | 176,454 | 17,772 |

Business Owner compressed JavaScript decreased 83.8%. Initial entry JavaScript
changed from 755,280 bytes (230,981 gzip) to 756,948 bytes (232,018 gzip), within
the existing 800,000-byte / 240,000-gzip-byte startup budget.

Commands run in `client/`:

- `node --test scripts/routeReliability.test.mjs`: 16 passed. Added behavioral
  checks for selected-mode loading/rendering, shared prefetch/navigation
  downloads, exact destination matching, and connection constraints.
- `npm run build:ci`: passed, including TypeScript, localization, production
  compilation, and validation of 1,086 emitted assets.
- `npm run verify:pwa-startup`: passed.
- Repository `git diff --check`: passed.

## Live evidence boundary

The first live probe returned HTTP 503 while Coolify was deploying the preceding
update-notice commit. After that deployment finished, `/ready` returned 200 with
all readiness checks passing, and homepage response time was approximately
0.29 seconds. This does not establish the cause of earlier navigation delays.

An existing authenticated browser reached the Business Workspace; the session
subsequently required sign-in, so an authenticated before/after timing comparison
is unavailable. The byte comparison above is local build evidence, not measured
live latency or a deployment-success claim. Verify the new deployment, readiness,
and published dashboard chunk before reporting this change live.
