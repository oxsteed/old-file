'use strict';

const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('progressive access Direct customer boundary (WP-032)', () => {
  test('customer quote and booking entry points stay available without helper or business roles', () => {
    const routes = read('routes/direct.js');
    const booking = read('../client/src/pages/DirectBookSlotPage.jsx');

    expect(routes).toContain("router.post('/requests', generalLimiter, optionalAuth, limitDirectPhotoAttachments, quoteCtrl.createQuoteRequest);");
    expect(routes).toContain("router.post('/catalog/services/:id/book', authenticate, requireEmailVerified, requireTermsAcceptance, directBookLimiter, ctrl.bookServiceSlot);");
    expect(routes).not.toMatch(/\/requests[^\n]*requireHelperCapability/);
    expect(routes).not.toMatch(/catalog\/services\/:id[^\n]*requireRole/);
    expect(booking).toMatch(/const signInFrom = `\$\{location\.pathname\}\$\{location\.search\}`;/);
    expect(booking).toMatch(/state=\{\{ from: signInFrom \}\}/);
    expect(booking).toMatch(/bookDirectServiceSlot\(serviceId/);
  });

  test('request reads and mutations remain owner-scoped and retry-safe', () => {
    const controller = read('controllers/directController.js');
    const quoteController = read('controllers/quoteRequestsController.js');
    const messages = read('__tests__/directMessageIdempotency.test.js');

    expect(controller).toMatch(/function canAccessRequest\(request, user\)/);
    expect(controller).toMatch(/String\(user\.id\) === String\(request\.user_id\)/);
    expect(controller).toMatch(/async function canAccessRequestDetail\(request, user\)/);
    expect(quoteController).toMatch(/req\.user\?\.id/);
    expect(quoteController).toMatch(/client_request_id|idempot/);
    expect(messages).toMatch(/replays a committed send without updating the request/);
  });

  test('Direct operations remain grant- and step-up-gated', () => {
    const routes = read('routes/direct.js');
    const controller = read('controllers/directController.js');

    expect(routes).toMatch(/router\.get\('\/admin\/dashboard', authenticate, requireAdmin, requirePermission\('manage_operations'\)/);
    expect(routes).toMatch(/router\.get\('\/admin\/inbox', authenticate, requireAdmin, requirePermission\('manage_operations'\)/);
    expect(routes).toMatch(/router\.patch\('\/admin\/requests\/:id', authenticate, requireAdmin, requirePermission\('manage_operations'\)/);
    expect(routes).toMatch(/router\.post\('\/requests\/:id\/messages', authenticate, requireDg1StepUp/);
    expect(controller).toMatch(/async function staffCanAccessDirectRequest\(user\)/);
    expect(controller).toMatch(/adminTotpEnabled\(user\.id\)/);
    expect(controller).toMatch(/hasGlobalGrant\(user\.id, 'manage_operations'\)/);
  });
});
