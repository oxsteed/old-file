'use strict';
/**
 * Dead-links batch regression (2026-11-25 findings-only audit).
 *
 * Every one of the 29 dead URLs from the audit must now resolve to a real
 * client route (client/src/App.jsx) or an allowlisted admin SPA path
 * (server/utils/adminSpaRoutes.js), and the dead URL literal must be gone
 * from every source file that emitted it.
 *
 * The test fails on the pre-fix tree (dead literals present) and passes
 * after the retargets. The catch-all `*` route is NotFound, not a match.
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

function extractAppRoutes(src) {
  const routes = new Set();
  for (const m of src.matchAll(/path="([^"]+)"/g)) {
    if (m[1] !== '*') routes.add(m[1]);
  }
  return [...routes];
}

function extractAdminRoutes(src) {
  const start = src.indexOf('Object.freeze([');
  const end = src.indexOf(']);', start);
  const body = src.slice(start, end);
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function matchesRoute(url, routes) {
  const pathOnly = url.split('?')[0].split('#')[0];
  const segs = pathOnly.split('/').filter(Boolean);
  return routes.some((route) => {
    const rsegs = route.split('/').filter(Boolean);
    if (rsegs.length !== segs.length) return false;
    return rsegs.every((rs, i) => rs.startsWith(':') || rs === segs[i]);
  });
}

const appRoutes = extractAppRoutes(read('client/src/App.jsx'));
const adminRoutes = extractAdminRoutes(read('server/utils/adminSpaRoutes.js'));
const allRoutes = [...appRoutes, ...adminRoutes];

// Each case: the dead URL from the audit, one concrete fixed URL (ids filled
// in), and the dead literal(s) that must be gone from the listed files.
const CASES = [
  {
    dead: '/growth',
    fixed: '/business-hub',
    checks: [{ file: 'client/src/pages/FranchiseTerritoryOpsPage.jsx', snippet: "to: '/growth'" }],
  },
  {
    dead: '/marketplace',
    fixed: '/products',
    checks: [
      { file: 'client/src/pages/LearnModePage.jsx', snippet: "toolsHref: '/marketplace'" },
      { file: 'client/src/pages/LearnModePage.jsx', snippet: "href: '/marketplace'" },
    ],
  },
  {
    dead: '/marketplace (tool-rental guides)',
    fixed: '/tool-rentals',
    checks: [],
  },
  {
    dead: '/admin/analytics',
    fixed: '/admin/analytics/query-builder',
    checks: [{ file: 'server/analytics/regionGeoSourceSwitch.js', snippet: 'action_url: "/admin/analytics"' }],
  },
  {
    dead: '/admin/consulting/business-launch/requests/:id',
    fixed: '/admin/consulting/business-launch',
    checks: [{ file: 'server/controllers/businessLaunchController.js', snippet: '/admin/consulting/business-launch/requests' }],
  },
  {
    dead: '/admin/support/tickets/:id',
    fixed: '/admin/support',
    checks: [{ file: 'server/controllers/customer360Controller.js', snippet: '/admin/support/tickets/${refId}' }],
  },
  {
    dead: '/admin/reviews/reports/:id',
    fixed: '/admin/moderation',
    checks: [{ file: 'server/controllers/reviewModerationController.js', snippet: '/admin/reviews/reports/${report.id}' }],
  },
  {
    dead: '/admin/careers',
    fixed: '/admin/super/careers',
    checks: [
      { file: 'server/services/careers/applications.js', snippet: "'/admin/careers'" },
      { file: 'server/services/careers/marketplace/scheduling.js', snippet: "'/admin/careers'" },
      { file: 'server/services/careers/marketplace/messaging.js', snippet: "'/admin/careers'" },
      { file: 'server/controllers/careers/adminController.js', snippet: "'/admin/careers'" },
    ],
  },
  {
    dead: '/admin/careers/fairness',
    fixed: '/admin/super/careers',
    checks: [
      { file: 'server/services/careers/fairness.js', snippet: "'/admin/careers/fairness'" },
      { file: 'server/__tests__/careersFairnessNotify.test.js', snippet: "'/admin/careers/fairness'" },
    ],
  },
  {
    dead: '/businesses/:id/book',
    fixed: '/book/business/biz-1',
    checks: [{ file: 'server/controllers/businessAppointmentsController.js', snippet: '/businesses/${appointment.business_id}/book' }],
  },
  {
    dead: '/businesses/:id/calendar',
    fixed: '/business/biz-1/workspace/calendar',
    checks: [
      { file: 'server/controllers/businessAppointmentsController.js', snippet: '/businesses/${appointment.business_id}/calendar' },
      { file: 'server/jobs/businessAppointmentReminders.js', snippet: '/businesses/${row.business_id}/calendar' },
      { file: 'server/jobs/businessAppointmentNoShowSweeper.js', snippet: '/businesses/${appointment.business_id}/calendar' },
    ],
  },
  {
    dead: '/settings/payouts',
    fixed: '/helper/payouts',
    checks: [{ file: 'server/controllers/PayoutController.js', snippet: "'/settings/payouts'" }],
  },
  {
    dead: '/profile#reviews',
    fixed: '/profile/user-1#reviews',
    checks: [{ file: 'server/controllers/reviewController.js', snippet: '`/profile#reviews`' }],
  },
  {
    dead: '/direct/requests/:id',
    fixed: '/direct/quotes/q-1',
    checks: [{ file: 'server/controllers/directController.js', snippet: '/direct/requests/${booked.id}' }],
  },
  {
    dead: '/businesses/:id/invoices/:id',
    fixed: '/invoices',
    checks: [{ file: 'server/controllers/businessInvoiceController.js', snippet: '/businesses/${invoice.business_id}/invoices/${invoice.id}' }],
  },
  {
    dead: '/my-profile/reviews',
    fixed: '/profile/user-1',
    checks: [{ file: 'server/controllers/reviewModerationController.js', snippet: "'/my-profile/reviews'" }],
  },
  {
    dead: '/my-enforcement-status',
    fixed: '/enforcement-policy',
    checks: [{ file: 'server/controllers/enforcementPolicyController.js', snippet: "'/my-enforcement-status'" }],
  },
  {
    dead: '/business',
    fixed: '/business-hub',
    checks: [{ file: 'server/controllers/businessStaffScheduleController.js', snippet: "action_url: '/business'," }],
  },
  {
    dead: '/support/my-tickets',
    fixed: '/support/escalation',
    checks: [{ file: 'server/controllers/paymentDisputeAdminController.js', snippet: "action_url: '/support/my-tickets'," }],
  },
  {
    dead: '/settings/security',
    fixed: '/settings?tab=security',
    checks: [{ file: 'server/controllers/superAdminUserController.js', snippet: "'/settings/security'" }],
  },
  {
    dead: '/dashboard/helper',
    fixed: '/helper-dashboard',
    checks: [{ file: 'server/controllers/verificationController.js', snippet: "'/dashboard/helper'" }],
  },
  {
    dead: '/restaurants/:id/manage',
    fixed: '/restaurants/r-1/portal?tab=shift',
    checks: [
      { file: 'server/services/restaurantPersona/teamService.js', snippet: '/manage?tab=' },
      { file: 'server/services/restaurantPersona/ownerService.js', snippet: '/manage?tab=' },
    ],
  },
  {
    dead: '/business/:id/hub?tab=properties',
    fixed: '/business/biz-1/workspace?tab=properties',
    checks: [
      { file: 'server/services/propertyManager/portfolioService.js', snippet: '/hub?tab=properties' },
      { file: 'server/services/propertyManager/workService.js', snippet: '/hub?tab=properties' },
      { file: 'server/services/propertyManager/upkeepService.js', snippet: '/hub?tab=properties' },
    ],
  },
  {
    dead: '/maintenance-requests',
    fixed: '/business/biz-1/maintenance-request',
    checks: [{ file: 'server/services/propertyManager/portfolioService.js', snippet: "'/maintenance-requests'" }],
  },
  {
    dead: '/maintenance-requests/:id',
    fixed: '/business/biz-1/maintenance-request',
    checks: [{ file: 'server/services/propertyManager/workService.js', snippet: '`/maintenance-requests/${r.id}`' }],
  },
  {
    dead: '/property-approvals',
    fixed: '/business-hub',
    checks: [{ file: 'server/services/propertyManager/workService.js', snippet: "'/property-approvals'" }],
  },
  {
    dead: '/signup?next=/careers/me',
    fixed: '/join?next=/careers/me',
    checks: [{ file: 'server/services/careers/offers.js', snippet: "'/signup?next=/careers/me'" }],
  },
  {
    dead: '/careers/me/profile',
    fixed: '/careers/me',
    checks: [{ file: 'server/services/careers/profile.js', snippet: "'/careers/me/profile'" }],
  },
  {
    dead: '/careers/me/onboarding/:id',
    fixed: '/careers/me',
    checks: [{ file: 'server/services/careers/onboardingRun.js', snippet: '/careers/me/onboarding/${ctx.id}' }],
  },
  {
    dead: '/business/:id/careers/onboarding/:id',
    fixed: '/business/biz-1/careers',
    checks: [{ file: 'server/services/careers/onboardingRun.js', snippet: '/business/${ctx.business_id}/careers/onboarding/${ctx.id}' }],
  },
];

describe('dead-links batch regression (2026-11-25 audit)', () => {
  test('route tables parse (sanity)', () => {
    expect(appRoutes.length).toBeGreaterThan(200);
    expect(adminRoutes.length).toBeGreaterThan(100);
  });

  for (const c of CASES) {
    test(`${c.dead} -> ${c.fixed} resolves to a real route`, () => {
      expect(matchesRoute(c.fixed, allRoutes)).toBe(true);
    });
    for (const check of c.checks) {
      test(`dead literal gone: ${c.dead} in ${check.file}`, () => {
        expect(read(check.file)).not.toContain(check.snippet);
      });
    }
  }
});
