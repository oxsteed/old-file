'use strict';

/**
 * Regression: a bad require path in server code (e.g. launchGate -> ./logger)
 * must fail CI. Full index.js load is exercised in CI via node -e require('./index');
 * here we avoid pulling the entire realtime stack under the Jest socketService mock.
 */
describe('server boot-critical module graph', () => {
  test('launch gate and logger import chain loads', () => {
    expect(() => {
      require('../middleware/launchGate');
      require('../utils/logger');
      require('../controllers/businessPublicSignalsController');
      require('../realtime/chatNamespace');
    }).not.toThrow();
  });
});
