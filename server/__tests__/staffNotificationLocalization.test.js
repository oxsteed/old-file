'use strict';

// S-19: staff push/email/in-app bodies render in the recipient's language
// with localized role names, without the English caller text appended.

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/socketService', () => ({ broadcastToUser: jest.fn() }));
jest.mock('../services/webPushService', () => ({ isConfigured: jest.fn().mockReturnValue(false), sendToUser: jest.fn() }));
jest.mock('../services/mobilePushService', () => ({ isConfigured: jest.fn().mockReturnValue(false), sendToUser: jest.fn() }));

const db = require('../db');
const { sendNotification } = require('../services/notificationService');
const { tNotif } = require('../utils/i18n');
const { staffNotifications, staffRoleName, staffDecisionName } = require('../utils/staffNotificationTemplates');

const LANGS = ['en', 'es', 'fr', 'ht', 'ar'];

beforeEach(() => {
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

function insertedNotification() {
  const call = db.query.mock.calls.find(([sql]) => /INSERT INTO notifications/.test(sql));
  return call ? call[1] : null;
}

test('every staff template has all five languages and the same placeholders', () => {
  for (const [type, entry] of Object.entries(staffNotifications)) {
    for (const field of ['title', 'body']) {
      const en = (entry[field].en.match(/\{\w+\}/g) || []).sort();
      for (const lang of LANGS) {
        expect(typeof entry[field][lang]).toBe('string');
        expect((entry[field][lang].match(/\{\w+\}/g) || []).sort()).toEqual(en);
      }
    }
    expect(type).toMatch(/^[a-z_]+$/);
  }
});

test('role codes and time-off decisions are localized', () => {
  expect(staffRoleName('support_agent', 'es')).toBe('agente de soporte');
  expect(staffRoleName('manager', 'ht')).toBe('manadjè');
  expect(staffDecisionName('approved', 'fr')).toBe('approuvée');
  expect(staffDecisionName('rejected', 'en')).toBe('declined');
});

test('a Spanish employee gets a Spanish invite body with no English appended', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ email: null, first_name: 'A', is_banned: false, preferred_language: 'es' }] })
    .mockResolvedValue({ rows: [{ id: 'n-1' }], rowCount: 1 });
  await sendNotification({
    userId: 'u-1',
    type: 'member_invite',
    title: 'You have been invited to join Taco Spot',
    body: 'You have been invited to join "Taco Spot" as a support_agent.',
    data: { params: { businessName: 'Taco Spot', role: 'support_agent' } },
  });
  const params = insertedNotification();
  expect(params).toBeTruthy();
  const flat = params.filter((p) => typeof p === 'string' && !p.startsWith('{')).join(' | ');
  expect(flat).toContain('Te han invitado a unirte a "Taco Spot" como agente de soporte.');
  expect(flat).not.toContain('You have been invited');
  expect(flat).not.toContain('support_agent');
});

test('time-off decision renders per language from params', () => {
  const fr = tNotif('time_off_decided', 'fr', { decision: staffDecisionName('rejected', 'fr'), startDate: '2026-11-01', endDate: '2026-11-03' });
  expect(fr.body).toBe('Votre demande du 2026-11-01 au 2026-11-03 a été refusée.');
  const ar = tNotif('crew_shift_published', 'ar', { count: 2, businessName: 'X', shiftLabel: 'Mon' });
  expect(ar.body).toContain('X');
  expect(ar.body).not.toMatch(/\{\w+\}/);
});

test('types without a parameterized template keep the caller body', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ email: null, first_name: 'A', is_banned: false, preferred_language: 'es' }] })
    .mockResolvedValue({ rows: [{ id: 'n-2' }], rowCount: 1 });
  await sendNotification({ userId: 'u-2', type: 'unknown_type_x', title: 'T', body: 'Specific body', data: { params: { a: 1 } } });
  const flat = insertedNotification().filter((p) => typeof p === 'string').join(' | ');
  expect(flat).toContain('Specific body');
});

test('business invite email labels employees with their own role, not representative', async () => {
  jest.isolateModules(() => {
    const email = jest.requireActual('../utils/email');
    expect(typeof email.sendBusinessInviteEmail).toBe('function');
  });
  const src = require('fs').readFileSync(require.resolve('../utils/email'), 'utf8');
  expect(src).toMatch(/staffRoleName\(options\.role, lang\)/);
});
