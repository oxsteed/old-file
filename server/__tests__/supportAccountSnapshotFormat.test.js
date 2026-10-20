'use strict';

// AI support chat review bug #7: snapshot money uses Intl in the user's
// locale (no "$" glued onto other currencies), and the active-jobs count
// leaves out drafts, expired jobs and soft-deleted rows.

const { mockQuery, resetMocks } = require('./setup');
const {
  getSupportAccountSnapshot,
  formatSnapshotForAI,
  formatMinorAmount,
  ACTIVE_CUSTOMER_JOBS_SQL,
} = require('../services/supportAccountSnapshot');

beforeEach(() => { resetMocks(); require('../services/supportAccountSnapshot')._resetSnapshotCacheForTests(); });

describe('formatMinorAmount', () => {
  test('formats in the currency and locale instead of "$" + code', () => {
    expect(formatMinorAmount(1250, 'USD', 'en')).toBe('$12.50');
    const eur = formatMinorAmount(1250, 'EUR', 'fr');
    expect(eur).toMatch(/12,50/);
    expect(eur).toContain('€');
    expect(eur).not.toContain('$');
    expect(formatMinorAmount(1250, 'EUR', 'en')).toBe('€12.50');
  });

  test('uses each locale of the widget', () => {
    expect(formatMinorAmount(1250, 'USD', 'es')).toMatch(/12,50/);
    expect(formatMinorAmount(1250, 'USD', 'ht')).toMatch(/12,50/);
    expect(formatMinorAmount(1250, 'USD', 'ar')).toMatch(/12[.,٫]50|١٢٫٥٠/);
  });

  test('respects zero-decimal currencies and unknown codes', () => {
    expect(formatMinorAmount(1250, 'JPY', 'en')).toBe('¥1,250');
    expect(formatMinorAmount(1250, 'NOPE1', 'en')).toBe('12.50 NOPE1');
    expect(formatMinorAmount('abc', 'USD', 'en')).toBeNull();
  });
});

test('active jobs SQL excludes drafts, expired and soft-deleted jobs', () => {
  expect(ACTIVE_CUSTOMER_JOBS_SQL).toMatch(/deleted_at IS NULL/);
  expect(ACTIVE_CUSTOMER_JOBS_SQL).toMatch(/status::text NOT IN \('draft', 'expired', 'completed', 'cancelled', 'closed'\)/);
  expect(ACTIVE_CUSTOMER_JOBS_SQL).toMatch(/expires_at <= NOW\(\)/);
});

test('snapshot formats wallet and payout money in the requested language', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/oxsteed_credit_accounts/.test(sql)) return { rows: [{ balance_cents: 1250, currency_code: 'EUR' }] };
    if (/main_app_payout_requests/.test(sql)) {
      return { rows: [{ amount_cents: 4000, currency_code: 'USD', payout_method: 'bank', status: 'pending', requested_at: '2026-10-18', processed_at: null }] };
    }
    if (/FROM jobs/.test(sql)) return { rows: [{ n: 1 }] };
    return { rows: [{ n: 0 }] };
  });
  const snap = await getSupportAccountSnapshot('u1', { language: 'fr' });
  expect(snap.credit.balance).toMatch(/12,50\s€/);
  expect(snap.credit.currency).toBe('EUR');
  expect(snap.latestPayout.amount).toMatch(/40,00/);
  const jobsCall = mockQuery.mock.calls.find(([sql]) => /FROM jobs/.test(sql));
  expect(jobsCall[0]).toBe(ACTIVE_CUSTOMER_JOBS_SQL);

  const text = formatSnapshotForAI(snap);
  expect(text).toMatch(/OxSteed Credit balance: 12,50\s€ \(EUR\)/);
  expect(text).not.toMatch(/\$12/);
});
