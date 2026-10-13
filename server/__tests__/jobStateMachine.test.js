'use strict';
require('./setup');
const { VALID_TRANSITIONS } = require('../models/jobModel');

test('published jobs go straight to accepted; legacy states fold back (P1-135)', () => {
  expect(VALID_TRANSITIONS.published).toContain('accepted');
  expect(VALID_TRANSITIONS.published).not.toContain('matched');
  expect(VALID_TRANSITIONS.matched).toEqual(expect.arrayContaining(['published', 'accepted']));
  expect(VALID_TRANSITIONS.negotiating).toEqual(expect.arrayContaining(['published', 'accepted']));
});
