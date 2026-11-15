'use strict';

/**
 * Notifications audit item 35: Web Push hygiene.
 * Prune half — already fixed and behaviorally covered in
 * webPushService.test.js (M5: MAX_CONSECUTIVE_FAILURES = 5 deactivates,
 * 400/404/410/413 deactivate at once, 429 never deactivates).
 * Remaining half: POST /notifications/webpush/test has no rate limit,
 * so one user can hammer the push provider with test sends.
 */

const fs = require('fs');
const path = require('path');

const routesSrc = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'notifications.js'),
  'utf8'
);

test('item 35: POST /notifications/webpush/test carries the standard limiter', () => {
  expect(routesSrc).toMatch(
    /router\.post\('\/webpush\/test',\s*authenticate,\s*strictLimiter,\s*webPushCtrl\.sendTest\)/
  );
});
