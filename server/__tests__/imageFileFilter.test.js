'use strict';

const imageFileFilter = require('../middleware/imageFileFilter');

describe('image file filter', () => {
  test('accepts supported image MIME types', () => {
    const cb = jest.fn();
    imageFileFilter({}, { mimetype: 'image/webp' }, cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  test('returns a structured 400 application error for unsupported types', () => {
    const cb = jest.fn();
    imageFileFilter({}, { mimetype: 'application/pdf' }, cb);
    const [error, accepted] = cb.mock.calls[0];
    expect(accepted).toBeUndefined();
    expect(error).toMatchObject({
      status: 400,
      code: 'invalid_file_type',
      message: 'Invalid file type. Only JPEG, PNG, and WebP are allowed.',
    });
  });
});
