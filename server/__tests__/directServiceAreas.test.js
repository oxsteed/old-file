'use strict';

const { mockQuery, resetMocks } = require('./setup');
const {
  checkAvailability,
  createServiceArea,
  distanceMiles,
  listServiceAreas,
  updateServiceArea,
} = require('../services/directServiceAreas');

const springfield = {
  id: '45503000-0000-4000-8000-000000000001',
  label: 'Springfield, OH',
  anchor_zip: '45503',
  anchor_lat: '39.952800',
  anchor_lng: '-83.780400',
  radius_miles: '60.00',
  active: true,
  notes: 'Default OxSteed Direct service radius from ZIP 45503.',
  created_at: '2026-09-04T00:00:00.000Z',
  updated_at: '2026-09-04T00:00:00.000Z',
};

beforeEach(() => {
  resetMocks();
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
});

describe('Direct service areas', () => {
  test('lists active service areas with public-safe field names', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [springfield], rowCount: 1 });

    const serviceAreas = await listServiceAreas();

    expect(serviceAreas).toEqual([
      expect.objectContaining({
        id: springfield.id,
        label: 'Springfield, OH',
        anchorZip: '45503',
        lat: 39.9528,
        lng: -83.7804,
        radiusMiles: 60,
        active: true,
      }),
    ]);
    expect(mockQuery.mock.calls[0][0]).toMatch(/FROM direct_service_areas/);
    expect(mockQuery.mock.calls[0][1]).toEqual([true]);
  });

  test('marks Columbus 43215 available inside the default 60 mile radius', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        'post code': '43215',
        places: [{
          'place name': 'Columbus',
          'state abbreviation': 'OH',
          latitude: '39.9653',
          longitude: '-83.0235',
        }],
      }),
    });
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [springfield], rowCount: 1 });

    const result = await checkAvailability({ zipCode: '43215' });

    expect(result.available).toBe(true);
    expect(result.location.zipCode).toBe('43215');
    expect(result.matchedServiceArea.distanceMiles).toBeGreaterThan(39);
    expect(result.matchedServiceArea.distanceMiles).toBeLessThan(42);
  });

  test('marks Cincinnati 45202 unavailable outside the default 60 mile radius', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        'post code': '45202',
        places: [{
          'place name': 'Cincinnati',
          'state abbreviation': 'OH',
          latitude: '39.1071',
          longitude: '-84.5041',
        }],
      }),
    });
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [springfield], rowCount: 1 });

    const result = await checkAvailability({ zipCode: '45202' });

    expect(result.available).toBe(false);
    expect(result.nearestServiceArea.distanceMiles).toBeCloseTo(69.9, 0);
  });

  test('supports explicit coordinates without calling external geocoding', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [springfield], rowCount: 1 });

    const result = await checkAvailability({
      lat: 39.9528,
      lng: -83.7804,
      zipCode: '45503',
    });

    expect(result.available).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('creates and updates service areas through parameterized queries', async () => {
    const dayton = {
      ...springfield,
      id: '11111111-1111-4111-8111-111111111111',
      label: 'Dayton, OH',
      anchor_zip: '45402',
      anchor_lat: '39.7589',
      anchor_lng: '-84.1916',
      radius_miles: '35.00',
      active: true,
      notes: null,
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [dayton], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [dayton], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ ...dayton, radius_miles: '45.00' }], rowCount: 1 });

    const created = await createServiceArea({
      label: 'Dayton, OH',
      anchorZip: '45402',
      anchorLat: 39.7589,
      anchorLng: -84.1916,
      radiusMiles: 35,
    });
    const updated = await updateServiceArea(dayton.id, { radiusMiles: 45 });

    expect(created.label).toBe('Dayton, OH');
    expect(updated.radiusMiles).toBe(45);
    expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO direct_service_areas/);
    expect(mockQuery.mock.calls[2][0]).toMatch(/UPDATE direct_service_areas/);
  });

  test('distance helper returns the expected Springfield to Columbus distance', () => {
    const miles = distanceMiles(
      { lat: 39.9528, lng: -83.7804 },
      { lat: 39.9653, lng: -83.0235 }
    );

    expect(miles).toBeGreaterThan(40);
    expect(miles).toBeLessThan(43);
  });
});
