'use strict';

const fs = require('fs');
const path = require('path');

function source(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'controllers', name), 'utf8');
}

describe('restaurant franchise audit coverage', () => {
  test('audits gift-card value changes without logging plaintext codes', () => {
    const controller = source('restaurantGiftCardController.js');
    expect(controller).toContain("action: 'restaurant.gift_card.redeemed'");
    expect(controller).toContain("action: 'restaurant.gift_card.refunded'");
    expect(controller).toContain('delete auditCard.code');
  });

  test('audits CRM deletion and delivery order state changes', () => {
    const loyalty = source('restaurantLoyaltyController.js');
    const delivery = source('restaurantDeliveryMarketplaceController.js');
    expect(loyalty).toContain("action: 'restaurant.loyalty_segment.deleted'");
    expect(delivery).toContain("action: 'restaurant.delivery_marketplace.order_ingested'");
    expect(delivery).toContain("action: 'restaurant.delivery_marketplace.order_transitioned'");
  });
});
