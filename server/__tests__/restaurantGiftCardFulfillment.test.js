'use strict';
jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(),
}));
jest.mock('../services/permissionsService', () => ({
  hasRestaurantPermission: jest.fn(),
}));
jest.mock('../services/restaurantLocationAccessService', () => ({
  getLocationScope: jest.fn(),
}));
const scope = require('../services/scopeModel'),
  permissions = require('../services/permissionsService'),
  locations = require('../services/restaurantLocationAccessService');
const f = require('../services/restaurantGiftCardFulfillment'),
  controller = require('../controllers/restaurantGiftCardController');
beforeEach(() => {
  scope.resolveRestaurantAccess.mockResolvedValue({
    id: 1,
    business_id: 2,
    effective_role: 'manager',
  });
  permissions.hasRestaurantPermission.mockResolvedValue(true);
  locations.getLocationScope.mockResolvedValue({
    mode: 'assigned',
    location_ids: [3],
  });
});
test.each([
  'listProducts',
  'createProduct',
  'issueValue',
  'listCards',
  'printCard',
  'handoffCard',
  'resolveDelivery',
  'reconcileCard',
  'reconciliationReport',
])('%s requires all-store authority for brand gift cards', async (name) => {
  const next = jest.fn();
  await controller[name](
    {
      params: { restaurantId: '1', cardId: '1' },
      user: { id: 'user' },
      body: {},
      query: {},
      get: () => '',
    },
    {},
    next,
  );
  expect(next).toHaveBeenCalledWith(
    expect.objectContaining({ code: 'location_scope_forbidden' }),
  );
});
test('explicit permission denial wins before store resolution', async () => {
  permissions.hasRestaurantPermission.mockResolvedValue(false);
  const next = jest.fn();
  await controller.printCard(
    { params: { restaurantId: '1', cardId: '1' }, user: { id: 'user' } },
    {},
    next,
  );
  expect(next).toHaveBeenCalledWith(
    expect.objectContaining({ code: 'forbidden' }),
  );
});
test.each([
  { recipientEmail: 'x\r\nBcc:other@example.invalid' },
  { recipientEmail: 'not-email' },
  { language: 'zz' },
  { message: 'x'.repeat(501) },
  { message: { text: 'x' } },
])('rejects malformed fulfillment payloads', (input) => {
  expect(() => f.normalize(input)).toThrow();
});
test.each(['en', 'es', 'fr', 'ht', 'ar'])(
  'print and email copy is localized and escaped: %s',
  (language) => {
    const rendered = f.render({
      language,
      restaurantName: '<Demo>',
      code: 'ABCD2345EFGH6789',
      currencyCode: 'KWD',
      amountCents: 1005,
      message: '<img src=x>',
    });
    expect(rendered.text).toContain(
      new Intl.NumberFormat(language, {
        style: 'currency',
        currency: 'KWD',
      }).format(1.005),
    );
    expect(rendered.html).toContain('&lt;Demo&gt;');
    expect(rendered.html).not.toContain('<img');
    expect(rendered.subject).toBe(f.COPY[language][0]);
  },
);

test('render stamps a per-response CSP nonce on the style block only when given one', () => {
  const base = {
    language: 'en',
    restaurantName: 'Demo',
    code: 'ABCD2345EFGH6789',
    currencyCode: 'USD',
    amountCents: 1000,
    message: 'Enjoy',
  };
  const without = f.render(base);
  expect(without.html).toContain('<style>');
  expect(without.html).not.toContain('nonce=');
  const nonce = 'AbC123+/==';
  const withNonce = f.render(base, { nonce });
  expect(withNonce.html).toContain(`<style nonce="${nonce}">`);
  expect(withNonce.html).not.toContain('unsafe-inline');
});
