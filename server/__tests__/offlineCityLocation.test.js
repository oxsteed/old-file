const { reverse } = require('../services/offlineCityLocation');

test('finds an approximate nearby city and US region without a provider', () => {
  expect(reverse(39.924, -83.808)).toEqual({
    city: 'Springfield', state: 'OH', display: 'Springfield, OH', approximate: true, provider: 'offline',
  });
});

test('preserves international region names', () => {
  expect(reverse(48.857, 2.352)).toMatchObject({ city: 'Paris', state: 'Île-de-France', approximate: true });
});

test.each([[0, 0], [-50, -140], [91, 0], [0, 181], [NaN, 1], [1, Infinity], ['39.924', -83.808]])(
  'does not invent a city for invalid or distant coordinates %s,%s', (lat, lng) => {
    expect(reverse(lat, lng)).toBeNull();
  },
);
