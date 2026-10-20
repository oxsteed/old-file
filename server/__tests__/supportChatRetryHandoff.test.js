'use strict';

// AI support chat review bug #4: a retried send must not look like the user
// repeating themselves, so it never trips the handoff heuristic.

require('./setup');
const { _shouldSuggestHandoff: shouldSuggestHandoff } = require('../controllers/chatController');

test('a retry (same user turn twice, no reply between) does not suggest handoff', () => {
  expect(shouldSuggestHandoff([
    { role: 'user', content: 'How do I post a job?' },
    { role: 'user', content: 'How do I post a job?' },
  ])).toBe(false);
  expect(shouldSuggestHandoff([
    { role: 'user', content: 'How do I post a job?' },
    { role: 'user', content: '  how do I   post a job? ' },
    { role: 'user', content: 'How do I post a job?' },
  ])).toBe(false);
});

test('retries do not inflate the turn count', () => {
  const history = [];
  for (const q of ['a question', 'second', 'third']) {
    history.push({ role: 'user', content: q }, { role: 'user', content: q }, { role: 'assistant', content: 'ok' });
  }
  expect(shouldSuggestHandoff(history)).toBe(false);
});

test('asking the same thing again after an answer still suggests handoff', () => {
  expect(shouldSuggestHandoff([
    { role: 'user', content: 'Where is my payout?' },
    { role: 'assistant', content: 'Check /wallet.' },
    { role: 'user', content: 'Where is my payout?' },
  ])).toBe(true);
});

test('negative sentiment and long conversations still suggest handoff', () => {
  expect(shouldSuggestHandoff([{ role: 'user', content: 'this is useless' }])).toBe(true);
  const long = [];
  for (let i = 0; i < 4; i += 1) long.push({ role: 'user', content: `q${i}` }, { role: 'assistant', content: 'a' });
  expect(shouldSuggestHandoff(long)).toBe(true);
});
