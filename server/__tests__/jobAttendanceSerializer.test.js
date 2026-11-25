'use strict';
// D-451 (270, G5-4): the exact address is hidden from the assigned helper
// until attendance is confirmed. Pure serializer checks, no DB.
const { serializeJob } = require('../services/jobSerializer');

const base = {
  id: '11111111-1111-1111-1111-111111111111',
  client_id: '22222222-2222-2222-2222-222222222222',
  assigned_helper_id: '33333333-3333-3333-3333-333333333333',
  location_address: '12 Maple Court',
  location_city: 'Springfield',
  location_state: 'OH',
  location_zip: '43015',
  status: 'accepted',
};

describe('jobSerializer attendance gate (270)', () => {
  test('helper without attendance sees no exact address but keeps city/state/zip', () => {
    const out = serializeJob({ ...base }, { user: { id: base.assigned_helper_id } });
    expect(out.location_address).toBeUndefined();
    expect(out.location_city).toBe('Springfield');
    expect(out.location_state).toBe('OH');
  });

  test('helper with attendance confirmed sees the exact address', () => {
    const out = serializeJob(
      { ...base, attendance_confirmed_at: new Date().toISOString() },
      { user: { id: base.assigned_helper_id } },
    );
    expect(out.location_address).toBe('12 Maple Court');
  });

  test('owner and linked viewers are unaffected by the gate', () => {
    const owner = serializeJob({ ...base }, { user: { id: base.client_id } });
    expect(owner.location_address).toBe('12 Maple Court');
    const linked = serializeJob(
      { ...base, recipient_user_id: '44444444-4444-4444-4444-444444444444' },
      { user: { id: '44444444-4444-4444-4444-444444444444' } },
    );
    expect(linked.location_address).toBe('12 Maple Court');
  });

  test('public viewers never see the address', () => {
    const out = serializeJob({ ...base }, { user: null });
    expect(out.location_address).toBeUndefined();
  });
});
