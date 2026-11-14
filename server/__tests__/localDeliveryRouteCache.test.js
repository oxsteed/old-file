'use strict';

// Domain 9 item 2: a duplicate delivery estimate must not pay AWS twice for
// the same route. Two identical calculateLocalDeliveryQuote calls go through
// the real geo route provider (AWS SDK mocked at the transport) and must
// cost exactly one CalculateRoutes request.
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-geo-routes', () => ({
  GeoRoutesClient: jest.fn(() => ({ send: mockSend })),
  CalculateRoutesCommand: jest.fn((input) => ({ operation: 'CalculateRoutes', input })),
  CalculateRouteMatrixCommand: jest.fn((input) => ({ operation: 'CalculateRouteMatrix', input })),
}));

const provider = require('../services/geoRouteProviderService');
const { calculateLocalDeliveryQuote } = require('../services/localDeliveryService');

const QUOTE_INPUT = {
  origin: { address: '1 W Main St', city: 'Springfield', state: 'OH', country: 'US', lat: 39.9242, lng: -83.8088 },
  originAddress: '1 W Main St',
  destination: { address: '2 E High St', city: 'Springfield', state: 'OH', country: 'US', lat: 39.953, lng: -83.81 },
  destinationAddress: '2 E High St',
  packageType: 'small',
  weightLbs: 5,
  serviceLevel: 'standard',
};

beforeEach(() => {
  process.env.AWS_GEO_ROUTES_ENABLED = 'true';
  process.env.AWS_REGION = 'us-east-1';
  mockSend.mockResolvedValue({
    Notices: [],
    Routes: [{
      Summary: { Distance: 8046, Duration: 900 },
      Legs: [{ Summary: { Distance: 8046, Duration: 900 }, Geometry: { LineString: [[-83.8088, 39.9242], [-83.81, 39.953]] } }],
    }],
  });
});

afterEach(() => {
  mockSend.mockReset();
  provider.resetForTests();
  delete process.env.AWS_GEO_ROUTES_ENABLED;
  delete process.env.AWS_REGION;
});

test('two identical estimates cost one AWS route call and agree on price', async () => {
  const first = await calculateLocalDeliveryQuote(QUOTE_INPUT);
  const second = await calculateLocalDeliveryQuote(QUOTE_INPUT);

  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(second.pricing.cents.customerTotal).toBe(first.pricing.cents.customerTotal);
  expect(second.route.distanceMiles).toBe(first.route.distanceMiles);
});

test('a different destination still pays for its own route call', async () => {
  await calculateLocalDeliveryQuote(QUOTE_INPUT);
  await calculateLocalDeliveryQuote({
    ...QUOTE_INPUT,
    destination: { address: '9 W Main St', city: 'Springfield', state: 'OH', country: 'US', lat: 39.96, lng: -83.82 },
    destinationAddress: '9 W Main St',
  });

  expect(mockSend).toHaveBeenCalledTimes(2);
});
