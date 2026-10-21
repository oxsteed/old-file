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
