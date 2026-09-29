'use strict';

const fs = require('fs');
const path = require('path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('admin search and legacy admin lists keep bounded pages and offsets', () => {
  const adminSearch = read('controllers/adminSearchController.js');
  const superAdmin = read('controllers/superAdminController.js');
  const superUsers = read('controllers/superAdminUserController.js');
  const logistics = read('controllers/logisticsAdminController.js');
  const modeApprovals = read('controllers/modePlatformApprovalController.js');

  expect(adminSearch).toMatch(/Math\.min\(parsedPage, 1_000_000\)/);
  expect(superAdmin).toMatch(/Math\.min\(parsedOffset, 1_000_000\)/);
  expect(superUsers).toMatch(/Math\.min\(1_000_000, Math\.max\(0, parseInt\(req\.query\.offset/);
  expect(logistics).toMatch(/Math\.min\(Math\.max\(parseInt\(req\.query\.offset, 10\) \|\| 0, 0\), 1_000_000\)/);
  expect(modeApprovals).toMatch(/Math\.min\(parsedOffset, 1_000_000\)/);
});

test('support audit export is bounded, rate-limited, and non-cacheable', () => {
  const routes = read('routes/support.js');

  expect(routes).toMatch(/router\.get\('\/audit\/export', strictLimiter,/);
  expect(routes).toMatch(/Math\.min\(500, Math\.max\(1, Number\.parseInt\(req\.query\.limit/);
  expect(routes).toMatch(/Cache-Control', 'private, no-store'/);
  expect(routes).toMatch(/X-Content-Type-Options', 'nosniff'/);
});
