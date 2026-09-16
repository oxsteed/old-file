'use strict';

const { mockQuery, resetMocks } = require('./setup');
const db = require('../db');
const { createQuoteRequest } = require('../controllers/quoteRequestsController');

const validBody = {
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada@example.com',
  service_category: 'Electrical',
  service_location: '123 Main Street',
  service_zip_code: '45502',
  details: 'Please provide a quote for this service.',
};

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function insertedRequest() {
  return {
    id: 'request-1',
    public_reference: 'DQ-REQUEST1',
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.com',
    phone: null,
    company_name: null,
    service_category: 'Electrical',
    service_location: '123 Main Street',
    budget_range: null,
    timeline: null,
    preferred_contact_method: 'email',
    details: validBody.details,
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('catalog-linked Direct quote requests', () => {
  test('canonicalizes a valid live service slug and preserves the readable name', async () => {
    const serviceId = '11111111-1111-4111-8111-111111111111';
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: serviceId, slug: 'direct-electrical-outlet-installation-small-residential', service_name: 'Outlet & Switch Installation - Small Residential', category_slug: 'electrical' }] })
      .mockResolvedValueOnce({ rows: [insertedRequest()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = response();
    await createQuoteRequest({
      body: {
        ...validBody,
        metadata: {
          serviceSlug: 'DIRECT-ELECTRICAL-OUTLET-INSTALLATION-SMALL-RESIDENTIAL',
          serviceName: 'Untrusted display text',
        },
      },
      user: null,
    }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const insertCall = mockQuery.mock.calls.find(([query]) => query.includes('INSERT INTO quote_requests'));
    expect(insertCall).toBeTruthy();
    expect(insertCall[0]).toContain('$30::jsonb');
    const metadata = JSON.parse(insertCall[1][14]);
    expect(metadata).toEqual(expect.objectContaining({
      serviceId,
      serviceIds: [serviceId],
      catalogServiceIds: [serviceId],
      serviceSlug: 'direct-electrical-outlet-installation-small-residential',
      serviceName: 'Outlet & Switch Installation - Small Residential',
      catalogServices: [{
        id: serviceId,
        slug: 'direct-electrical-outlet-installation-small-residential',
        name: 'Outlet & Switch Installation - Small Residential',
        categorySlug: 'electrical',
      }],
    }));
    expect(metadata).not.toHaveProperty('service_slug');
    expect(mockQuery.mock.calls.find(([query]) => query.includes('INSERT INTO quote_request_services'))).toBeTruthy();
  });

  test('persists multiple canonical catalog services in input order', async () => {
    const firstId = '22222222-2222-4222-8222-222222222222';
    const secondId = '33333333-3333-4333-8333-333333333333';
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [
        { id: secondId, slug: 'direct-plumbing-drain-repair', service_name: 'Drain Repair', category_slug: 'plumbing' },
        { id: firstId, slug: 'direct-electrical-ceiling-fan-installation', service_name: 'Ceiling Fan Installation', category_slug: 'electrical' },
      ] })
      .mockResolvedValueOnce({ rows: [insertedRequest()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = response();
    await createQuoteRequest({
      body: {
        ...validBody,
        metadata: { serviceIds: [firstId, secondId] },
      },
      user: null,
    }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const insertCall = mockQuery.mock.calls.find(([query]) => query.includes('INSERT INTO quote_requests'));
    const metadata = JSON.parse(insertCall[1][14]);
    expect(metadata.serviceIds).toEqual([firstId, secondId]);
    expect(metadata.catalogServices.map((service) => service.id)).toEqual([firstId, secondId]);
    const relationInsert = mockQuery.mock.calls.find(([query]) => query.includes('INSERT INTO quote_request_services'));
    expect(JSON.parse(relationInsert[1][1]).map((service) => service.id)).toEqual([firstId, secondId]);
  });

  test('rejects malformed catalog service IDs before opening a database transaction', async () => {
    const res = response();
    await createQuoteRequest({
      body: {
        ...validBody,
        metadata: { serviceIds: ['not-a-uuid'] },
      },
      user: null,
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Selected catalog service is invalid' });
    expect(db.connect).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects a missing or unavailable catalog service and rolls back before insertion', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = response();
    await createQuoteRequest({
      body: {
        ...validBody,
        metadata: { serviceSlug: 'direct-electrical-retired-service' },
      },
      user: null,
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Selected catalog service is not currently requestable' });
    expect(mockQuery.mock.calls.map(([query]) => query)).not.toContainEqual(expect.stringContaining('INSERT INTO quote_requests'));
    expect(mockQuery.mock.calls.at(-1)[0]).toBe('ROLLBACK');
  });

  test('rejects malformed catalog slugs before opening a database transaction', async () => {
    const res = response();
    await createQuoteRequest({
      body: {
        ...validBody,
        metadata: { serviceSlug: '../electrical-service' },
      },
      user: null,
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Selected catalog service is invalid' });
    expect(db.connect).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects overlong catalog slugs without truncating them into another identifier', async () => {
    const res = response();
    await createQuoteRequest({
      body: {
        ...validBody,
        metadata: { serviceSlug: `${'a'.repeat(140)}-extra` },
      },
      user: null,
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Selected catalog service is invalid' });
    expect(db.connect).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('keeps legacy quote requests without a catalog slug unchanged', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [insertedRequest()] })
      .mockResolvedValueOnce({ rows: [] });

    const res = response();
    await createQuoteRequest({ body: validBody, user: null }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockQuery.mock.calls[1][0]).toContain('INSERT INTO quote_requests');
  });
});
