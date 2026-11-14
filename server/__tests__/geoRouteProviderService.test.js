const mockSend = jest.fn();

jest.mock('@aws-sdk/client-geo-routes', () => ({
  GeoRoutesClient: jest.fn(() => ({ send: mockSend })),
  CalculateRoutesCommand: jest.fn((input) => ({ operation: 'CalculateRoutes', input })),
  CalculateRouteMatrixCommand: jest.fn((input) => ({ operation: 'CalculateRouteMatrix', input })),
}));

const {
  CalculateRoutesCommand,
  CalculateRouteMatrixCommand,
  GeoRoutesClient,
} = require('@aws-sdk/client-geo-routes');
const provider = require('../services/geoRouteProviderService');

afterEach(() => {
  mockSend.mockReset();
  GeoRoutesClient.mockClear();
  CalculateRoutesCommand.mockClear();
  CalculateRouteMatrixCommand.mockClear();
  provider.resetForTests();
  delete process.env.AWS_GEO_ROUTES_ENABLED;
  delete process.env.AWS_REGION;
});

test('keeps Routes v2 opt-in', async () => {
  await expect(provider.calculateRoute({ origin: [0, 0], destination: [1, 1] })).resolves.toBeNull();
  expect(GeoRoutesClient).not.toHaveBeenCalled();
});

test('maps CalculateRoutes into the shared route contract', async () => {
  process.env.AWS_GEO_ROUTES_ENABLED = 'true';
  process.env.AWS_REGION = 'us-east-1';
  mockSend.mockResolvedValueOnce({
    Notices: [],
    Routes: [{
      Summary: { Distance: 1200, Duration: 90 },
      Legs: [{ Summary: { Distance: 1200, Duration: 90 }, Geometry: { LineString: [[0, 0], [1, 1]] } }],
    }],
  });

  await expect(provider.calculateRoute({ origin: [0, 0], destination: [1, 1], travelMode: 'Car' })).resolves.toEqual({
    provider: 'aws',
    distanceMeters: 1200,
    durationSeconds: 90,
    legs: [{ distanceMeters: 1200, durationSeconds: 90, geometry: [[0, 0], [1, 1]] }],
    geometry: [[0, 0], [1, 1]],
    notices: [],
  });
  expect(CalculateRoutesCommand).toHaveBeenCalledWith({
    Origin: [0, 0],
    Destination: [1, 1],
    TravelMode: 'Car',
    LegGeometryFormat: 'Simple',
    LegAdditionalFeatures: ['Summary'],
    DepartNow: true,
  });
});

test('maps CalculateRouteMatrix into a bounded matrix contract', async () => {
  process.env.AWS_GEO_ROUTES_ENABLED = 'true';
  process.env.AWS_REGION = 'us-east-1';
  mockSend.mockResolvedValueOnce({ ErrorCount: 0, RouteMatrix: [[{ Distance: 800, Duration: 60 }]] });

  await expect(provider.calculateMatrix({ origins: [[0, 0]], destinations: [[1, 1]], travelMode: 'Car' })).resolves.toEqual({
    provider: 'aws',
    errorCount: 0,
    matrix: [[{ distanceMeters: 800, durationSeconds: 60, error: null }]],
  });
  expect(CalculateRouteMatrixCommand).toHaveBeenCalledWith({
    Origins: [{ Position: [0, 0] }],
    Destinations: [{ Position: [1, 1] }],
    TravelMode: 'Car',
    RoutingBoundary: { Unbounded: true },
    DepartNow: true,
  });
});

// Domain 9 item 2: a duplicate estimate must not pay AWS twice for the same
// route. The provider caches identical route calculations for a TTL and
// shares one in-flight request between concurrent callers.
const ROUTE_RESPONSE = {
  Notices: [],
  Routes: [{
    Summary: { Distance: 1200, Duration: 90 },
    Legs: [{ Summary: { Distance: 1200, Duration: 90 }, Geometry: { LineString: [[0, 0], [1, 1]] } }],
  }],
};

function enableProvider() {
  process.env.AWS_GEO_ROUTES_ENABLED = 'true';
  process.env.AWS_REGION = 'us-east-1';
}

test('serves a repeated identical route from cache without a second AWS call', async () => {
  enableProvider();
  mockSend.mockResolvedValue(ROUTE_RESPONSE);

  const first = await provider.calculateRoute({ origin: [0, 0], destination: [1, 1], travelMode: 'Car' });
  const second = await provider.calculateRoute({ origin: [0, 0], destination: [1, 1], travelMode: 'Car' });

  expect(second).toEqual(first);
  expect(mockSend).toHaveBeenCalledTimes(1);
});

test('dedupes concurrent identical route calculations into one AWS call', async () => {
  enableProvider();
  mockSend.mockResolvedValue(ROUTE_RESPONSE);

  const [first, second] = await Promise.all([
    provider.calculateRoute({ origin: [0, 0], destination: [1, 1], travelMode: 'Car' }),
    provider.calculateRoute({ origin: [0, 0], destination: [1, 1], travelMode: 'Car' }),
  ]);

  expect(second).toEqual(first);
  expect(mockSend).toHaveBeenCalledTimes(1);
});

test('does not reuse a cached route for a different travel mode', async () => {
  enableProvider();
  mockSend.mockResolvedValue(ROUTE_RESPONSE);

  await provider.calculateRoute({ origin: [0, 0], destination: [1, 1], travelMode: 'Car' });
  await provider.calculateRoute({ origin: [0, 0], destination: [1, 1], travelMode: 'Truck' });

  expect(mockSend).toHaveBeenCalledTimes(2);
});

test('recalculates after the route cache TTL expires', async () => {
  jest.useFakeTimers();
  try {
    enableProvider();
    mockSend.mockResolvedValue(ROUTE_RESPONSE);

    await provider.calculateRoute({ origin: [0, 0], destination: [1, 1], travelMode: 'Car' });
    expect(mockSend).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(provider.ROUTE_CACHE_TTL_MS + 1);
    await provider.calculateRoute({ origin: [0, 0], destination: [1, 1], travelMode: 'Car' });
    expect(mockSend).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

test('does not cache a failed route lookup', async () => {
  enableProvider();
  mockSend.mockResolvedValueOnce({ Routes: [] });
  mockSend.mockResolvedValueOnce(ROUTE_RESPONSE);

  await expect(provider.calculateRoute({ origin: [0, 0], destination: [1, 1], travelMode: 'Car' })).resolves.toBeNull();
  const second = await provider.calculateRoute({ origin: [0, 0], destination: [1, 1], travelMode: 'Car' });
  expect(second).not.toBeNull();
  expect(mockSend).toHaveBeenCalledTimes(2);
});
