const mockSend = jest.fn();

jest.mock('@aws-sdk/client-geo-places', () => ({
  GeoPlacesClient: jest.fn(() => ({ send: mockSend })),
  SearchTextCommand: jest.fn((input) => ({ operation: 'SearchText', input })),
  ReverseGeocodeCommand: jest.fn((input) => ({ operation: 'ReverseGeocode', input })),
}));

const {
  GeoPlacesClient,
  SearchTextCommand,
  ReverseGeocodeCommand,
} = require('@aws-sdk/client-geo-places');
const geoProvider = require('../services/geoProviderService');

const originalEnv = {
  AWS_GEO_PLACES_ENABLED: process.env.AWS_GEO_PLACES_ENABLED,
  AWS_GEO_PLACES_LANGUAGE: process.env.AWS_GEO_PLACES_LANGUAGE,
  AWS_REGION: process.env.AWS_REGION,
};

afterEach(() => {
  mockSend.mockReset();
  GeoPlacesClient.mockClear();
  SearchTextCommand.mockClear();
  ReverseGeocodeCommand.mockClear();
  geoProvider.resetForTests();
  for (const [key, value] of Object.entries({
    AWS_GEO_PLACES_ENABLED: originalEnv.AWS_GEO_PLACES_ENABLED,
    AWS_GEO_PLACES_LANGUAGE: originalEnv.AWS_GEO_PLACES_LANGUAGE,
    AWS_REGION: originalEnv.AWS_REGION,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('keeps Amazon Location opt-in when no provider is configured', async () => {
  delete process.env.AWS_GEO_PLACES_ENABLED;
  process.env.AWS_REGION = 'us-east-1';

  await expect(geoProvider.suggest('Springfield, OH')).resolves.toBeNull();
  expect(GeoPlacesClient).not.toHaveBeenCalled();
});

test('maps Amazon Location text search into the existing geo contract', async () => {
  process.env.AWS_GEO_PLACES_ENABLED = 'true';
  process.env.AWS_REGION = 'us-east-1';
  process.env.AWS_GEO_PLACES_LANGUAGE = 'en-US';
  mockSend.mockResolvedValueOnce({
    ResultItems: [{
      Title: 'Springfield, Ohio',
      Address: {
        Label: 'Springfield, OH 45501, United States',
        Locality: 'Springfield',
        Region: { Code: 'OH', Name: 'Ohio' },
        PostalCode: '45501',
        Country: { Code2: 'US', Name: 'United States' },
      },
      Position: [-83.8088, 39.9242],
    }],
  });

  await expect(geoProvider.suggest('Springfield, OH')).resolves.toEqual([{
    display: 'Springfield, OH 45501, United States',
    city: 'Springfield',
    state: 'OH',
    zip: '45501',
    country: 'US',
    lat: 39.9242,
    lng: -83.8088,
  }]);
  expect(SearchTextCommand).toHaveBeenCalledWith({
    QueryText: 'Springfield, OH',
    MaxResults: 5,
    Language: 'en-US',
    IntendedUse: 'Storage',
  });
});

test('reverse geocodes browser coordinates without persisting the response', async () => {
  process.env.AWS_GEO_PLACES_ENABLED = 'true';
  process.env.AWS_REGION = 'us-east-1';
  mockSend.mockResolvedValueOnce({
    ResultItems: [{
      Address: { Locality: 'Springfield', Region: { Code: 'OH' }, Country: { Code2: 'US' } },
      Position: [-83.8088, 39.9242],
    }],
  });

  await expect(geoProvider.reverse(39.9242, -83.8088)).resolves.toMatchObject({
    display: 'Springfield, OH, US',
    city: 'Springfield',
    state: 'OH',
    country: 'US',
    lat: 39.9242,
    lng: -83.8088,
  });
  expect(ReverseGeocodeCommand).toHaveBeenCalledWith({
    QueryPosition: [-83.8088, 39.9242],
    MaxResults: 1,
    Language: 'en',
    IntendedUse: 'SingleUse',
  });
});
