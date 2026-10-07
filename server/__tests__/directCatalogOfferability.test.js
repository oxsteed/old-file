'use strict';

// ITEM 19: batch offerability must distinguish available / unavailable /
// error. An engine failure for one service must be logged and surfaced as a
// distinct status — never silently collapsed into "not Bookable" — while the
// happy path for healthy services stays byte-identical.

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/directSlotEngine', () => {
  const actual = jest.requireActual('../services/directSlotEngine');
  return {
    ...actual,
    loadPoolSizes: jest.fn(),
    hasOfferableSlots: jest.fn(),
  };
});

const { getCatalog } = require('../services/directCatalogService');
const { loadPoolSizes, hasOfferableSlots } = require('../services/directSlotEngine');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

function serviceRow(id, slug) {
  return {
    id,
    category_id: 'cat-1',
    slug,
    name_i18n: { en: slug },
    description_i18n: { en: 'desc' },
    price_cents: null,
    currency_code: 'USD',
    availability_days: [],
    display_order: 0,
    sort_order: 0,
    lifecycle_status: 'live',
    is_active: true,
    is_published: true,
    is_operationally_available: true,
    is_bookable: true,
    category_slug: 'electrical',
    category_lifecycle_status: 'live',
    category_is_active: true,
  };
}

describe('direct catalog batch offerability (ITEM 19)', () => {
  test('engine error for one service surfaces a distinct status; healthy services unchanged', async () => {
    const categories = [{
      id: 'cat-1',
      slug: 'electrical',
      name_i18n: { en: 'Electrical' },
      lifecycle_status: 'live',
      is_active: true,
    }];
    const services = [serviceRow('svc-a', 'svc-a'), serviceRow('svc-b', 'svc-b')];
    mockQuery
      .mockResolvedValueOnce({ rows: categories })
      .mockResolvedValueOnce({ rows: services })
      .mockResolvedValueOnce({ rows: [] }); // tools

    loadPoolSizes.mockResolvedValue(new Map([
      ['svc-a', { size: 2, roles: [], userIds: [] }],
      ['svc-b', { size: 2, roles: [], userIds: [] }],
    ]));
    hasOfferableSlots.mockImplementation(async (serviceId) => {
      if (serviceId === 'svc-b') throw new Error('engine exploded');
      return {
        slotsAvailable: true,
        nextSlotStartsAt: '2026-10-08T10:00:00.000Z',
        assigneePoolSize: 2,
        capacityExhausted: false,
        reason: null,
        error: null,
        statusCode: null,
      };
    });

    const catalog = await getCatalog({ locale: 'en' });
    const byId = new Map(catalog.categories[0].services.map((s) => [s.id, s]));
    const a = byId.get('svc-a');
    const b = byId.get('svc-b');

    // Happy path identical: bookable, no offerabilityStatus field at all.
    expect(a.slotsAvailable).toBe(true);
    expect(a.bookable).toBe(true);
    expect(a).not.toHaveProperty('offerabilityStatus');
    expect(a.capabilityReasons).not.toContain('offerability_check_failed');

    // Error path: distinct status + reason, not silently "not Bookable".
    expect(b.offerabilityStatus).toBe('error');
    expect(b.slotsAvailable).toBe(false);
    expect(b.bookable).toBe(false);
    expect(b.capabilityReasons).toContain('offerability_check_failed');
    expect(b.capabilityReasons).not.toContain('no_open_slots');
  });

  test('engine-level error payload (not a throw) also surfaces distinctly', async () => {
    const categories = [{
      id: 'cat-1',
      slug: 'electrical',
      name_i18n: { en: 'Electrical' },
      lifecycle_status: 'live',
      is_active: true,
    }];
    mockQuery
      .mockResolvedValueOnce({ rows: categories })
      .mockResolvedValueOnce({ rows: [serviceRow('svc-c', 'svc-c')] })
      .mockResolvedValueOnce({ rows: [] }); // tools

    loadPoolSizes.mockResolvedValue(new Map([
      ['svc-c', { size: 1, roles: [], userIds: [] }],
    ]));
    // computeServiceSlots returns { error, statusCode } for unknown services
    // instead of throwing; hasOfferableSlots now forwards it.
    hasOfferableSlots.mockResolvedValue({
      slotsAvailable: false,
      nextSlotStartsAt: null,
      assigneePoolSize: 0,
      capacityExhausted: false,
      reason: null,
      error: 'Service not found',
      statusCode: 404,
    });

    const catalog = await getCatalog({ locale: 'en' });
    const svc = catalog.categories[0].services[0];
    expect(svc.offerabilityStatus).toBe('error');
    expect(svc.capabilityReasons).toContain('offerability_check_failed');
  });
});
