'use strict';

const controller = require('../controllers/restaurantPrinterController');

describe('allergen label printer rendering', () => {
  test('renders only declared allergens with quantity and seat context', () => {
    const buffer = controller.buildAllergenLabelReceipt({
      restaurant: { display_name: 'Label Diner' },
      snapshot: {
        order: { id: 41, queue_number: 9 },
        items: [
          { item_name: 'Burger', quantity: 2, seat_number: 3, allergens: ['milk', 'wheat'] },
          { item_name: 'Water', quantity: 1, seat_number: null, allergens: [] },
        ],
      },
    });
    const text = buffer.toString('latin1');
    expect(text).toContain('Label Diner');
    expect(text).toContain('Order #9');
    expect(text).toContain('ALLERGEN LABELS');
    expect(text).toContain('2 x Burger');
    expect(text).toContain('ALLERGENS: milk, wheat');
    expect(text).toContain('Seat 3');
    expect(text).not.toContain('Water');
  });

  test('fails closed when the order has no declared allergens', () => {
    expect(() => controller.buildAllergenLabelReceipt({
      restaurant: { display_name: 'Label Diner' },
      snapshot: { order: { id: 41 }, items: [{ item_name: 'Water', allergens: [] }] },
    })).toThrow(expect.objectContaining({ code: 'allergen_labels_unavailable', statusCode: 409 }));
  });
});

describe('localized receipt labels (F-24)', () => {
  test('uses the configured restaurant locale for fixed labels and money', () => {
    const { buffer } = controller.buildOrderReceipt({
      restaurant: {
        display_name: 'Casa',
        settings: { receiptLocale: 'es' },
        timezone: 'America/New_York',
      },
      settings: { drawerKickOnCash: false },
      snapshot: {
        order: {
          id: 12,
          queue_number: 4,
          guest_name: 'Ana',
          table_label: '3',
          fulfillment_type: 'dine_in',
          subtotal_cents: 1000,
          discount_cents: 100,
          tax_cents: 90,
          service_fee_cents: 0,
          delivery_fee_cents: 0,
          tip_cents: 0,
          total_cents: 990,
          currency_code: 'USD',
          created_at: '2026-10-21T16:00:00.000Z',
        },
        items: [{ id: 1, item_name: 'Taco', quantity: 1, line_total_cents: 1000, special_instructions: null }],
        modifiersByItem: new Map(),
        payments: [{ payment_type: 'cash', amount_cents: 990, status: 'recorded' }],
      },
    });
    const text = buffer.toString('latin1');
    expect(text).toContain('Pedido #4');
    expect(text).toContain('Fecha:');
    expect(text).toContain('Cliente: Ana');
    expect(text).toContain('Mesa: 3');
    expect(text).toContain('Descuento');
    expect(text).toContain('Impuesto');
    expect(text).toContain('Pagado (cash)');
    expect(text).toContain('Gracias por su compra');
    expect(text).not.toContain('Thank you for your business');
  });
});
