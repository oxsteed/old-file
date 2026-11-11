'use strict';

const { getAppleAppAssociation } = require('../services/appleAppAssociation');

describe('Apple app association contract', () => {
  test('uses the configured team ID for both universal links and credentials', () => {
    expect(getAppleAppAssociation({ teamId: 'TEAM123' })).toEqual({
      applinks: {
        apps: [],
        details: [{ appID: 'TEAM123.com.oxsteed.app', paths: ['*'] }],
      },
      webcredentials: { apps: ['TEAM123.com.oxsteed.app'] },
    });
  });

  test('falls back to the documented default when configuration is blank', () => {
    const association = getAppleAppAssociation({ teamId: '   ' });
    expect(association.applinks.details[0].appID).toBe('ZBRGSDRRU7.com.oxsteed.app');
    expect(association.webcredentials.apps).toEqual(['ZBRGSDRRU7.com.oxsteed.app']);
  });
});
