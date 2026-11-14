'use strict';

// Notifications audit item 7 follow-up: registerOversightActions used to
// skip a missing licence-oversight module silently (continue with no log),
// so a deleted or renamed module left the oversight actions unregistered
// behind a green startup. A skip must warn.

describe('oversight actions silent skip (audit item 7 follow-up)', () => {
  test('a missing module logs a warning instead of skipping silently', () => {
    jest.resetModules();
    const logger = require('../utils/logger');
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const error = new Error("Cannot find module './safeguardingService'");
    error.code = 'MODULE_NOT_FOUND';
    jest.doMock('../services/creditCompliance/safeguardingService', () => { throw error; });
    try {
      const { registerOversightActions } = require('../services/creditCompliance/oversightActions');
      const seen = [];
      expect(() => registerOversightActions((name) => seen.push(name))).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        'credit_oversight.module_missing',
        expect.objectContaining({ module: './safeguardingService' })
      );
      // The other modules still register their actions.
      expect(seen.length).toBeGreaterThan(0);
    } finally {
      warnSpy.mockRestore();
      jest.dontMock('../services/creditCompliance/safeguardingService');
      jest.resetModules();
    }
  });
});
