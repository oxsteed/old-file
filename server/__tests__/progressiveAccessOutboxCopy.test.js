'use strict';

// WP-020: every shipped locale has safe copy for every access event.
const fs = require('fs');
const path = require('path');
const { buildMessage, COPY, CAPABILITY_LABELS } = require('../services/access/outboxWorker');

const LOCALES = fs.readdirSync(path.join(__dirname, '..', '..', 'client', 'src', 'i18n', 'locales'))
  .filter((d) => /^[a-z]{2}$/.test(d));
const EVENTS = Object.keys(COPY.en);
const CAPS = Object.keys(CAPABILITY_LABELS.en);

describe('access notification copy (WP-020)', () => {
  test('covers all 20 client locales', () => {
    expect(LOCALES.length).toBe(20);
    for (const l of LOCALES) {
      expect(Object.keys(COPY[l] || {}).sort()).toEqual([...EVENTS].sort());
      expect(Object.keys(CAPABILITY_LABELS[l] || {}).sort()).toEqual([...CAPS].sort());
    }
  });

  test('messages are translated, interpolate a label and never leak a raw key', () => {
    for (const l of LOCALES) {
      for (const e of EVENTS) {
        for (const c of CAPS) {
          const m = buildMessage(e, c, l);
          expect(m.title).toBeTruthy();
          expect(m.body).toContain(CAPABILITY_LABELS[l][c]);
          expect(m.body).not.toContain(c);
          expect(m.body).not.toMatch(/\$\{|\{\{|undefined/);
          if (l !== 'en') expect(m.body).not.toBe(buildMessage(e, c, 'en').body);
        }
      }
    }
  });

  test('unknown language falls back to English; unknown event yields nothing', () => {
    expect(buildMessage('access_request.approved', 'helper.offer_services', 'xx')).toEqual(buildMessage('access_request.approved', 'helper.offer_services', 'en'));
    expect(buildMessage('nope', 'helper.offer_services', 'en')).toBeNull();
  });
});
