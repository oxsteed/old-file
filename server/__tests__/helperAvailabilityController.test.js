'use strict';

// BACKEND-2J regression: saving 2+ availability slots built INSERT placeholders
// with stride 4 (i * 4) while binding 3 params per slot, skipping $5 and
// making Postgres fail with "could not determine data type of parameter $5".
// The placeholders must be sequential ($1..$6 for two slots).

const { mockQuery, resetMocks } = require('./setup');
const availabilityController = require('../controllers/helperAvailabilityController');

const HELPER_ID = '11111111-1111-4111-8111-111111111111';

function reqWith(slots) {
  return { user: { id: HELPER_ID }, body: { slots } };
}

function resMock() {
  const res = {};
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  resetMocks();
});

describe('helperAvailabilityController.setTemplate', () => {
  test('saves 2 slots with sequential $1..$6 placeholders', async () => {
    const req = reqWith([
      { day_of_week: 1, start_time: '09:00', end_time: '12:00' },
      { day_of_week: 2, start_time: '13:00', end_time: '17:00' },
    ]);
    const res = resMock();
    const next = jest.fn();

    await availabilityController.setTemplate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ template: [] });

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      /INSERT INTO helper_availability/.test(sql)
    );
    expect(insertCall).toBeDefined();
    const [sql, params] = insertCall;

    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    // $1 (helper_id) is reused in every row tuple; the 3 bound params per slot
    // must follow sequentially: $2..$4 for slot 1, $5..$7 for slot 2.
    expect(placeholders).toEqual([1, 2, 3, 4, 1, 5, 6, 7]);
    expect(params).toEqual([HELPER_ID, 1, '09:00', '12:00', 2, '13:00', '17:00']);
  });

  test('saves 3 slots with sequential $1..$10 placeholders', async () => {
    const req = reqWith([
      { day_of_week: 1, start_time: '09:00', end_time: '12:00' },
      { day_of_week: 2, start_time: '13:00', end_time: '17:00' },
      { day_of_week: 3, start_time: '08:00', end_time: '10:00' },
    ]);
    const res = resMock();
    const next = jest.fn();

    await availabilityController.setTemplate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      /INSERT INTO helper_availability/.test(sql)
    );
    const placeholders = [...insertCall[0].matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    expect(placeholders).toEqual([1, 2, 3, 4, 1, 5, 6, 7, 1, 8, 9, 10]);
    expect(insertCall[1]).toHaveLength(10);
  });

  test('skips the insert entirely when no slots are given', async () => {
    const req = reqWith([]);
    const res = resMock();
    const next = jest.fn();

    await availabilityController.setTemplate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(
      mockQuery.mock.calls.some(([sql]) => /INSERT INTO helper_availability/.test(sql))
    ).toBe(false);
  });
});
