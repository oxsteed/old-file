# Featured placement route CI repair

CI run 37218110214 failed three assertions in `adminSpaRoutes.test.js`.
The client registered `/admin/super/featured-placements`, but the server's
explicit document-route manifest omitted it. Direct GET/HEAD requests and
trailing-slash redirects therefore returned 404 instead of the admin shell.

The repair registers the route in `server/utils/adminSpaRoutes.js`. Existing
manifest-parity, GET/HEAD, cache, robots, and canonical-redirect tests exercise
the new page automatically. Explicit registration and unknown/file-suffix
rejection assertions protect the route boundary. No wildcard fallback or API
authorization changes were introduced.

Local verification:

- Focused `adminSpaRoutes.test.js` and `adminFeaturedPlacement.test.js`:
  2 suites, 342 tests passed.
- `client/npm run build:ci`: passed localization, typecheck, production build,
  and emitted-asset verification.
- Server regression suite: 373 suites and 4,040 tests passed, with existing
  3 suites/46 tests skipped. The Linux-specific `restaurantMediaVideo.test.js`
  was excluded locally because this Mac lacks `/usr/bin/ffmpeg`; GitHub's
  unchanged CI installs FFmpeg and runs the complete suite.
- `git diff --check`: passed.

The post-push GitHub run remains the source of truth for the full Linux suite
and isolated PostgreSQL migration rehearsal. These local tests do not certify
a production deployment or live authenticated business workflows.
