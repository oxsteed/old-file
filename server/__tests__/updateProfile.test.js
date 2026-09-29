'use strict';

const { mockQuery, resetMocks } = require('./setup');

const authCtrl = require('../controllers/authController');

function mockResponse() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const USER_ID = '00000000-0000-4000-8000-000000000333';

function mockReq(body) {
  return {
    user: { id: USER_ID, role: 'customer' },
    body: body || {},
  };
}

function queueUpdateResult(row) {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })      // BEGIN
    .mockResolvedValueOnce({ rows: [row] })  // UPDATE ... RETURNING *
    .mockResolvedValueOnce({ rows: [] });    // COMMIT
}

function baseRow(overrides) {
  return Object.assign(
    {
      id: USER_ID,
      first_name: 'Alex',
      last_name: 'Smith',
      email: 'alex@example.com',
      phone: null,
      bio: null,
      profile_photo_url: null,
      role: 'customer',
      zip_code: null,
      display_name_preference: 'first_name',
      preferred_language: null,
    },
    overrides
  );
}

function updateCall() {
  const calls = mockQuery.mock.calls.filter((c) => /UPDATE users/i.test(c[0]));
  expect(calls.length).toBe(1);
  return { text: calls[0][0], params: calls[0][1] };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('updateProfile bio', () => {
  test('accepts and trims bio, stores it, returns it in user object', async () => {
    const res = mockResponse();
    queueUpdateResult(baseRow({ bio: 'Helper for hire.' }));
    await authCtrl.updateProfile(mockReq({ bio: '  Helper for hire.  ' }), res);

    const { text, params } = updateCall();
    expect(text).toMatch(/bio = \$\d+/);
    expect(params).toContain('Helper for hire.');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        user: expect.objectContaining({ bio: 'Helper for hire.' }),
      })
    );
  });

  test('rejects bio longer than 500 chars with 400 and issues no queries', async () => {
    const res = mockResponse();
    await authCtrl.updateProfile(mockReq({ bio: 'x'.repeat(501) }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'bio_too_long' }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('empty bio clears the stored bio', async () => {
    const res = mockResponse();
    queueUpdateResult(baseRow({ bio: null }));
    await authCtrl.updateProfile(mockReq({ bio: '   ' }), res);
    const { params } = updateCall();
    expect(params).toContain(null);
  });

  test('omitted bio leaves the stored bio untouched', async () => {
    const res = mockResponse();
    queueUpdateResult(baseRow({ bio: 'Keep me' }));
    await authCtrl.updateProfile(mockReq({ phone: '555-0100' }), res);
    const { text } = updateCall();
    expect(text).not.toMatch(/bio = /);
  });
});

describe('updateProfile profile_photo_url', () => {
  test('accepts a valid https URL and stores it', async () => {
    const res = mockResponse();
    queueUpdateResult(baseRow({ profile_photo_url: 'https://cdn.example.com/p.jpg' }));
    await authCtrl.updateProfile(mockReq({ profile_photo_url: 'https://cdn.example.com/p.jpg' }), res);
    const { text, params } = updateCall();
    expect(text).toMatch(/profile_photo_url = \$\d+/);
    expect(params).toContain('https://cdn.example.com/p.jpg');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ profile_photo_url: 'https://cdn.example.com/p.jpg' }),
      })
    );
  });

  test('rejects non-http URL with 400 and issues no queries', async () => {
    const res = mockResponse();
    await authCtrl.updateProfile(mockReq({ profile_photo_url: 'ftp://evil.example.com/p.jpg' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_profile_photo_url' }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects URL without protocol with 400', async () => {
    const res = mockResponse();
    await authCtrl.updateProfile(mockReq({ profile_photo_url: 'cdn.example.com/p.jpg' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects URL longer than 500 chars with 400', async () => {
    const res = mockResponse();
    await authCtrl.updateProfile(
      mockReq({ profile_photo_url: 'https://example.com/' + 'x'.repeat(490) }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('empty string clears the stored photo URL', async () => {
    const res = mockResponse();
    queueUpdateResult(baseRow({ profile_photo_url: null }));
    await authCtrl.updateProfile(mockReq({ profile_photo_url: '' }), res);
    const { text } = updateCall();
    expect(text).toMatch(/profile_photo_url = NULL/);
  });

  test('omitted photo URL leaves it untouched', async () => {
    const res = mockResponse();
    queueUpdateResult(baseRow({ profile_photo_url: 'https://cdn.example.com/old.jpg' }));
    await authCtrl.updateProfile(mockReq({ phone: '555-0100' }), res);
    const { text } = updateCall();
    expect(text).not.toMatch(/profile_photo_url/);
  });
});

describe('updateProfile existing fields still work', () => {
  test('phone update works alongside bio and photo', async () => {
    const res = mockResponse();
    queueUpdateResult(baseRow({ phone: '555-0100', bio: 'Hi', profile_photo_url: 'https://cdn.example.com/p.jpg' }));
    await authCtrl.updateProfile(
      mockReq({ phone: '555-0100', bio: 'Hi', profile_photo_url: 'https://cdn.example.com/p.jpg' }),
      res
    );
    const { params } = updateCall();
    expect(params[0]).toBe('555-0100');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('updateProfile address', () => {
  test('accepts a full address, trims and normalizes it', async () => {
    const res = mockResponse();
    queueUpdateResult(baseRow({ address_line1: '123 Main St', city: 'Springfield', state: 'IL', zip_code: '62701', country: 'US' }));
    await authCtrl.updateProfile(
      mockReq({
        address_line1: '  123 Main St ',
        address_line2: '',
        city: 'Springfield',
        state: 'il',
        country: 'us',
        zip_code: '62701',
      }),
      res
    );

    const { text, params } = updateCall();
    expect(text).toMatch(/address_line1 = \$\d+/);
    expect(text).toMatch(/address_line2 = NULL/);
    expect(text).toMatch(/city = \$\d+/);
    expect(text).toMatch(/state = \$\d+/);
    expect(text).toMatch(/zip_code = \$\d+/);
    expect(text).toMatch(/country = \$\d+/);
    expect(params).toContain('123 Main St');
    expect(params).toContain('Springfield');
    expect(params).toContain('IL');
    expect(params).toContain('62701');
    expect(params).toContain('US');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        user: expect.objectContaining({ address_line1: '123 Main St', country: 'US' }),
      })
    );
  });

  test('rejects an unsupported country with 400 and issues no queries', async () => {
    const res = mockResponse();
    await authCtrl.updateProfile(mockReq({ country: 'XX' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_country' }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects an empty country with 400', async () => {
    const res = mockResponse();
    await authCtrl.updateProfile(mockReq({ country: '   ' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_country' }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects a state that is not valid for the country with 400', async () => {
    const res = mockResponse();
    await authCtrl.updateProfile(mockReq({ country: 'US', state: 'Ontario' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_state' }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects a postal code that does not match the country format with 400', async () => {
    const res = mockResponse();
    await authCtrl.updateProfile(mockReq({ country: 'US', zip_code: 'not-a-zip' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_postal_code' }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects address_line1 longer than 255 chars with 400', async () => {
    const res = mockResponse();
    await authCtrl.updateProfile(mockReq({ address_line1: 'x'.repeat(256) }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'address_line1_too_long' }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('empty address_line2 clears the stored value', async () => {
    const res = mockResponse();
    queueUpdateResult(baseRow({ address_line2: null }));
    await authCtrl.updateProfile(mockReq({ address_line2: '   ' }), res);
    const { text } = updateCall();
    expect(text).toMatch(/address_line2 = NULL/);
  });

  test('omitted address fields leave stored values untouched', async () => {
    const res = mockResponse();
    queueUpdateResult(baseRow({ phone: '555-0100' }));
    await authCtrl.updateProfile(mockReq({ phone: '555-0100' }), res);
    const { text } = updateCall();
    expect(text).not.toMatch(/address_line1/);
    expect(text).not.toMatch(/address_line2/);
    expect(text).not.toMatch(/city = /);
    expect(text).not.toMatch(/state = /);
    expect(text).not.toMatch(/zip_code = /);
    expect(text).not.toMatch(/country = /);
  });

  test('validates state against the stored country when country is omitted', async () => {
    const res = mockResponse();
    const req = mockReq({ state: 'Ontario' });
    req.user.country = 'US';
    await authCtrl.updateProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_state' }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('accepts a free-text state for a country without a region list', async () => {
    const res = mockResponse();
    queueUpdateResult(baseRow({ city: 'Port-au-Prince', state: 'Ouest', country: 'HT' }));
    await authCtrl.updateProfile(
      mockReq({ city: 'Port-au-Prince', state: 'Ouest', country: 'HT' }),
      res
    );
    const { params } = updateCall();
    expect(params).toContain('Ouest');
    expect(params).toContain('HT');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
