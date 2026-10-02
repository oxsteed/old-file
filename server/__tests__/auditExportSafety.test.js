'use strict';

jest.mock('../services/auditService', () => ({
  getUserActionLogs: jest.fn().mockResolvedValue({
    rows: [{ created_at: '2026-09-29T00:00:00.000Z', admin_email: '=formula@example.com', old_value: '@unsafe' }],
    total: 1,
  }),
}));

const auditController = require('../controllers/auditController');

function responseDouble() {
  return {
    setHeader: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

test('audit CSV exports neutralize spreadsheet formulas and disable caching', async () => {
  const res = responseDouble();
  // E05: the export resolves the caller's scope; super-admin = global.
  await auditController.exportUserActions({ query: {}, isSuper: true }, res);

  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
  const body = res.write.mock.calls.map(([value]) => value).join('');
  expect(body).toContain("'=formula@example.com");
  expect(body).toContain("'@unsafe");
});
