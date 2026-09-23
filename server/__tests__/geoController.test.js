jest.mock('../services/geoProviderService', () => ({
  nearby: jest.fn(),
  reverse: jest.fn(),
  suggest: jest.fn(),
}));

jest.mock('../services/geoRouteProviderService', () => ({
  calculateMatrix: jest.fn(),
  calculateRoute: jest.fn(),
}));

const geoProvider = require('../services/geoProviderService');
const routeProvider = require('../services/geoRouteProviderService');
const controller = require('../controllers/geoController');

function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.GOOGLE_MAPS_API_KEY;
});

test('uses AWS suggestions without requiring a Google key', async () => {
  geoProvider.suggest.mockResolvedValueOnce([{ city: 'Springfield', state: 'OH', lat: 39.9, lng: -83.8 }]);
  const res = response();
  await controller.suggest({ query: { q: 'Springfield, OH' } }, res);
  expect(res.json).toHaveBeenCalledWith([{ city: 'Springfield', state: 'OH', lat: 39.9, lng: -83.8 }]);
});

test('uses manual suggestions when both providers are unavailable', async () => {
  geoProvider.suggest.mockResolvedValueOnce(null);
  const res = response();
  await controller.suggest({ query: { q: 'Springfield, OH 45501' } }, res);
  expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ city: 'Springfield', state: 'OH', zip: '45501' })]);
});

test('returns an AWS route when enabled and a local route when unavailable', async () => {
  const req = { body: { origin: { lat: 39.9, lng: -83.8 }, destination: { lat: 39.91, lng: -83.81 } } };
  routeProvider.calculateRoute.mockResolvedValueOnce({ provider: 'aws', distanceMeters: 100, durationSeconds: 10 });
  const awsResponse = response();
  await controller.route(req, awsResponse);
  expect(awsResponse.json).toHaveBeenCalledWith({ route: { provider: 'aws', distanceMeters: 100, durationSeconds: 10 } });

  routeProvider.calculateRoute.mockResolvedValueOnce(null);
  const fallbackResponse = response();
  await controller.route({
    body: { origin: { lat: 39.9, lng: -83.8 }, destination: { lat: 39.92, lng: -83.82 } },
  }, fallbackResponse);
  expect(fallbackResponse.json.mock.calls[0][0].route).toEqual(expect.objectContaining({ provider: 'haversine', fallback: true }));
});

test('rejects unsupported Amazon route travel modes before calling the provider', async () => {
  const res = response();
  await controller.route({ body: {
    origin: [0, 0],
    destination: [1, 1],
    travelMode: 'Transit',
  } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(routeProvider.calculateRoute).not.toHaveBeenCalled();
});

test('bounds route matrices to the supported request cell count', async () => {
  const res = response();
  await controller.routeMatrix({ body: {
    origins: Array.from({ length: 11 }, (_, index) => [index, 0]),
    destinations: Array.from({ length: 10 }, (_, index) => [index, 1]),
  } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(routeProvider.calculateMatrix).not.toHaveBeenCalled();
});
