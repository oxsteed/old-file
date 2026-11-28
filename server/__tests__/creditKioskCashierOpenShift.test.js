'use strict';
// G13-B7 (D-762): a concurrent shift double-open races the
// SELECT-then-INSERT in openShift; the loser hits the one-open-per-device
// unique index (23505) and must get the existing open shift, not a raw 500.
const { openShift } = require('../services/creditKioskCashier');

const device = { id: 11, restaurant_id: 22, location_id: null };
const shiftRow = {
  id: 'shift-race-1',
  device_id: 11,
  restaurant_id: 22,
  location_id: null,
  status: 'open',
  opened_at: '2026-11-28T12:00:00.000Z',
  closed_at: null,
  opening_cash_cents: null,
  closeout: null,
};

function racingClient({ insertError = null, racedRow = shiftRow } = {}) {
  let calls = 0;
  return {
    calls: () => calls,
    query: async (sql) => {
      calls += 1;
      if (String(sql).includes('INSERT INTO oxsteed_credit_kiosk_shifts')) {
        if (insertError) throw insertError;
        return { rows: [shiftRow] };
      }
      if (String(sql).includes('FROM oxsteed_credit_kiosk_shifts')) {
        // First SELECT sees no open shift; the re-read after a 23505
        // sees the winner's row.
        return { rows: calls >= 3 ? [racedRow] : [] };
      }
      throw new Error(`unexpected query: ${String(sql).slice(0, 60)}`);
    },
  };
}

test('a 23505 on the shift insert returns the existing open shift', async () => {
  const client = racingClient({ insertError: Object.assign(new Error('duplicate key'), { code: '23505' }) });
  const result = await openShift(client, { device });
  expect(result.alreadyOpen).toBe(true);
  expect(result.shift.id).toBe('shift-race-1');
  expect(result.shift.status).toBe('open');
  expect(client.calls()).toBe(3);
});

test('a non-23505 insert error still propagates', async () => {
  const client = racingClient({ insertError: Object.assign(new Error('boom'), { code: '40001' }) });
  await expect(openShift(client, { device })).rejects.toThrow('boom');
  expect(client.calls()).toBe(2);
});

test('a 23505 with no open shift on re-read rethrows the original error', async () => {
  const client = racingClient({
    insertError: Object.assign(new Error('duplicate key'), { code: '23505' }),
    racedRow: null,
  });
  await expect(openShift(client, { device })).rejects.toThrow('duplicate key');
});
