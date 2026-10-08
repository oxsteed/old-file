'use strict';

const { launchGate, _resolveRequestPath } = require('../middleware/launchGate');

function mockReq({ baseUrl = '', path = '', originalUrl } = {}) {
  return { baseUrl, path, originalUrl, method: 'GET' };
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn(() => res);
  return res;
}

describe('launchGate middleware', () => {
  const prevDisabled = process.env.LAUNCH_GATE_DISABLED;

  afterEach(() => {
    process.env.LAUNCH_GATE_DISABLED = prevDisabled;
  });

  beforeEach(() => {
    delete process.env.LAUNCH_GATE_DISABLED;
  });

  test('_resolveRequestPath joins mount baseUrl and relative path', () => {
    expect(_resolveRequestPath(mockReq({
      baseUrl: '/api/templates',
      path: '/user-list',
    }))).toBe('/api/templates/user-list');
  });

  test('blocks user-facing templates API with 404', () => {
    const gate = launchGate();
    const req = mockReq({ baseUrl: '/api/templates', path: '/catalog' });
    const res = mockRes();
    const next = jest.fn();
    gate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows admin templates path through', () => {
    const gate = launchGate();
    const req = mockReq({ baseUrl: '/api/templates', path: '/admin/preview' });
    const res = mockRes();
    const next = jest.fn();
    gate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('LAUNCH_GATE_DISABLED bypasses the gate', () => {
    process.env.LAUNCH_GATE_DISABLED = 'true';
    const gate = launchGate();
    const req = mockReq({ baseUrl: '/api/templates', path: '/catalog' });
    const res = mockRes();
    const next = jest.fn();
    gate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
