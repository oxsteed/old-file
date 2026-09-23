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
